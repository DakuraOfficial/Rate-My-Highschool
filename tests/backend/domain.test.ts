import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAuthor, calculateSummary, DomainError, isModeratorId, publicReview,
  transitionReview, editReview, deleteReview, assertReportResolution, nextTimestamp, reportReceiptOrValidate, validateReportInput, validateReviewInput, verifySameOrigin,
} from "../../app/lib/domain.ts";
import type { Report, StoredReview } from "../../app/lib/domain.ts";

const valid = {
  schoolId: "001234567890", relationship: "parent", experienceYear: 2026,
  title: "A helpful school", text: "Our family has had a thoughtful and positive experience at this school.",
  ratings: { technology: 5, teachers: 3 },
};
const review = (patch: Partial<StoredReview> = {}): StoredReview => ({
  ...valid, relationship: "parent", id: "r1", authorId: "private-owner", revision: 1,
  status: "published", approvedRevision: 1, createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z", publishedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null, ...patch,
});
const hasStatus = (status: number) => (error: unknown) => error instanceof DomainError && error.status === status;

test("overall gives every review equal weight and ignores unanswered categories", () => {
  const result = calculateSummary([
    review({ ratings: { technology: 5 } }),
    review({ id: "r2", ratings: { technology: 1, teachers: 1, clubs: 1 } }),
  ]);
  assert.equal(result.overall, 3);
  assert.equal(result.count, 2);
  assert.deepEqual(result.categories.technology, { average: 3, count: 2 });
  assert.deepEqual(result.categories.teachers, { average: 1, count: 1 });
  assert.deepEqual(result.categories.safety, { average: null, count: 0 });
});

test("only published nondeleted reviews contribute to counts, dates, and scores", () => {
  const result = calculateSummary([
    review({ status: "pending" }), review({ status: "hidden" }), review({ status: "rejected" }),
    review({ deletedAt: "2026-02-01T00:00:00.000Z" }),
    review({ id: "r5", ratings: { safety: 2 }, publishedAt: "2026-01-12T00:00:00.000Z" }),
  ]);
  assert.equal(result.overall, 2);
  assert.equal(result.count, 1);
  assert.equal(result.latestReview, "2026-01-12T00:00:00.000Z");
});

test("no published ratings remain null, never zero", () => {
  const result = calculateSummary([]);
  assert.equal(result.overall, null);
  assert.equal(result.latestReview, null);
  assert.equal(result.count, 0);
  for (const category of Object.values(result.categories)) assert.deepEqual(category, { average: null, count: 0 });
});

test("review validation trims writing, preserves leading-zero ID, and omits unanswered ratings", () => {
  assert.deepEqual(validateReviewInput({ ...valid, confirmed: true, title: "  A helpful school  ", ratings: { technology: 5, teachers: null, clubs: "" } }, 2026), {
    ...valid, ratings: { technology: 5 },
  });
});

test("review validation rejects missing scores, fractional/out-of-range/string scores and extra categories", () => {
  for (const ratings of [{}, { safety: 0 }, { clubs: 6 }, { teachers: 3.5 }, { culture: "5" }, { nonsense: 5 }]) {
    assert.throws(() => validateReviewInput({ ...valid, confirmed: true, ratings }, 2026), hasStatus(400));
  }
});

test("review validation enforces title/text/year/relationship and exposes field errors", () => {
  for (const patch of [
    { title: "tiny" }, { title: "x".repeat(101) }, { text: "x".repeat(49) }, { text: "x".repeat(2001) },
    { experienceYear: 1999 }, { experienceYear: 2027 }, { experienceYear: 2025.5 },
    { relationship: "verified parent" }, { schoolId: "invalid" },
  ]) assert.throws(() => validateReviewInput({ ...valid, confirmed: true, ...patch }, 2026), hasStatus(400));
  try { validateReviewInput({ ...valid, confirmed: true, title: "x" }, 2026); }
  catch (error) { assert.ok(error instanceof DomainError); assert.ok(error.fields?.title); }
});

