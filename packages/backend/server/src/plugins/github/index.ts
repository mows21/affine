import { Module } from '@nestjs/common';

import { PermissionModule } from '../../core/permission';
import { GitHubWebhookController } from './controller';
import { GitHubCanvasService } from './github-canvas.service';
import { GitHubService } from './github.service';
import { GitHubResolver } from './resolver';

// Re-export tools for use in copilot
export * from './github-tools';

@Module({
  imports: [PermissionModule],
  providers: [GitHubService, GitHubCanvasService, GitHubResolver],
  controllers: [GitHubWebhookController],
  exports: [GitHubService, GitHubCanvasService],
})
export class GitHubModule {}
