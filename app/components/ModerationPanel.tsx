"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORIES, type Report, type Review as OwnedReview } from "../lib/domain";
import type { SchoolSummary } from "./ReviewForm";

const REVIEW_CATEGORIES = CATEGORIES.map(({ key, label }) => [key, label] as const);

export type Queue = { reviews: OwnedReview[]; reports: Report[] };
type Action = "approve" | "reject" | "hide" | "restore" | "resolve";
type Props = { initialQueue?: Queue; initialError?: string; schools: Record<string, SchoolSummary> };

const ACTION_LABELS: Record<Action, string> = { approve: "Approve review", reject: "Reject review", hide: "Hide review", restore: "Restore review", resolve: "Resolve report" };
const REASON_LABELS: Record<string, string> = { personal_information: "Personal information", harassment: "Harassment", spam: "Spam", other: "Other" };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function ReviewContent({ review, school }: { review: OwnedReview; school?: SchoolSummary }) {
  return <>
    <p><Link className="text-link" href={`/schools/${review.schoolId}`}>{school?.name ?? `School · NCES ${review.schoolId}`}</Link>{school?.city || school?.state ? <span className="muted"> · {[school.city, school.state].filter(Boolean).join(", ")}</span> : null}</p>
    <div className="review-meta"><span className="pill">{review.deletedAt ? "Deleted" : review.status.charAt(0).toUpperCase() + review.status.slice(1)}</span><span>{review.relationship} · experience in {review.experienceYear}</span></div>
    <h3>{review.title}</h3>
    <p className="review-copy">{review.text}</p>
    <div className="review-meta">{REVIEW_CATEGORIES.filter(([key]) => review.ratings[key] !== undefined).map(([key, label]) => <span key={key}>{label}: {review.ratings[key]}/5</span>)}</div>
    <p className="field-hint">Updated {formatDate(review.updatedAt)} · relationship is self-reported</p>
  </>;
}

