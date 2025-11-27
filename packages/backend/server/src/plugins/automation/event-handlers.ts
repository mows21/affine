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

  // #region GitHub Events

  @OnEvent('github.issue.created')
  async onGitHubIssueCreated(payload: {
    workspaceId: string;
    repository: string;
    issue: {
      id: number;
      number: number;
      title: string;
      body?: string;
      state: string;
      author: string;
      labels: string[];
      url: string;
    };
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.github_issue_created,
      {
        repository: payload.repository,
        issue: payload.issue,
      }
    );
  }

  @OnEvent('github.issue.updated')
  async onGitHubIssueUpdated(payload: {
    workspaceId: string;
    repository: string;
    issue: {
      id: number;
      number: number;
      title: string;
      body?: string;
      state: string;
      author: string;
      labels: string[];
      url: string;
    };
    changes?: Record<string, any>;
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.github_issue_updated,
      {
        repository: payload.repository,
        issue: payload.issue,
        changes: payload.changes,
      }
    );
  }

  @OnEvent('github.issue.closed')
  async onGitHubIssueClosed(payload: {
    workspaceId: string;
    repository: string;
    issue: {
      id: number;
      number: number;
      title: string;
      state: string;
      author: string;
      closedBy?: string;
      url: string;
    };
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.github_issue_closed,
      {
        repository: payload.repository,
        issue: payload.issue,
      }
    );
  }

  @OnEvent('github.pr.created')
  async onGitHubPRCreated(payload: {
    workspaceId: string;
    repository: string;
    pullRequest: {
      id: number;
      number: number;
      title: string;
      body?: string;
      state: string;
      author: string;
      headBranch: string;
      baseBranch: string;
      draft: boolean;
      url: string;
    };
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.github_pr_created,
      {
        repository: payload.repository,
        pullRequest: payload.pullRequest,
      }
    );
  }

  @OnEvent('github.pr.merged')
  async onGitHubPRMerged(payload: {
    workspaceId: string;
    repository: string;
    pullRequest: {
      id: number;
      number: number;
      title: string;
      author: string;
      mergedBy: string;
      headBranch: string;
      baseBranch: string;
      url: string;
    };
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.github_pr_merged,
      {
        repository: payload.repository,
        pullRequest: payload.pullRequest,
      }
    );
  }

  @OnEvent('github.pr.closed')
  async onGitHubPRClosed(payload: {
    workspaceId: string;
    repository: string;
    pullRequest: {
      id: number;
      number: number;
      title: string;
      state: string;
      author: string;
      closedBy?: string;
      merged: boolean;
      url: string;
    };
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.github_pr_closed,
      {
        repository: payload.repository,
        pullRequest: payload.pullRequest,
      }
    );
  }

  @OnEvent('github.push')
  async onGitHubPush(payload: {
    workspaceId: string;
    repository: string;
    ref: string;
    commits: Array<{
      id: string;
      message: string;
      author: string;
      url: string;
    }>;
    pusher: string;
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.github_push,
      {
        repository: payload.repository,
        ref: payload.ref,
        commits: payload.commits,
        pusher: payload.pusher,
      }
    );
  }

  @OnEvent('github.release')
  async onGitHubRelease(payload: {
    workspaceId: string;
    repository: string;
    release: {
      id: number;
      tagName: string;
      name: string;
      body?: string;
      draft: boolean;
      prerelease: boolean;
      author: string;
      url: string;
    };
    action: 'published' | 'created' | 'edited' | 'deleted';
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.github_release,
      {
        repository: payload.repository,
        release: payload.release,
        action: payload.action,
      }
    );
  }

  @OnEvent('github.workflow.completed')
  async onGitHubWorkflowCompleted(payload: {
    workspaceId: string;
    repository: string;
    workflow: {
      id: number;
      name: string;
      conclusion: string;
      status: string;
      url: string;
    };
    branch: string;
  }) {
    await this.triggerAutomation(
      payload.workspaceId,
      WebhookEventType.github_workflow_completed,
      {
        repository: payload.repository,
        workflow: payload.workflow,
        branch: payload.branch,
      }
    );
  }

  // #endregion
}
