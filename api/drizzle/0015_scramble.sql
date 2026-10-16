CREATE TABLE "scramble_team_members" (
	"team_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"handicap" integer NOT NULL,
	CONSTRAINT "scramble_team_members_team_id_player_id_pk" PRIMARY KEY("team_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "scramble_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scramble_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"tee_time" text,
	"handicap" integer NOT NULL,
	"hole_scores" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"entered_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scrambles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"date" text NOT NULL,
	"layout_id" uuid NOT NULL,
	"team_size" integer NOT NULL,
	"allowance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scrambles_season_id_unique" UNIQUE("season_id")
);
--> statement-breakpoint
ALTER TABLE "scramble_team_members" ADD CONSTRAINT "scramble_team_members_team_id_scramble_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."scramble_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scramble_team_members" ADD CONSTRAINT "scramble_team_members_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scramble_teams" ADD CONSTRAINT "scramble_teams_scramble_id_scrambles_id_fk" FOREIGN KEY ("scramble_id") REFERENCES "public"."scrambles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scramble_teams" ADD CONSTRAINT "scramble_teams_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrambles" ADD CONSTRAINT "scrambles_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrambles" ADD CONSTRAINT "scrambles_layout_id_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scramble_teams_number_idx" ON "scramble_teams" USING btree ("scramble_id","number");