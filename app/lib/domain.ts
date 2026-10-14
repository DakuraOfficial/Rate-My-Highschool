/** Pure review rules shared by persistence, the interface, and deterministic tests. */
export const CATEGORIES = [
  { key: "technology", label: "Technology" },
  { key: "learning", label: "Learning opportunities" },
  { key: "clubs", label: "Clubs" },
  { key: "teachers", label: "Teachers" },
  { key: "administration", label: "Administration" },
  { key: "safety", label: "Safety" },
  { key: "culture", label: "School culture" },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export type Ratings = Partial<Record<CategoryKey, number>>;
export const RELATIONSHIPS = ["parent", "student", "alumnus", "staff"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export type ReviewStatus = "pending" | "published" | "rejected" | "hidden";
export type ReviewInput = {
  schoolId: string; relationship: Relationship; experienceYear: number;
  title: string; text: string; ratings: Ratings;
};
export type Review = ReviewInput & {
  id: string; revision: number; status: ReviewStatus;
  createdAt: string; updatedAt: string; publishedAt: string | null; deletedAt: string | null;
};
export type StoredReview = Review & { authorId: string; approvedRevision: number | null };
export type Summary = {
  overall: number | null; count: number;
  categories: Record<CategoryKey, { average: number | null; count: number }>;
  latestReview: string | null;
};
export const REPORT_REASONS = ["personal_information", "harassment", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type Report = {
  id: string; reviewId: string; reason: ReportReason; explanation: string;
  status: "open" | "resolved"; createdAt: string; updatedAt: string; resolvedAt: string | null;
  review?: Review | null;
};
export type ModerationAction = "approve" | "reject" | "hide" | "restore";

export class DomainError extends Error {
  status: number;
  fields?: Record<string, string>;
  constructor(message: string, status = 400, fields?: Record<string, string>) {
    super(message);
    this.name = "DomainError";
    this.status = status;
    this.fields = fields;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("Provide a valid JSON object.");
  return value as Record<string, unknown>;
}

export function validateReviewInput(value: unknown, currentYear = new Date().getFullYear()): ReviewInput {
  const data = object(value);
  const fields: Record<string, string> = {};
  const schoolId = typeof data.schoolId === "string" ? data.schoolId.trim() : "";
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!/^\d{12}$/.test(schoolId)) fields.schoolId = "Choose a school from the directory.";
  if (!RELATIONSHIPS.includes(data.relationship as Relationship)) fields.relationship = "Choose your relationship to the school.";
  if (!Number.isInteger(data.experienceYear) || (data.experienceYear as number) < 2000 || (data.experienceYear as number) > currentYear) {
    fields.experienceYear = `Enter a year from 2000 through ${currentYear}.`;
  }
  const titleLength = Array.from(title).length;
  const textLength = Array.from(text).length;
  if (titleLength < 5 || titleLength > 100) fields.title = "Use 5–100 characters for the title.";
  if (textLength < 50 || textLength > 2000) fields.text = "Use 50–2,000 characters for your experience.";
  if (data.confirmed !== true) fields.confirmed = "Confirm firsthand experience and agreement with the community guidelines.";
  const ratings: Ratings = {};
  if (!data.ratings || typeof data.ratings !== "object" || Array.isArray(data.ratings)) fields.ratings = "Choose at least one category score.";
  else {
    const validKeys = new Set(CATEGORIES.map((category) => category.key));
    for (const [key, score] of Object.entries(data.ratings)) {
      if (!validKeys.has(key as CategoryKey)) { fields.ratings = "Use only the seven listed categories."; continue; }
      if (score === null || score === undefined || score === "") continue;
      if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5) fields[`ratings.${key}`] = "Choose a whole-number score from 1 to 5.";
      else ratings[key as CategoryKey] = score as number;
    }
    if (!Object.keys(ratings).length) fields.ratings ??= "Choose at least one category score.";
  }
  if (Object.keys(fields).length) throw new DomainError("Please check the highlighted fields.", 400, fields);
  return { schoolId, relationship: data.relationship as Relationship, experienceYear: data.experienceYear as number, title, text, ratings };
}

export function validateReportInput(value: unknown): { reason: ReportReason; explanation: string } {
  const data = object(value);
  const explanation = typeof data.explanation === "string" ? data.explanation.trim() : "";
  if (!REPORT_REASONS.includes(data.reason as ReportReason)) throw new DomainError("Choose a report reason.", 400, { reason: "Choose a listed reason." });
  if (data.explanation !== undefined && typeof data.explanation !== "string") throw new DomainError("Provide text for the explanation.");
  if (explanation.length > 500) throw new DomainError("Keep the explanation to 500 characters.", 400, { explanation: "Use at most 500 characters." });
  return { reason: data.reason as ReportReason, explanation };
}

export function reportReceiptOrValidate(review: Review, existingReport: Report | null): Report | null {
  if (existingReport?.status === "open") return existingReport;
  if (review.status !== "published" || review.deletedAt) throw new DomainError("Only a published review can be reported.", 409);
  return null;
}

export function assertReportResolution(report: Report, expectedUpdatedAt: string): void {
  if (report.status !== "open" || expectedUpdatedAt !== report.updatedAt) throw new DomainError("This report changed. Refresh the moderation queue before resolving it.", 409);
}

export function nextTimestamp(previous: string | null, now = Date.now()): string {
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now).toISOString();
}

export function calculateSummary(reviews: readonly Review[]): Summary {
  const categories = Object.fromEntries(CATEGORIES.map(({ key }) => [key, { average: null, count: 0 }])) as Summary["categories"];
  const totals: Partial<Record<CategoryKey, number>> = {};
  let overallTotal = 0;
  let count = 0;
  let latestReview: string | null = null;
  for (const review of reviews) {
    if (review.status !== "published" || review.deletedAt) continue;
    const values: number[] = [];
    for (const { key } of CATEGORIES) {
      const score = review.ratings[key];
      if (typeof score !== "number") continue;
      values.push(score);
      totals[key] = (totals[key] ?? 0) + score;
      categories[key].count += 1;
    }
    if (!values.length) continue;
    overallTotal += values.reduce((sum, score) => sum + score, 0) / values.length;
    count += 1;
    if (review.publishedAt && (!latestReview || review.publishedAt > latestReview)) latestReview = review.publishedAt;
  }
  for (const { key } of CATEGORIES) if (categories[key].count) categories[key].average = totals[key]! / categories[key].count;
  return { overall: count ? overallTotal / count : null, count, categories, latestReview };
}

/** An explicit whitelist prevents private account or audit fields reaching any client. */
export function publicReview(review: StoredReview): Review {
  return {
    id: review.id, schoolId: review.schoolId, relationship: review.relationship, experienceYear: review.experienceYear,
    title: review.title, text: review.text, ratings: review.ratings, revision: review.revision, status: review.status,
    createdAt: review.createdAt, updatedAt: review.updatedAt, publishedAt: review.publishedAt, deletedAt: review.deletedAt,
  };
}

export function assertAuthor(review: StoredReview, userId: string): void {
  if (!userId) throw new DomainError("Sign in to manage your review.", 401);
  if (review.authorId !== userId) throw new DomainError("You can only manage your own reviews.", 403);
}

export function editReview(review: StoredReview, input: ReviewInput, userId: string, expectedRevision: number, now: string): StoredReview {
  assertAuthor(review, userId);
  if (expectedRevision !== review.revision || !Number.isInteger(expectedRevision)) throw new DomainError("This review changed. Reload your latest review before editing.", 409);
  if (input.schoolId !== review.schoolId) throw new DomainError("A review cannot be moved to another school.");
  return { ...review, ...input, revision: review.revision + 1, status: "pending", updatedAt: now,
    approvedRevision: null, publishedAt: null, deletedAt: null };
}

export function deleteReview(review: StoredReview, userId: string, expectedRevision: number, now: string): StoredReview {
  assertAuthor(review, userId);
  if (expectedRevision !== review.revision || !Number.isInteger(expectedRevision)) throw new DomainError("This review changed. Reload your latest review before deleting.", 409);
  if (review.deletedAt) throw new DomainError("This review is already deleted.", 409);
  return { ...review, revision: review.revision + 1, updatedAt: now, deletedAt: now };
}

export function verifySameOrigin(requestUrl: string, origin: string | null): void {
  if (!origin || origin !== new URL(requestUrl).origin) throw new DomainError("This request must come from this site.", 403);
}

export function isModeratorId(userId: string, allowlist: string | undefined): boolean {
  return Boolean(userId && allowlist?.split(",").map((id) => id.trim()).filter(Boolean).includes(userId));
}

export function transitionReview(review: StoredReview, action: ModerationAction, expectedRevision: number, now: string): StoredReview {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== review.revision) throw new DomainError("This review changed. Refresh before moderating it.", 409);
  if (review.deletedAt) throw new DomainError("A deleted review cannot be moderated.", 409);
  if (action === "approve" || action === "reject") {
    if (review.status !== "pending") throw new DomainError("Only pending reviews can be approved or rejected.", 409);
    return { ...review, status: action === "approve" ? "published" : "rejected", updatedAt: now,
      approvedRevision: action === "approve" ? review.revision : review.approvedRevision,
      publishedAt: action === "approve" ? now : review.publishedAt };
  }
  if (action === "hide") {
    if (review.status !== "published") throw new DomainError("Only published reviews can be hidden.", 409);
    return { ...review, status: "hidden", updatedAt: now };
  }
  if (action === "restore") {
    if (review.status !== "hidden" || review.approvedRevision !== review.revision || !review.publishedAt) throw new DomainError("Only previously approved, unchanged hidden reviews can be restored.", 409);
    return { ...review, status: "published", updatedAt: now };
  }
  throw new DomainError("Choose a valid moderation action.");
}
