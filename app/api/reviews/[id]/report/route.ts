import { validateReportInput } from "../../../../lib/domain";
import { reportReview } from "../../../../lib/reviews";
import { apiError, jsonResponse, readJson, requireWriter } from "../../http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireWriter(request, "report");
    const input = validateReportInput(await readJson(request));
    const { id } = await context.params;
    return jsonResponse({ report: await reportReview(user.userId, id, input) }, 201);
  } catch (error) { return apiError(error); }
}
