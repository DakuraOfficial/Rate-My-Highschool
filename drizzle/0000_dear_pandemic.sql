CREATE TABLE `moderation_history` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text,
	`report_id` text,
	`moderator_id` text NOT NULL,
	`action` text NOT NULL,
	`revision` integer,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`report_id`) REFERENCES `review_reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `moderation_review_idx` ON `moderation_history` (`review_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `review_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reports_reason_check" CHECK("review_reports"."reason" in ('personal_information','harassment','spam','other')),
	CONSTRAINT "reports_status_check" CHECK("review_reports"."status" in ('open','resolved')),
	CONSTRAINT "reports_explanation_check" CHECK(length("review_reports"."explanation") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_review_reporter_unique` ON `review_reports` (`review_id`,`reporter_id`);--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `review_reports` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`author_id` text NOT NULL,
	`relationship` text NOT NULL,
	`experience_year` integer NOT NULL,
	`title` text NOT NULL,
	`review_text` text NOT NULL,
	`technology` integer,
	`learning` integer,
	`clubs` integer,
	`teachers` integer,
	`administration` integer,
	`safety` integer,
	`culture` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`approved_revision` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`published_at` text,
	`deleted_at` text,
	CONSTRAINT "reviews_relationship_check" CHECK("reviews"."relationship" in ('parent','student','alumnus','staff')),
	CONSTRAINT "reviews_status_check" CHECK("reviews"."status" in ('pending','published','rejected','hidden')),
	CONSTRAINT "reviews_revision_check" CHECK("reviews"."revision" >= 1),
	CONSTRAINT "reviews_title_check" CHECK(length("reviews"."title") between 5 and 100),
	CONSTRAINT "reviews_text_check" CHECK(length("reviews"."review_text") between 50 and 2000),
	CONSTRAINT "reviews_scores_check" CHECK(
    ("reviews"."technology" is null or "reviews"."technology" between 1 and 5) and
    ("reviews"."learning" is null or "reviews"."learning" between 1 and 5) and
    ("reviews"."clubs" is null or "reviews"."clubs" between 1 and 5) and
    ("reviews"."teachers" is null or "reviews"."teachers" between 1 and 5) and
    ("reviews"."administration" is null or "reviews"."administration" between 1 and 5) and
    ("reviews"."safety" is null or "reviews"."safety" between 1 and 5) and
    ("reviews"."culture" is null or "reviews"."culture" between 1 and 5)),
	CONSTRAINT "reviews_at_least_one_score" CHECK(coalesce("reviews"."technology", "reviews"."learning", "reviews"."clubs", "reviews"."teachers", "reviews"."administration", "reviews"."safety", "reviews"."culture") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_school_author_unique` ON `reviews` (`school_id`,`author_id`);--> statement-breakpoint
CREATE INDEX `reviews_school_public_idx` ON `reviews` (`school_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `reviews_author_idx` ON `reviews` (`author_id`);--> statement-breakpoint
CREATE INDEX `reviews_moderation_idx` ON `reviews` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `write_throttles` (
	`author_id` text NOT NULL,
	`kind` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`author_id`, `kind`)
);
