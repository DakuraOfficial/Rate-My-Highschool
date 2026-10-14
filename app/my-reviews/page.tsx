import MyReviews from "../components/MyReviews";
import type { SchoolSummary } from "../components/ReviewForm";
import { requireChatGPTUser } from "../chatgpt-auth";
import { getSchool } from "../lib/directory";
import { displayName } from "../lib/format";
import { getMyReviews } from "../lib/reviews";
import { isModerator } from "../lib/moderator";

export const metadata = { title: "My reviews | Rate My Highschool" };
export const dynamic = "force-dynamic";

export default async function MyReviewsPage() {
  const user = await requireChatGPTUser("/my-reviews");
  let reviews;
  let error = "";
  try {
    reviews = await getMyReviews(user.userId);
  } catch {
    error = "Your saved reviews are temporarily unavailable. Please retry; no review records have been changed.";
  }
  const schools: Record<string, SchoolSummary> = {};
  for (const review of reviews ?? []) {
    const school = getSchool(review.schoolId);
    if (school) schools[school.id] = { id: school.id, name: displayName(school.name), city: school.city, state: school.state };
  }
  return <div className="container page-content">
    <h1 className="page-title">My reviews</h1>
    <p className="muted">Manage your school experiences. Your account details are private; published reviews appear anonymously.</p>
    {isModerator(user.userId) ? <div className="actions" style={{ marginTop: 20 }}><a className="button secondary" href="/moderation">Moderate reviews</a></div> : null}
    <MyReviews schools={schools} initialReviews={reviews} initialError={error} />
  </div>;
}
