import Link from "next/link";
import { requireChatGPTUser } from "../chatgpt-auth";
import ModerationPanel from "../components/ModerationPanel";
import type { SchoolSummary } from "../components/ReviewForm";
import { getSchool } from "../lib/directory";
import { displayName } from "../lib/format";
import { isModerator } from "../lib/moderator";
import { getModerationQueue } from "../lib/reviews";

export const metadata = { title: "Moderation | Rate My Highschool" };
export const dynamic = "force-dynamic";

export default async function ModerationPage() {
  const user = await requireChatGPTUser("/moderation");
  if (!isModerator(user.userId)) {
    return <div className="container page-content"><h1 className="page-title">Moderator access required</h1><div className="notice"><p>This account is not authorized to moderate school reviews. Access is configured by the site owner.</p><Link className="text-link" href="/#schools">Return to Find schools</Link></div></div>;
  }
  let queue;
  let error = "";
  try {
    queue = await getModerationQueue();
  } catch {
    error = "The moderation records are temporarily unavailable. Please retry before taking an action.";
  }
  const schools: Record<string, SchoolSummary> = {};
  const reviews = [...(queue?.reviews ?? []), ...(queue?.reports ?? []).flatMap((report) => report.review ? [report.review] : [])];
  for (const review of reviews) {
    const school = getSchool(review.schoolId);
    if (school) schools[school.id] = { id: school.id, name: displayName(school.name), city: school.city, state: school.state };
  }
  return <div className="container page-content">
    <h1 className="page-title">Moderation</h1>
    <p className="muted">Review school-level experiences for personal information, harassment, and spam. Every action is recorded.</p>
    <ModerationPanel schools={schools} initialQueue={queue} initialError={error} />
  </div>;
}
