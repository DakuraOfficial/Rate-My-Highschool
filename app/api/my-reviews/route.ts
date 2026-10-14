import { getChatGPTUser } from "../../chatgpt-auth";
import { DomainError } from "../../lib/domain";
import { getMyReviews } from "../../lib/reviews";
import { apiError, jsonResponse } from "../reviews/http";

export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new DomainError("Sign in to see your reviews.", 401);
    return jsonResponse({ reviews: await getMyReviews(user.userId) });
  } catch (error) { return apiError(error); }
}
