ALTER TABLE "matches" ADD COLUMN "bracket_slot" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "seed_a" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "seed_b" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "decided_winner_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "decided_reason" text;--> statement-breakpoint
ALTER TABLE "weeks" ADD COLUMN "playoff_round" integer;--> statement-breakpoint
ALTER TABLE "weeks" ADD COLUMN "is_final" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_decided_winner_id_players_id_fk" FOREIGN KEY ("decided_winner_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;