-- Roles are now "admin" and "user". Renaming the enum values keeps every existing row.
ALTER TYPE "public"."league_role" RENAME VALUE 'commissioner' TO 'admin';--> statement-breakpoint
ALTER TYPE "public"."league_role" RENAME VALUE 'player' TO 'user';
