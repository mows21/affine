import {
  Args,
  Field,
  ID,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Parent,
  Query,
  registerEnumType,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import {
  AutomationExecutionStatus,
  AutomationStatus,
  AutomationTriggerType,
  IntegrationStatus,
  IntegrationType,
  WebhookDeliveryStatus,
  WebhookEventType,
  WebhookStatus,
} from '@prisma/client';
import GraphQLJSON from 'graphql-type-json';

import { CurrentUser } from '../../core/auth/session';
import { AccessController } from '../../core/permission';
import { Models } from '../../models';
import { AutomationExecutorService } from './automation-executor.service';
import { IntegrationDispatcherService } from './integration-dispatcher.service';

// Register enums for GraphQL
registerEnumType(WebhookEventType, { name: 'WebhookEventType' });
registerEnumType(WebhookStatus, { name: 'WebhookStatus' });
registerEnumType(WebhookDeliveryStatus, { name: 'WebhookDeliveryStatus' });
registerEnumType(IntegrationType, { name: 'IntegrationType' });
registerEnumType(IntegrationStatus, { name: 'IntegrationStatus' });
registerEnumType(AutomationStatus, { name: 'AutomationStatus' });
registerEnumType(AutomationTriggerType, { name: 'AutomationTriggerType' });
registerEnumType(AutomationExecutionStatus, {
  name: 'AutomationExecutionStatus',
});

// #region Webhook Types

@ObjectType()
export class WebhookEndpointType {
  @Field(() => ID)
  id!: string;

  @Field()
  workspaceId!: string;

  @Field()
  name!: string;

  @Field()
  url!: string;

  @Field(() => [WebhookEventType])
  events!: WebhookEventType[];

  @Field(() => WebhookStatus)
  status!: WebhookStatus;

  @Field(() => GraphQLJSON, { nullable: true })
  headers?: Record<string, string>;

  @Field(() => Int)
  maxRetries!: number;

  @Field(() => Int)
  retryDelayMs!: number;

  @Field(() => Int)
  rateLimitPerMinute!: number;

  @Field({ nullable: true })
  description?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  @Field({ nullable: true })
  lastTriggeredAt?: Date;

  @Field(() => Int)
  successCount!: number;

  @Field(() => Int)
  failureCount!: number;
}

@ObjectType()
export class WebhookDeliveryType {
  @Field(() => ID)
  id!: string;

  @Field()
  webhookId!: string;

  @Field(() => WebhookEventType)
  event!: WebhookEventType;

  @Field(() => GraphQLJSON)
  payload!: Record<string, any>;

  @Field(() => WebhookDeliveryStatus)
  status!: WebhookDeliveryStatus;

  @Field(() => Int, { nullable: true })
  statusCode?: number;

  @Field({ nullable: true })
  responseBody?: string;

  @Field({ nullable: true })
  errorMessage?: string;

  @Field(() => Int)
  attempts!: number;

  @Field()
  createdAt!: Date;

  @Field({ nullable: true })
  completedAt?: Date;

  @Field(() => Int, { nullable: true })
  durationMs?: number;
}

@InputType()
export class CreateWebhookInput {
  @Field()
  workspaceId!: string;

  @Field()
  name!: string;

  @Field()
  url!: string;

  @Field(() => [WebhookEventType])
  events!: WebhookEventType[];

  @Field({ nullable: true })
  description?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  headers?: Record<string, string>;

  @Field(() => Int, { nullable: true })
  maxRetries?: number;

  @Field(() => Int, { nullable: true })
  retryDelayMs?: number;

  @Field(() => Int, { nullable: true })
  rateLimitPerMinute?: number;
}

@InputType()
export class UpdateWebhookInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  url?: string;

  @Field(() => [WebhookEventType], { nullable: true })
  events?: WebhookEventType[];

  @Field(() => WebhookStatus, { nullable: true })
  status?: WebhookStatus;

  @Field({ nullable: true })
  description?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  headers?: Record<string, string>;

  @Field(() => Int, { nullable: true })
  maxRetries?: number;

  @Field(() => Int, { nullable: true })
  retryDelayMs?: number;

  @Field(() => Int, { nullable: true })
  rateLimitPerMinute?: number;
}

// #endregion

// #region Integration Types

