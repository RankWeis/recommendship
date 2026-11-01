CREATE TABLE "edit_clock" (
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"clocks" jsonb NOT NULL,
	CONSTRAINT "edit_clock_table_name_row_id_pk" PRIMARY KEY("table_name","row_id")
);
--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "updated_at" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "updated_at" text;--> statement-breakpoint
ALTER TABLE "recommendation" ADD COLUMN "updated_at" text;--> statement-breakpoint
ALTER TABLE "recommender" ADD COLUMN "updated_at" text;