export default function ModerationPanel({ initialQueue, initialError, schools }: Props) {
  const [queue, setQueue] = useState<Queue>(initialQueue ?? { reviews: [], reports: [] });
  const [loading, setLoading] = useState(initialQueue === undefined && !initialError);
  const [error, setError] = useState(initialError ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reviewFilter, setReviewFilter] = useState<"pending" | "published" | "hidden">("pending");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/moderation", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { error?: string; reviews?: OwnedReview[]; reports?: Report[] } | null;
      if (!response.ok || !Array.isArray(data?.reviews) || !Array.isArray(data?.reports)) {
        setError(data?.error ?? "We couldn’t load the moderation queue. Please try again.");
        return;
      }
      setQueue({ reviews: data.reviews, reports: data.reports });
    } catch {
      setError("We couldn’t reach the moderation service. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialQueue !== undefined || initialError) return;
    let active = true;
    const controller = new AbortController();
    fetch("/api/moderation", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { error?: string; reviews?: OwnedReview[]; reports?: Report[] } | null;
        if (!response.ok || !Array.isArray(data?.reviews) || !Array.isArray(data?.reports)) throw new Error(data?.error ?? "We couldn’t load the moderation queue.");
        if (active) setQueue({ reviews: data.reviews, reports: data.reports });
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "We couldn’t reach the moderation service."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [initialQueue, initialError]);

  async function takeAction(action: Action, noteKey: string, review?: OwnedReview, report?: Report) {
    if (busy || loading) return;
    setBusy(noteKey);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(review ? { reviewId: review.id, revision: review.revision } : {}),
          ...(report ? { reportId: report.id, updatedAt: report.updatedAt } : {}),
          note: notes[noteKey] ?? "",
        }),
      });
      const data = await response.json().catch(() => null) as { error?: string; review?: OwnedReview; report?: Report } | null;
      if (!response.ok) {
        setError(data?.error ?? "The moderation action could not be saved. Please try again.");
        return;
      }
      const expectedStatus = action === "approve" || action === "restore" ? "published" : action === "reject" ? "rejected" : "hidden";
      const confirmed = action === "resolve" ? data?.report?.id === report?.id && data?.report?.status === "resolved" : data?.review?.id === review?.id && data?.review?.status === expectedStatus;
      if (!confirmed) {
        setError("The service did not confirm this action. Refresh the queue before trying again.");
        return;
      }
      setNotes((previous) => { const next = { ...previous }; delete next[noteKey]; return next; });
      setMessage(action === "resolve" ? "The report is resolved. Resolving a report does not change the review’s publication status." : action === "approve" ? "The review is approved and now contributes to public ratings." : action === "restore" ? "The review is restored and contributes to public ratings again." : action === "hide" ? "The review is hidden and no longer contributes to public ratings." : "The review is rejected and does not appear publicly.");
      await reload();
    } catch {
      setError("We couldn’t reach the moderation service. No successful action has been confirmed.");
    } finally {
      setBusy(null);
    }
  }

  function noteField(noteKey: string) {
    return <div className="form-field">
      <label htmlFor={`note-${noteKey}`}>Internal note <span className="muted">(optional)</span></label>
      <textarea className="moderation-note" id={`note-${noteKey}`} rows={2} maxLength={1000} disabled={Boolean(busy) || loading} value={notes[noteKey] ?? ""} onChange={(event) => setNotes((previous) => ({ ...previous, [noteKey]: event.target.value }))} />
      <p className="field-hint">Stored with the moderation action; never displayed publicly.</p>
    </div>;
  }

  function actionButton(action: Action, noteKey: string, review?: OwnedReview, report?: Report) {
    return <button className={action === "reject" || action === "hide" ? "button secondary" : "button"} key={action} type="button" disabled={Boolean(busy) || loading} onClick={() => takeAction(action, noteKey, review, report)}>{busy === noteKey ? "Saving…" : ACTION_LABELS[action]}</button>;
  }

  const visibleReviews = queue.reviews.filter((review) => review.status === reviewFilter && !review.deletedAt);
  return <div>
    <div className="actions"><button className="button secondary" type="button" onClick={reload} disabled={loading || Boolean(busy)}>{loading ? "Loading queue…" : "Refresh queue"}</button><span className="muted">You control which reviews appear publicly.</span></div>
    {message ? <div className="notice" role="status">{message}</div> : null}
    {error ? <div className="error-message" role="alert"><p>{error}</p><p>Refresh to review the latest content before retrying an action.</p><button className="button secondary" type="button" onClick={reload} disabled={loading || Boolean(busy)}>Reload queue</button></div> : null}
    {loading ? <p className="muted" role="status">Loading moderation records…</p> : null}
    <div className="moderation-columns">
      <section aria-labelledby="review-queue-heading">
        <h2 id="review-queue-heading" className="section-title">Review queue</h2>
        <div className="form-field"><label htmlFor="moderation-review-filter">Review status</label><select id="moderation-review-filter" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as typeof reviewFilter)}><option value="pending">Awaiting moderation</option><option value="published">Published</option><option value="hidden">Hidden</option></select></div>
        {!loading && !error && !visibleReviews.length ? <div className="empty-state"><p>{reviewFilter === "pending" ? "No reviews are awaiting moderation." : `No ${reviewFilter} reviews in this queue.`}</p></div> : null}
        <div className="review-list">{visibleReviews.map((review) => <article className="panel review-card" key={review.id}>
          <ReviewContent review={review} school={schools[review.schoolId]} />
          {noteField(`review-${review.id}`)}
          <div className="actions">{review.status === "pending" ? <>{actionButton("approve", `review-${review.id}`, review)}{actionButton("reject", `review-${review.id}`, review)}</> : review.status === "published" ? actionButton("hide", `review-${review.id}`, review) : actionButton("restore", `review-${review.id}`, review)}</div>
        </article>)}</div>
        <p className="field-hint">Choose a status to review pending submissions or manage published and hidden reviews.</p>
      </section>
      <section aria-labelledby="reports-queue-heading">
        <h2 id="reports-queue-heading" className="section-title">Open reports {!loading && !error ? <span className="muted">({queue.reports.length})</span> : null}</h2>
        <p className="muted">A report does not automatically hide a review or change its rating.</p>
        {!loading && !error && !queue.reports.length ? <div className="empty-state"><p>No open reports.</p></div> : null}
        <div className="review-list">{queue.reports.map((report) => <article className="panel review-card" key={report.id}>
          <div className="review-meta"><span className="pill">{REASON_LABELS[report.reason] ?? report.reason}</span><span>Reported {formatDate(report.updatedAt)}</span></div>
          {report.explanation ? <p className="review-copy">{report.explanation}</p> : <p className="muted">No additional explanation provided.</p>}
          {report.review ? <ReviewContent review={report.review} school={schools[report.review.schoolId]} /> : <p className="muted">The associated review is unavailable.</p>}
          {noteField(`report-${report.id}`)}
          <div className="actions">
            {report.review?.status === "published" && !report.review.deletedAt ? actionButton("hide", `report-${report.id}`, report.review) : null}
            {report.review?.status === "hidden" && !report.review.deletedAt ? actionButton("restore", `report-${report.id}`, report.review) : null}
            {actionButton("resolve", `report-${report.id}`, undefined, report)}
          </div>
        </article>)}</div>
        <p className="field-hint">Up to 200 open reports are shown, oldest first.</p>
      </section>
    </div>
  </div>;
}
