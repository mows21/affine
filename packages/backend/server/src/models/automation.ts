import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  Automation,
  AutomationExecution,
  AutomationExecutionStatus,
  AutomationStatus,
  AutomationTriggerType,
  InboundWebhook,
  Prisma,
  WebhookEventType,
} from '@prisma/client';
import { randomBytes } from 'crypto';

import { EventBus } from '../base';
import { BaseModel } from './base';

declare global {
  interface Events {
    'automation.created': { automationId: string; workspaceId: string };
    'automation.updated': { automationId: string; workspaceId: string };
    'automation.deleted': { automationId: string; workspaceId: string };
    'automation.executed': {
      automationId: string;
      executionId: string;
      status: AutomationExecutionStatus;
    };
    'inbound_webhook.received': {
      webhookId: string;
      workspaceId: string;
      payload: Record<string, any>;
    };
  }
}

export type { Automation, AutomationExecution, InboundWebhook };
export {
  AutomationStatus,
  AutomationTriggerType,
  AutomationExecutionStatus,
};

// Trigger configuration types
export interface EventTriggerConfig {
  events: WebhookEventType[];
  filters?: Record<string, any>; // Optional field-level filters
}

export interface ScheduleTriggerConfig {
  cron: string; // Cron expression
  timezone?: string;
}

export interface InboundWebhookTriggerConfig {
  webhookId: string;
}

export interface ManualTriggerConfig {
  allowedUsers?: string[]; // User IDs who can manually trigger
}

export type TriggerConfig =
  | EventTriggerConfig
  | ScheduleTriggerConfig
  | InboundWebhookTriggerConfig
  | ManualTriggerConfig;

// Action types
export enum ActionType {
  SEND_WEBHOOK = 'send_webhook',
  SEND_EMAIL = 'send_email',
  SEND_NOTIFICATION = 'send_notification',
  CREATE_DOC = 'create_doc',
  UPDATE_DOC = 'update_doc',
  ADD_COMMENT = 'add_comment',
  CALL_INTEGRATION = 'call_integration',
  HTTP_REQUEST = 'http_request',
  TRANSFORM_DATA = 'transform_data',
  DELAY = 'delay',
  CONDITION = 'condition',
}

export interface ActionDefinition {
  id: string;
  type: ActionType;
  name: string;
  config: Record<string, any>;
  onSuccess?: string; // Next action ID
  onFailure?: string; // Action ID on failure
}

export interface ConditionDefinition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'regex';
  value: any;
  logic?: 'and' | 'or';
}

export interface CreateAutomationInput {
  workspaceId: string;
  name: string;
  description?: string;
  triggerType: AutomationTriggerType;
  triggerConfig: TriggerConfig;
  actions: ActionDefinition[];
  conditions?: ConditionDefinition[];
  maxExecutionsPerHour?: number;
  timeoutMs?: number;
  createdBy?: string;
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string;
  status?: AutomationStatus;
  triggerType?: AutomationTriggerType;
  triggerConfig?: TriggerConfig;
  actions?: ActionDefinition[];
  conditions?: ConditionDefinition[];
  maxExecutionsPerHour?: number;
  timeoutMs?: number;
}

export interface CreateInboundWebhookInput {
  workspaceId: string;
  name: string;
  description?: string;
  secret?: string;
  payloadSchema?: Record<string, any>;
  createdBy?: string;
}

@Injectable()
export class AutomationModel extends BaseModel {
  constructor(private readonly event: EventBus) {
    super();
  }

  /**
   * Generate a secure token for inbound webhooks
   */
  private generateToken(): string {
    return `iwh_${randomBytes(24).toString('hex')}`;
  }

  // #region Automations

