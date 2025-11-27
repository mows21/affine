import { Logger } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';

import { GitHubCanvasService } from './github-canvas.service';
import { CreateIssueInput, GitHubService } from './github.service';

const logger = new Logger('GitHubTools');

/**
 * Create GitHub repository overview tool
 */
export const createGitHubRepoOverviewTool = (
  github: GitHubService,
  canvasService: GitHubCanvasService
) => {
  return tool({
    description:
      'Get an overview of a GitHub repository including issues, PRs, milestones, and workflow status. Use this to understand project status and create visualizations.',
    inputSchema: z.object({
      workspaceId: z.string().describe('The AFFiNE workspace ID'),
      owner: z.string().describe('GitHub repository owner (user or org)'),
      repo: z.string().describe('GitHub repository name'),
      generateSummary: z
        .boolean()
        .optional()
        .describe('Whether to generate an AI summary'),
    }),
    execute: async ({ workspaceId, owner, repo, generateSummary }) => {
      try {
        const result = await canvasService.syncRepoToCanvas(
          workspaceId,
          owner,
          repo,
          {
            includeKanban: true,
            includeMindMap: true,
            includeTimeline: true,
            includeWorkflows: true,
            generateSummary: generateSummary ?? true,
          }
        );

        return {
          success: true,
          markdown: result.markdown,
          visualizations: result.visualizations,
        };
      } catch (err: any) {
        logger.error(`Failed to get repo overview: ${owner}/${repo}`, err);
        return {
          success: false,
          error: err.message,
        };
      }
    },
  });
};

/**
 * Create GitHub issues listing tool
 */
export const createGitHubListIssuesTool = (github: GitHubService) => {
  return tool({
    description:
      'List issues from a GitHub repository. Can filter by state, labels, and assignee.',
    inputSchema: z.object({
      workspaceId: z.string().describe('The AFFiNE workspace ID'),
      owner: z.string().describe('GitHub repository owner'),
      repo: z.string().describe('GitHub repository name'),
      state: z
        .enum(['open', 'closed', 'all'])
        .optional()
        .describe('Issue state filter'),
      labels: z.string().optional().describe('Comma-separated label names'),
      limit: z.number().optional().describe('Max number of issues to return'),
    }),
    execute: async ({ workspaceId, owner, repo, state, labels, limit }) => {
      try {
        const issues = await github.listIssues(workspaceId, owner, repo, {
          state: state || 'open',
          labels,
          per_page: limit || 30,
        });

        return {
          success: true,
          count: issues.length,
          issues: issues.map(i => ({
            number: i.number,
            title: i.title,
            state: i.state,
            labels: i.labels.map(l => l.name),
            assignees: i.assignees.map(a => a.login),
            url: i.html_url,
            createdAt: i.created_at,
          })),
        };
      } catch (err: any) {
        logger.error(`Failed to list issues: ${owner}/${repo}`, err);
        return { success: false, error: err.message };
      }
    },
  });
};

/**
 * Create GitHub issue creation tool
 */
export const createGitHubCreateIssueTool = (github: GitHubService) => {
  return tool({
    description:
      'Create a new issue in a GitHub repository. Use this to convert tasks from canvas/documents into GitHub issues.',
    inputSchema: z.object({
      workspaceId: z.string().describe('The AFFiNE workspace ID'),
      owner: z.string().describe('GitHub repository owner'),
      repo: z.string().describe('GitHub repository name'),
      title: z.string().describe('Issue title'),
      body: z.string().optional().describe('Issue body in markdown'),
      labels: z
        .array(z.string())
        .optional()
        .describe('Labels to apply to the issue'),
      assignees: z
        .array(z.string())
        .optional()
        .describe('GitHub usernames to assign'),
    }),
    execute: async ({
      workspaceId,
      owner,
      repo,
      title,
      body,
      labels,
      assignees,
    }) => {
      try {
        const issue = await github.createIssue(workspaceId, owner, repo, {
          title,
          body,
          labels,
          assignees,
        });

        return {
          success: true,
          issue: {
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            state: issue.state,
          },
        };
      } catch (err: any) {
        logger.error(`Failed to create issue in ${owner}/${repo}`, err);
        return { success: false, error: err.message };
      }
    },
  });
};

