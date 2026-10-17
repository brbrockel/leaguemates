CREATE TABLE "site_notice_reads" (
	"notice_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "site_notice_reads_notice_id_user_id_pk" PRIMARY KEY("notice_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "site_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"must_see" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "for_date" text;--> statement-breakpoint
ALTER TABLE "site_notice_reads" ADD CONSTRAINT "site_notice_reads_notice_id_site_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."site_notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_notice_reads" ADD CONSTRAINT "site_notice_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_notices" ADD CONSTRAINT "site_notices_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;