import { getChatGPTUser } from "../../chatgpt-auth";
import { DomainError, verifySameOrigin } from "../../lib/domain";
import { consumeWriteAllowance } from "../../lib/reviews";

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiError(error: unknown): Response {
  if (error instanceof DomainError) {
    const response = jsonResponse({ error: error.message, ...(error.fields ? { fields: error.fields } : {}) }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", "3600");
    return response;
  }
  console.error("Review service request failed", error);
  return jsonResponse({ error: "The review service is temporarily unavailable. Please try again later." }, 503);
}

export async function requireWriter(request: Request, kind: "review" | "report" | "moderation") {
  verifySameOrigin(request.url, request.headers.get("origin"));
  const user = await getChatGPTUser();
  if (!user) throw new DomainError("Sign in to continue.", 401);
  // Moderation callers check authorization before consuming the higher allowance.
  if (kind !== "moderation") await consumeWriteAllowance(user.userId, kind);
  return user;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new DomainError("Send the form as JSON.", 415);
  const maxBytes = 16_384;
  if (Number(request.headers.get("content-length")) > maxBytes) throw new DomainError("This form is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("Provide a valid form.");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new DomainError("This form is too large.", 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new DomainError("Provide valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("Provide a valid form object.");
  return value as Record<string, unknown>;
}

export function expectedRevision(body: Record<string, unknown>): number {
  if (!Number.isInteger(body.revision) || (body.revision as number) < 1) throw new DomainError("Reload the latest review before making changes.", 400, { revision: "A current review revision is required." });
  return body.revision as number;
}
