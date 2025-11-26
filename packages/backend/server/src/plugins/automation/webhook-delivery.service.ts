import { Injectable, Logger } from '@nestjs/common';
import { WebhookDeliveryStatus, WebhookEventType } from '@prisma/client';
import { createHmac } from 'crypto';

import { OnJob } from '../../base';
import { Models } from '../../models';

// Extend Jobs interface for webhook delivery
declare global {
  interface Jobs {
    'automation.deliverWebhook': {
      deliveryId: string;
    };
    'automation.retryWebhooks': Record<string, never>;
  }
}

export interface WebhookPayload {
  id: string;
  timestamp: string;
  event: WebhookEventType;
  workspaceId: string;
  data: Record<string, any>;
}

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  errorMessage?: string;
  durationMs: number;
}

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(private readonly models: Models) {}

  /**
   * Generate HMAC signature for webhook payload
   */
  generateSignature(payload: string, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedPayload = `${timestamp}.${payload}`;
    const signature = createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    return `t=${timestamp},v1=${signature}`;
  }

  /**
   * Verify HMAC signature from incoming webhook
   */
  verifySignature(
    payload: string,
    signature: string,
    secret: string,
    tolerance = 300 // 5 minutes
  ): boolean {
    try {
      const parts = signature.split(',');
      const timestampPart = parts.find(p => p.startsWith('t='));
      const signaturePart = parts.find(p => p.startsWith('v1='));

      if (!timestampPart || !signaturePart) {
        return false;
      }

      const timestamp = parseInt(timestampPart.substring(2), 10);
      const expectedSignature = signaturePart.substring(3);

      // Check timestamp is within tolerance
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > tolerance) {
        this.logger.warn('Webhook signature timestamp out of tolerance');
        return false;
      }

      // Compute expected signature
      const signedPayload = `${timestamp}.${payload}`;
      const computedSignature = createHmac('sha256', secret)
        .update(signedPayload)
        .digest('hex');

      // Constant-time comparison
      return computedSignature === expectedSignature;
    } catch (error) {
      this.logger.error('Error verifying webhook signature', error);
      return false;
    }
  }

  /**
   * Build the webhook payload
   */
  buildPayload(
    event: WebhookEventType,
    workspaceId: string,
    data: Record<string, any>
  ): WebhookPayload {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      event,
      workspaceId,
      data,
    };
  }

  /**
   * Deliver a webhook to its endpoint
   */
  async deliver(deliveryId: string): Promise<WebhookDeliveryResult> {
    const delivery = await this.models.webhook.getDelivery(deliveryId);

    if (!delivery || !delivery.webhook) {
      return {
        success: false,
        errorMessage: 'Delivery or webhook not found',
        durationMs: 0,
      };
    }

    const { webhook, payload, event } = delivery;
    const startTime = Date.now();

    try {
      const payloadStr = JSON.stringify(payload);
      const signature = this.generateSignature(payloadStr, webhook.secret);

      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'AFFiNE-Webhooks/1.0',
        'X-AFFiNE-Webhook-ID': webhook.id,
        'X-AFFiNE-Webhook-Event': event,
        'X-AFFiNE-Webhook-Signature': signature,
        'X-AFFiNE-Webhook-Timestamp': new Date().toISOString(),
        ...(typeof webhook.headers === 'object' && webhook.headers !== null
          ? (webhook.headers as Record<string, string>)
          : {}),
      };

      // Make the HTTP request
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const durationMs = Date.now() - startTime;
      const responseBody = await response.text().catch(() => '');

      if (response.ok) {
        // Success
        await this.models.webhook.updateDeliveryStatus(deliveryId, {
          status: WebhookDeliveryStatus.success,
          statusCode: response.status,
          responseBody: responseBody.substring(0, 10000), // Limit response size
          durationMs,
        });

        await this.models.webhook.updateStats(webhook.id, true);

        this.logger.log(
          `Webhook delivered successfully: ${deliveryId} to ${webhook.url}`
        );

        return {
          success: true,
          statusCode: response.status,
          responseBody,
          durationMs,
        };
      } else {
        // HTTP error
        const shouldRetry = this.shouldRetry(
          response.status,
          delivery.attempts,
          webhook.maxRetries
        );

        if (shouldRetry) {
          const nextRetryAt = this.calculateNextRetry(
            delivery.attempts,
            webhook.retryDelayMs
          );

          await this.models.webhook.updateDeliveryStatus(deliveryId, {
            status: WebhookDeliveryStatus.retrying,
            statusCode: response.status,
            responseBody: responseBody.substring(0, 10000),
            errorMessage: `HTTP ${response.status}: ${response.statusText}`,
            durationMs,
            nextRetryAt,
          });

          this.logger.warn(
            `Webhook delivery failed, will retry: ${deliveryId} (attempt ${delivery.attempts + 1})`
          );
        } else {
          await this.models.webhook.updateDeliveryStatus(deliveryId, {
            status: WebhookDeliveryStatus.failed,
            statusCode: response.status,
            responseBody: responseBody.substring(0, 10000),
            errorMessage: `HTTP ${response.status}: ${response.statusText}`,
            durationMs,
          });

          await this.models.webhook.updateStats(webhook.id, false);

          this.logger.error(
            `Webhook delivery failed permanently: ${deliveryId}`
          );
        }

        return {
          success: false,
          statusCode: response.status,
          responseBody,
          errorMessage: `HTTP ${response.status}: ${response.statusText}`,
          durationMs,
        };
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      const shouldRetry = this.shouldRetry(
        0,
        delivery.attempts,
        webhook.maxRetries
      );

      if (shouldRetry) {
        const nextRetryAt = this.calculateNextRetry(
          delivery.attempts,
          webhook.retryDelayMs
        );

        await this.models.webhook.updateDeliveryStatus(deliveryId, {
          status: WebhookDeliveryStatus.retrying,
          errorMessage,
          durationMs,
          nextRetryAt,
        });

        this.logger.warn(
          `Webhook delivery error, will retry: ${deliveryId} - ${errorMessage}`
        );
      } else {
        await this.models.webhook.updateDeliveryStatus(deliveryId, {
          status: WebhookDeliveryStatus.failed,
          errorMessage,
          durationMs,
        });

        await this.models.webhook.updateStats(webhook.id, false);

        this.logger.error(
          `Webhook delivery failed permanently: ${deliveryId} - ${errorMessage}`
        );
      }

      return {
        success: false,
        errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Determine if a delivery should be retried
   */
  private shouldRetry(
    statusCode: number,
    attempts: number,
    maxRetries: number
  ): boolean {
    // Don't retry if max attempts reached
    if (attempts >= maxRetries) {
      return false;
    }

    // Don't retry client errors (4xx) except for rate limiting
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
      return false;
    }

    // Retry server errors (5xx), network errors (0), and rate limiting (429)
    return true;
  }

  /**
   * Calculate exponential backoff for retry
   */
  private calculateNextRetry(attempts: number, baseDelayMs: number): Date {
    // Exponential backoff: baseDelay * 2^attempts with jitter
    const delay = baseDelayMs * Math.pow(2, attempts);
    const jitter = Math.random() * 1000; // Add up to 1s jitter
    const maxDelay = 3600000; // Cap at 1 hour

    return new Date(Date.now() + Math.min(delay + jitter, maxDelay));
  }

  /**
   * Trigger webhooks for an event
   */
  async triggerWebhooks(
    workspaceId: string,
    event: WebhookEventType,
    data: Record<string, any>
  ): Promise<string[]> {
    const webhooks = await this.models.webhook.findByEvent(workspaceId, event);
    const deliveryIds: string[] = [];

    for (const webhook of webhooks) {
      try {
        const payload = this.buildPayload(event, workspaceId, data);
        const deliveryId = await this.models.webhook.createDelivery({
          webhookId: webhook.id,
          event,
          payload,
        });
        deliveryIds.push(deliveryId);

        // Immediately attempt delivery (will be queued via job system)
        this.deliver(deliveryId).catch(err => {
          this.logger.error(`Error delivering webhook ${deliveryId}`, err);
        });
      } catch (error) {
        this.logger.error(
          `Error creating webhook delivery for ${webhook.id}`,
          error
        );
      }
    }

    return deliveryIds;
  }

  /**
   * Job handler for webhook delivery
   */
  @OnJob('automation.deliverWebhook')
  async handleDeliverWebhook({ deliveryId }: { deliveryId: string }) {
    await this.deliver(deliveryId);
  }

  /**
   * Job handler for retrying failed webhooks
   */
  @OnJob('automation.retryWebhooks')
  async handleRetryWebhooks() {
    const pendingRetries = await this.models.webhook.getPendingRetries(50);

    for (const delivery of pendingRetries) {
      try {
        await this.deliver(delivery.id);
      } catch (error) {
        this.logger.error(`Error retrying webhook ${delivery.id}`, error);
      }
    }
  }
}