  /**
   * Create a new automation
   */
  @Transactional()
  async create(input: CreateAutomationInput): Promise<Automation> {
    const automation = await this.db.automation.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description,
        triggerType: input.triggerType,
        triggerConfig: input.triggerConfig as any,
        actions: input.actions as any,
        conditions: input.conditions as any ?? Prisma.JsonNull,
        maxExecutionsPerHour: input.maxExecutionsPerHour ?? 100,
        timeoutMs: input.timeoutMs ?? 30000,
        createdBy: input.createdBy,
        status: AutomationStatus.draft,
      },
    });

    this.logger.log(
      `Automation created: ${automation.id} for workspace ${input.workspaceId}`
    );
    this.event.emit('automation.created', {
      automationId: automation.id,
      workspaceId: input.workspaceId,
    });

    return automation;
  }

  /**
   * Get automation by ID
   */
  async get(automationId: string): Promise<Automation | null> {
    return this.db.automation.findUnique({
      where: { id: automationId },
    });
  }

  /**
   * List automations for a workspace
   */
  async listByWorkspace(
    workspaceId: string,
    options?: {
      status?: AutomationStatus;
      triggerType?: AutomationTriggerType;
      limit?: number;
      offset?: number;
    }
  ): Promise<Automation[]> {
    return this.db.automation.findMany({
      where: {
        workspaceId,
        ...(options?.status && { status: options.status }),
        ...(options?.triggerType && { triggerType: options.triggerType }),
      },
      take: options?.limit ?? 100,
      skip: options?.offset ?? 0,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find active automations by trigger type
   */
  async findByTriggerType(
    workspaceId: string,
    triggerType: AutomationTriggerType
  ): Promise<Automation[]> {
    return this.db.automation.findMany({
      where: {
        workspaceId,
        triggerType,
        status: AutomationStatus.active,
      },
    });
  }

  /**
   * Find event-triggered automations for a specific event
   */
  async findByEvent(
    workspaceId: string,
    event: WebhookEventType
  ): Promise<Automation[]> {
    const automations = await this.db.automation.findMany({
      where: {
        workspaceId,
        triggerType: AutomationTriggerType.event,
        status: AutomationStatus.active,
      },
    });

    // Filter by event type in trigger config
    return automations.filter(automation => {
      const config = automation.triggerConfig as EventTriggerConfig;
      return (
        config.events?.includes(event) ||
        config.events?.includes(WebhookEventType.all_events)
      );
    });
  }

  /**
   * Find automations triggered by an inbound webhook
   */
  async findByInboundWebhook(webhookId: string): Promise<Automation[]> {
    const automations = await this.db.automation.findMany({
      where: {
        triggerType: AutomationTriggerType.webhook_inbound,
        status: AutomationStatus.active,
      },
    });

    return automations.filter(automation => {
      const config = automation.triggerConfig as InboundWebhookTriggerConfig;
      return config.webhookId === webhookId;
    });
  }

  /**
   * Update an automation
   */
  async update(
    automationId: string,
    input: UpdateAutomationInput
  ): Promise<Automation> {
    const automation = await this.db.automation.update({
      where: { id: automationId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.triggerType !== undefined && {
          triggerType: input.triggerType,
        }),
        ...(input.triggerConfig !== undefined && {
          triggerConfig: input.triggerConfig as any,
        }),
        ...(input.actions !== undefined && { actions: input.actions as any }),
        ...(input.conditions !== undefined && {
          conditions: input.conditions as any ?? Prisma.JsonNull,
        }),
        ...(input.maxExecutionsPerHour !== undefined && {
          maxExecutionsPerHour: input.maxExecutionsPerHour,
        }),
        ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
      },
    });

    this.logger.debug(`Automation updated: ${automationId}`);
    this.event.emit('automation.updated', {
      automationId: automation.id,
      workspaceId: automation.workspaceId,
    });

    return automation;
  }

  /**
   * Activate an automation
   */
  async activate(automationId: string): Promise<Automation> {
    return this.update(automationId, { status: AutomationStatus.active });
  }

  /**
   * Pause an automation
   */
  async pause(automationId: string): Promise<Automation> {
    return this.update(automationId, { status: AutomationStatus.paused });
  }

  /**
   * Update automation stats
   */
  async updateStats(automationId: string, success: boolean): Promise<void> {
    await this.db.automation.update({
      where: { id: automationId },
      data: {
        lastRunAt: new Date(),
        runCount: { increment: 1 },
        ...(success ? {} : { errorCount: { increment: 1 } }),
      },
    });
  }

  /**
   * Delete an automation
   */
  async delete(automationId: string): Promise<void> {
    const automation = await this.db.automation.findUnique({
      where: { id: automationId },
      select: { workspaceId: true },
    });

    if (automation) {
      await this.db.automation.delete({
        where: { id: automationId },
      });

      this.logger.log(`Automation deleted: ${automationId}`);
      this.event.emit('automation.deleted', {
        automationId,
        workspaceId: automation.workspaceId,
      });
    }
  }

  // #endregion

  // #region Automation Executions

  /**
   * Create a new execution record
   */
  async createExecution(
    automationId: string,
    triggerData: Record<string, any>
  ): Promise<AutomationExecution> {
    const execution = await this.db.automationExecution.create({
      data: {
        automationId,
        triggerData,
        status: AutomationExecutionStatus.pending,
      },
    });

    return execution;
  }

  /**
   * Get execution by ID
   */
  async getExecution(
    executionId: string
  ): Promise<AutomationExecution | null> {
    return this.db.automationExecution.findUnique({
      where: { id: executionId },
    });
  }

  /**
   * List executions for an automation
   */
  async listExecutions(
    automationId: string,
    options?: {
      status?: AutomationExecutionStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<AutomationExecution[]> {
    return this.db.automationExecution.findMany({
      where: {
        automationId,
        ...(options?.status && { status: options.status }),
      },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Update execution status
   */
  async updateExecutionStatus(
    executionId: string,
    data: {
      status: AutomationExecutionStatus;
      results?: Record<string, any>;
      errorMessage?: string;
    }
  ): Promise<void> {
    const updateData: Prisma.AutomationExecutionUpdateInput = {
      status: data.status,
      ...(data.results !== undefined && { results: data.results }),
      ...(data.errorMessage !== undefined && {
        errorMessage: data.errorMessage,
      }),
    };

    if (
      data.status === AutomationExecutionStatus.completed ||
      data.status === AutomationExecutionStatus.failed ||
      data.status === AutomationExecutionStatus.cancelled
    ) {
      const execution = await this.db.automationExecution.findUnique({
        where: { id: executionId },
        select: { startedAt: true, automationId: true },
      });

      if (execution) {
        updateData.completedAt = new Date();
        updateData.durationMs =
          new Date().getTime() - execution.startedAt.getTime();

        this.event.emit('automation.executed', {
          automationId: execution.automationId,
          executionId,
          status: data.status,
        });
      }
    }

    await this.db.automationExecution.update({
      where: { id: executionId },
      data: updateData,
    });
  }

  /**
   * Start execution (mark as running)
   */
  async startExecution(executionId: string): Promise<void> {
    await this.db.automationExecution.update({
      where: { id: executionId },
      data: { status: AutomationExecutionStatus.running },
    });
  }

  /**
   * Check if automation has exceeded rate limit
   */
  async hasExceededRateLimit(
    automationId: string,
    maxPerHour: number
  ): Promise<boolean> {
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const count = await this.db.automationExecution.count({
      where: {
        automationId,
        startedAt: { gte: oneHourAgo },
      },
    });

    return count >= maxPerHour;
  }

  /**
   * Clean up old executions
   */
  async cleanupOldExecutions(olderThanDays = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = await this.db.automationExecution.deleteMany({
      where: {
        startedAt: { lt: cutoff },
        status: {
          in: [
            AutomationExecutionStatus.completed,
            AutomationExecutionStatus.failed,
            AutomationExecutionStatus.cancelled,
          ],
        },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} old automation executions`);
    }

    return result.count;
  }

  // #endregion

  // #region Inbound Webhooks

  /**
   * Create a new inbound webhook
   */
  async createInboundWebhook(
    input: CreateInboundWebhookInput
  ): Promise<InboundWebhook> {
    const token = this.generateToken();

    const webhook = await this.db.inboundWebhook.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        token,
        secret: input.secret,
        description: input.description,
        payloadSchema: input.payloadSchema ?? Prisma.JsonNull,
        createdBy: input.createdBy,
        enabled: true,
      },
    });

    this.logger.log(
      `Inbound webhook created: ${webhook.id} for workspace ${input.workspaceId}`
    );

    return webhook;
  }

  /**
   * Get inbound webhook by ID
   */
  async getInboundWebhook(webhookId: string): Promise<InboundWebhook | null> {
    return this.db.inboundWebhook.findUnique({
      where: { id: webhookId },
    });
  }

  /**
   * Get inbound webhook by token
   */
  async getInboundWebhookByToken(
    token: string
  ): Promise<InboundWebhook | null> {
    return this.db.inboundWebhook.findUnique({
      where: { token },
    });
  }

  /**
   * List inbound webhooks for a workspace
   */
  async listInboundWebhooks(
    workspaceId: string,
    options?: {
      enabled?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<InboundWebhook[]> {
    return this.db.inboundWebhook.findMany({
      where: {
        workspaceId,
        ...(options?.enabled !== undefined && { enabled: options.enabled }),
      },
      take: options?.limit ?? 100,
      skip: options?.offset ?? 0,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update inbound webhook stats
   */
  async updateInboundWebhookStats(webhookId: string): Promise<void> {
    await this.db.inboundWebhook.update({
      where: { id: webhookId },
      data: {
        lastReceivedAt: new Date(),
        requestCount: { increment: 1 },
      },
    });
  }

  /**
   * Delete inbound webhook
   */
  async deleteInboundWebhook(webhookId: string): Promise<void> {
    await this.db.inboundWebhook.delete({
      where: { id: webhookId },
    });
    this.logger.log(`Inbound webhook deleted: ${webhookId}`);
  }

  /**
   * Handle incoming webhook request
   */
  async handleInboundWebhook(
    token: string,
    payload: Record<string, any>
  ): Promise<{ webhookId: string; workspaceId: string } | null> {
    const webhook = await this.getInboundWebhookByToken(token);

    if (!webhook || !webhook.enabled) {
      return null;
    }

    await this.updateInboundWebhookStats(webhook.id);

    this.event.emit('inbound_webhook.received', {
      webhookId: webhook.id,
      workspaceId: webhook.workspaceId,
      payload,
    });

    return {
      webhookId: webhook.id,
      workspaceId: webhook.workspaceId,
    };
  }

  // #endregion
}
