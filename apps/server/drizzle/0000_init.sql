CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"created_at" text NOT NULL,
	"rating_scale_min" double precision DEFAULT 1 NOT NULL,
	"rating_scale_max" double precision DEFAULT 5 NOT NULL,
	"approved_at" text
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"external_source" text DEFAULT 'NONE' NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"code" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"note" text,
	"used_by" text,
	"used_at" text
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category_id" text NOT NULL,
	"title" text NOT NULL,
	"year" integer,
	"creator" text,
	"external_source" text,
	"external_id" text,
	"image_url" text,
	"metadata" text,
	"status" text DEFAULT 'TO_TRY' NOT NULL,
	"rating" double precision,
	"rated_at" text,
	"review" text,
	"added_at" text NOT NULL,
	"tried_at" text
);
--> statement-breakpoint
CREATE TABLE "recommendation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"recommender_id" text NOT NULL,
	"received_at" text NOT NULL,
	"channel" text,
	"enthusiasm" smallint,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "recommender" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" text NOT NULL,
	"linked_user_id" text
);
--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_recommender_id_recommender_id_fk" FOREIGN KEY ("recommender_id") REFERENCES "public"."recommender"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_user_idx" ON "category" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "item_user_idx" ON "item" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_external_uq" ON "item" USING btree ("user_id","external_source","external_id") WHERE "item"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recommendation_user_idx" ON "recommendation" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_pair_uq" ON "recommendation" USING btree ("item_id","recommender_id");--> statement-breakpoint
CREATE INDEX "recommender_user_idx" ON "recommender" USING btree ("user_id");