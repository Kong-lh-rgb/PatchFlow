CREATE TYPE "public"."run_event_type" AS ENUM('run.status_changed', 'step.started', 'step.completed', 'tool.started', 'tool.completed', 'verification.completed', 'approval.requested', 'artifact.created', 'run.completed', 'run.failed');--> statement-breakpoint
CREATE TYPE "public"."run_phase" AS ENUM('preparing', 'analyzing', 'reproducing', 'planning', 'editing', 'verifying', 'awaiting_approval');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'preparing', 'analyzing', 'reproducing', 'planning', 'editing', 'verifying', 'awaiting_approval', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"type" "run_event_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_run_id_sequence_key" UNIQUE("run_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"phase" "run_phase",
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_events_run_id_idx" ON "run_events" USING btree ("run_id");