@ObjectType()
export class IntegrationType_GQL {
  @Field(() => ID)
  id!: string;

  @Field()
  workspaceId!: string;

  @Field(() => IntegrationType)
  type!: IntegrationType;

  @Field()
  name!: string;

  @Field(() => IntegrationStatus)
  status!: IntegrationStatus;

  @Field(() => GraphQLJSON, { nullable: true })
  config?: Record<string, any>;

  @Field(() => [WebhookEventType])
  events!: WebhookEventType[];

  @Field({ nullable: true })
  description?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  @Field({ nullable: true })
  lastSyncAt?: Date;

  @Field({ nullable: true })
  errorMessage?: string;
}

@InputType()
export class CreateIntegrationInput {
  @Field()
  workspaceId!: string;

  @Field(() => IntegrationType)
  type!: IntegrationType;

  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  config?: Record<string, any>;

  @Field(() => [WebhookEventType], { nullable: true })
  events?: WebhookEventType[];
}

@InputType()
export class UpdateIntegrationInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  config?: Record<string, any>;

  @Field(() => GraphQLJSON, { nullable: true })
  credentials?: Record<string, any>;

  @Field(() => [WebhookEventType], { nullable: true })
  events?: WebhookEventType[];
}

// #endregion

// #region Automation Types

@ObjectType()
export class AutomationType {
  @Field(() => ID)
  id!: string;

  @Field()
  workspaceId!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => AutomationStatus)
  status!: AutomationStatus;

  @Field(() => AutomationTriggerType)
  triggerType!: AutomationTriggerType;

  @Field(() => GraphQLJSON)
  triggerConfig!: Record<string, any>;

  @Field(() => GraphQLJSON)
  actions!: Record<string, any>[];

  @Field(() => GraphQLJSON, { nullable: true })
  conditions?: Record<string, any>[];

  @Field(() => Int)
  maxExecutionsPerHour!: number;

  @Field(() => Int)
  timeoutMs!: number;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  @Field({ nullable: true })
  lastRunAt?: Date;

  @Field(() => Int)
  runCount!: number;

  @Field(() => Int)
  errorCount!: number;
}

@ObjectType()
export class AutomationExecutionType {
  @Field(() => ID)
  id!: string;

  @Field()
  automationId!: string;

  @Field(() => AutomationExecutionStatus)
  status!: AutomationExecutionStatus;

  @Field(() => GraphQLJSON)
  triggerData!: Record<string, any>;

  @Field(() => GraphQLJSON, { nullable: true })
  results?: Record<string, any>;

  @Field({ nullable: true })
  errorMessage?: string;

  @Field()
  startedAt!: Date;

  @Field({ nullable: true })
  completedAt?: Date;

  @Field(() => Int, { nullable: true })
  durationMs?: number;
}

@InputType()
export class CreateAutomationInput {
  @Field()
  workspaceId!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => AutomationTriggerType)
  triggerType!: AutomationTriggerType;

  @Field(() => GraphQLJSON)
  triggerConfig!: Record<string, any>;

  @Field(() => GraphQLJSON)
  actions!: Record<string, any>[];

  @Field(() => GraphQLJSON, { nullable: true })
  conditions?: Record<string, any>[];

  @Field(() => Int, { nullable: true })
  maxExecutionsPerHour?: number;

  @Field(() => Int, { nullable: true })
  timeoutMs?: number;
}

@InputType()
export class UpdateAutomationInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => AutomationStatus, { nullable: true })
  status?: AutomationStatus;

  @Field(() => AutomationTriggerType, { nullable: true })
  triggerType?: AutomationTriggerType;

  @Field(() => GraphQLJSON, { nullable: true })
  triggerConfig?: Record<string, any>;

  @Field(() => GraphQLJSON, { nullable: true })
  actions?: Record<string, any>[];

  @Field(() => GraphQLJSON, { nullable: true })
  conditions?: Record<string, any>[];

  @Field(() => Int, { nullable: true })
  maxExecutionsPerHour?: number;

  @Field(() => Int, { nullable: true })
  timeoutMs?: number;
}

// #endregion

// #region Inbound Webhook Types

@ObjectType()
export class InboundWebhookType {
  @Field(() => ID)
  id!: string;

  @Field()
  workspaceId!: string;

  @Field()
  name!: string;

