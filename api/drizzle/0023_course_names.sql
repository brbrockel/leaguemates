-- Official names from the clubs' own sites (checked 2026-10-15).
UPDATE "courses" SET "name" = 'Rockledge Golf Club' WHERE "name" = 'Rockledge Country Club'
  AND NOT EXISTS (SELECT 1 FROM "courses" WHERE "name" = 'Rockledge Golf Club');
--> statement-breakpoint
-- North Ridge (formerly Pine Valley), Southington: reported closed and redeveloped; no card exists.
DELETE FROM "courses" c
WHERE c."name" IN ('North Ridge Golf Club', 'Pine Valley Golf Club')
  AND NOT EXISTS (SELECT 1 FROM "layouts" l WHERE l."course_id" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "seasons" s WHERE s."course_id" = c."id");
