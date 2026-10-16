ALTER TABLE "courses" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;