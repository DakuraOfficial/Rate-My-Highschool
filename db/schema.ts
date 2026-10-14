import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull(),
  authorId: text("author_id").notNull(),
  relationship: text("relationship", { enum: ["parent", "student", "alumnus", "staff"] }).notNull(),
  experienceYear: integer("experience_year").notNull(),
  title: text("title").notNull(),
  text: text("review_text").notNull(),
  technology: integer("technology"), learning: integer("learning"), clubs: integer("clubs"),
  teachers: integer("teachers"), administration: integer("administration"), safety: integer("safety"), culture: integer("culture"),
  revision: integer("revision").notNull().default(1),
  approvedRevision: integer("approved_revision"),
  status: text("status", { enum: ["pending", "published", "rejected", "hidden"] }).notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  publishedAt: text("published_at"),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("reviews_school_author_unique").on(table.schoolId, table.authorId),
  index("reviews_school_public_idx").on(table.schoolId, table.status, table.deletedAt),
  index("reviews_author_idx").on(table.authorId),
  index("reviews_moderation_idx").on(table.status, table.updatedAt),
  check("reviews_relationship_check", sql`${table.relationship} in ('parent','student','alumnus','staff')`),
  check("reviews_status_check", sql`${table.status} in ('pending','published','rejected','hidden')`),
  check("reviews_revision_check", sql`${table.revision} >= 1`),
  check("reviews_title_check", sql`length(${table.title}) between 5 and 100`),
  check("reviews_text_check", sql`length(${table.text}) between 50 and 2000`),
  check("reviews_scores_check", sql`
    (${table.technology} is null or ${table.technology} between 1 and 5) and
    (${table.learning} is null or ${table.learning} between 1 and 5) and
    (${table.clubs} is null or ${table.clubs} between 1 and 5) and
    (${table.teachers} is null or ${table.teachers} between 1 and 5) and
    (${table.administration} is null or ${table.administration} between 1 and 5) and
    (${table.safety} is null or ${table.safety} between 1 and 5) and
    (${table.culture} is null or ${table.culture} between 1 and 5)`),
  check("reviews_at_least_one_score", sql`coalesce(${table.technology}, ${table.learning}, ${table.clubs}, ${table.teachers}, ${table.administration}, ${table.safety}, ${table.culture}) is not null`),
]);

export const reviewReports = sqliteTable("review_reports", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => reviews.id),
  reporterId: text("reporter_id").notNull(),
  reason: text("reason", { enum: ["personal_information", "harassment", "spam", "other"] }).notNull(),
  explanation: text("explanation").notNull().default(""),
  status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), resolvedAt: text("resolved_at"),
}, (table) => [
  uniqueIndex("reports_review_reporter_unique").on(table.reviewId, table.reporterId),
  index("reports_status_idx").on(table.status, table.updatedAt),
  check("reports_reason_check", sql`${table.reason} in ('personal_information','harassment','spam','other')`),
  check("reports_status_check", sql`${table.status} in ('open','resolved')`),
  check("reports_explanation_check", sql`length(${table.explanation}) <= 500`),
]);

export const moderationHistory = sqliteTable("moderation_history", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").references(() => reviews.id),
  reportId: text("report_id").references(() => reviewReports.id),
  moderatorId: text("moderator_id").notNull(),
  action: text("action").notNull(), revision: integer("revision"),
  note: text("note").notNull().default(""), createdAt: text("created_at").notNull(),
}, (table) => [index("moderation_review_idx").on(table.reviewId, table.createdAt)]);

/** A bounded counter per account/action remains effective across Worker instances. */
export const writeThrottles = sqliteTable("write_throttles", {
  authorId: text("author_id").notNull(),
  kind: text("kind").notNull(), windowStart: integer("window_start").notNull(), count: integer("count").notNull(),
}, (table) => [primaryKey({ columns: [table.authorId, table.kind] })]);
