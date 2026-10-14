"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReviewForm, { REVIEW_CATEGORIES, type OwnedReview, type SchoolSummary } from "./ReviewForm";

type Props = {
  schools: Record<string, SchoolSummary>;
  initialReviews?: OwnedReview[];
  initialError?: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export default function MyReviews({ schools, initialReviews, initialError }: Props) {
  const [reviews, setReviews] = useState<OwnedReview[]>(initialReviews ?? []);
  const [loading, setLoading] = useState(initialReviews === undefined && !initialError);
  const [error, setError] = useState(initialError ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/my-reviews", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { error?: string; reviews?: OwnedReview[] } | null;
      if (!response.ok || !Array.isArray(data?.reviews)) {
        setError(data?.error ?? "We couldn’t load your reviews. Please try again.");
        return;
      }
      setReviews(data.reviews);
    } catch {
      setError("We couldn’t reach the review service. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialReviews !== undefined || initialError) return;
    let active = true;
    const controller = new AbortController();
    fetch("/api/my-reviews", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { error?: string; reviews?: OwnedReview[] } | null;
        if (!response.ok || !Array.isArray(data?.reviews)) throw new Error(data?.error ?? "We couldn’t load your reviews.");
        if (active) setReviews(data.reviews);
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "We couldn’t reach the review service."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [initialReviews, initialError]);

  async function deleteReview(review: OwnedReview) {
    if (busyId) return;
    setBusyId(review.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/reviews/${encodeURIComponent(review.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: review.revision }),
      });
      const data = await response.json().catch(() => null) as { error?: string; review?: OwnedReview } | null;
      if (!response.ok) {
        setError(data?.error ?? "We couldn’t delete your review. Please try again.");
        return;
      }
      if (data?.review?.id !== review.id || !data.review.deletedAt) {
        setError("The service did not confirm deletion. Refresh your reviews before trying again.");
        return;
      }
      setDeletingId(null);
      setMessage("Your review was deleted and no longer contributes to public ratings.");
      await reload();
    } catch {
      setError("We couldn’t reach the review service. Your review has not been confirmed deleted.");
    } finally {
      setBusyId(null);
    }
  }

  return <div>
    <div className="actions"><button className="button secondary" type="button" onClick={reload} disabled={loading || Boolean(busyId) || Boolean(editingId)}>{loading ? "Loading reviews…" : "Refresh reviews"}</button><Link className="text-link" href="/#schools">Find a school to review</Link></div>
    {message ? <div className="notice" role="status">{message}</div> : null}
    {error ? <div className="error-message" role="alert"><p>{error}</p><button className="button secondary" type="button" onClick={reload} disabled={loading || Boolean(editingId)}>Try again</button></div> : null}
    {loading ? <p className="muted" role="status">Loading your saved reviews…</p> : null}
    {!loading && !error && !reviews.length ? <div className="empty-state"><h2 className="section-title">Your first review can help another family.</h2><p>Find a school you know and share your firsthand experience.</p><Link className="button" href="/#schools">Find schools</Link></div> : null}
    <div className="review-list">
      {reviews.map((review) => {
        const school = schools[review.schoolId] ?? { id: review.schoolId, name: `School · NCES ${review.schoolId}`, city: "", state: "" };
        const deleted = Boolean(review.deletedAt);
        return <article className="panel review-card" key={review.id}>
          <div className="review-meta"><span className="pill">{deleted ? "Deleted" : review.status === "published" ? "Published" : review.status === "pending" ? "Awaiting moderation" : review.status === "rejected" ? "Rejected" : "Hidden"}</span><span>Updated {formatDate(review.updatedAt)}</span></div>
          <h2 className="section-title"><Link href={`/schools/${school.id}`}>{school.name}</Link></h2>
          {school.city || school.state ? <p className="muted">{[school.city, school.state].filter(Boolean).join(", ")}</p> : null}
          {editingId === review.id ? <ReviewForm key={`${review.id}-${review.revision}`} school={school} existing={review} onCancel={() => setEditingId(null)} onSaved={() => { setEditingId(null); setMessage("Your updated review is awaiting moderation."); void reload(); }} /> : <>
            <h3>{review.title}</h3>
            <p className="review-copy">{review.text}</p>
            <div className="review-meta"><span>{review.relationship === "alumnus" ? "Alumnus" : review.relationship.charAt(0).toUpperCase() + review.relationship.slice(1)} · experience in {review.experienceYear}</span><span>Self-reported relationship</span></div>
            <div className="review-meta">{REVIEW_CATEGORIES.filter(([key]) => review.ratings[key] !== undefined).map(([key, label]) => <span key={key}>{label}: {review.ratings[key]}/5</span>)}</div>
            {!deleted && review.status === "pending" ? <p className="field-hint">Your review will be public after moderator approval.</p> : null}
            {!deleted && (review.status === "rejected" || review.status === "hidden") ? <p className="field-hint">This review does not appear publicly. You can edit and resubmit it for moderation.</p> : null}
            {deleted ? <p className="field-hint">This review is no longer public. Resubmitting reuses your review record and sends it for moderation.</p> : null}
            {deletingId === review.id ? <div className="notice">
              <p>Delete this review? It will stop contributing to public ratings immediately.</p>
              <div className="actions"><button className="button" type="button" disabled={Boolean(busyId)} onClick={() => deleteReview(review)}>{busyId === review.id ? "Deleting…" : "Delete review"}</button><button className="button secondary" type="button" disabled={Boolean(busyId)} onClick={() => setDeletingId(null)}>Keep review</button></div>
            </div> : <div className="actions">
              <button className="button secondary" type="button" disabled={Boolean(busyId) || loading || Boolean(editingId)} onClick={() => { setEditingId(review.id); setDeletingId(null); setMessage(""); }}>{deleted ? "Write a new version" : "Edit review"}</button>
              {!deleted ? <button className="text-link" type="button" disabled={Boolean(busyId) || loading || Boolean(editingId)} onClick={() => setDeletingId(review.id)}>Delete review</button> : null}
            </div>}
          </>}
        </article>;
      })}
    </div>
  </div>;
}
