ALTER TABLE "card_rounds" ADD COLUMN "gross" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "recorded_outcome" text;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "official_standings" jsonb;