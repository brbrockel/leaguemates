ALTER TABLE "users" ADD COLUMN "nickname" text;--> statement-breakpoint
-- People who play go by their player nickname (their first league's, if more than one).
UPDATE "users" u SET "nickname" = p."display_name"
FROM (
  SELECT DISTINCT ON ("user_id") "user_id", "display_name"
  FROM "players" WHERE "user_id" IS NOT NULL
  ORDER BY "user_id", "created_at"
) p
WHERE p."user_id" = u."id";
