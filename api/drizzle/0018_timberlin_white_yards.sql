-- Timberlin White tee yardages from the club's official scorecard (timberlingolf.com/course/scorecard,
-- checked 2026-10-15): 3,064 out, 3,049 in, 6,113 total. Only fills holes still without a yardage,
-- so anything entered in the course editor is kept.
UPDATE "holes" AS h SET "yards" = v.yards
FROM (VALUES
  (1, 534), (2, 333), (3, 347), (4, 156), (5, 346), (6, 510), (7, 160), (8, 310), (9, 368),
  (10, 481), (11, 347), (12, 145), (13, 467), (14, 343), (15, 384), (16, 161), (17, 360), (18, 361)
) AS v(number, yards)
WHERE h."layout_id" IN ('7a1b0000-0000-4000-8000-0000000000f9', '7a1b0000-0000-4000-8000-0000000000b9')
  AND h."number" = v.number
  AND h."yards" IS NULL;
