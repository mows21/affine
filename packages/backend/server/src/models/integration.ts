import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  Integration,
  IntegrationStatus,
  IntegrationType,
  Prisma,
  WebhookEventType,
} from '@prisma/client';

import { EventBus } from '../base';
import { BaseModel } from './base';

declare global {
  interface Events {
    'integration.created': { integrationId: string; workspaceId: string };
    'integration.updated': { integrationId: string; workspaceId: string };
    'integration.deleted': { integrationId: string; workspaceId: string };
    'integration.connected': { integrationId: string; type: IntegrationType };
    'integration.disconnected': {
      integrationId: string;
      type: IntegrationType;
    };
  }
}

export type { Integration };
export { IntegrationType, IntegrationStatus };

export interface CreateIntegrationInput {
  workspaceId: string;
  type: IntegrationType;
  name: string;
  description?: string;
  config?: Record<string, any>;
  events?: WebhookEventType[];
  createdBy?: string;
}

export interface UpdateIntegrationInput {
  name?: string;
  description?: string;
  config?: Record<string, any>;
  credentials?: Record<string, any>;
  events?: WebhookEventType[];
  status?: IntegrationStatus;
  errorMessage?: string;
}

// Type-safe configuration interfaces for each integration type
export interface SlackIntegrationConfig {
  channelId?: string;
  channelName?: string;
  botToken?: string;
  teamId?: string;
  teamName?: string;
  notifyOnDocCreate?: boolean;
  notifyOnDocUpdate?: boolean;
  notifyOnComment?: boolean;
  notifyOnMemberJoin?: boolean;
  messageTemplate?: string;
}

export interface DiscordIntegrationConfig {
  guildId?: string;
  guildName?: string;
  channelId?: string;
  channelName?: string;
  webhookUrl?: string;
  notifyOnDocCreate?: boolean;
  notifyOnDocUpdate?: boolean;
  notifyOnComment?: boolean;
  notifyOnMemberJoin?: boolean;
  embedColor?: string;
}

export interface ZapierIntegrationConfig {
  webhookUrl: string;
  zapId?: string;
}

export interface N8nIntegrationConfig {
  webhookUrl: string;
  workflowId?: string;
}

export interface GithubIntegrationConfig {
  owner: string;
  repo: string;
  accessToken?: string;
  syncIssues?: boolean;
  syncPRs?: boolean;
  labelMapping?: Record<string, string>;
}

export interface LinearIntegrationConfig {
  teamId: string;
  apiKey?: string;
  projectId?: string;
  syncIssues?: boolean;
  statusMapping?: Record<string, string>;
}

export interface NotionIntegrationConfig {
  databaseId: string;
  accessToken?: string;
  syncPages?: boolean;
  propertyMapping?: Record<string, string>;
}

@Injectable()
export class IntegrationModel extends BaseModel {
  constructor(private readonly event: EventBus) {
    super();
  }

  // #region Integrations

  /**
   * Create a new integration
   */
  @Transactional()
  async create(input: CreateIntegrationInput): Promise<Integration> {
    const integration = await this.db.integration.create({
      data: {
        workspaceId: input.workspaceId,
        type: input.type,
        name: input.name,
        description: input.description,
        config: input.config ?? Prisma.JsonNull,
        events: input.events ?? [],
        createdBy: input.createdBy,
        status: IntegrationStatus.pending_setup,
      },
    });

    this.logger.log(
      `Integration created: ${integration.id} (${input.type}) for workspace ${input.workspaceId}`
    );
    this.event.emit('integration.created', {
      integrationId: integration.id,
      workspaceId: input.workspaceId,
    });

    return integration;
  }

  /**
   * Get integration by ID
   */
  async get(integrationId: string): Promise<Integration | null> {
    return this.db.integration.findUnique({
      where: { id: integrationId },
    });
  }

  /**
   * Get integration by workspace, type, and name
   */
  async getByTypeAndName(
    workspaceId: string,
    type: IntegrationType,
    name: string
  ): Promise<Integration | null> {
    return this.db.integration.findUnique({
      where: {
        workspaceId_type_name: { workspaceId, type, name },
      },
    });
  }

