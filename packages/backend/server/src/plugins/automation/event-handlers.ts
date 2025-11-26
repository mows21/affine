import { Injectable, Logger } from '@nestjs/common';
import { WebhookEventType } from '@prisma/client';

import { OnEvent } from '../../base';
import { Models } from '../../models';
import { AutomationExecutorService } from './automation-executor.service';
import { IntegrationDispatcherService } from './integration-dispatcher.service';
import { WebhookDeliveryService } from './webhook-delivery.service';

/**
 * Event handlers that bridge internal events to webhooks, integrations, and automations
 */
@Injectable()
export class AutomationEventHandlers {
  private readonly logger = new Logger(AutomationEventHandlers.name);

  constructor(
    private readonly models: Models,
    private readonly webhookDelivery: WebhookDeliveryService,
    private readonly integrationDispatcher: IntegrationDispatcherService,
    private readonly automationExecutor: AutomationExecutorService
  ) {}

  /**
   * Helper to trigger all automation systems for an event
   */
  private async triggerAutomation(
    workspaceId: string,
    event: WebhookEventType,
    data: Record<string, any>
  ) {
    try {
      // Trigger outbound webhooks
      await this.webhookDelivery.triggerWebhooks(workspaceId, event, data);

      // Trigger integrations (Slack, Discord, etc.)
      await this.integrationDispatcher.dispatch(workspaceId, event, data);

      // Trigger automations
      await this.automationExecutor.triggerByEvent(workspaceId, event, data);
    } catch (error) {
      this.logger.error(
        `Error triggering automation for ${event} in workspace ${workspaceId}`,
        error
      );
    }
  }

  // #region Document Events

  @OnEvent('doc.created')
  async onDocCreated(payload: {
    workspaceId: string;
    docId: string;
    createdBy?: string;
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.doc_created,
      {
        docId: payload.docId,
        createdBy: payload.createdBy,
      }
    );
  }

  @OnEvent('doc.updated')
  async onDocUpdated(payload: {
    workspaceId: string;
    docId: string;
    updatedBy?: string;
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.doc_updated,
      {
        docId: payload.docId,
        updatedBy: payload.updatedBy,
      }
    );
  }

  // #endregion

  // #region Workspace Events

  @OnEvent('workspace.updated')
  async onWorkspaceUpdated(workspace: {
    id: string;
    name?: string | null;
    public?: boolean;
  }) {
    await this.triggerAutomation(
      workspace.id,
      WebhookEventType.workspace_updated,
      {
        workspaceId: workspace.id,
        name: workspace.name,
        public: workspace.public,
      }
    );
  }

  @OnEvent('workspace.deleted')
  async onWorkspaceDeleted(payload: { id: string }) {
    // Note: Webhooks are deleted with workspace via cascade
    // This is mainly for logging/audit purposes
    this.logger.log(`Workspace deleted: ${payload.id}`);
  }

  @OnEvent('workspace.members.invite')
  async onMemberInvited(payload: { inviterId: string; inviteId: string }) {
    // Get invite details to find workspace
    try {
      // This would need the invite details - simplified for now
      this.logger.debug(`Member invite event: ${payload.inviteId}`);
    } catch (error) {
      this.logger.error('Error handling member invite event', error);
    }
  }

  @OnEvent('workspace.members.removed')
  async onMemberRemoved(payload: { workspaceId: string; userId: string }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.workspace_member_removed,
      {
        userId: payload.userId,
      }
    );
  }

  // #endregion

  // #region User Events

  @OnEvent('user.created')
  async onUserCreated(user: { id: string; email: string; name: string }) {
    // User created events are workspace-independent
    // Could be used for admin-level webhooks in the future
    this.logger.debug(`User created: ${user.id}`);
  }

  // #endregion

  // #region Blob Events

  @OnEvent('workspace.blob.sync')
  async onBlobSync(payload: { workspaceId: string; key: string }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.blob_uploaded,
      {
        blobKey: payload.key,
      }
    );
  }

  // #endregion

  // #region Integration-specific Events

  @OnEvent('integration.connected')
  async onIntegrationConnected(payload: {
    integrationId: string;
    type: string;
  }) {
    this.logger.log(
      `Integration connected: ${payload.integrationId} (${payload.type})`
    );
  }

  @OnEvent('integration.disconnected')
  async onIntegrationDisconnected(payload: {
    integrationId: string;
    type: string;
  }) {
    this.logger.log(
      `Integration disconnected: ${payload.integrationId} (${payload.type})`
    );
  }

  // #endregion

  // #region Inbound Webhook Events

  @OnEvent('inbound_webhook.received')
  async onInboundWebhookReceived(payload: {
    webhookId: string;
    workspaceId: string;
    payload: Record<string, any>;
  }) {
    // Trigger automations that listen to this inbound webhook
    await this.automationExecutor.triggerByInboundWebhook(
      payload.webhookId,
      payload.workspaceId,
      payload.payload
    );
  }

  // #endregion
}
