ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_league_id_leagues_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "season_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_log_season_idx" ON "audit_log" USING btree ("season_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
-- Tag existing entries with their season.
UPDATE "audit_log" a SET "season_id" = x.season_id FROM (
  SELECT al.id, COALESCE(
    CASE WHEN al.entity_type = 'season' THEN (SELECT s.id FROM seasons s WHERE s.id::text = al.entity_id) END,
    CASE WHEN al.entity_type = 'week' THEN (SELECT w.season_id FROM weeks w WHERE w.id::text = al.entity_id) END,
    CASE WHEN al.entity_type = 'scorecard' THEN (
      SELECT w.season_id FROM scorecards sc JOIN groups g ON g.id = sc.group_id JOIN weeks w ON w.id = g.week_id
      WHERE sc.id::text = al.entity_id) END,
    CASE WHEN al.entity_type = 'match' THEN (
      SELECT w.season_id FROM matches m JOIN weeks w ON w.id = m.week_id WHERE m.id::text = al.entity_id) END,
    CASE WHEN al.entity_type = 'scramble' THEN (SELECT s.season_id FROM scrambles s WHERE s.id::text = al.entity_id) END,
    CASE WHEN al.entity_type = 'scramble_team' THEN (
      SELECT s.season_id FROM scramble_teams t JOIN scrambles s ON s.id = t.scramble_id WHERE t.id::text = al.entity_id) END,
    CASE WHEN al.entity_type = 'photo' THEN (
      SELECT COALESCE(p.season_id, w.season_id) FROM photos p
      LEFT JOIN groups g ON g.id = p.group_id LEFT JOIN weeks w ON w.id = g.week_id
      WHERE p.id::text = al.entity_id) END
  ) AS season_id
  FROM audit_log al
) x WHERE x.id = a.id AND x.season_id IS NOT NULL;
--> statement-breakpoint
-- The audit log is append-only: no change or removal, whatever the app or a bug tries.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
