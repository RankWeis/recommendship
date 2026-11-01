CREATE TABLE "user_limits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"rows" integer,
	"changes_per_day" integer,
	"unlimited" boolean DEFAULT false NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text NOT NULL
);
