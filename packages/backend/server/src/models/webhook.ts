import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  Prisma,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookEventType,
  WebhookStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';

import { EventBus } from '../base';
import { BaseModel } from './base';

declare global {
  interface Events {
    'webhook.created': { webhookId: string; workspaceId: string };
    'webhook.updated': { webhookId: string; workspaceId: string };
    'webhook.deleted': { webhookId: string; workspaceId: string };
    'webhook.triggered': {
      webhookId: string;
      event: WebhookEventType;
      deliveryId: string;
    };
  }
}

export type { WebhookEndpoint };
export { WebhookEventType, WebhookStatus, WebhookDeliveryStatus };

export interface CreateWebhookInput {
  workspaceId: string;
  name: string;
  url: string;
  events: WebhookEventType[];
  description?: string;
  headers?: Record<string, string>;
  maxRetries?: number;
  retryDelayMs?: number;
  rateLimitPerMinute?: number;
  createdBy?: string;
}

export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  events?: WebhookEventType[];
  status?: WebhookStatus;
  description?: string;
  headers?: Record<string, string>;
  maxRetries?: number;
  retryDelayMs?: number;
  rateLimitPerMinute?: number;
}

export interface CreateDeliveryInput {
  webhookId: string;
  event: WebhookEventType;
  payload: Record<string, any>;
}

@Injectable()
export class WebhookModel extends BaseModel {
  constructor(private readonly event: EventBus) {
    super();
  }

  /**
   * Generate a secure webhook secret
   */
  private generateSecret(): string {
    return `whsec_${randomBytes(32).toString('hex')}`;
  }

  // #region Webhook Endpoints

  /**
   * Create a new webhook endpoint
   */
  @Transactional()
  async create(input: CreateWebhookInput): Promise<WebhookEndpoint> {
    const secret = this.generateSecret();

    const webhook = await this.db.webhookEndpoint.create({
      data: {
        workspaceId: input.workspaceId,
        name: input.name,
        url: input.url,
        secret,
        events: input.events,
        description: input.description,
        headers: input.headers ?? Prisma.JsonNull,
        maxRetries: input.maxRetries ?? 3,
        retryDelayMs: input.retryDelayMs ?? 1000,
        rateLimitPerMinute: input.rateLimitPerMinute ?? 60,
        createdBy: input.createdBy,
        status: WebhookStatus.active,
      },
    });

    this.logger.log(
      `Webhook created: ${webhook.id} for workspace ${input.workspaceId}`
    );
    this.event.emit('webhook.created', {
      webhookId: webhook.id,
      workspaceId: input.workspaceId,
    });

    return webhook;
  }

  /**
   * Get webhook by ID
   */
  async get(webhookId: string): Promise<WebhookEndpoint | null> {
    return this.db.webhookEndpoint.findUnique({
      where: { id: webhookId },
    });
  }

  /**
   * Get webhook with its secret (for delivery)
   */
  async getWithSecret(
    webhookId: string
  ): Promise<(WebhookEndpoint & { secret: string }) | null> {
    return this.db.webhookEndpoint.findUnique({
      where: { id: webhookId },
    });
  }

