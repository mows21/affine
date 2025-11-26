import { Injectable, Logger } from '@nestjs/common';
import {
  Automation,
  AutomationExecutionStatus,
  AutomationTriggerType,
  WebhookEventType,
} from '@prisma/client';

import { OnJob } from '../../base';
import {
  ActionDefinition,
  ActionType,
  ConditionDefinition,
  EventTriggerConfig,
  Models,
} from '../../models';

// Extend Jobs interface for automation execution
declare global {
  interface Jobs {
    'automation.execute': {
      automationId: string;
      executionId: string;
    };
    'automation.scheduled': {
      automationId: string;
    };
  }
}

export interface ExecutionContext {
  workspaceId: string;
  triggerData: Record<string, any>;
  variables: Record<string, any>;
  results: Record<string, any>;
}

@Injectable()
export class AutomationExecutorService {
  private readonly logger = new Logger(AutomationExecutorService.name);

  constructor(private readonly models: Models) {}

  /**
   * Trigger automations by event
   */
  async triggerByEvent(
    workspaceId: string,
    event: WebhookEventType,
    data: Record<string, any>
  ): Promise<string[]> {
    const automations = await this.models.automation.findByEvent(
      workspaceId,
      event
    );
    const executionIds: string[] = [];

    for (const automation of automations) {
      try {
        // Check rate limit
        if (
          await this.models.automation.hasExceededRateLimit(
            automation.id,
            automation.maxExecutionsPerHour
          )
        ) {
          this.logger.warn(
            `Automation ${automation.id} rate limit exceeded`
          );
          continue;
        }

        // Check conditions
        const triggerConfig = automation.triggerConfig as EventTriggerConfig;
        const conditions = automation.conditions as
          | ConditionDefinition[]
          | null;

        if (conditions && !this.evaluateConditions(conditions, data)) {
          this.logger.debug(
            `Automation ${automation.id} conditions not met`
          );
          continue;
        }

        // Create execution
        const execution = await this.models.automation.createExecution(
          automation.id,
          { event, data }
        );
        executionIds.push(execution.id);

        // Execute asynchronously
        this.execute(automation, execution.id, { event, data }).catch(err => {
          this.logger.error(
            `Error executing automation ${automation.id}`,
            err
          );
        });
      } catch (error) {
        this.logger.error(
          `Error triggering automation ${automation.id}`,
          error
        );
      }
    }

    return executionIds;
  }

  /**
   * Trigger automations by inbound webhook
   */
  async triggerByInboundWebhook(
    webhookId: string,
    workspaceId: string,
    payload: Record<string, any>
  ): Promise<string[]> {
    const automations =
      await this.models.automation.findByInboundWebhook(webhookId);
    const executionIds: string[] = [];

    for (const automation of automations) {
      try {
        // Check rate limit
        if (
          await this.models.automation.hasExceededRateLimit(
            automation.id,
            automation.maxExecutionsPerHour
          )
        ) {
          this.logger.warn(
            `Automation ${automation.id} rate limit exceeded`
          );
          continue;
        }

        // Create execution
        const execution = await this.models.automation.createExecution(
          automation.id,
          { webhookId, payload }
        );
        executionIds.push(execution.id);

        // Execute asynchronously
        this.execute(automation, execution.id, {
          webhookId,
          payload,
        }).catch(err => {
          this.logger.error(
            `Error executing automation ${automation.id}`,
            err
          );
        });
      } catch (error) {
        this.logger.error(
          `Error triggering automation ${automation.id}`,
          error
        );
      }
    }

    return executionIds;
  }

  /**
   * Manually trigger an automation
   */
  async triggerManually(
    automationId: string,
    userId: string,
    data?: Record<string, any>
  ): Promise<string> {
    const automation = await this.models.automation.get(automationId);

    if (!automation) {
      throw new Error('Automation not found');
    }

    // Check rate limit
    if (
      await this.models.automation.hasExceededRateLimit(
        automation.id,
        automation.maxExecutionsPerHour
      )
    ) {
      throw new Error('Rate limit exceeded');
    }

    // Create execution
    const execution = await this.models.automation.createExecution(
      automation.id,
      { manual: true, triggeredBy: userId, data }
    );

    // Execute asynchronously
    this.execute(automation, execution.id, {
      manual: true,
      triggeredBy: userId,
      data,
    }).catch(err => {
      this.logger.error(`Error executing automation ${automation.id}`, err);
    });

    return execution.id;
  }