/**
 * Create GitHub issue update tool
 */
export const createGitHubUpdateIssueTool = (github: GitHubService) => {
  return tool({
    description:
      'Update an existing GitHub issue. Can change title, body, state, labels, or assignees.',
    inputSchema: z.object({
      workspaceId: z.string().describe('The AFFiNE workspace ID'),
      owner: z.string().describe('GitHub repository owner'),
      repo: z.string().describe('GitHub repository name'),
      issueNumber: z.number().describe('Issue number to update'),
      title: z.string().optional().describe('New title'),
      body: z.string().optional().describe('New body'),
      state: z.enum(['open', 'closed']).optional().describe('New state'),
      labels: z.array(z.string()).optional().describe('New labels'),
      assignees: z.array(z.string()).optional().describe('New assignees'),
    }),
    execute: async ({
      workspaceId,
      owner,
      repo,
      issueNumber,
      title,
      body,
      state,
      labels,
      assignees,
    }) => {
      try {
        const issue = await github.updateIssue(
          workspaceId,
          owner,
          repo,
          issueNumber,
          { title, body, state, labels, assignees }
        );

        return {
          success: true,
          issue: {
            number: issue.number,
            title: issue.title,
            state: issue.state,
            url: issue.html_url,
          },
        };
      } catch (err: any) {
        logger.error(
          `Failed to update issue #${issueNumber} in ${owner}/${repo}`,
          err
        );
        return { success: false, error: err.message };
      }
    },
  });
};

/**
 * Create GitHub PRs listing tool
 */
export const createGitHubListPRsTool = (github: GitHubService) => {
  return tool({
    description:
      'List pull requests from a GitHub repository. Useful for understanding code review status.',
    inputSchema: z.object({
      workspaceId: z.string().describe('The AFFiNE workspace ID'),
      owner: z.string().describe('GitHub repository owner'),
      repo: z.string().describe('GitHub repository name'),
      state: z
        .enum(['open', 'closed', 'all'])
        .optional()
        .describe('PR state filter'),
      limit: z.number().optional().describe('Max number of PRs to return'),
    }),
    execute: async ({ workspaceId, owner, repo, state, limit }) => {
      try {
        const prs = await github.listPullRequests(workspaceId, owner, repo, {
          state: state || 'open',
          per_page: limit || 20,
        });

        return {
          success: true,
          count: prs.length,
          pullRequests: prs.map(pr => ({
            number: pr.number,
            title: pr.title,
            state: pr.merged ? 'merged' : pr.state,
            draft: pr.draft,
            head: pr.head.ref,
            base: pr.base.ref,
            author: pr.user.login,
            url: pr.html_url,
            createdAt: pr.created_at,
          })),
        };
      } catch (err: any) {
        logger.error(`Failed to list PRs: ${owner}/${repo}`, err);
        return { success: false, error: err.message };
      }
    },
  });
};

/**
 * Create tool for extracting issues from canvas content
 */
export const createExtractIssuesFromCanvasTool = (
  canvasService: GitHubCanvasService
) => {
  return tool({
    description:
      'Analyze canvas/document content and extract potential GitHub issues. Use this to convert planning documents into actionable issues.',
    inputSchema: z.object({
      content: z
        .string()
        .describe('The canvas or document content to analyze'),
    }),
    execute: async ({ content }) => {
      try {
        const extractedIssues =
          await canvasService.extractIssuesFromCanvas(content);

        return {
          success: true,
          count: extractedIssues.length,
          issues: extractedIssues,
        };
      } catch (err: any) {
        logger.error('Failed to extract issues from canvas', err);
        return { success: false, error: err.message };
      }
    },
  });
};

/**
 * Create tool for generating project documentation
 */
