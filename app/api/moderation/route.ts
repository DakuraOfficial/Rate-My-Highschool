import { DomainError } from "../../lib/domain";
import type { ModerationAction } from "../../lib/domain";
import { requireModerator } from "../../lib/moderator";
import { consumeWriteAllowance, getModerationQueue, moderateReview, resolveReport } from "../../lib/reviews";
import { apiError, expectedRevision, jsonResponse, readJson, requireWriter } from "../reviews/http";

export async function GET() {
  try {
    await requireModerator();
    return jsonResponse(await getModerationQueue());
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await requireWriter(request, "moderation");
    const user = await requireModerator();
    await consumeWriteAllowance(user.userId, "moderation");
    const body = await readJson(request);
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (body.note !== undefined && typeof body.note !== "string") throw new DomainError("Provide text for the internal note.");
    if (note.length > 1000) throw new DomainError("Keep the internal note to 1,000 characters.");
    if (body.action === "resolve") {
      if (typeof body.reportId !== "string" || !body.reportId) throw new DomainError("Choose a report to resolve.");
      if (typeof body.updatedAt !== "string" || !body.updatedAt || body.updatedAt.length > 64) throw new DomainError("Refresh the report before resolving it.");
      return jsonResponse({ report: await resolveReport(user.userId, body.reportId, body.updatedAt, note) });
    }
    if (!["approve", "reject", "hide", "restore"].includes(body.action as string)) throw new DomainError("Choose a valid moderation action.");
    if (typeof body.reviewId !== "string" || !body.reviewId) throw new DomainError("Choose a review to moderate.");
    return jsonResponse({ review: await moderateReview(user.userId, body.reviewId, body.action as ModerationAction, expectedRevision(body), note) });
  } catch (error) { return apiError(error); }
}
