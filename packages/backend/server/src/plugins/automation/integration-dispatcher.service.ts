import { Injectable, Logger } from '@nestjs/common';
import {
  Integration,
  IntegrationStatus,
  IntegrationType,
  WebhookEventType,
} from '@prisma/client';

import {
  DiscordIntegrationConfig,
  Models,
  SlackIntegrationConfig,
} from '../../models';

export interface IntegrationMessage {
  title?: string;
  text: string;
  url?: string;
  color?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
  timestamp?: string;
}

@Injectable()
export class IntegrationDispatcherService {
  private readonly logger = new Logger(IntegrationDispatcherService.name);

  constructor(private readonly models: Models) {}

  /**
   * Dispatch an event to all relevant integrations
   */
  async dispatch(
    workspaceId: string,
    event: WebhookEventType,
    data: Record<string, any>
  ): Promise<void> {
    const integrations = await this.models.integration.findByEvent(
      workspaceId,
      event
    );

    for (const integration of integrations) {
      try {
        await this.sendToIntegration(integration, event, data);
      } catch (error) {
        this.logger.error(
          `Error dispatching to integration ${integration.id}`,
          error
        );
        await this.models.integration.markError(
          integration.id,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  }

  /**
   * Send event to a specific integration
   */
  private async sendToIntegration(
    integration: Integration,
    event: WebhookEventType,
    data: Record<string, any>
  ): Promise<void> {
    const message = this.formatMessage(event, data);

    switch (integration.type) {
      case IntegrationType.slack:
        await this.sendToSlack(integration, message);
        break;
      case IntegrationType.discord:
        await this.sendToDiscord(integration, message);
        break;
      case IntegrationType.zapier:
      case IntegrationType.n8n:
      case IntegrationType.make:
        await this.sendToWebhookIntegration(integration, event, data);
        break;
      default:
        this.logger.warn(
          `Unsupported integration type: ${integration.type}`
        );
    }

    await this.models.integration.updateLastSync(integration.id);
  }

  /**
   * Format event data into a message for integrations
   */
  private formatMessage(
    event: WebhookEventType,
    data: Record<string, any>
  ): IntegrationMessage {
    const eventTitles: Record<WebhookEventType, string> = {
      [WebhookEventType.doc_created]: 'New Document Created',
      [WebhookEventType.doc_updated]: 'Document Updated',
      [WebhookEventType.doc_deleted]: 'Document Deleted',
      [WebhookEventType.doc_shared]: 'Document Shared',
      [WebhookEventType.doc_unshared]: 'Document Unshared',
      [WebhookEventType.workspace_created]: 'Workspace Created',
      [WebhookEventType.workspace_updated]: 'Workspace Updated',
      [WebhookEventType.workspace_deleted]: 'Workspace Deleted',
      [WebhookEventType.workspace_member_added]: 'Member Added to Workspace',
      [WebhookEventType.workspace_member_removed]:
        'Member Removed from Workspace',
      [WebhookEventType.workspace_member_role_changed]: 'Member Role Changed',
      [WebhookEventType.comment_created]: 'New Comment',
      [WebhookEventType.comment_updated]: 'Comment Updated',
      [WebhookEventType.comment_deleted]: 'Comment Deleted',
      [WebhookEventType.comment_resolved]: 'Comment Resolved',
      [WebhookEventType.user_invited]: 'User Invited',
      [WebhookEventType.user_joined]: 'User Joined',
      [WebhookEventType.ai_session_created]: 'AI Session Started',
      [WebhookEventType.ai_session_completed]: 'AI Session Completed',
      [WebhookEventType.blob_uploaded]: 'File Uploaded',
      [WebhookEventType.blob_deleted]: 'File Deleted',
      [WebhookEventType.all_events]: 'Event',
    };

    const title = eventTitles[event] || 'AFFiNE Event';
    const text = this.formatEventText(event, data);

    return {
      title,
      text,
      color: this.getEventColor(event),
      fields: this.formatFields(data),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Format event text description
   */
  private formatEventText(
    event: WebhookEventType,
    data: Record<string, any>
  ): string {
    switch (event) {
      case WebhookEventType.doc_created:
        return `A new document has been created${data.title ? `: ${data.title}` : ''}`;
      case WebhookEventType.doc_updated:
        return `Document ${data.title || data.docId} has been updated`;
      case WebhookEventType.workspace_member_added:
        return `A new member has joined the workspace`;
      case WebhookEventType.workspace_member_removed:
        return `A member has been removed from the workspace`;
      case WebhookEventType.comment_created:
        return `New comment added${data.docTitle ? ` on "${data.docTitle}"` : ''}`;
      default:
        return `Event: ${event}`;
    }
  }

  /**
   * Get color for event type
   */
  private getEventColor(event: WebhookEventType): string {
    if (event.includes('created') || event.includes('added')) {
      return '#36a64f'; // Green
    }
    if (event.includes('deleted') || event.includes('removed')) {
      return '#e01e5a'; // Red
    }
    if (event.includes('updated') || event.includes('changed')) {
      return '#2eb886'; // Teal
    }
    return '#1264a3'; // Blue (default)
  }

  /**
   * Format data fields for rich messages
   */
  private formatFields(
    data: Record<string, any>
  ): Array<{ name: string; value: string; inline?: boolean }> {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

    if (data.docId) {
      fields.push({ name: 'Document ID', value: data.docId, inline: true });
    }
    if (data.userId) {
      fields.push({ name: 'User', value: data.userId, inline: true });
    }
    if (data.title) {
      fields.push({ name: 'Title', value: data.title, inline: false });
    }

    return fields;
  }

  // #region Slack Integration

  /**
   * Send message to Slack
   */
  private async sendToSlack(
    integration: Integration,
    message: IntegrationMessage
  ): Promise<void> {
    const config = this.models.integration.getSlackConfig(integration);
    const credentials = integration.credentials as { botToken?: string } | null;

    if (!config.channelId || !credentials?.botToken) {
      throw new Error('Slack integration not properly configured');
    }

    const slackMessage = {
      channel: config.channelId,
      attachments: [
        {
          color: message.color,
          title: message.title,
          text: message.text,
          fields: message.fields?.map(f => ({
            title: f.name,
            value: f.value,
            short: f.inline,
          })),
          footer: 'AFFiNE',
          ts: Math.floor(Date.now() / 1000).toString(),
        },
      ],
    };

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.botToken}`,
      },
      body: JSON.stringify(slackMessage),
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`);
    }

    this.logger.debug(`Slack message sent to ${config.channelId}`);
  }

  // #endregion

  // #region Discord Integration

  /**
   * Send message to Discord
   */
  private async sendToDiscord(
    integration: Integration,
    message: IntegrationMessage
  ): Promise<void> {
    const config = this.models.integration.getDiscordConfig(integration);

    if (!config.webhookUrl) {
      throw new Error('Discord webhook URL not configured');
    }

    const discordMessage = {
      embeds: [
        {
          title: message.title,
          description: message.text,
          color: parseInt(message.color?.replace('#', '') || '0066ff', 16),
          fields: message.fields?.map(f => ({
            name: f.name,
            value: f.value,
            inline: f.inline,
          })),
          footer: { text: 'AFFiNE' },
          timestamp: message.timestamp,
        },
      ],
    };

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(discordMessage),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord webhook error: ${error}`);
    }

    this.logger.debug(`Discord message sent`);
  }

  // #endregion

  // #region Generic Webhook Integrations (Zapier, n8n, Make)

  /**
   * Send to webhook-based integration (Zapier, n8n, Make)
   */
  private async sendToWebhookIntegration(
    integration: Integration,
    event: WebhookEventType,
    data: Record<string, any>
  ): Promise<void> {
    const config = integration.config as { webhookUrl?: string } | null;

    if (!config?.webhookUrl) {
      throw new Error(
        `${integration.type} webhook URL not configured`
      );
    }

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      workspaceId: integration.workspaceId,
      integrationId: integration.id,
      integrationType: integration.type,
      data,
    };

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AFFiNE-Integration/1.0',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${integration.type} webhook error: ${error}`);
    }

    this.logger.debug(
      `${integration.type} webhook sent to ${config.webhookUrl}`
    );
  }

  // #endregion

  // #region Provider-specific methods for setup

  /**
   * Test Slack connection
   */
  async testSlackConnection(botToken: string): Promise<{
    ok: boolean;
    team?: string;
    error?: string;
  }> {
    const response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
      },
    });

    const result = await response.json();
    return {
      ok: result.ok,
      team: result.team,
      error: result.error,
    };
  }

  /**
   * List Slack channels
   */
  async listSlackChannels(
    botToken: string
  ): Promise<Array<{ id: string; name: string }>> {
    const response = await fetch(
      'https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=100',
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
        },
      }
    );

    const result = await response.json();

    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`);
    }

    return result.channels.map((ch: any) => ({
      id: ch.id,
      name: ch.name,
    }));
  }

  /**
   * Test Discord webhook
   */
  async testDiscordWebhook(
    webhookUrl: string
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'AFFiNE integration test - connection successful!',
        }),
      });

      return {
        ok: response.ok,
        error: response.ok ? undefined : await response.text(),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // #endregion
}