test("submission requires firsthand experience and community-guidelines confirmation", () => {
  assert.throws(() => validateReviewInput(valid, 2026), hasStatus(400));
  assert.throws(() => validateReviewInput({ ...valid, confirmed: false }, 2026), hasStatus(400));
});

test("Unicode writing lengths match SQLite character constraints instead of UTF-16 code units", () => {
  assert.throws(() => validateReviewInput({ ...valid, confirmed: true, title: "😀".repeat(3) }, 2026), hasStatus(400));
  assert.throws(() => validateReviewInput({ ...valid, confirmed: true, text: "😀".repeat(25) }, 2026), hasStatus(400));
  assert.equal(validateReviewInput({ ...valid, confirmed: true, text: "😀".repeat(50) }, 2026).text, "😀".repeat(50));
});

test("public serializer never leaks identity or moderation internals", () => {
  const visible = publicReview(review());
  assert.equal(visible.id, "r1");
  assert.equal("authorId" in visible, false);
  assert.equal("approvedRevision" in visible, false);
  assert.equal(JSON.stringify(visible).includes("private-owner"), false);
});

test("ownership requires an authenticated exact author", () => {
  assert.doesNotThrow(() => assertAuthor(review(), "private-owner"));
  assert.throws(() => assertAuthor(review(), "other-account"), hasStatus(403));
  assert.throws(() => assertAuthor(review(), ""), hasStatus(401));
});

test("editing approved or deleted content returns the same review to pending and clears its publication", () => {
  const edited = editReview(review({ deletedAt: "before" }), valid as StoredReview, "private-owner", 1, "now");
  assert.equal(edited.id, "r1");
  assert.equal(edited.status, "pending");
  assert.equal(edited.revision, 2);
  assert.equal(edited.deletedAt, null);
  assert.equal(edited.publishedAt, null);
  assert.equal(edited.approvedRevision, null);
  assert.throws(() => editReview(review(), valid as StoredReview, "other", 1, "now"), hasStatus(403));
  assert.throws(() => editReview(review(), valid as StoredReview, "private-owner", 2, "now"), hasStatus(409));
  assert.throws(() => editReview(review(), { ...valid, schoolId: "009999999999" } as StoredReview, "private-owner", 1, "now"), hasStatus(400));
});

test("author deletion is revision-safe and immediately removes the review from ratings", () => {
  const deleted = deleteReview(review(), "private-owner", 1, "now");
  assert.equal(deleted.deletedAt, "now");
  assert.equal(deleted.revision, 2);
  assert.equal(calculateSummary([deleted]).count, 0);
  assert.throws(() => deleteReview(review(), "other", 1, "now"), hasStatus(403));
  assert.throws(() => deleteReview(review(), "private-owner", 0, "now"), hasStatus(409));
});

test("writes require an exact same origin and reject missing or cross-site origin", () => {
  assert.doesNotThrow(() => verifySameOrigin("https://schools.example/api/reviews", "https://schools.example"));
  assert.throws(() => verifySameOrigin("https://schools.example/api/reviews", "https://evil.example"), hasStatus(403));
  assert.throws(() => verifySameOrigin("https://schools.example/api/reviews", null), hasStatus(403));
  assert.throws(() => verifySameOrigin("https://schools.example/api/reviews", "https://schools.example.evil.example"), hasStatus(403));
});

test("moderator access denies a missing allowlist and matches complete stable IDs only", () => {
  assert.equal(isModeratorId("owner", undefined), false);
  assert.equal(isModeratorId("owner", " owner, second "), true);
  assert.equal(isModeratorId("own", "owner"), false);
  assert.equal(isModeratorId("", ",,"), false);
});

