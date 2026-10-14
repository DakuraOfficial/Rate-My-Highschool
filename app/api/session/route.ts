import { getChatGPTUser } from "../../chatgpt-auth";
import { isModerator } from "../../lib/moderator";
import { apiError, jsonResponse } from "../reviews/http";

export async function GET() {
  try {
    const user = await getChatGPTUser();
    return jsonResponse({ authenticated: Boolean(user), moderator: Boolean(user && isModerator(user.userId)), userId: user?.userId ?? null });
  } catch (error) { return apiError(error); }
}
