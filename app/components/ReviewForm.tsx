"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { CATEGORIES, type CategoryKey, type Review } from "../lib/domain";

export const REVIEW_CATEGORIES = CATEGORIES.map(({ key, label }) => [key, label] as const);

export type SchoolSummary = { id: string; name: string; city: string; state: string };
export type OwnedReview = Review;

type Props = {
  school: SchoolSummary;
  existing?: OwnedReview;
  onSaved?: () => void;
  onCancel?: () => void;
};

export default function ReviewForm({ school, existing, onSaved, onCancel }: Props) {
  const currentYear = new Date().getFullYear();
  const [relationship, setRelationship] = useState(existing?.relationship ?? "parent");
  const [experienceYear, setExperienceYear] = useState(String(existing?.experienceYear ?? currentYear));
  const [ratings, setRatings] = useState<Partial<Record<CategoryKey, number>>>(existing?.ratings ?? {});
  const [title, setTitle] = useState(existing?.title ?? "");
  const [text, setText] = useState(existing?.text ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  function changeRating(key: CategoryKey, value: number | null) {
    setRatings((previous) => {
      const next = { ...previous };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const nextErrors: Record<string, string> = {};
    const year = Number(experienceYear);
    if (!Number.isInteger(year) || year < 2000 || year > currentYear) {
      nextErrors.experienceYear = `Choose a year from 2000 to ${currentYear}.`;
    }
    if (Object.keys(ratings).length === 0) nextErrors.ratings = "Rate at least one category.";
    if (title.trim().length < 5 || title.trim().length > 100) nextErrors.title = "Use 5–100 characters for your title.";
    if (text.trim().length < 50 || text.trim().length > 2000) nextErrors.text = "Write 50–2,000 characters about your experience.";
    if (!confirmed) nextErrors.confirmed = "Confirm your firsthand experience and agreement to the community guidelines.";
    setErrors(nextErrors);
    setRequestError("");
    setSignInRequired(false);
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(existing ? `/api/reviews/${encodeURIComponent(existing.id)}` : "/api/reviews", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId: school.id,
          relationship,
          experienceYear: year,
          title: title.trim(),
          text: text.trim(),
          ratings,
          confirmed,
          ...(existing ? { revision: existing.revision } : {}),
        }),
      });
      const data = await response.json().catch(() => null) as { error?: string; fields?: Record<string, string>; review?: OwnedReview } | null;
      if (!response.ok) {
        setErrors(data?.fields ?? {});
        setSignInRequired(response.status === 401);
        setRequestError(data?.error ?? "We couldn’t save your review. Your answers are still here; please try again.");
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      if (!data?.review?.id || data.review.schoolId !== school.id || data.review.status !== "pending") {
        setRequestError("The service did not confirm the saved review. Check My reviews before trying again; your answers are still here.");
        requestAnimationFrame(() => errorRef.current?.focus());
        return;
      }
      setSaved(true);
      onSaved?.();
    } catch {
      setRequestError("We couldn’t reach the review service. Your answers are still here; please try again.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return <div className="notice" role="status">
      <h2 className="section-title">Your review is awaiting moderation.</h2>
      <p>Thanks for sharing your experience. It will appear anonymously once approved.</p>
      <div className="actions">
        <Link className="button" href="/my-reviews">View My reviews</Link>
        <Link className="button secondary" href={`/schools/${school.id}`}>Return to school</Link>
      </div>
    </div>;
  }

  return <form className="review-form" onSubmit={submit} noValidate>
    <div className="notice">
      <p>Your review will display anonymously with your relationship and experience year. All submissions await moderation. Relationship labels are self-reported.</p>
      {existing && !existing.deletedAt ? <p>Saving an edit removes the previous version from public reviews and ratings until the new version is approved.</p> : null}
    </div>

    {requestError || Object.keys(errors).length ? <div className="error-message" ref={errorRef} tabIndex={-1} role="alert">
      <p>{requestError || "Please check the highlighted fields."}</p>
      {Object.keys(errors).length ? <ul>{Object.entries(errors).map(([field, message]) => <li key={field}>{field === "schoolId" ? message : <a href={`#review-${field}`}>{message}</a>}</li>)}</ul> : null}
      {signInRequired ? <p><a className="button secondary" target="_top" href={`/signin-with-chatgpt?return_to=${encodeURIComponent(`/schools/${school.id}/review`)}`}>Sign in to submit your review</a></p> : null}
      {requestError ? <p>You can <Link className="text-link" href="/my-reviews">check your saved version in My reviews</Link> before retrying.</p> : null}
    </div> : null}

    <fieldset disabled={saving} className="form-section">
      <legend className="section-title">Your school experience</legend>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="review-relationship">My relationship to the school</label>
          <select id="review-relationship" name="relationship" value={relationship} onChange={(event) => setRelationship(event.target.value as OwnedReview["relationship"])} aria-invalid={Boolean(errors.relationship)} aria-describedby={`review-relationship-help${errors.relationship ? " review-relationship-error" : ""}`}>
            <option value="parent">Parent / guardian</option>
            <option value="student">Student</option>
            <option value="alumnus">Alumnus</option>
            <option value="staff">Staff</option>
          </select>
          <p id="review-relationship-help" className="field-hint">This relationship is self-reported.</p>
          {errors.relationship ? <p id="review-relationship-error" className="error-message">{errors.relationship}</p> : null}
        </div>
        <div className="form-field">
          <label htmlFor="review-experienceYear">School experience year</label>
          <input id="review-experienceYear" name="experienceYear" type="number" inputMode="numeric" min={2000} max={currentYear} required value={experienceYear} onChange={(event) => setExperienceYear(event.target.value)} aria-invalid={Boolean(errors.experienceYear)} aria-describedby={errors.experienceYear ? "review-year-error" : "review-year-help"} />
          <p id="review-year-help" className="field-hint">The most recent year you experienced this school.</p>
          {errors.experienceYear ? <p id="review-year-error" className="error-message">{errors.experienceYear}</p> : null}
        </div>
      </div>
    </fieldset>

    <fieldset className="form-section" disabled={saving} id="review-ratings" aria-describedby="review-rating-help">
      <legend className="section-title">Rate what you know</legend>
      <p id="review-rating-help" className="muted">1 = very poor · 5 = excellent. Rate at least one category; leave anything outside your experience unrated.</p>
      {errors.ratings ? <p className="error-message" role="alert">{errors.ratings}</p> : null}
      {REVIEW_CATEGORIES.map(([key, label]) => <fieldset key={key} className="rating-group" id={`review-ratings.${key}`} aria-invalid={Boolean(errors[`ratings.${key}`])} aria-describedby={errors[`ratings.${key}`] ? `review-rating-error-${key}` : undefined}>
        <legend>{label}</legend>
        <div className="actions">
          {[1, 2, 3, 4, 5].map((value) => <label className="rating-choice" key={value}>
            <input type="radio" name={`rating-${key}`} value={value} checked={ratings[key] === value} onChange={() => changeRating(key, value)} aria-label={`${label}: ${value} out of 5`} />
            <span>{value}</span>
          </label>)}
          <label className="rating-choice">
            <input type="radio" name={`rating-${key}`} value="" checked={ratings[key] === undefined} onChange={() => changeRating(key, null)} aria-label={`${label}: not rated`} />
            <span>Not rated</span>
          </label>
        </div>
        {errors[`ratings.${key}`] ? <p id={`review-rating-error-${key}`} className="error-message">{errors[`ratings.${key}`]}</p> : null}
      </fieldset>)}
    </fieldset>

    <fieldset className="form-section" disabled={saving}>
      <legend className="section-title">Tell other families about it</legend>
      <p className="muted">Discuss the school as a whole. Don’t name individual teachers, administrators, students, or children. Personal contact information, harassment, and spam are prohibited.</p>
      <div className="form-field">
        <label htmlFor="review-title">Review title</label>
        <input id="review-title" name="title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} required aria-invalid={Boolean(errors.title)} aria-describedby={`review-title-help${errors.title ? " review-title-error" : ""}`} placeholder="A few words about your experience" />
        <p id="review-title-help" className="field-hint">{title.length}/100 characters · minimum 5</p>
        {errors.title ? <p id="review-title-error" className="error-message">{errors.title}</p> : null}
      </div>
      <div className="form-field">
        <label htmlFor="review-text">Your experience</label>
        <textarea id="review-text" name="text" rows={7} value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} required aria-invalid={Boolean(errors.text)} aria-describedby={`review-text-help${errors.text ? " review-text-error" : ""}`} placeholder="What worked well? What could improve? Share details that would help a family considering this school." />
        <p id="review-text-help" className="field-hint">{text.length}/2,000 characters · minimum 50</p>
        {errors.text ? <p id="review-text-error" className="error-message">{errors.text}</p> : null}
      </div>
      <label className="check-field" htmlFor="review-confirmed">
        <input id="review-confirmed" name="confirmed" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} aria-invalid={Boolean(errors.confirmed)} aria-describedby={errors.confirmed ? "review-confirmation-error" : undefined} />
        <span>I have firsthand experience with this school and agree to the school-level community guidelines above.</span>
      </label>
      {errors.confirmed ? <p id="review-confirmation-error" className="error-message">{errors.confirmed}</p> : null}
    </fieldset>
    <div className="actions">
      <button className="button" type="submit" disabled={saving}>{saving ? "Saving your review…" : existing ? "Resubmit for moderation" : "Submit for moderation"}</button>
      {onCancel ? <button className="button secondary" type="button" disabled={saving} onClick={onCancel}>Cancel edit</button> : <Link className="text-link" href={`/schools/${school.id}`}>Back to {school.name}</Link>}
    </div>
    <p className="field-hint">Only one review per account per school. You can edit or delete it from My reviews.</p>
  </form>;
}