export const createGenerateProjectDocTool = (
  canvasService: GitHubCanvasService
) => {
  return tool({
    description:
      'Generate project documentation (overview, roadmap, sprint planning, retrospective) from GitHub repository data.',
    inputSchema: z.object({
      workspaceId: z.string().describe('The AFFiNE workspace ID'),
      owner: z.string().describe('GitHub repository owner'),
      repo: z.string().describe('GitHub repository name'),
      format: z
        .enum(['overview', 'roadmap', 'sprint-planning', 'retrospective'])
        .describe('Type of document to generate'),
    }),
    execute: async ({ workspaceId, owner, repo, format }) => {
      try {
        const markdown = await canvasService.generateCanvasMarkdown(
          workspaceId,
          owner,
          repo,
          format
        );

        return {
          success: true,
          format,
          markdown,
        };
      } catch (err: any) {
        logger.error(`Failed to generate ${format} document`, err);
        return { success: false, error: err.message };
      }
    },
  });
};

/**
 * Create tool for batch creating issues from canvas
 */
export const createBatchCreateIssuesTool = (
  github: GitHubService,
  canvasService: GitHubCanvasService
) => {
  return tool({
    description:
      'Extract issues from canvas content and create them in GitHub. This combines extraction and creation in one step.',
    inputSchema: z.object({
      workspaceId: z.string().describe('The AFFiNE workspace ID'),
      owner: z.string().describe('GitHub repository owner'),
      repo: z.string().describe('GitHub repository name'),
      content: z.string().describe('Canvas/document content to process'),
      minConfidence: z
        .number()
        .optional()
        .describe('Minimum confidence threshold (0-1) for creating issues'),
    }),
    execute: async ({
      workspaceId,
      owner,
      repo,
      content,
      minConfidence = 0.7,
    }) => {
      try {
        // Extract potential issues
        const extractedIssues =
          await canvasService.extractIssuesFromCanvas(content);

        // Filter by confidence
        const issuesToCreate = extractedIssues.filter(
          i => i.confidence >= minConfidence
        );

        // Create issues in GitHub
        const createdIssues = [];
        for (const issue of issuesToCreate) {
          try {
            const created = await github.createIssue(
              workspaceId,
              owner,
              repo,
              {
                title: issue.title,
                body: issue.body,
                labels: issue.labels,
              }
            );
            createdIssues.push({
              number: created.number,
              title: created.title,
              url: created.html_url,
            });
          } catch (err) {
            logger.warn(`Failed to create issue: ${issue.title}`);
          }
        }

        return {
          success: true,
          extracted: extractedIssues.length,
          created: createdIssues.length,
          issues: createdIssues,
        };
      } catch (err: any) {
        logger.error('Failed to batch create issues', err);
        return { success: false, error: err.message };
      }
    },
  });
};

// Export all tools as a set
export interface GitHubAITools {
  github_repo_overview: ReturnType<typeof createGitHubRepoOverviewTool>;
  github_list_issues: ReturnType<typeof createGitHubListIssuesTool>;
  github_create_issue: ReturnType<typeof createGitHubCreateIssueTool>;
  github_update_issue: ReturnType<typeof createGitHubUpdateIssueTool>;
  github_list_prs: ReturnType<typeof createGitHubListPRsTool>;
  github_extract_issues: ReturnType<typeof createExtractIssuesFromCanvasTool>;
  github_generate_doc: ReturnType<typeof createGenerateProjectDocTool>;
  github_batch_create_issues: ReturnType<typeof createBatchCreateIssuesTool>;
}

export const createGitHubTools = (
  github: GitHubService,
  canvasService: GitHubCanvasService
): GitHubAITools => ({
  github_repo_overview: createGitHubRepoOverviewTool(github, canvasService),
  github_list_issues: createGitHubListIssuesTool(github),
  github_create_issue: createGitHubCreateIssueTool(github),
  github_update_issue: createGitHubUpdateIssueTool(github),
  github_list_prs: createGitHubListPRsTool(github),
  github_extract_issues: createExtractIssuesFromCanvasTool(canvasService),
  github_generate_doc: createGenerateProjectDocTool(canvasService),
  github_batch_create_issues: createBatchCreateIssuesTool(github, canvasService),
});
