-- The old handicap settings (last N rounds, minimum rounds) were placeholders nobody confirmed.
-- Drop them so the new defaults apply (best 10 of the last 20, fitted to the league's history).
UPDATE "leagues" SET "settings" = "settings" - 'handicap' WHERE "settings" ? 'handicap';
