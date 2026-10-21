CREATE TABLE "card_grids" (
	"layout_id" uuid PRIMARY KEY NOT NULL,
	"image_id" uuid NOT NULL,
	"grid" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_grids" ADD CONSTRAINT "card_grids_layout_id_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_grids" ADD CONSTRAINT "card_grids_image_id_course_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."course_images"("id") ON DELETE cascade ON UPDATE no action;