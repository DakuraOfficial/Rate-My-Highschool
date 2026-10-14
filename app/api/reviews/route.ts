import { getSchool } from "../../lib/directory";
import { DomainError, validateReviewInput } from "../../lib/domain";
import { createReview, getSchoolReviews } from "../../lib/reviews";
import { apiError, jsonResponse, readJson, requireWriter } from "./http";

export async function GET(request: Request) {
  try {
    const schoolId = new URL(request.url).searchParams.get("school") ?? "";
    if (!await getSchool(schoolId)) throw new DomainError("School not found. Choose a school from the directory.", 404);
    return jsonResponse(await getSchoolReviews(schoolId));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireWriter(request, "review");
    const input = validateReviewInput(await readJson(request));
    if (!await getSchool(input.schoolId)) throw new DomainError("School not found. Choose a school from the directory.", 404, { schoolId: "School not found." });
    return jsonResponse({ review: await createReview(user.userId, input) }, 201);
  } catch (error) { return apiError(error); }
}
