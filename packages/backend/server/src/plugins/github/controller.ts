import crypto from 'node:crypto';

import {
  Body,
  Controller,
  Headers,
  Logger,
  Param,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Response } from 'express';

import { Public } from '../../core/auth/guard';
import { Models } from '../../models';

interface GitHubUser {
  login: string;
  id: number;
}

interface GitHubLabel {
  name: string;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  user: GitHubUser;
  labels: GitHubLabel[];
  html_url: string;
  closed_at?: string;
}

interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  user: GitHubUser;
  head: { ref: string };
  base: { ref: string };
  draft: boolean;
  merged: boolean;
  merged_by?: GitHubUser;
  html_url: string;
}

interface GitHubCommit {
  id: string;
  message: string;
  author: { name: string; email: string };
  url: string;
}

interface GitHubRepository {
  full_name: string;
  name: string;
  owner: { login: string };
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  author: GitHubUser;
  html_url: string;
}

interface GitHubWorkflowRun {
  id: number;
  name: string;
  conclusion: string;
  status: string;
  html_url: string;
  head_branch: string;
}

type GitHubWebhookPayload = {
  action?: string;
  repository: GitHubRepository;
  sender: GitHubUser;
  issue?: GitHubIssue;
  pull_request?: GitHubPullRequest;
  commits?: GitHubCommit[];
  pusher?: { name: string; email: string };
  ref?: string;
  release?: GitHubRelease;
  workflow_run?: GitHubWorkflowRun;
  changes?: Record<string, any>;
};

/**
 * Controller for receiving GitHub webhooks
 * URL: /api/github/webhook/:workspaceId/:secret
 */
@Controller('/api/github/webhook')
export class GitHubWebhookController {
  private readonly logger = new Logger(GitHubWebhookController.name);

  constructor(
    private readonly models: Models,
    private readonly event: EventEmitter2
  ) {}

