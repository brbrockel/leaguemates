ALTER TABLE "players" ADD COLUMN "spot" integer;--> statement-breakpoint
-- Number existing players 1..n per league, in the order they were added.
UPDATE "players" p SET "spot" = n.rn
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "league_id" ORDER BY "created_at", "id") AS rn
  FROM "players"
) n
WHERE p."id" = n."id";--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "spot" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "players_league_spot_idx" ON "players" USING btree ("league_id","spot");
