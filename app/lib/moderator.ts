import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../chatgpt-auth";
import { DomainError, isModeratorId } from "./domain";

export function isModerator(userId: string): boolean {
  return isModeratorId(userId, (env as { MODERATOR_USER_IDS?: string }).MODERATOR_USER_IDS);
}

export async function requireModerator(): Promise<{ userId: string }> {
  const user = await getChatGPTUser();
  if (!user) throw new DomainError("Sign in to access moderation.", 401);
  if (!isModerator(user.userId)) throw new DomainError("Your account is not authorized to moderate this site.", 403);
  return { userId: user.userId };
}
