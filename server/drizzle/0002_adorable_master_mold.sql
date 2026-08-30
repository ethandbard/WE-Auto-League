ALTER TYPE "public"."email_status" ADD VALUE 'suppressed';--> statement-breakpoint
CREATE TABLE "email_template_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL,
	"template_key" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "email_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "email_templates_enabled" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "reminder_lead_hours" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "auto_mail_standings_on_publish" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "email_template_overrides" ADD CONSTRAINT "email_template_overrides_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_template_overrides" ADD CONSTRAINT "email_template_overrides_updated_by_employees_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_template_overrides_league_key_uq" ON "email_template_overrides" USING btree ("league_id","template_key");--> statement-breakpoint
-- Data migration, deliberately not the column default: every league that
-- exists when this deploys is the production league, whose roster still holds
-- placeholder @weauto.local addresses. It comes up paused so the box can run
-- EMAIL_PROVIDER=resend again without mailing them. New leagues default false.
UPDATE "leagues" SET "email_paused" = true;