import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { WebhookEventType } from '@prisma/client';
import { Request } from 'express';

import { Public } from '../../core/auth/guard';
import { AccessController } from '../../core/permission';
import { Models } from '../../models';
import { AutomationExecutorService } from './automation-executor.service';
import { WebhookDeliveryService } from './webhook-delivery.service';

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

/**
 * REST API Controller for Automation features
 * Provides agent-friendly endpoints for webhooks, integrations, and automations
 */
@Controller('api/automation')
export class AutomationController {
  constructor(
    private readonly models: Models,
    private readonly ac: AccessController,
    private readonly webhookDelivery: WebhookDeliveryService,
    private readonly automationExecutor: AutomationExecutorService
  ) {}

  // #region Webhooks API

  /**
   * List webhooks for a workspace
   * GET /api/automation/workspaces/:workspaceId/webhooks
   */
  @Get('workspaces/:workspaceId/webhooks')
  async listWebhooks(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Query('status') status?: string
  ) {
    if (!req.user) throw new UnauthorizedException();

    await this.ac
      .user(req.user.id)
      .workspace(workspaceId)
      .assert('Workspace.Read');

    const webhooks = await this.models.webhook.listByWorkspace(workspaceId, {
      status: status as any,
    });

    return {
      data: webhooks.map(w => ({
        id: w.id,
        name: w.name,
        url: w.url,
        events: w.events,
        status: w.status,
        successCount: w.successCount,
        failureCount: w.failureCount,
        lastTriggeredAt: w.lastTriggeredAt,
        createdAt: w.createdAt,
      })),
      total: webhooks.length,
    };
  }

  /**
   * Create a webhook
   * POST /api/automation/workspaces/:workspaceId/webhooks
   */
  @Post('workspaces/:workspaceId/webhooks')
  async createWebhook(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Body()
    body: {
      name: string;
      url: string;
      events: WebhookEventType[];
      description?: string;
      headers?: Record<string, string>;
    }
  ) {
    if (!req.user) throw new UnauthorizedException();

    await this.ac
      .user(req.user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings');

    const webhook = await this.models.webhook.create({
      workspaceId,
      name: body.name,
      url: body.url,
      events: body.events,
      description: body.description,
      headers: body.headers,
      createdBy: req.user.id,
    });

    return {
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      secret: webhook.secret,
      events: webhook.events,
      status: webhook.status,
      createdAt: webhook.createdAt,
    };
  }

  /**
   * Get webhook details
   * GET /api/automation/webhooks/:id
   */
  @Get('webhooks/:id')
  async getWebhook(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string
  ) {
    if (!req.user) throw new UnauthorizedException();

    const webhook = await this.models.webhook.get(id);
    if (!webhook) throw new NotFoundException('Webhook not found');

    await this.ac
      .user(req.user.id)
      .workspace(webhook.workspaceId)
      .assert('Workspace.Read');

    return webhook;
  }

  /**
   * Update a webhook
   * PUT /api/automation/webhooks/:id
   */
  @Put('webhooks/:id')
  async updateWebhook(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      url?: string;
      events?: WebhookEventType[];
      status?: string;
      description?: string;
      headers?: Record<string, string>;
    }
  ) {
    if (!req.user) throw new UnauthorizedException();

    const webhook = await this.models.webhook.get(id);
    if (!webhook) throw new NotFoundException('Webhook not found');

    await this.ac
      .user(req.user.id)
      .workspace(webhook.workspaceId)
      .assert('Workspace.Settings');

    return this.models.webhook.update(id, body as any);
  }

  /**
   * Delete a webhook
   * DELETE /api/automation/webhooks/:id
   */
  @Delete('webhooks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWebhook(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string
  ) {
    if (!req.user) throw new UnauthorizedException();

    const webhook = await this.models.webhook.get(id);
    if (!webhook) throw new NotFoundException('Webhook not found');

    await this.ac
      .user(req.user.id)
      .workspace(webhook.workspaceId)
      .assert('Workspace.Settings');

    await this.models.webhook.delete(id);
  }

