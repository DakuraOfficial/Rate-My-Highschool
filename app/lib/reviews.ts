import { env } from "cloudflare:workers";
import {
  CATEGORIES, assertReportResolution, calculateSummary, deleteReview, DomainError, editReview, isModeratorId, nextTimestamp, publicReview, reportReceiptOrValidate, transitionReview,
} from "./domain";
import type { CategoryKey, ModerationAction, Ratings, Report, ReportReason, Review, ReviewInput, ReviewStatus, StoredReview, Summary } from "./domain";

type ReviewRow = {
  id: string; school_id: string; author_id: string; relationship: ReviewInput["relationship"];
  experience_year: number; title: string; review_text: string;
  revision: number; approved_revision: number | null; status: ReviewStatus;
  created_at: string; updated_at: string; published_at: string | null; deleted_at: string | null;
} & Record<CategoryKey, number | null>;
type ReportRow = {
  id: string; review_id: string; reason: ReportReason; explanation: string; status: "open" | "resolved";
  created_at: string; updated_at: string; resolved_at: string | null;
};

export function getReviewDatabase(): D1Database {
  const database = (env as { DB?: D1Database }).DB;
  if (!database) throw new DomainError("The review service is temporarily unavailable. Please try again later.", 503);
  return database;
}

function fromRow(row: ReviewRow): StoredReview {
  const ratings: Ratings = {};
  for (const { key } of CATEGORIES) if (row[key] !== null) ratings[key] = row[key];
  return {
    id: row.id, schoolId: row.school_id, authorId: row.author_id,
    relationship: row.relationship, experienceYear: row.experience_year, title: row.title, text: row.review_text, ratings,
    revision: row.revision, approvedRevision: row.approved_revision, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at, deletedAt: row.deleted_at,
  };
}

function reportFromRow(row: ReportRow): Report {
  return { id: row.id, reviewId: row.review_id, reason: row.reason, explanation: row.explanation,
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at };
}

export async function getStoredReview(id: string): Promise<StoredReview> {
  const row = await getReviewDatabase().prepare("SELECT * FROM reviews WHERE id = ?").bind(id).first<ReviewRow>();
  if (!row) throw new DomainError("Review not found.", 404);
  return fromRow(row);
}

async function getStoredOwnReview(userId: string, schoolId: string): Promise<StoredReview | null> {
  const row = await getReviewDatabase().prepare("SELECT * FROM reviews WHERE author_id = ? AND school_id = ?").bind(userId, schoolId).first<ReviewRow>();
  return row ? fromRow(row) : null;
}

export async function getOwnReview(userId: string, schoolId: string): Promise<Review | null> {
  const review = await getStoredOwnReview(userId, schoolId);
  return review ? publicReview(review) : null;
}

export async function getPublicReviews(schoolId: string): Promise<Review[]> {
  const { results } = await getReviewDatabase().prepare("SELECT * FROM reviews WHERE school_id = ? AND status = 'published' AND deleted_at IS NULL ORDER BY published_at DESC, id DESC").bind(schoolId).all<ReviewRow>();
  return results.map((row) => publicReview(fromRow(row)));
}

export async function getSchoolReviews(schoolId: string): Promise<{ reviews: Review[]; summary: Summary }> {
  const reviews = await getPublicReviews(schoolId);
  return { reviews, summary: calculateSummary(reviews) };
}

const scoreSum = CATEGORIES.map(({ key }) => `COALESCE(${key}, 0)`).join(" + ");
const answerCount = CATEGORIES.map(({ key }) => `(CASE WHEN ${key} IS NULL THEN 0 ELSE 1 END)`).join(" + ");
const categoryAggregates = CATEGORIES.map(({ key }) => `AVG(${key}) AS ${key}_average, COUNT(${key}) AS ${key}_count`).join(", ");
type SummaryRow = { school_id: string; overall: number | null; count: number; latest_review: string | null } & Record<string, number | string | null>;

export async function getSchoolSummaries(schoolIds: readonly string[]): Promise<Record<string, Summary>> {
  const ids = [...new Set(schoolIds)];
  if (!ids.length) return {};
  if (ids.length > 100) throw new DomainError("Request no more than 100 school summaries.");
  const summaries: Record<string, Summary> = Object.fromEntries(ids.map((id) => [id, calculateSummary([])]));
  const { results } = await getReviewDatabase().prepare(`SELECT school_id, COUNT(*) AS count,
    AVG(1.0 * (${scoreSum}) / (${answerCount})) AS overall, MAX(published_at) AS latest_review,
    ${categoryAggregates} FROM reviews WHERE school_id IN (${ids.map(() => "?").join(",")})
    AND status = 'published' AND deleted_at IS NULL GROUP BY school_id`).bind(...ids).all<SummaryRow>();
  for (const row of results) {
    const categories = Object.fromEntries(CATEGORIES.map(({ key }) => [key, {
      average: row[`${key}_average`] as number | null, count: row[`${key}_count`] as number,
    }])) as Summary["categories"];
    summaries[row.school_id] = { overall: row.overall, count: row.count, latestReview: row.latest_review, categories };
  }
  return summaries;
}

