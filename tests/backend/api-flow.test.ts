import test from "node:test";
import assert from "node:assert/strict";
import type { Review, Report, Summary } from "../../app/lib/domain.ts";

// Opt in against a running local preview after its D1 migration has been applied.
// The Sites local sign-in middleware owns this cookie and strips spoofed identity headers.
const baseUrl = process.env.API_TEST_BASE_URL;
const schoolId = "270819004415";

test("persistent API review, report, and moderation flow", { skip: !baseUrl, timeout: 120_000 }, async () => {
  const request = async <T>(path: string, options: {
    method?: string; body?: Record<string, unknown>; signedIn?: boolean; origin?: string; spoof?: boolean;
  } = {}) => {
    const headers: Record<string, string> = {};
    if (options.signedIn) headers.cookie = "__sites_local_auth=1";
    if (options.method) headers.origin = options.origin ?? baseUrl!;
    if (options.body) headers["Content-Type"] = "application/json";
    if (options.spoof) {
      headers["oai-authenticated-user-id"] = "local_seedy";
      headers["oai-authenticated-user-email"] = "pretend@example.invalid";
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET", headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const content = await response.text();
    let data: T;
    try { data = JSON.parse(content) as T; }
    catch {
      if (response.status >= 400) data = { error: content.slice(0, 200) } as T;
      else throw new Error(`${path} returned ${response.status}: ${content.slice(0, 200)}`);
    }
    return { status: response.status, data };
  };
  const publicReviews = () => request<{ reviews: Review[]; summary: Summary }>(`/api/reviews?school=${schoolId}`);
  const form = {
    schoolId, relationship: "parent", experienceYear: 2026, title: "Local database verification",
    text: "This temporary review checks the local database and moderation flow. It will be deleted after verification.",
    ratings: { technology: 5, teachers: 3 }, confirmed: true,
  };
  const moderator = (body: Record<string, unknown>) => request<{ review?: Review; report?: Report }>("/api/moderation", { method: "POST", body, signedIn: true });

  assert.equal((await request<{ authenticated: boolean }>("/api/session")).data.authenticated, false);
  const session = await request<{ authenticated: boolean; moderator: boolean; userId: string }>("/api/session", { signedIn: true });
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.moderator, true);
  assert.equal((await request("/api/my-reviews", { spoof: true })).status, 401);
  assert.equal((await request("/api/moderation")).status, 401);
  assert.equal((await request("/api/reviews", { method: "POST", body: form })).status, 401);
  assert.equal((await request("/api/reviews", { method: "POST", body: form, signedIn: true, origin: "https://outside.example" })).status, 403);
  const invalid = await request<{ fields: Record<string, string> }>("/api/reviews", { method: "POST", body: { ...form, title: "no" }, signedIn: true });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.data.fields.title);

  const existing = (await request<{ reviews: Review[] }>("/api/my-reviews", { signedIn: true })).data.reviews.find((review) => review.schoolId === schoolId);
  const submitted = existing && !existing.deletedAt
    ? await request<{ review: Review }>(`/api/reviews/${existing.id}`, { method: "PATCH", body: { ...form, revision: existing.revision }, signedIn: true })
    : await request<{ review: Review }>("/api/reviews", { method: "POST", body: form, signedIn: true });
  assert.ok(submitted.status === 200 || submitted.status === 201);
  let review = submitted.data.review;
  assert.equal(review.status, "pending");
  assert.equal("authorId" in review, false);
  assert.equal((await publicReviews()).data.reviews.some((item) => item.id === review.id), false);
  assert.equal((await request("/api/reviews", { method: "POST", body: form, signedIn: true })).status, 409);
  assert.equal((await moderator({ action: "approve", reviewId: review.id, revision: review.revision + 1 })).status, 409);

  const approval = await moderator({ action: "approve", reviewId: review.id, revision: review.revision, note: "Temporary API verification" });
  assert.equal(approval.status, 200);
  review = approval.data.review!;
  const published = (await publicReviews()).data;
  assert.ok(published.reviews.some((item) => item.id === review.id));
  assert.equal(published.summary.overall, 4);
  assert.deepEqual(published.summary.categories.technology, { average: 5, count: 1 });
  assert.deepEqual(published.summary.categories.teachers, { average: 3, count: 1 });
  assert.deepEqual(published.summary.categories.safety, { average: null, count: 0 });
  assert.equal(JSON.stringify(published).includes(session.data.userId), false);
  assert.equal((await publicReviews()).data.summary.count, 1);

  const reported = await request<{ report: Report }>(`/api/reviews/${review.id}/report`, { method: "POST", body: { reason: "spam", explanation: "Temporary verification report" }, signedIn: true });
  assert.equal(reported.status, 201);
  const duplicateReport = await request<{ report: Report }>(`/api/reviews/${review.id}/report`, { method: "POST", body: { reason: "other", explanation: "Repeated receipt" }, signedIn: true });
  assert.equal(duplicateReport.data.report.id, reported.data.report.id);
  assert.equal(duplicateReport.data.report.reason, "spam");
  assert.equal((await publicReviews()).data.summary.count, 1);
  assert.equal((await moderator({ action: "resolve", reportId: reported.data.report.id, updatedAt: reported.data.report.updatedAt })).status, 200);
  const reopened = await request<{ report: Report }>(`/api/reviews/${review.id}/report`, { method: "POST", body: { reason: "harassment" }, signedIn: true });
  assert.equal(reopened.data.report.id, reported.data.report.id);
  assert.equal(reopened.data.report.status, "open");
  assert.equal(reopened.data.report.reason, "harassment");
  assert.equal((await moderator({ action: "resolve", reportId: reported.data.report.id, updatedAt: reported.data.report.updatedAt })).status, 409);

  assert.equal((await moderator({ action: "hide", reviewId: review.id, revision: review.revision })).status, 200);
  assert.equal((await publicReviews()).data.summary.count, 0);
  const hiddenReceipt = await request<{ report: Report }>(`/api/reviews/${review.id}/report`, { method: "POST", body: { reason: "other" }, signedIn: true });
  assert.equal(hiddenReceipt.status, 201);
  assert.equal(hiddenReceipt.data.report.id, reported.data.report.id);
  const restored = await moderator({ action: "restore", reviewId: review.id, revision: review.revision });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.review?.publishedAt, review.publishedAt);
  assert.equal((await publicReviews()).data.summary.count, 1);
  assert.equal((await moderator({ action: "resolve", reportId: reported.data.report.id, updatedAt: reopened.data.report.updatedAt })).status, 200);

  const edited = await request<{ review: Review }>(`/api/reviews/${review.id}`, { method: "PATCH", body: { ...form, ratings: { safety: 2 }, revision: review.revision }, signedIn: true });
  assert.equal(edited.status, 200);
  const originalRevision = review.revision;
  review = edited.data.review;
  assert.equal(review.status, "pending");
  assert.equal(review.revision, originalRevision + 1);
  assert.equal(review.publishedAt, null);
  assert.equal((await publicReviews()).data.summary.count, 0);
  assert.equal((await moderator({ action: "approve", reviewId: review.id, revision: originalRevision })).status, 409);
  assert.equal((await moderator({ action: "restore", reviewId: review.id, revision: review.revision })).status, 409);
  assert.equal((await request(`/api/reviews/${review.id}`, { method: "PATCH", body: { ...form, revision: originalRevision }, signedIn: true })).status, 409);

  const deleted = await request<{ review: Review }>(`/api/reviews/${review.id}`, { method: "DELETE", body: { revision: review.revision }, signedIn: true });
  assert.equal(deleted.status, 200);
  assert.ok(deleted.data.review.deletedAt);
  const resubmitted = await request<{ review: Review }>("/api/reviews", { method: "POST", body: form, signedIn: true });
  assert.equal(resubmitted.status, 201);
  assert.equal(resubmitted.data.review.id, review.id);
  assert.equal(resubmitted.data.review.status, "pending");
  assert.equal(resubmitted.data.review.deletedAt, null);
  assert.equal(resubmitted.data.review.createdAt, review.createdAt);
  const finalDelete = await request<{ review: Review }>(`/api/reviews/${review.id}`, { method: "DELETE", body: { revision: resubmitted.data.review.revision }, signedIn: true });
  assert.equal(finalDelete.status, 200);
  assert.equal((await publicReviews()).data.summary.count, 0);
  console.log(`Verified API flow; temporary review ${review.id} is soft-deleted (school ${schoolId}).`);
});
