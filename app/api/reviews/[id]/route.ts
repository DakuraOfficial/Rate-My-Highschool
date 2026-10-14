import { getSchool } from "../../../lib/directory";
import { DomainError, validateReviewInput } from "../../../lib/domain";
import { removeReview, updateReview } from "../../../lib/reviews";
import { apiError, expectedRevision, jsonResponse, readJson, requireWriter } from "../http";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireWriter(request, "review");
    const body = await readJson(request);
    const input = validateReviewInput(body);
    if (!await getSchool(input.schoolId)) throw new DomainError("School not found.", 404);
    const { id } = await context.params;
    return jsonResponse({ review: await updateReview(id, user.userId, input, expectedRevision(body)) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireWriter(request, "review");
    const body = await readJson(request);
    const { id } = await context.params;
    return jsonResponse({ review: await removeReview(id, user.userId, expectedRevision(body)) });
  } catch (error) { return apiError(error); }
}