  /**
   * List webhooks for a workspace
   */
  async listByWorkspace(
    workspaceId: string,
    options?: {
      status?: WebhookStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<WebhookEndpoint[]> {
    return this.db.webhookEndpoint.findMany({
      where: {
        workspaceId,
        ...(options?.status && { status: options.status }),
      },
      take: options?.limit ?? 100,
      skip: options?.offset ?? 0,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find webhooks subscribed to a specific event
   */
  async findByEvent(
    workspaceId: string,
    event: WebhookEventType
  ): Promise<WebhookEndpoint[]> {
    return this.db.webhookEndpoint.findMany({
      where: {
        workspaceId,
        status: WebhookStatus.active,
        OR: [
          { events: { has: event } },
          { events: { has: WebhookEventType.all_events } },
        ],
      },
    });
  }

  /**
   * Update a webhook endpoint
   */
  async update(
    webhookId: string,
    input: UpdateWebhookInput
  ): Promise<WebhookEndpoint> {
    const webhook = await this.db.webhookEndpoint.update({
      where: { id: webhookId },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.url && { url: input.url }),
        ...(input.events && { events: input.events }),
        ...(input.status && { status: input.status }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.headers !== undefined && {
          headers: input.headers ?? Prisma.JsonNull,
        }),
        ...(input.maxRetries !== undefined && { maxRetries: input.maxRetries }),
        ...(input.retryDelayMs !== undefined && {
          retryDelayMs: input.retryDelayMs,
        }),
        ...(input.rateLimitPerMinute !== undefined && {
          rateLimitPerMinute: input.rateLimitPerMinute,
        }),
      },
    });

    this.logger.debug(`Webhook updated: ${webhookId}`);
    this.event.emit('webhook.updated', {
      webhookId: webhook.id,
      workspaceId: webhook.workspaceId,
    });

    return webhook;
  }

  /**
   * Regenerate webhook secret
   */
  async regenerateSecret(webhookId: string): Promise<string> {
    const newSecret = this.generateSecret();

    await this.db.webhookEndpoint.update({
      where: { id: webhookId },
      data: { secret: newSecret },
    });

    this.logger.log(`Webhook secret regenerated: ${webhookId}`);
    return newSecret;
  }

  /**
   * Delete a webhook endpoint
   */
  async delete(webhookId: string): Promise<void> {
    const webhook = await this.db.webhookEndpoint.findUnique({
      where: { id: webhookId },
      select: { workspaceId: true },
    });

    if (webhook) {
      await this.db.webhookEndpoint.delete({
        where: { id: webhookId },
      });

      this.logger.log(`Webhook deleted: ${webhookId}`);
      this.event.emit('webhook.deleted', {
        webhookId,
        workspaceId: webhook.workspaceId,
      });
    }
  }

  /**
   * Update webhook stats
   */
  async updateStats(
    webhookId: string,
    success: boolean
  ): Promise<void> {
    await this.db.webhookEndpoint.update({
      where: { id: webhookId },
      data: {
        lastTriggeredAt: new Date(),
        ...(success
          ? { successCount: { increment: 1 } }
          : { failureCount: { increment: 1 } }),
      },
    });
  }

  /**
   * Mark webhook as failed (after max retries exceeded)
   */
  async markAsFailed(webhookId: string): Promise<void> {
    await this.db.webhookEndpoint.update({
      where: { id: webhookId },
      data: { status: WebhookStatus.failed },
    });
    this.logger.warn(`Webhook marked as failed: ${webhookId}`);
  }

  // #endregion

  // #region Webhook Deliveries

  /**
   * Create a new delivery record
   */
  async createDelivery(input: CreateDeliveryInput): Promise<string> {
    const delivery = await this.db.webhookDelivery.create({
      data: {
        webhookId: input.webhookId,
        event: input.event,
        payload: input.payload,
        status: WebhookDeliveryStatus.pending,
        attempts: 0,
      },
    });

    this.event.emit('webhook.triggered', {
      webhookId: input.webhookId,
      event: input.event,
      deliveryId: delivery.id,
    });

    return delivery.id;
  }

  /**
   * Get delivery by ID
   */
  async getDelivery(deliveryId: string) {
    return this.db.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });
  }

  /**
   * List deliveries for a webhook
   */
  async listDeliveries(
    webhookId: string,
    options?: {
      status?: WebhookDeliveryStatus;
      limit?: number;
      offset?: number;
    }
  ) {
    return this.db.webhookDelivery.findMany({
      where: {
        webhookId,
        ...(options?.status && { status: options.status }),
      },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get pending deliveries that need to be retried
   */
  async getPendingRetries(limit = 100) {
    return this.db.webhookDelivery.findMany({
      where: {
        status: WebhookDeliveryStatus.retrying,
        nextRetryAt: { lte: new Date() },
      },
      include: { webhook: true },
      take: limit,
      orderBy: { nextRetryAt: 'asc' },
    });
  }

  /**
   * Update delivery status
   */
  async updateDeliveryStatus(
    deliveryId: string,
    data: {
      status: WebhookDeliveryStatus;
      statusCode?: number;
      responseBody?: string;
      errorMessage?: string;
      durationMs?: number;
      nextRetryAt?: Date;
    }
  ): Promise<void> {
    const updateData: Prisma.WebhookDeliveryUpdateInput = {
      status: data.status,
      attempts: { increment: 1 },
      ...(data.statusCode !== undefined && { statusCode: data.statusCode }),
      ...(data.responseBody !== undefined && {
        responseBody: data.responseBody,
      }),
      ...(data.errorMessage !== undefined && {
        errorMessage: data.errorMessage,
      }),
      ...(data.durationMs !== undefined && { durationMs: data.durationMs }),
      ...(data.nextRetryAt !== undefined && { nextRetryAt: data.nextRetryAt }),
    };

    if (
      data.status === WebhookDeliveryStatus.success ||
      data.status === WebhookDeliveryStatus.failed
    ) {
      updateData.completedAt = new Date();
    }

    await this.db.webhookDelivery.update({
      where: { id: deliveryId },
      data: updateData,
    });
  }

  /**
   * Clean up old deliveries
   */
  async cleanupOldDeliveries(olderThanDays = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = await this.db.webhookDelivery.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        status: {
          in: [WebhookDeliveryStatus.success, WebhookDeliveryStatus.failed],
        },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} old webhook deliveries`);
    }

    return result.count;
  }

  // #endregion
}
