import { Module } from '@nestjs/common';

import { PermissionModule } from '../../core/permission';
import { AutomationExecutorService } from './automation-executor.service';
import {
  AutomationController,
  InboundWebhookController,
} from './controller';
import { AutomationEventHandlers } from './event-handlers';
import { IntegrationDispatcherService } from './integration-dispatcher.service';
import {
  AutomationResolver,
  InboundWebhookResolver,
  IntegrationResolver,
  WebhookResolver,
} from './resolver';
import { WebhookDeliveryService } from './webhook-delivery.service';

@Module({
  imports: [PermissionModule],
  providers: [
    // Core services
    WebhookDeliveryService,
    IntegrationDispatcherService,
    AutomationExecutorService,

    // Event handlers
    AutomationEventHandlers,

    // GraphQL resolvers
    WebhookResolver,
    IntegrationResolver,
    AutomationResolver,
    InboundWebhookResolver,
  ],
  controllers: [AutomationController, InboundWebhookController],
  exports: [
    WebhookDeliveryService,
    IntegrationDispatcherService,
    AutomationExecutorService,
  ],
})
export class AutomationModule {}

export * from './automation-executor.service';
export * from './integration-dispatcher.service';
export * from './webhook-delivery.service';
