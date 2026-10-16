CREATE TABLE "round_absences" (
	"week_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"sub_name" text,
	"marked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_absences_week_id_player_id_pk" PRIMARY KEY("week_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "round_absences" ADD CONSTRAINT "round_absences_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_absences" ADD CONSTRAINT "round_absences_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_absences" ADD CONSTRAINT "round_absences_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;