  @Public()
  @Post(':workspaceId/:secret')
  async handleWebhook(
    @Param('workspaceId') workspaceId: string,
    @Param('secret') secret: string,
    @Headers('x-github-event') event: string,
    @Headers('x-github-delivery') deliveryId: string,
    @Headers('x-hub-signature-256') signature: string,
    @Body() payload: GitHubWebhookPayload,
    @Res() res: Response
  ) {
    try {
      // Verify the webhook belongs to this workspace
      const integration = await this.models.integration.findByType(
        workspaceId,
        'github'
      );

      if (!integration || integration.length === 0) {
        throw new UnauthorizedException('GitHub integration not found');
      }

      const githubIntegration = integration[0];
      const webhookSecret = (githubIntegration.config as any)?.webhookSecret;

      // Verify signature if webhook secret is configured
      if (webhookSecret && signature) {
        const isValid = this.verifySignature(
          JSON.stringify(payload),
          signature,
          webhookSecret
        );
        if (!isValid) {
          throw new UnauthorizedException('Invalid signature');
        }
      }

      // Verify the secret path parameter matches
      if (secret !== (githubIntegration.config as any)?.pathSecret) {
        throw new UnauthorizedException('Invalid webhook path');
      }

      this.logger.log(
        `Received GitHub webhook: ${event} for workspace ${workspaceId}`
      );

      // Process the webhook based on event type
      await this.processWebhook(workspaceId, event, payload);

      res.status(200).json({ received: true, event, deliveryId });
    } catch (error) {
      this.logger.error('Error processing GitHub webhook', error);

      if (error instanceof UnauthorizedException) {
        res.status(401).json({ error: 'Unauthorized' });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  private verifySignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    const expectedSignature =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(payload).digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  private async processWebhook(
    workspaceId: string,
    event: string,
    payload: GitHubWebhookPayload
  ) {
    const repository = payload.repository.full_name;

    switch (event) {
      case 'issues':
        await this.handleIssueEvent(workspaceId, repository, payload);
        break;

      case 'pull_request':
        await this.handlePullRequestEvent(workspaceId, repository, payload);
        break;

      case 'push':
        await this.handlePushEvent(workspaceId, repository, payload);
        break;

      case 'release':
        await this.handleReleaseEvent(workspaceId, repository, payload);
        break;

      case 'workflow_run':
        await this.handleWorkflowEvent(workspaceId, repository, payload);
        break;

      default:
        this.logger.debug(`Unhandled GitHub event: ${event}`);
    }
  }

  private async handleIssueEvent(
    workspaceId: string,
    repository: string,
    payload: GitHubWebhookPayload
  ) {
    const issue = payload.issue;
    if (!issue) return;

    const issueData = {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      author: issue.user.login,
      labels: issue.labels.map(l => l.name),
      url: issue.html_url,
    };

    switch (payload.action) {
      case 'opened':
        this.event.emit('github.issue.created', {
          workspaceId,
          repository,
          issue: issueData,
        });
        break;

      case 'edited':
      case 'labeled':
      case 'unlabeled':
      case 'assigned':
      case 'unassigned':
        this.event.emit('github.issue.updated', {
          workspaceId,
          repository,
          issue: issueData,
          changes: payload.changes,
        });
        break;

      case 'closed':
        this.event.emit('github.issue.closed', {
          workspaceId,
          repository,
          issue: {
            ...issueData,
            closedBy: payload.sender.login,
          },
        });
        break;

      case 'reopened':
        this.event.emit('github.issue.updated', {
          workspaceId,
          repository,
          issue: issueData,
          changes: { state: { from: 'closed', to: 'open' } },
        });
        break;
    }
  }

  private async handlePullRequestEvent(
    workspaceId: string,
    repository: string,
    payload: GitHubWebhookPayload
  ) {
    const pr = payload.pull_request;
    if (!pr) return;

    const prData = {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      author: pr.user.login,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      draft: pr.draft,
      merged: pr.merged,
      url: pr.html_url,
    };

    switch (payload.action) {
      case 'opened':
        this.event.emit('github.pr.created', {
          workspaceId,
          repository,
          pullRequest: prData,
        });
        break;

      case 'closed':
        if (pr.merged) {
          this.event.emit('github.pr.merged', {
            workspaceId,
            repository,
            pullRequest: {
              ...prData,
              mergedBy: pr.merged_by?.login || payload.sender.login,
            },
          });
        } else {
          this.event.emit('github.pr.closed', {
            workspaceId,
            repository,
            pullRequest: {
              ...prData,
              closedBy: payload.sender.login,
            },
          });
        }
        break;

      case 'edited':
      case 'ready_for_review':
      case 'review_requested':
      case 'labeled':
      case 'unlabeled':
        // These can be handled as updates if needed
        break;
    }
  }

  private async handlePushEvent(
    workspaceId: string,
    repository: string,
    payload: GitHubWebhookPayload
  ) {
    if (!payload.commits || !payload.ref) return;

    this.event.emit('github.push', {
      workspaceId,
      repository,
      ref: payload.ref,
      commits: payload.commits.map(c => ({
        id: c.id,
        message: c.message,
        author: c.author.name,
        url: c.url,
      })),
      pusher: payload.pusher?.name || payload.sender.login,
    });
  }

  private async handleReleaseEvent(
    workspaceId: string,
    repository: string,
    payload: GitHubWebhookPayload
  ) {
    const release = payload.release;
    if (!release) return;

    const action = payload.action as
      | 'published'
      | 'created'
      | 'edited'
      | 'deleted';
    if (!['published', 'created', 'edited', 'deleted'].includes(action)) return;

    this.event.emit('github.release', {
      workspaceId,
      repository,
      release: {
        id: release.id,
        tagName: release.tag_name,
        name: release.name,
        body: release.body,
        draft: release.draft,
        prerelease: release.prerelease,
        author: release.author.login,
        url: release.html_url,
      },
      action,
    });
  }

  private async handleWorkflowEvent(
    workspaceId: string,
    repository: string,
    payload: GitHubWebhookPayload
  ) {
    const workflowRun = payload.workflow_run;
    if (!workflowRun) return;

    if (payload.action === 'completed') {
      this.event.emit('github.workflow.completed', {
        workspaceId,
        repository,
        workflow: {
          id: workflowRun.id,
          name: workflowRun.name,
          conclusion: workflowRun.conclusion,
          status: workflowRun.status,
          url: workflowRun.html_url,
        },
        branch: workflowRun.head_branch,
      });
    }
  }
}
