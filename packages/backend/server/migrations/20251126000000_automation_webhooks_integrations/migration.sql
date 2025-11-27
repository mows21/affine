-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('doc_created', 'doc_updated', 'doc_deleted', 'doc_shared', 'doc_unshared', 'workspace_created', 'workspace_updated', 'workspace_deleted', 'workspace_member_added', 'workspace_member_removed', 'workspace_member_role_changed', 'comment_created', 'comment_updated', 'comment_deleted', 'comment_resolved', 'user_invited', 'user_joined', 'ai_session_created', 'ai_session_completed', 'blob_uploaded', 'blob_deleted', 'all_events');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('active', 'paused', 'disabled', 'failed');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'success', 'failed', 'retrying');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('slack', 'discord', 'zapier', 'n8n', 'make', 'github', 'linear', 'notion', 'custom_webhook');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('active', 'disconnected', 'error', 'pending_setup');

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('event', 'schedule', 'webhook_inbound', 'manual');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('active', 'paused', 'draft', 'error');

-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "url" TEXT NOT NULL,
    "secret" VARCHAR NOT NULL,
    "events" "WebhookEventType"[],
    "status" "WebhookStatus" NOT NULL DEFAULT 'active',
    "headers" JSONB,
    "max_retries" SMALLINT NOT NULL DEFAULT 3,
    "retry_delay_ms" INTEGER NOT NULL DEFAULT 1000,
    "rate_limit_per_minute" SMALLINT NOT NULL DEFAULT 60,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" VARCHAR,
    "last_triggered_at" TIMESTAMPTZ(3),
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" VARCHAR NOT NULL,
    "webhook_id" VARCHAR NOT NULL,
    "event" "WebhookEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "status_code" SMALLINT,
    "response_body" TEXT,
    "error_message" TEXT,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "name" VARCHAR NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'pending_setup',
    "credentials" JSONB,
    "config" JSONB,
    "events" "WebhookEventType"[],
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" VARCHAR,
    "last_sync_at" TIMESTAMPTZ(3),
    "error_message" TEXT,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" TEXT,
    "status" "AutomationStatus" NOT NULL DEFAULT 'draft',
    "trigger_type" "AutomationTriggerType" NOT NULL,
    "trigger_config" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "conditions" JSONB,
    "max_executions_per_hour" SMALLINT NOT NULL DEFAULT 100,
    "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" VARCHAR,
    "last_run_at" TIMESTAMPTZ(3),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" VARCHAR NOT NULL,
    "automation_id" VARCHAR NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL DEFAULT 'pending',
    "trigger_data" JSONB NOT NULL,
    "results" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_webhooks" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "token" VARCHAR NOT NULL,
    "secret" VARCHAR,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payload_schema" JSONB,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" VARCHAR,
    "last_received_at" TIMESTAMPTZ(3),
    "request_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "inbound_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_endpoints_workspace_id_idx" ON "webhook_endpoints"("workspace_id");

-- CreateIndex
CREATE INDEX "webhook_endpoints_status_idx" ON "webhook_endpoints"("status");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries"("webhook_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "integrations_workspace_id_idx" ON "integrations"("workspace_id");

-- CreateIndex
CREATE INDEX "integrations_type_idx" ON "integrations"("type");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_workspace_id_type_name_key" ON "integrations"("workspace_id", "type", "name");

-- CreateIndex
CREATE INDEX "automations_workspace_id_idx" ON "automations"("workspace_id");

-- CreateIndex
CREATE INDEX "automations_status_idx" ON "automations"("status");

-- CreateIndex
CREATE INDEX "automation_executions_automation_id_started_at_idx" ON "automation_executions"("automation_id", "started_at");

-- CreateIndex
CREATE INDEX "automation_executions_status_idx" ON "automation_executions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_webhooks_token_key" ON "inbound_webhooks"("token");

-- CreateIndex
CREATE INDEX "inbound_webhooks_workspace_id_idx" ON "inbound_webhooks"("workspace_id");

-- CreateIndex
CREATE INDEX "inbound_webhooks_token_idx" ON "inbound_webhooks"("token");

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