  /**
   * Execute an automation
   */
  async execute(
    automation: Automation,
    executionId: string,
    triggerData: Record<string, any>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Mark as running
      await this.models.automation.startExecution(executionId);

      const context: ExecutionContext = {
        workspaceId: automation.workspaceId,
        triggerData,
        variables: {},
        results: {},
      };

      const actions = automation.actions as ActionDefinition[];

      // Execute actions sequentially
      for (const action of actions) {
        try {
          const result = await this.executeAction(action, context);
          context.results[action.id] = result;
          context.variables = { ...context.variables, ...result };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

          this.logger.error(
            `Action ${action.id} failed: ${errorMessage}`
          );

          // Handle failure - execute onFailure action if specified
          if (action.onFailure) {
            const failureAction = actions.find(a => a.id === action.onFailure);
            if (failureAction) {
              await this.executeAction(failureAction, context);
            }
          }

          // Mark execution as failed
          await this.models.automation.updateExecutionStatus(executionId, {
            status: AutomationExecutionStatus.failed,
            results: context.results,
            errorMessage: `Action ${action.name} failed: ${errorMessage}`,
          });

          await this.models.automation.updateStats(automation.id, false);
          return;
        }
      }

      // Mark as completed
      await this.models.automation.updateExecutionStatus(executionId, {
        status: AutomationExecutionStatus.completed,
        results: context.results,
      });

      await this.models.automation.updateStats(automation.id, true);

      this.logger.log(
        `Automation ${automation.id} executed successfully in ${Date.now() - startTime}ms`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      await this.models.automation.updateExecutionStatus(executionId, {
        status: AutomationExecutionStatus.failed,
        errorMessage,
      });

      await this.models.automation.updateStats(automation.id, false);

      this.logger.error(
        `Automation ${automation.id} failed: ${errorMessage}`
      );
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    action: ActionDefinition,
    context: ExecutionContext
  ): Promise<Record<string, any>> {
    const config = this.interpolateConfig(action.config, context);

    switch (action.type) {
      case ActionType.SEND_WEBHOOK:
        return this.executeSendWebhook(config, context);

      case ActionType.HTTP_REQUEST:
        return this.executeHttpRequest(config);

      case ActionType.SEND_NOTIFICATION:
        return this.executeSendNotification(config, context);

      case ActionType.TRANSFORM_DATA:
        return this.executeTransformData(config, context);

      case ActionType.DELAY:
        return this.executeDelay(config);

      case ActionType.CONDITION:
        return this.executeCondition(config, context);

      default:
        throw new Error(`Unsupported action type: ${action.type}`);
    }
  }

  /**
   * Interpolate variables in config
   */
  private interpolateConfig(
    config: Record<string, any>,
    context: ExecutionContext
  ): Record<string, any> {
    const interpolate = (value: any): any => {
      if (typeof value === 'string') {
        // Replace {{variable}} with actual values
        return value.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
          const parts = path.split('.');
          let current: any = { ...context.triggerData, ...context.variables };

          for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
              current = current[part];
            } else {
              return '';
            }
          }

          return String(current ?? '');
        });
      }

      if (Array.isArray(value)) {
        return value.map(interpolate);
      }

      if (value && typeof value === 'object') {
        const result: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
          result[k] = interpolate(v);
        }
        return result;
      }

      return value;
    };

    return interpolate(config);
  }

  /**
   * Evaluate conditions
   */
  private evaluateConditions(
    conditions: ConditionDefinition[],
    data: Record<string, any>
  ): boolean {
    let result = true;
    let currentLogic: 'and' | 'or' = 'and';

    for (const condition of conditions) {
      const fieldValue = this.getNestedValue(data, condition.field);
      const conditionResult = this.evaluateCondition(
        fieldValue,
        condition.operator,
        condition.value
      );

      if (currentLogic === 'and') {
        result = result && conditionResult;
      } else {
        result = result || conditionResult;
      }

      currentLogic = condition.logic || 'and';
    }

    return result;
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    fieldValue: any,
    operator: string,
    value: any
  ): boolean {
    switch (operator) {
      case 'eq':
        return fieldValue === value;
      case 'ne':
        return fieldValue !== value;
      case 'gt':
        return fieldValue > value;
      case 'gte':
        return fieldValue >= value;
      case 'lt':
        return fieldValue < value;
      case 'lte':
        return fieldValue <= value;
      case 'contains':
        return String(fieldValue).includes(String(value));
      case 'regex':
        return new RegExp(value).test(String(fieldValue));
      default:
        return false;
    }
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: Record<string, any>, path: string): any {
    const parts = path.split('.');
    let current: any = obj;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  // #region Action Implementations

  /**
   * Send webhook action
   */
  private async executeSendWebhook(
    config: Record<string, any>,
    context: ExecutionContext
  ): Promise<Record<string, any>> {
    const { url, method = 'POST', headers = {}, body } = config;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseBody = await response.text();

    return {
      statusCode: response.status,
      responseBody:
        response.headers.get('content-type')?.includes('json') &&
        responseBody
          ? JSON.parse(responseBody)
          : responseBody,
      success: response.ok,
    };
  }

  /**
   * HTTP request action
   */
  private async executeHttpRequest(
    config: Record<string, any>
  ): Promise<Record<string, any>> {
    const { url, method = 'GET', headers = {}, body, timeout = 30000 } = config;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseBody = await response.text();

      return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers),
        body:
          response.headers.get('content-type')?.includes('json') &&
          responseBody
            ? JSON.parse(responseBody)
            : responseBody,
        success: response.ok,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Send notification action
   */
  private async executeSendNotification(
    config: Record<string, any>,
    context: ExecutionContext
  ): Promise<Record<string, any>> {
    const { userId, title, body, level = 'Default' } = config;

    // This would integrate with the notification system
    this.logger.log(
      `Notification to ${userId}: ${title} - ${body}`
    );

    return { sent: true, userId, title };
  }

  /**
   * Transform data action
   */
  private executeTransformData(
    config: Record<string, any>,
    context: ExecutionContext
  ): Record<string, any> {
    const { mapping } = config;
    const result: Record<string, any> = {};

    if (mapping && typeof mapping === 'object') {
      for (const [key, value] of Object.entries(mapping)) {
        if (typeof value === 'string' && value.startsWith('$')) {
          // Reference to context data
          const path = value.substring(1);
          result[key] = this.getNestedValue(
            { ...context.triggerData, ...context.variables },
            path
          );
        } else {
          result[key] = value;
        }
      }
    }

    return result;
  }

  /**
   * Delay action
   */
  private async executeDelay(
    config: Record<string, any>
  ): Promise<Record<string, any>> {
    const { ms = 1000 } = config;
    const maxDelay = 60000; // Cap at 1 minute

    await new Promise(resolve =>
      setTimeout(resolve, Math.min(ms, maxDelay))
    );

    return { delayed: true, ms: Math.min(ms, maxDelay) };
  }

  /**
   * Condition action (branching)
   */
  private executeCondition(
    config: Record<string, any>,
    context: ExecutionContext
  ): Record<string, any> {
    const { conditions } = config;
    const result = this.evaluateConditions(conditions, {
      ...context.triggerData,
      ...context.variables,
    });

    return { conditionMet: result };
  }

  // #endregion

  /**
   * Job handler for automation execution
   */
  @OnJob('automation.execute')
  async handleExecuteJob({
    automationId,
    executionId,
  }: {
    automationId: string;
    executionId: string;
  }) {
    const automation = await this.models.automation.get(automationId);
    const execution = await this.models.automation.getExecution(executionId);

    if (automation && execution) {
      await this.execute(
        automation,
        executionId,
        execution.triggerData as Record<string, any>
      );
    }
  }

  /**
   * Job handler for scheduled automations
   */
  @OnJob('automation.scheduled')
  async handleScheduledJob({ automationId }: { automationId: string }) {
    const automation = await this.models.automation.get(automationId);

    if (!automation || automation.status !== 'active') {
      return;
    }

    // Check rate limit
    if (
      await this.models.automation.hasExceededRateLimit(
        automation.id,
        automation.maxExecutionsPerHour
      )
    ) {
      this.logger.warn(`Scheduled automation ${automation.id} rate limited`);
      return;
    }

    const execution = await this.models.automation.createExecution(
      automation.id,
      { scheduled: true, timestamp: new Date().toISOString() }
    );

    await this.execute(automation, execution.id, {
      scheduled: true,
      timestamp: new Date().toISOString(),
    });
  }
}