  /**
   * List integrations for a workspace
   */
  async listByWorkspace(
    workspaceId: string,
    options?: {
      type?: IntegrationType;
      status?: IntegrationStatus;
      limit?: number;
      offset?: number;
    }
  ): Promise<Integration[]> {
    return this.db.integration.findMany({
      where: {
        workspaceId,
        ...(options?.type && { type: options.type }),
        ...(options?.status && { status: options.status }),
      },
      take: options?.limit ?? 100,
      skip: options?.offset ?? 0,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find active integrations subscribed to a specific event
   */
  async findByEvent(
    workspaceId: string,
    event: WebhookEventType
  ): Promise<Integration[]> {
    return this.db.integration.findMany({
      where: {
        workspaceId,
        status: IntegrationStatus.active,
        OR: [
          { events: { has: event } },
          { events: { has: WebhookEventType.all_events } },
        ],
      },
    });
  }

  /**
   * Update an integration
   */
  async update(
    integrationId: string,
    input: UpdateIntegrationInput
  ): Promise<Integration> {
    const integration = await this.db.integration.update({
      where: { id: integrationId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.config !== undefined && {
          config: input.config ?? Prisma.JsonNull,
        }),
        ...(input.credentials !== undefined && {
          credentials: input.credentials ?? Prisma.JsonNull,
        }),
        ...(input.events !== undefined && { events: input.events }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.errorMessage !== undefined && {
          errorMessage: input.errorMessage,
        }),
      },
    });

    this.logger.debug(`Integration updated: ${integrationId}`);
    this.event.emit('integration.updated', {
      integrationId: integration.id,
      workspaceId: integration.workspaceId,
    });

    return integration;
  }

  /**
   * Connect an integration (activate it)
   */
  async connect(
    integrationId: string,
    credentials?: Record<string, any>
  ): Promise<Integration> {
    const integration = await this.db.integration.update({
      where: { id: integrationId },
      data: {
        status: IntegrationStatus.active,
        ...(credentials && { credentials }),
        errorMessage: null,
        lastSyncAt: new Date(),
      },
    });

    this.logger.log(`Integration connected: ${integrationId}`);
    this.event.emit('integration.connected', {
      integrationId: integration.id,
      type: integration.type,
    });

    return integration;
  }

  /**
   * Disconnect an integration
   */
  async disconnect(integrationId: string): Promise<Integration> {
    const integration = await this.db.integration.update({
      where: { id: integrationId },
      data: {
        status: IntegrationStatus.disconnected,
        credentials: Prisma.JsonNull,
      },
    });

    this.logger.log(`Integration disconnected: ${integrationId}`);
    this.event.emit('integration.disconnected', {
      integrationId: integration.id,
      type: integration.type,
    });

    return integration;
  }

  /**
   * Mark integration as error
   */
  async markError(
    integrationId: string,
    errorMessage: string
  ): Promise<Integration> {
    const integration = await this.db.integration.update({
      where: { id: integrationId },
      data: {
        status: IntegrationStatus.error,
        errorMessage,
      },
    });

    this.logger.warn(`Integration error: ${integrationId} - ${errorMessage}`);
    return integration;
  }

  /**
   * Update last sync time
   */
  async updateLastSync(integrationId: string): Promise<void> {
    await this.db.integration.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date() },
    });
  }

  /**
   * Delete an integration
   */
  async delete(integrationId: string): Promise<void> {
    const integration = await this.db.integration.findUnique({
      where: { id: integrationId },
      select: { workspaceId: true },
    });

    if (integration) {
      await this.db.integration.delete({
        where: { id: integrationId },
      });

      this.logger.log(`Integration deleted: ${integrationId}`);
      this.event.emit('integration.deleted', {
        integrationId,
        workspaceId: integration.workspaceId,
      });
    }
  }

  // #endregion

  // #region Helper methods

  /**
   * Get typed config for Slack integration
   */
  getSlackConfig(integration: Integration): SlackIntegrationConfig {
    return (integration.config as SlackIntegrationConfig) ?? {};
  }

  /**
   * Get typed config for Discord integration
   */
  getDiscordConfig(integration: Integration): DiscordIntegrationConfig {
    return (integration.config as DiscordIntegrationConfig) ?? {};
  }

  /**
   * Get typed config for GitHub integration
   */
  getGithubConfig(integration: Integration): GithubIntegrationConfig {
    return (integration.config as GithubIntegrationConfig) ?? {};
  }

  /**
   * Get typed config for Linear integration
   */
  getLinearConfig(integration: Integration): LinearIntegrationConfig {
    return (integration.config as LinearIntegrationConfig) ?? {};
  }

  /**
   * Get typed config for Notion integration
   */
  getNotionConfig(integration: Integration): NotionIntegrationConfig {
    return (integration.config as NotionIntegrationConfig) ?? {};
  }

  // #endregion
}