test("approve/reject require pending live content and exact loaded revision", () => {
  const pending = review({ status: "pending", approvedRevision: null, publishedAt: null });
  const approved = transitionReview(pending, "approve", 1, "2026-02-01T00:00:00.000Z");
  assert.equal(approved.status, "published");
  assert.equal(approved.approvedRevision, 1);
  assert.equal(approved.publishedAt, "2026-02-01T00:00:00.000Z");
  assert.equal(transitionReview(pending, "reject", 1, "now").status, "rejected");
  assert.throws(() => transitionReview(pending, "approve", 2, "now"), hasStatus(409));
  assert.throws(() => transitionReview(review(), "approve", 1, "now"), hasStatus(409));
  assert.throws(() => transitionReview({ ...pending, deletedAt: "then" }, "reject", 1, "now"), hasStatus(409));
});

test("hide/restore retain publication date, and unapproved edited content cannot be restored", () => {
  const hidden = transitionReview(review(), "hide", 1, "now");
  assert.equal(hidden.status, "hidden");
  assert.equal(transitionReview(hidden, "restore", 1, "later").publishedAt, "2026-01-01T00:00:00.000Z");
  assert.throws(() => transitionReview({ ...hidden, revision: 2 }, "restore", 2, "now"), hasStatus(409));
  assert.throws(() => transitionReview({ ...hidden, deletedAt: "then" }, "restore", 1, "now"), hasStatus(409));
  assert.throws(() => transitionReview(review({ status: "pending" }), "hide", 1, "now"), hasStatus(409));
});

test("report validation accepts known reasons and enforces a trimmed 500-character maximum", () => {
  assert.deepEqual(validateReportInput({ reason: "spam", explanation: "  Repeated advertising.  " }), { reason: "spam", explanation: "Repeated advertising." });
  assert.deepEqual(validateReportInput({ reason: "personal_information" }), { reason: "personal_information", explanation: "" });
  assert.throws(() => validateReportInput({ reason: "disagreement" }), hasStatus(400));
  assert.throws(() => validateReportInput({ reason: "other", explanation: "x".repeat(501) }), hasStatus(400));
});

test("an unresolved report retains its receipt after hiding, while new or reopened reports require publication", () => {
  const receipt: Report = { id: "report1", reviewId: "r1", reason: "spam", explanation: "", status: "open", createdAt: "then", updatedAt: "then", resolvedAt: null };
  assert.equal(reportReceiptOrValidate(review({ status: "hidden" }), receipt)?.id, "report1");
  assert.equal(reportReceiptOrValidate(review(), null), null);
  assert.throws(() => reportReceiptOrValidate(review({ status: "hidden" }), null), hasStatus(409));
  assert.throws(() => reportReceiptOrValidate(review({ deletedAt: "now" }), null), hasStatus(409));
  assert.throws(() => reportReceiptOrValidate(review({ status: "hidden" }), { ...receipt, status: "resolved" }), hasStatus(409));
});

test("resolving a report requires the open version displayed to the moderator", () => {
  const receipt: Report = { id: "report1", reviewId: "r1", reason: "spam", explanation: "", status: "open", createdAt: "then", updatedAt: "newer", resolvedAt: null };
  assert.doesNotThrow(() => assertReportResolution(receipt, "newer"));
  assert.throws(() => assertReportResolution(receipt, "older"), hasStatus(409));
  assert.throws(() => assertReportResolution({ ...receipt, status: "resolved" }, "newer"), hasStatus(409));
});

test("report version timestamps increase even when the clock repeats or moves backward", () => {
  assert.equal(nextTimestamp("2026-01-01T00:00:00.001Z", Date.parse("2026-01-01T00:00:00.001Z")), "2026-01-01T00:00:00.002Z");
  assert.equal(nextTimestamp("2026-01-01T00:00:00.001Z", Date.parse("2026-01-01T00:00:00.000Z")), "2026-01-01T00:00:00.002Z");
  assert.equal(nextTimestamp(null, Date.parse("2026-01-01T00:00:00.000Z")), "2026-01-01T00:00:00.000Z");
});
