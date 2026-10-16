CREATE TABLE "bug_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"title" text NOT NULL,
	"happened" text NOT NULL,
	"expected" text,
	"page" text,
	"user_agent" text,
	"app_version" text,
	"issue_number" integer,
	"issue_url" text,
	"issue_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;