export async function getSchoolSummary(schoolId: string): Promise<Summary> {
  return (await getSchoolSummaries([schoolId]))[schoolId];
}

export async function getMyReviews(userId: string): Promise<Review[]> {
  if (!userId) throw new DomainError("Sign in to see your reviews.", 401);
  const { results } = await getReviewDatabase().prepare("SELECT * FROM reviews WHERE author_id = ? ORDER BY updated_at DESC, id DESC").bind(userId).all<ReviewRow>();
  return results.map((row) => publicReview(fromRow(row)));
}

/** One atomic bounded counter per account/action protects every Worker instance. */
export async function consumeWriteAllowance(userId: string, kind: "review" | "report" | "moderation"): Promise<void> {
  const limit = { review: 12, report: 20, moderation: 120 }[kind];
  const now = Math.floor(Date.now() / 1000);
  const row = await getReviewDatabase().prepare(`INSERT INTO write_throttles (author_id, kind, window_start, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(author_id, kind) DO UPDATE SET
    count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END,
    window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
    WHERE window_start <= ? OR count < ? RETURNING count`).bind(userId, kind, now, now - 3600, now - 3600, now - 3600, limit).first<{ count: number }>();
  if (!row) throw new DomainError("Too many requests. Please wait before trying again.", 429);
}

function ratingValues(ratings: Ratings): (number | null)[] {
  return CATEGORIES.map(({ key }) => ratings[key] ?? null);
}

