import Link from "next/link";
import { notFound } from "next/navigation";
import { requireChatGPTUser } from "../../../chatgpt-auth";
import ReviewForm from "../../../components/ReviewForm";
import { getSchool } from "../../../lib/directory";
import { displayName } from "../../../lib/format";
import { getOwnReview } from "../../../lib/reviews";

export const metadata = { title: "Review a school | Rate My Highschool" };
export const dynamic = "force-dynamic";

export default async function ReviewSchoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const school = getSchool(id);
  if (!school) notFound();
  const user = await requireChatGPTUser(`/schools/${id}/review`);
  let review;
  let error = "";
  try {
    review = await getOwnReview(user.userId, id);
  } catch {
    error = "We couldn’t check your existing review. Please retry before submitting so your saved experience stays intact.";
  }
  return <div className="container page-content">
    <Link className="text-link" href={`/schools/${id}`}>← Back to school</Link>
    <h1 className="page-title">{review && !review.deletedAt ? "Edit your school review" : "Share your school experience"}</h1>
    <h2 className="section-title">{displayName(school.name)}</h2>
    <p className="muted">{school.city}, {school.state}</p>
    {error ? <div className="error-message" role="alert"><p>{error}</p><Link className="button secondary" href={`/schools/${id}/review`}>Try again</Link></div> : <ReviewForm school={{ id: school.id, name: displayName(school.name), city: school.city, state: school.state }} existing={review ?? undefined} />}
  </div>;
}
