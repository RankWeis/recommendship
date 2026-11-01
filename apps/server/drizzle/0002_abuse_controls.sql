CREATE TABLE "suspension" (
	"user_id" text PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"by" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "write_usage" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"ops" integer NOT NULL,
	CONSTRAINT "write_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