export async function createReview(userId: string, input: ReviewInput): Promise<Review> {
  const existing = await getStoredOwnReview(userId, input.schoolId);
  if (existing) {
    if (!existing.deletedAt) throw new DomainError("You already have a review for this school. Edit your existing review in My reviews.", 409);
    return updateReview(existing.id, userId, input, existing.revision);
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const result = await getReviewDatabase().prepare(`INSERT INTO reviews
    (id, school_id, author_id, relationship, experience_year, title, review_text,
      technology, learning, clubs, teachers, administration, safety, culture, revision, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?)
    ON CONFLICT(school_id, author_id) DO NOTHING`).bind(
      id, input.schoolId, userId, input.relationship, input.experienceYear, input.title, input.text,
      ...ratingValues(input.ratings), now, now,
    ).run();
  if (!result.meta.changes) throw new DomainError("A review already exists for this school. Reload My reviews.", 409);
  return publicReview(await getStoredReview(id));
}

export async function updateReview(id: string, userId: string, input: ReviewInput, revision: number): Promise<Review> {
  const review = await getStoredReview(id);
  const next = editReview(review, input, userId, revision, new Date().toISOString());
  const result = await getReviewDatabase().prepare(`UPDATE reviews SET relationship = ?, experience_year = ?, title = ?, review_text = ?,
    technology = ?, learning = ?, clubs = ?, teachers = ?, administration = ?, safety = ?, culture = ?,
    revision = revision + 1, approved_revision = NULL, status = 'pending', updated_at = ?, published_at = NULL, deleted_at = NULL
    WHERE id = ? AND author_id = ? AND revision = ?`).bind(
      next.relationship, next.experienceYear, next.title, next.text, ...ratingValues(next.ratings), next.updatedAt, id, userId, revision,
    ).run();
  if (!result.meta.changes) throw new DomainError("This review changed. Reload before saving.", 409);
  return publicReview(next);
}

export async function removeReview(id: string, userId: string, revision: number): Promise<Review> {
  const review = await getStoredReview(id);
  const next = deleteReview(review, userId, revision, new Date().toISOString());
  const result = await getReviewDatabase().prepare("UPDATE reviews SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND author_id = ? AND revision = ? AND deleted_at IS NULL")
    .bind(next.deletedAt, next.updatedAt, id, userId, revision).run();
  if (!result.meta.changes) throw new DomainError("This review changed. Reload before deleting.", 409);
  return publicReview(next);
}

export async function reportReview(userId: string, reviewId: string, input: { reason: ReportReason; explanation: string }): Promise<Report> {
  const review = await getStoredReview(reviewId);
  const database = getReviewDatabase();
  const existing = await database.prepare("SELECT id, review_id, reason, explanation, status, created_at, updated_at, resolved_at FROM review_reports WHERE review_id = ? AND reporter_id = ?")
    .bind(reviewId, userId).first<ReportRow>();
  const receipt = reportReceiptOrValidate(review, existing ? reportFromRow(existing) : null);
  if (receipt) return receipt;
  const now = nextTimestamp(existing?.updated_at ?? null);
  // Open duplicates keep their original receipt; resolved duplicates reuse and reopen the same record.
  await database.prepare(`INSERT INTO review_reports (id, review_id, reporter_id, reason, explanation, status, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, 'open', ?, ? WHERE EXISTS (SELECT 1 FROM reviews WHERE id = ? AND status = 'published' AND deleted_at IS NULL)
    ON CONFLICT(review_id, reporter_id) DO UPDATE SET reason = excluded.reason, explanation = excluded.explanation,
    status = 'open', updated_at = excluded.updated_at, resolved_at = NULL WHERE review_reports.status = 'resolved' AND review_reports.updated_at = ?`)
    .bind(crypto.randomUUID(), reviewId, userId, input.reason, input.explanation, now, now, reviewId, existing?.updated_at ?? null).run();
  const row = await database.prepare("SELECT id, review_id, reason, explanation, status, created_at, updated_at, resolved_at FROM review_reports WHERE review_id = ? AND reporter_id = ?")
    .bind(reviewId, userId).first<ReportRow>();
  if (!row || row.status !== "open") throw new DomainError("The review or report changed before your report was received. Please reload.", 409);
  return reportFromRow(row);
}

export async function getModerationQueue(): Promise<{ reviews: Review[]; reports: Report[] }> {
  const database = getReviewDatabase();
  const [reviewResult, reportResult] = await Promise.all([
    database.prepare("SELECT * FROM reviews WHERE deleted_at IS NULL AND status IN ('pending','hidden','published') ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'hidden' THEN 1 ELSE 2 END, updated_at DESC").all<ReviewRow>(),
    database.prepare("SELECT id, review_id, reason, explanation, status, created_at, updated_at, resolved_at FROM review_reports WHERE status = 'open' ORDER BY created_at ASC LIMIT 200").all<ReportRow>(),
  ]);
  const reports = await Promise.all(reportResult.results.map(async (row) => {
    const reviewRow = await database.prepare("SELECT * FROM reviews WHERE id = ?").bind(row.review_id).first<ReviewRow>();
    return { ...reportFromRow(row), review: reviewRow ? publicReview(fromRow(reviewRow)) : null };
  }));
  return { reviews: reviewResult.results.map((row) => publicReview(fromRow(row))), reports };
}

export async function moderateReview(moderatorId: string, id: string, action: ModerationAction, revision: number, note: string): Promise<Review> {
  if (!isModeratorId(moderatorId, (env as { MODERATOR_USER_IDS?: string }).MODERATOR_USER_IDS)) throw new DomainError("Your account is not authorized to moderate this site.", 403);
  const review = await getStoredReview(id);
  const now = new Date().toISOString();
  const next = transitionReview(review, action, revision, now);
  const database = getReviewDatabase();
  // D1 batches are transactions. changes() ties the audit entry to the successful conditional update.
  const results = await database.batch([
    database.prepare(`UPDATE reviews SET status = ?, approved_revision = ?, published_at = ?, updated_at = ?
      WHERE id = ? AND revision = ? AND status = ? AND deleted_at IS NULL`).bind(next.status, next.approvedRevision, next.publishedAt, now, id, revision, review.status),
    database.prepare(`INSERT INTO moderation_history (id, review_id, moderator_id, action, revision, note, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`).bind(crypto.randomUUID(), id, moderatorId, action, revision, note, now),
  ]);
  if (!results[0].meta.changes) throw new DomainError("This review changed. Refresh the moderation queue.", 409);
  return publicReview(next);
}

export async function resolveReport(moderatorId: string, reportId: string, expectedUpdatedAt: string, note: string): Promise<Report> {
  if (!isModeratorId(moderatorId, (env as { MODERATOR_USER_IDS?: string }).MODERATOR_USER_IDS)) throw new DomainError("Your account is not authorized to moderate this site.", 403);
  const database = getReviewDatabase();
  const report = await database.prepare("SELECT id, review_id, reason, explanation, status, created_at, updated_at, resolved_at FROM review_reports WHERE id = ?").bind(reportId).first<ReportRow>();
  if (!report) throw new DomainError("Report not found.", 404);
  assertReportResolution(reportFromRow(report), expectedUpdatedAt);
  const now = nextTimestamp(report.updated_at);
  const results = await database.batch([
    database.prepare("UPDATE review_reports SET status = 'resolved', updated_at = ?, resolved_at = ? WHERE id = ? AND status = 'open' AND updated_at = ?").bind(now, now, reportId, expectedUpdatedAt),
    database.prepare(`INSERT INTO moderation_history (id, review_id, report_id, moderator_id, action, note, created_at)
      SELECT ?, ?, ?, ?, 'resolve', ?, ? WHERE changes() = 1`).bind(crypto.randomUUID(), report.review_id, reportId, moderatorId, note, now),
  ]);
  if (!results[0].meta.changes) throw new DomainError("This report changed. Refresh the moderation queue.", 409);
  return reportFromRow({ ...report, status: "resolved", updated_at: now, resolved_at: now });
}
