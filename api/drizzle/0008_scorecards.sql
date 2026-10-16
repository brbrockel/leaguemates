CREATE TYPE "public"."scorecard_status" AS ENUM('draft', 'submitted', 'disputed', 'final');--> statement-breakpoint
CREATE TABLE "card_rounds" (
	"scorecard_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"handicap" integer NOT NULL,
	"attendance" text DEFAULT 'played' NOT NULL,
	"sub_name" text,
	"hole_scores" jsonb NOT NULL,
	CONSTRAINT "card_rounds_scorecard_id_player_id_pk" PRIMARY KEY("scorecard_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"layout_id" uuid NOT NULL,
	"status" "scorecard_status" DEFAULT 'draft' NOT NULL,
	"entered_by" uuid,
	"submitted_at" timestamp with time zone,
	"final_at" timestamp with time zone,
	"disputed_by" uuid,
	"dispute_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scorecards_group_id_unique" UNIQUE("group_id")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "handicap" integer;--> statement-breakpoint
ALTER TABLE "card_rounds" ADD CONSTRAINT "card_rounds_scorecard_id_scorecards_id_fk" FOREIGN KEY ("scorecard_id") REFERENCES "public"."scorecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_rounds" ADD CONSTRAINT "card_rounds_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_layout_id_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_disputed_by_users_id_fk" FOREIGN KEY ("disputed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;