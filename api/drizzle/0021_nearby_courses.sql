-- Courses within about 20 minutes of Berlin, CT (OpenGolfAPI's Connecticut listing, checked
-- 2026-10-15). Names and towns only: add a course's nines in the course editor when the
-- league plays it. Timberlin, the league's home course, is pinned to the top.
UPDATE "courses" SET "pinned" = true, "notes" = 'Home course · Public · 18 holes'
WHERE "name" = 'Timberlin Golf Club';
--> statement-breakpoint
INSERT INTO "courses" ("name", "city", "state", "notes")
SELECT v.name, v.city, 'CT', v.notes
FROM (VALUES
  ('Shuttle Meadow Country Club', 'Berlin', 'Private · par 71'),
  ('Stanley Golf Course', 'New Britain', 'Public · 27 holes (Blue, White, Red nines)'),
  ('Indian Hill Country Club', 'Newington', 'Private · par 72'),
  ('Hawk''s Landing Country Club', 'Southington', 'Public · par 71'),
  ('North Ridge Golf Club', 'Southington', 'Public · 9 holes'),
  ('Pine Valley Golf Club', 'Southington', 'Public'),
  ('Southington Country Club', 'Plantsville', 'Semi-private · par 71'),
  ('Hunter Golf Club', 'Meriden', 'Public · par 71'),
  ('TPC River Highlands', 'Cromwell', 'Private · par 70'),
  ('Rolling Greens Golf Course', 'Rocky Hill', 'Public · 9 holes'),
  ('Wethersfield Country Club', 'Wethersfield', 'Private · par 71'),
  ('Miner Hills Golf Course', 'Middletown', 'Public · 9 holes'),
  ('Lyman Orchards Golf Club', 'Middlefield', 'Public · Jones and Player 18s, Apple Nine'),
  ('Indian Springs Golf Club', 'Middlefield', 'Public · 9 holes'),
  ('Tunxis Country Club', 'Farmington', 'Public · White and Green 18s, Red nine'),
  ('Westwoods Golf Course', 'Farmington', 'Public · 18-hole executive'),
  ('Country Club of Farmington', 'Farmington', 'Private · par 71'),
  ('Chippanee Golf Club', 'Bristol', 'Par 70'),
  ('Wheeler Family Traditions Golf Club', 'Wallingford', 'Semi-private · par 70'),
  ('Rockledge Country Club', 'West Hartford', 'Public · par 72')
) AS v(name, city, notes)
WHERE NOT EXISTS (SELECT 1 FROM "courses" c WHERE c."name" = v.name);