  @Field()
  token!: string;

  @Field()
  enabled!: boolean;

  @Field(() => GraphQLJSON, { nullable: true })
  payloadSchema?: Record<string, any>;

  @Field({ nullable: true })
  description?: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  @Field({ nullable: true })
  lastReceivedAt?: Date;

  @Field(() => Int)
  requestCount!: number;

  @Field()
  webhookUrl!: string;
}

@InputType()
export class CreateInboundWebhookInput {
  @Field()
  workspaceId!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  secret?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  payloadSchema?: Record<string, any>;
}

// #endregion

// Webhook Resolver
@Resolver(() => WebhookEndpointType)
export class WebhookResolver {
  constructor(
    private readonly models: Models,
    private readonly ac: AccessController
  ) {}

  @Query(() => [WebhookEndpointType])
  async webhooks(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('status', { type: () => WebhookStatus, nullable: true })
    status?: WebhookStatus
  ): Promise<WebhookEndpointType[]> {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');

    return this.models.webhook.listByWorkspace(workspaceId, { status });
  }

  @Query(() => WebhookEndpointType, { nullable: true })
  async webhook(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<WebhookEndpointType | null> {
    const webhook = await this.models.webhook.get(id);
    if (!webhook) return null;

    await this.ac
      .user(user.id)
      .workspace(webhook.workspaceId)
      .assert('Workspace.Read');

    return webhook;
  }

  @Mutation(() => WebhookEndpointType)
  async createWebhook(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreateWebhookInput
  ): Promise<WebhookEndpointType> {
    await this.ac
      .user(user.id)
      .workspace(input.workspaceId)
      .assert('Workspace.Settings');

    return this.models.webhook.create({
      ...input,
      createdBy: user.id,
    });
  }

  @Mutation(() => WebhookEndpointType)
  async updateWebhook(
    @CurrentUser() user: { id: string },
    @Args('id') id: string,
    @Args('input') input: UpdateWebhookInput
  ): Promise<WebhookEndpointType> {
    const webhook = await this.models.webhook.get(id);
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    await this.ac
      .user(user.id)
      .workspace(webhook.workspaceId)
      .assert('Workspace.Settings');

    return this.models.webhook.update(id, input);
  }

  @Mutation(() => String)
  async regenerateWebhookSecret(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<string> {
    const webhook = await this.models.webhook.get(id);
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    await this.ac
      .user(user.id)
      .workspace(webhook.workspaceId)
      .assert('Workspace.Settings');

    return this.models.webhook.regenerateSecret(id);
  }

  @Mutation(() => Boolean)
  async deleteWebhook(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<boolean> {
    const webhook = await this.models.webhook.get(id);
    if (!webhook) {
      throw new Error('Webhook not found');
    }

    await this.ac
      .user(user.id)
      .workspace(webhook.workspaceId)
      .assert('Workspace.Settings');

    await this.models.webhook.delete(id);
    return true;
  }

  @ResolveField(() => [WebhookDeliveryType])
  async deliveries(
    @Parent() webhook: WebhookEndpointType,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ): Promise<WebhookDeliveryType[]> {
    return this.models.webhook.listDeliveries(webhook.id, { limit });
  }
}

// Integration Resolver
@Resolver(() => IntegrationType_GQL)
export class IntegrationResolver {
  constructor(
    private readonly models: Models,
    private readonly ac: AccessController,
    private readonly dispatcher: IntegrationDispatcherService
  ) {}

  @Query(() => [IntegrationType_GQL])
  async integrations(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('type', { type: () => IntegrationType, nullable: true })
    type?: IntegrationType
  ): Promise<IntegrationType_GQL[]> {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');

    return this.models.integration.listByWorkspace(workspaceId, { type });
  }

  @Query(() => IntegrationType_GQL, { nullable: true })
  async integration(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<IntegrationType_GQL | null> {
    const integration = await this.models.integration.get(id);
    if (!integration) return null;

    await this.ac
      .user(user.id)
      .workspace(integration.workspaceId)
      .assert('Workspace.Read');

    return integration;
  }

  @Mutation(() => IntegrationType_GQL)
  async createIntegration(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreateIntegrationInput
  ): Promise<IntegrationType_GQL> {
    await this.ac
      .user(user.id)
      .workspace(input.workspaceId)
      .assert('Workspace.Settings');

    return this.models.integration.create({
      ...input,
      createdBy: user.id,
    });
  }

  @Mutation(() => IntegrationType_GQL)
  async updateIntegration(
    @CurrentUser() user: { id: string },
    @Args('id') id: string,
    @Args('input') input: UpdateIntegrationInput
  ): Promise<IntegrationType_GQL> {
    const integration = await this.models.integration.get(id);
    if (!integration) {
      throw new Error('Integration not found');
    }

    await this.ac
      .user(user.id)
      .workspace(integration.workspaceId)
      .assert('Workspace.Settings');

    return this.models.integration.update(id, input);
  }

  @Mutation(() => IntegrationType_GQL)
  async connectIntegration(
    @CurrentUser() user: { id: string },
    @Args('id') id: string,
    @Args('credentials', { type: () => GraphQLJSON, nullable: true })
    credentials?: Record<string, any>
  ): Promise<IntegrationType_GQL> {
    const integration = await this.models.integration.get(id);
    if (!integration) {
      throw new Error('Integration not found');
    }

    await this.ac
      .user(user.id)
      .workspace(integration.workspaceId)
      .assert('Workspace.Settings');

    return this.models.integration.connect(id, credentials);
  }

  @Mutation(() => IntegrationType_GQL)
  async disconnectIntegration(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<IntegrationType_GQL> {
    const integration = await this.models.integration.get(id);
    if (!integration) {
      throw new Error('Integration not found');
    }

    await this.ac
      .user(user.id)
      .workspace(integration.workspaceId)
      .assert('Workspace.Settings');

    return this.models.integration.disconnect(id);
  }

  @Mutation(() => Boolean)
  async deleteIntegration(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<boolean> {
    const integration = await this.models.integration.get(id);
    if (!integration) {
      throw new Error('Integration not found');
    }

    await this.ac
      .user(user.id)
      .workspace(integration.workspaceId)
      .assert('Workspace.Settings');

    await this.models.integration.delete(id);
    return true;
  }

  @Mutation(() => Boolean)
  async testSlackConnection(
    @CurrentUser() user: { id: string },
    @Args('botToken') botToken: string
  ): Promise<boolean> {
    const result = await this.dispatcher.testSlackConnection(botToken);
    return result.ok;
  }

  @Mutation(() => Boolean)
  async testDiscordWebhook(
    @CurrentUser() user: { id: string },
    @Args('webhookUrl') webhookUrl: string
  ): Promise<boolean> {
    const result = await this.dispatcher.testDiscordWebhook(webhookUrl);
    return result.ok;
  }
}

// Automation Resolver
@Resolver(() => AutomationType)
export class AutomationResolver {
  constructor(
    private readonly models: Models,
    private readonly ac: AccessController,
    private readonly executor: AutomationExecutorService
  ) {}

  @Query(() => [AutomationType])
  async automations(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('status', { type: () => AutomationStatus, nullable: true })
    status?: AutomationStatus
  ): Promise<AutomationType[]> {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');

    return this.models.automation.listByWorkspace(workspaceId, { status });
  }

  @Query(() => AutomationType, { nullable: true })
  async automation(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<AutomationType | null> {
    const automation = await this.models.automation.get(id);
    if (!automation) return null;

    await this.ac
      .user(user.id)
      .workspace(automation.workspaceId)
      .assert('Workspace.Read');

    return automation;
  }

  @Mutation(() => AutomationType)
  async createAutomation(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreateAutomationInput
  ): Promise<AutomationType> {
    await this.ac
      .user(user.id)
      .workspace(input.workspaceId)
      .assert('Workspace.Settings');

    return this.models.automation.create({
      ...input,
      actions: input.actions as any,
      conditions: input.conditions as any,
      createdBy: user.id,
    });
  }

  @Mutation(() => AutomationType)
  async updateAutomation(
    @CurrentUser() user: { id: string },
    @Args('id') id: string,
    @Args('input') input: UpdateAutomationInput
  ): Promise<AutomationType> {
    const automation = await this.models.automation.get(id);
    if (!automation) {
      throw new Error('Automation not found');
    }

    await this.ac
      .user(user.id)
      .workspace(automation.workspaceId)
      .assert('Workspace.Settings');

    return this.models.automation.update(id, {
      ...input,
      actions: input.actions as any,
      conditions: input.conditions as any,
    });
  }

  @Mutation(() => AutomationType)
  async activateAutomation(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<AutomationType> {
    const automation = await this.models.automation.get(id);
    if (!automation) {
      throw new Error('Automation not found');
    }

    await this.ac
      .user(user.id)
      .workspace(automation.workspaceId)
      .assert('Workspace.Settings');

    return this.models.automation.activate(id);
  }

  @Mutation(() => AutomationType)
  async pauseAutomation(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<AutomationType> {
    const automation = await this.models.automation.get(id);
    if (!automation) {
      throw new Error('Automation not found');
    }

    await this.ac
      .user(user.id)
      .workspace(automation.workspaceId)
      .assert('Workspace.Settings');

    return this.models.automation.pause(id);
  }

  @Mutation(() => String)
  async triggerAutomation(
    @CurrentUser() user: { id: string },
    @Args('id') id: string,
    @Args('data', { type: () => GraphQLJSON, nullable: true })
    data?: Record<string, any>
  ): Promise<string> {
    const automation = await this.models.automation.get(id);
    if (!automation) {
      throw new Error('Automation not found');
    }

    await this.ac
      .user(user.id)
      .workspace(automation.workspaceId)
      .assert('Workspace.Settings');

    return this.executor.triggerManually(id, user.id, data);
  }

  @Mutation(() => Boolean)
  async deleteAutomation(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<boolean> {
    const automation = await this.models.automation.get(id);
    if (!automation) {
      throw new Error('Automation not found');
    }

    await this.ac
      .user(user.id)
      .workspace(automation.workspaceId)
      .assert('Workspace.Settings');

    await this.models.automation.delete(id);
    return true;
  }

  @ResolveField(() => [AutomationExecutionType])
  async executions(
    @Parent() automation: AutomationType,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ): Promise<AutomationExecutionType[]> {
    return this.models.automation.listExecutions(automation.id, { limit });
  }
}

// Inbound Webhook Resolver
@Resolver(() => InboundWebhookType)
export class InboundWebhookResolver {
  private readonly baseUrl: string;

  constructor(
    private readonly models: Models,
    private readonly ac: AccessController
  ) {
    // This would typically come from config
    this.baseUrl =
      process.env.AFFINE_SERVER_BASE_URL || 'https://app.affine.pro';
  }

  @Query(() => [InboundWebhookType])
  async inboundWebhooks(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string
  ): Promise<InboundWebhookType[]> {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');

    const webhooks =
      await this.models.automation.listInboundWebhooks(workspaceId);
    return webhooks.map(w => ({
      ...w,
      webhookUrl: `${this.baseUrl}/api/webhooks/inbound/${w.token}`,
    }));
  }

  @Query(() => InboundWebhookType, { nullable: true })
  async inboundWebhook(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<InboundWebhookType | null> {
    const webhook = await this.models.automation.getInboundWebhook(id);
    if (!webhook) return null;

    await this.ac
      .user(user.id)
      .workspace(webhook.workspaceId)
      .assert('Workspace.Read');

    return {
      ...webhook,
      webhookUrl: `${this.baseUrl}/api/webhooks/inbound/${webhook.token}`,
    };
  }

  @Mutation(() => InboundWebhookType)
  async createInboundWebhook(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreateInboundWebhookInput
  ): Promise<InboundWebhookType> {
    await this.ac
      .user(user.id)
      .workspace(input.workspaceId)
      .assert('Workspace.Settings');

    const webhook = await this.models.automation.createInboundWebhook({
      ...input,
      createdBy: user.id,
    });

    return {
      ...webhook,
      webhookUrl: `${this.baseUrl}/api/webhooks/inbound/${webhook.token}`,
    };
  }

  @Mutation(() => Boolean)
  async deleteInboundWebhook(
    @CurrentUser() user: { id: string },
    @Args('id') id: string
  ): Promise<boolean> {
    const webhook = await this.models.automation.getInboundWebhook(id);
    if (!webhook) {
      throw new Error('Inbound webhook not found');
    }

    await this.ac
      .user(user.id)
      .workspace(webhook.workspaceId)
      .assert('Workspace.Settings');

    await this.models.automation.deleteInboundWebhook(id);
    return true;
  }
}
