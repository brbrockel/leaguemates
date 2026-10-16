DROP INDEX "players_league_name_idx";--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "full_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "players_league_nickname_idx" ON "players" USING btree ("league_id",lower("display_name"));