  /**
   * Get webhook deliveries
   * GET /api/automation/webhooks/:id/deliveries
   */
  @Get('webhooks/:id/deliveries')
  async getWebhookDeliveries(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    if (!req.user) throw new UnauthorizedException();

    const webhook = await this.models.webhook.get(id);
    if (!webhook) throw new NotFoundException('Webhook not found');

    await this.ac
      .user(req.user.id)
      .workspace(webhook.workspaceId)
      .assert('Workspace.Read');

    const deliveries = await this.models.webhook.listDeliveries(id, {
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    return {
      data: deliveries,
      total: deliveries.length,
    };
  }

  /**
   * Retry a failed webhook delivery
   * POST /api/automation/deliveries/:id/retry
   */
  @Post('deliveries/:id/retry')
  async retryDelivery(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string
  ) {
    if (!req.user) throw new UnauthorizedException();

    const delivery = await this.models.webhook.getDelivery(id);
    if (!delivery) throw new NotFoundException('Delivery not found');

    await this.ac
      .user(req.user.id)
      .workspace(delivery.webhook.workspaceId)
      .assert('Workspace.Settings');

    const result = await this.webhookDelivery.deliver(id);
    return result;
  }

  // #endregion

  // #region Integrations API

  /**
   * List integrations for a workspace
   * GET /api/automation/workspaces/:workspaceId/integrations
   */
  @Get('workspaces/:workspaceId/integrations')
  async listIntegrations(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Query('type') type?: string
  ) {
    if (!req.user) throw new UnauthorizedException();

    await this.ac
      .user(req.user.id)
      .workspace(workspaceId)
      .assert('Workspace.Read');

    const integrations = await this.models.integration.listByWorkspace(
      workspaceId,
      { type: type as any }
    );

    return {
      data: integrations.map(i => ({
        id: i.id,
        type: i.type,
        name: i.name,
        status: i.status,
        events: i.events,
        lastSyncAt: i.lastSyncAt,
        createdAt: i.createdAt,
      })),
      total: integrations.length,
    };
  }

  /**
   * Create an integration
   * POST /api/automation/workspaces/:workspaceId/integrations
   */
  @Post('workspaces/:workspaceId/integrations')
  async createIntegration(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Body()
    body: {
      type: string;
      name: string;
      description?: string;
      config?: Record<string, any>;
      events?: WebhookEventType[];
    }
  ) {
    if (!req.user) throw new UnauthorizedException();

    await this.ac
      .user(req.user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings');

    return this.models.integration.create({
      workspaceId,
      type: body.type as any,
      name: body.name,
      description: body.description,
      config: body.config,
      events: body.events,
      createdBy: req.user.id,
    });
  }

  // #endregion

  // #region Automations API

  /**
   * List automations for a workspace
   * GET /api/automation/workspaces/:workspaceId/automations
   */
  @Get('workspaces/:workspaceId/automations')
  async listAutomations(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Query('status') status?: string
  ) {
    if (!req.user) throw new UnauthorizedException();

    await this.ac
      .user(req.user.id)
      .workspace(workspaceId)
      .assert('Workspace.Read');

    const automations = await this.models.automation.listByWorkspace(
      workspaceId,
      { status: status as any }
    );

    return {
      data: automations.map(a => ({
        id: a.id,
        name: a.name,
        status: a.status,
        triggerType: a.triggerType,
        runCount: a.runCount,
        errorCount: a.errorCount,
        lastRunAt: a.lastRunAt,
        createdAt: a.createdAt,
      })),
      total: automations.length,
    };
  }

  /**
   * Create an automation
   * POST /api/automation/workspaces/:workspaceId/automations
   */
  @Post('workspaces/:workspaceId/automations')
  async createAutomation(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Body()
    body: {
      name: string;
      description?: string;
      triggerType: string;
      triggerConfig: Record<string, any>;
      actions: Record<string, any>[];
      conditions?: Record<string, any>[];
    }
  ) {
    if (!req.user) throw new UnauthorizedException();

    await this.ac
      .user(req.user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings');

    return this.models.automation.create({
      workspaceId,
      name: body.name,
      description: body.description,
      triggerType: body.triggerType as any,
      triggerConfig: body.triggerConfig as any,
      actions: body.actions as any,
      conditions: body.conditions as any,
      createdBy: req.user.id,
    });
  }

  /**
   * Trigger an automation manually
   * POST /api/automation/automations/:id/trigger
   */
  @Post('automations/:id/trigger')
  async triggerAutomation(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body?: { data?: Record<string, any> }
  ) {
    if (!req.user) throw new UnauthorizedException();

    const automation = await this.models.automation.get(id);
    if (!automation) throw new NotFoundException('Automation not found');

    await this.ac
      .user(req.user.id)
      .workspace(automation.workspaceId)
      .assert('Workspace.Settings');

    const executionId = await this.automationExecutor.triggerManually(
      id,
      req.user.id,
      body?.data
    );

    return { executionId };
  }

  /**
   * Get automation executions
   * GET /api/automation/automations/:id/executions
   */
  @Get('automations/:id/executions')
  async getAutomationExecutions(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    if (!req.user) throw new UnauthorizedException();

    const automation = await this.models.automation.get(id);
    if (!automation) throw new NotFoundException('Automation not found');

    await this.ac
      .user(req.user.id)
      .workspace(automation.workspaceId)
      .assert('Workspace.Read');

    const executions = await this.models.automation.listExecutions(id, {
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    return {
      data: executions,
      total: executions.length,
    };
  }

  // #endregion

  // #region Inbound Webhooks API

  /**
   * List inbound webhooks for a workspace
   * GET /api/automation/workspaces/:workspaceId/inbound-webhooks
   */
  @Get('workspaces/:workspaceId/inbound-webhooks')
  async listInboundWebhooks(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string
  ) {
    if (!req.user) throw new UnauthorizedException();

    await this.ac
      .user(req.user.id)
      .workspace(workspaceId)
      .assert('Workspace.Read');

    const webhooks =
      await this.models.automation.listInboundWebhooks(workspaceId);
    const baseUrl =
      process.env.AFFINE_SERVER_BASE_URL || 'https://app.affine.pro';

    return {
      data: webhooks.map(w => ({
        ...w,
        webhookUrl: `${baseUrl}/api/webhooks/inbound/${w.token}`,
      })),
      total: webhooks.length,
    };
  }

  /**
   * Create an inbound webhook
   * POST /api/automation/workspaces/:workspaceId/inbound-webhooks
   */
  @Post('workspaces/:workspaceId/inbound-webhooks')
  async createInboundWebhook(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId') workspaceId: string,
    @Body()
    body: {
      name: string;
      description?: string;
      secret?: string;
      payloadSchema?: Record<string, any>;
    }
  ) {
    if (!req.user) throw new UnauthorizedException();

    await this.ac
      .user(req.user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings');

    const webhook = await this.models.automation.createInboundWebhook({
      workspaceId,
      name: body.name,
      description: body.description,
      secret: body.secret,
      payloadSchema: body.payloadSchema,
      createdBy: req.user.id,
    });

    const baseUrl =
      process.env.AFFINE_SERVER_BASE_URL || 'https://app.affine.pro';

    return {
      ...webhook,
      webhookUrl: `${baseUrl}/api/webhooks/inbound/${webhook.token}`,
    };
  }

  // #endregion
}

/**
 * Public controller for inbound webhook endpoints
 */
@Controller('api/webhooks')
export class InboundWebhookController {
  constructor(
    private readonly models: Models,
    private readonly webhookDelivery: WebhookDeliveryService
  ) {}

  /**
   * Receive inbound webhook
   * POST /api/webhooks/inbound/:token
   */
  @Public()
  @Post('inbound/:token')
  @HttpCode(HttpStatus.OK)
  async receiveInboundWebhook(
    @Param('token') token: string,
    @Body() body: Record<string, any>,
    @Headers('x-webhook-signature') signature?: string,
    @Req() req?: RawBodyRequest<Request>
  ) {
    const result = await this.models.automation.handleInboundWebhook(
      token,
      body
    );

    if (!result) {
      throw new NotFoundException('Webhook not found or disabled');
    }

    // If webhook has a secret, verify signature
    const webhook = await this.models.automation.getInboundWebhookByToken(token);
    if (webhook?.secret && signature) {
      const rawBody = req?.rawBody?.toString() || JSON.stringify(body);
      const isValid = this.webhookDelivery.verifySignature(
        rawBody,
        signature,
        webhook.secret
      );

      if (!isValid) {
        throw new UnauthorizedException('Invalid webhook signature');
      }
    }

    return {
      success: true,
      webhookId: result.webhookId,
      message: 'Webhook received',
    };
  }

  /**
   * Verify inbound webhook (for services that require verification)
   * GET /api/webhooks/inbound/:token
   */
  @Public()
  @Get('inbound/:token')
  async verifyInboundWebhook(
    @Param('token') token: string,
    @Query('challenge') challenge?: string
  ) {
    const webhook = await this.models.automation.getInboundWebhookByToken(token);

    if (!webhook || !webhook.enabled) {
      throw new NotFoundException('Webhook not found or disabled');
    }

    // Return challenge for services like Slack that require verification
    if (challenge) {
      return { challenge };
    }

    return { status: 'ok' };
  }
}
