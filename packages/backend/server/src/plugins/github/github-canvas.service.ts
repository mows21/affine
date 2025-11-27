import { Injectable, Logger } from '@nestjs/common';

import { Models } from '../../models';
import { CopilotProviderFactory } from '../copilot/providers';
import { PromptService } from '../copilot/prompt';
import {
  GitHubIssue,
  GitHubMilestone,
  GitHubPullRequest,
  GitHubRepository,
  GitHubService,
  GitHubWorkflowRun,
} from './github.service';

// Canvas block types for GitHub visualization
export interface CanvasBlock {
  id: string;
  type: string;
  props: Record<string, any>;
  children?: CanvasBlock[];
}

export interface KanbanBoard {
  type: 'kanban';
  columns: Array<{
    id: string;
    title: string;
    cards: Array<{
      id: string;
      title: string;
      description?: string;
      labels?: Array<{ name: string; color: string }>;
      assignees?: string[];
      url?: string;
      metadata?: Record<string, any>;
    }>;
  }>;
}

export interface MindMap {
  type: 'mindmap';
  root: {
    id: string;
    text: string;
    children: MindMapNode[];
  };
}

export interface MindMapNode {
  id: string;
  text: string;
  description?: string;
  url?: string;
  children?: MindMapNode[];
}

export interface Timeline {
  type: 'timeline';
  events: Array<{
    id: string;
    title: string;
    date: string;
    description?: string;
    status?: string;
    url?: string;
  }>;
}

export interface FlowChart {
  type: 'flowchart';
  nodes: Array<{
    id: string;
    type: 'start' | 'end' | 'process' | 'decision' | 'io';
    label: string;
    status?: 'success' | 'failure' | 'pending' | 'running';
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
  }>;
}

export type CanvasVisualization =
  | KanbanBoard
  | MindMap
  | Timeline
  | FlowChart;

@Injectable()
export class GitHubCanvasService {
  private readonly logger = new Logger(GitHubCanvasService.name);

  constructor(
    private readonly models: Models,
    private readonly github: GitHubService,
    private readonly promptService: PromptService,
    private readonly providerFactory: CopilotProviderFactory
  ) {}

  // #region GitHub to Canvas Transformations

  /**
   * Transform GitHub issues into a Kanban board
   */
  issuesToKanban(issues: GitHubIssue[], milestones?: GitHubMilestone[]): KanbanBoard {
    // Group issues by state and labels
    const openIssues = issues.filter(i => i.state === 'open');
    const closedIssues = issues.filter(i => i.state === 'closed');

    // Try to identify in-progress issues by labels
    const inProgressLabels = ['in progress', 'in-progress', 'doing', 'wip'];
    const inProgress = openIssues.filter(i =>
      i.labels.some(l => inProgressLabels.includes(l.name.toLowerCase()))
    );
    const todo = openIssues.filter(
      i => !i.labels.some(l => inProgressLabels.includes(l.name.toLowerCase()))
    );

    return {
      type: 'kanban',
      columns: [
        {
          id: 'backlog',
          title: '📋 Backlog',
          cards: todo.map(issue => ({
            id: `issue-${issue.number}`,
            title: issue.title,
            description: issue.body?.substring(0, 200),
            labels: issue.labels.map(l => ({ name: l.name, color: l.color })),
            assignees: issue.assignees.map(a => a.login),
            url: issue.html_url,
            metadata: {
              number: issue.number,
              type: 'issue',
              createdAt: issue.created_at,
            },
          })),
        },
        {
          id: 'in-progress',
          title: '🚧 In Progress',
          cards: inProgress.map(issue => ({
            id: `issue-${issue.number}`,
            title: issue.title,
            description: issue.body?.substring(0, 200),
            labels: issue.labels.map(l => ({ name: l.name, color: l.color })),
            assignees: issue.assignees.map(a => a.login),
            url: issue.html_url,
            metadata: {
              number: issue.number,
              type: 'issue',
              createdAt: issue.created_at,
            },
          })),
        },
        {
          id: 'done',
          title: '✅ Done',
          cards: closedIssues.slice(0, 20).map(issue => ({
            id: `issue-${issue.number}`,
            title: issue.title,
            description: issue.body?.substring(0, 200),
            labels: issue.labels.map(l => ({ name: l.name, color: l.color })),
            assignees: issue.assignees.map(a => a.login),
            url: issue.html_url,
            metadata: {
              number: issue.number,
              type: 'issue',
              closedAt: issue.closed_at,
            },
          })),
        },
      ],
    };
  }

  /**
   * Transform repository structure into a mind map
   */
  repositoryToMindMap(
    repo: GitHubRepository,
    issues: GitHubIssue[],
    prs: GitHubPullRequest[],
    milestones: GitHubMilestone[]
  ): MindMap {
    // Group issues by labels/categories
    const labelGroups = new Map<string, GitHubIssue[]>();
    issues.forEach(issue => {
      const primaryLabel = issue.labels[0]?.name || 'Uncategorized';
      if (!labelGroups.has(primaryLabel)) {
        labelGroups.set(primaryLabel, []);
      }
      labelGroups.get(primaryLabel)!.push(issue);
    });

    return {
      type: 'mindmap',
      root: {
        id: `repo-${repo.id}`,
        text: repo.name,
        children: [
          {
            id: 'issues',
            text: `📋 Issues (${issues.length})`,
            children: Array.from(labelGroups.entries()).map(
              ([label, groupIssues]) => ({
                id: `label-${label}`,
                text: label,
                children: groupIssues.slice(0, 10).map(issue => ({
                  id: `issue-${issue.number}`,
                  text: `#${issue.number}: ${issue.title}`,
                  url: issue.html_url,
                })),
              })
            ),
          },
          {
            id: 'prs',
            text: `🔀 Pull Requests (${prs.length})`,
            children: prs.slice(0, 10).map(pr => ({
              id: `pr-${pr.number}`,
              text: `#${pr.number}: ${pr.title}`,
              description: pr.draft ? '(Draft)' : pr.state,
              url: pr.html_url,
            })),
          },
          {
            id: 'milestones',
            text: `🎯 Milestones (${milestones.length})`,
            children: milestones.map(m => ({
              id: `milestone-${m.id}`,
              text: m.title,
              description: m.due_on
                ? `Due: ${new Date(m.due_on).toLocaleDateString()}`
                : undefined,
              url: m.html_url,
            })),
          },
        ],
      },
    };
  }

  /**
   * Transform milestones and issues into a timeline
   */
  milestonesToTimeline(
    milestones: GitHubMilestone[],
    issues: GitHubIssue[]
  ): Timeline {
    const events: Timeline['events'] = [];

    // Add milestones
    milestones.forEach(m => {
      if (m.due_on) {
        events.push({
          id: `milestone-${m.id}`,
          title: `🎯 ${m.title}`,
          date: m.due_on,
          description: `${m.open_issues} open, ${m.closed_issues} closed`,
          status: m.state,
          url: m.html_url,
        });
      }
    });

    // Add significant issues (closed ones as completed events)
    issues
      .filter(i => i.closed_at)
      .slice(0, 20)
      .forEach(issue => {
        events.push({
          id: `issue-${issue.number}`,
          title: `✅ #${issue.number}: ${issue.title}`,
          date: issue.closed_at!,
          status: 'closed',
          url: issue.html_url,
        });
      });

    // Sort by date
    events.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    return {
      type: 'timeline',
      events,
    };
  }

  /**
   * Transform workflow runs into a flowchart
   */
  workflowsToFlowChart(runs: GitHubWorkflowRun[]): FlowChart {
    const nodes: FlowChart['nodes'] = [
      { id: 'trigger', type: 'start', label: 'Push/PR' },
    ];
    const edges: FlowChart['edges'] = [];

    // Group runs by workflow
    const workflows = new Map<string, GitHubWorkflowRun[]>();
    runs.forEach(run => {
      if (!workflows.has(run.name)) {
        workflows.set(run.name, []);
      }
      workflows.get(run.name)!.push(run);
    });

    let prevId = 'trigger';
    workflows.forEach((workflowRuns, name) => {
      const latestRun = workflowRuns[0];
      const nodeId = `workflow-${name.replace(/\s+/g, '-')}`;

      nodes.push({
        id: nodeId,
        type: 'process',
        label: name,
        status:
          latestRun.conclusion === 'success'
            ? 'success'
            : latestRun.conclusion === 'failure'
              ? 'failure'
              : latestRun.status === 'in_progress'
                ? 'running'
                : 'pending',
      });

      edges.push({ from: prevId, to: nodeId });
      prevId = nodeId;
    });

    nodes.push({ id: 'deploy', type: 'end', label: 'Deploy' });
    edges.push({ from: prevId, to: 'deploy' });

    return {
      type: 'flowchart',
      nodes,
      edges,
    };
  }

  // #endregion

  // #region AI-Powered Transformations

  /**
   * Use AI to generate a project summary from GitHub data
   */
  async generateProjectSummary(
    workspaceId: string,
    owner: string,
    repo: string
  ): Promise<string> {
    const overview = await this.github.getRepositoryOverview(
      workspaceId,
      owner,
      repo
    );

    const prompt = `Analyze this GitHub repository and provide a concise project summary:

Repository: ${overview.repository.full_name}
Description: ${overview.repository.description || 'No description'}
Language: ${overview.repository.language || 'Unknown'}
Stars: ${overview.repository.stargazers_count}
Forks: ${overview.repository.forks_count}

Open Issues (${overview.issues.filter(i => i.state === 'open').length}):
${overview.issues
  .filter(i => i.state === 'open')
  .slice(0, 10)
  .map(i => `- #${i.number}: ${i.title}`)
  .join('\n')}

Open Pull Requests (${overview.pullRequests.filter(p => p.state === 'open').length}):
${overview.pullRequests
  .filter(p => p.state === 'open')
  .slice(0, 5)
  .map(p => `- #${p.number}: ${p.title}`)
  .join('\n')}

Milestones:
${overview.milestones.map(m => `- ${m.title} (${m.open_issues} open, ${m.closed_issues} closed)`).join('\n')}

Provide:
1. A brief project overview
2. Current development focus (based on recent issues/PRs)
3. Key areas needing attention
4. Suggested next steps`;

    const provider = await this.providerFactory.getProviderByModel(
      'gpt-4o-mini'
    );
    if (!provider) {
      throw new Error('AI provider not available');
    }

    return provider.text(
      { modelId: 'gpt-4o-mini' },
      [{ role: 'user', content: prompt }]
    );
  }

  /**
   * Use AI to suggest issue organization/categorization
   */
  async suggestIssueOrganization(
    issues: GitHubIssue[]
  ): Promise<{
    categories: Array<{
      name: string;
      description: string;
      issues: number[];
    }>;
    priorities: Array<{
      priority: 'high' | 'medium' | 'low';
      issues: number[];
    }>;
  }> {
    const issuesSummary = issues
      .map(i => `#${i.number}: ${i.title} [${i.labels.map(l => l.name).join(', ')}]`)
      .join('\n');

    const prompt = `Analyze these GitHub issues and suggest organization:

${issuesSummary}

Return a JSON object with:
1. "categories": Array of { "name": string, "description": string, "issues": number[] }
2. "priorities": Array of { "priority": "high"|"medium"|"low", "issues": number[] }

Categorize by type (bug, feature, documentation, etc.) and suggest priority based on title/labels.`;

    const provider = await this.providerFactory.getProviderByModel(
      'gpt-4o-mini'
    );
    if (!provider) {
      throw new Error('AI provider not available');
    }

    const response = await provider.text(
      { modelId: 'gpt-4o-mini' },
      [{ role: 'user', content: prompt }]
    );

    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      this.logger.warn('Failed to parse AI response as JSON');
    }

    return { categories: [], priorities: [] };
  }

  /**
   * Generate markdown documentation for canvas from GitHub data
   */
  async generateCanvasMarkdown(
    workspaceId: string,
    owner: string,
    repo: string,
    format: 'overview' | 'roadmap' | 'sprint-planning' | 'retrospective'
  ): Promise<string> {
    const overview = await this.github.getRepositoryOverview(
      workspaceId,
      owner,
      repo
    );

    const prompts: Record<string, string> = {
      overview: `Create a project overview document for ${overview.repository.full_name}:

Repository: ${JSON.stringify(overview.repository, null, 2)}
Issues: ${overview.issues.length} total, ${overview.issues.filter(i => i.state === 'open').length} open
PRs: ${overview.pullRequests.length} total
Milestones: ${overview.milestones.map(m => m.title).join(', ')}

Generate a well-structured markdown document with:
- Project summary
- Tech stack & architecture (based on language/topics)
- Current status
- Key contributors/maintainers
- Links to important resources`,

      roadmap: `Create a product roadmap document based on this GitHub data:

Milestones:
${JSON.stringify(overview.milestones, null, 2)}

Open Issues by Label:
${JSON.stringify(
  overview.issues
    .filter(i => i.state === 'open')
    .reduce(
      (acc, i) => {
        const label = i.labels[0]?.name || 'unlabeled';
        acc[label] = (acc[label] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
  null,
  2
)}

Generate a markdown roadmap with:
- Vision & goals
- Milestones timeline
- Feature categories
- Dependencies
- Success metrics`,

      'sprint-planning': `Create a sprint planning document:

Open Issues:
${overview.issues
  .filter(i => i.state === 'open')
  .slice(0, 20)
  .map(i => `- #${i.number}: ${i.title} [${i.labels.map(l => l.name).join(', ')}]`)
  .join('\n')}

Open PRs:
${overview.pullRequests
  .filter(p => p.state === 'open')
  .map(p => `- #${p.number}: ${p.title} (${p.draft ? 'Draft' : 'Ready'})`)
  .join('\n')}

Generate a sprint planning document with:
- Sprint goals
- Prioritized backlog
- Assignments suggestions
- Risk items
- Definition of done`,

      retrospective: `Create a sprint retrospective document:

Recently Closed Issues:
${overview.issues
  .filter(i => i.state === 'closed')
  .slice(0, 15)
  .map(i => `- #${i.number}: ${i.title} (closed: ${i.closed_at})`)
  .join('\n')}

Merged PRs:
${overview.pullRequests
  .filter(p => p.merged)
  .slice(0, 10)
  .map(p => `- #${p.number}: ${p.title}`)
  .join('\n')}

Generate a retrospective document with:
- What went well
- What could be improved
- Action items
- Metrics summary
- Shoutouts`,
    };

    const provider = await this.providerFactory.getProviderByModel('gpt-4o');
    if (!provider) {
      throw new Error('AI provider not available');
    }

    return provider.text(
      { modelId: 'gpt-4o' },
      [{ role: 'user', content: prompts[format] }]
    );
  }

  // #endregion

  // #region Canvas to GitHub (Reverse Sync)

  /**
   * Parse canvas content and extract potential GitHub issues
   */
  async extractIssuesFromCanvas(
    canvasContent: string
  ): Promise<Array<{
    title: string;
    body: string;
    labels: string[];
    confidence: number;
  }>> {
    const prompt = `Analyze this canvas/document content and extract potential GitHub issues:

${canvasContent}

For each potential issue found, return a JSON array with:
- "title": Clear, actionable issue title
- "body": Detailed description in markdown
- "labels": Suggested labels (bug, feature, enhancement, documentation, etc.)
- "confidence": 0-1 score of how confident you are this should be an issue

Only include items that are clearly actionable tasks or bugs.`;

    const provider = await this.providerFactory.getProviderByModel(
      'gpt-4o-mini'
    );
    if (!provider) {
      throw new Error('AI provider not available');
    }

    const response = await provider.text(
      { modelId: 'gpt-4o-mini' },
      [{ role: 'user', content: prompt }]
    );

    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      this.logger.warn('Failed to parse extracted issues');
    }

    return [];
  }

  /**
   * Convert a Kanban card back to a GitHub issue update
   */
  kanbanCardToIssueUpdate(
    card: KanbanBoard['columns'][0]['cards'][0],
    columnId: string
  ): {
    state?: 'open' | 'closed';
    labels?: string[];
  } {
    const update: { state?: 'open' | 'closed'; labels?: string[] } = {};

    // Map column to state
    if (columnId === 'done' || columnId === 'closed') {
      update.state = 'closed';
    } else {
      update.state = 'open';
    }

    // Map column to labels
    if (columnId === 'in-progress') {
      update.labels = [...(card.labels?.map(l => l.name) || []), 'in progress'];
    }

    return update;
  }

  // #endregion

  // #region Full Sync Operations

  /**
   * Full sync: GitHub repo to Canvas document
   */
  async syncRepoToCanvas(
    workspaceId: string,
    owner: string,
    repo: string,
    options?: {
      includeKanban?: boolean;
      includeMindMap?: boolean;
      includeTimeline?: boolean;
      includeWorkflows?: boolean;
      generateSummary?: boolean;
    }
  ): Promise<{
    markdown: string;
    visualizations: CanvasVisualization[];
  }> {
    const overview = await this.github.getRepositoryOverview(
      workspaceId,
      owner,
      repo
    );

    const visualizations: CanvasVisualization[] = [];
    let markdown = `# ${overview.repository.full_name}\n\n`;

    // Add description
    if (overview.repository.description) {
      markdown += `> ${overview.repository.description}\n\n`;
    }

    // Generate AI summary if requested
    if (options?.generateSummary) {
      const summary = await this.generateProjectSummary(
        workspaceId,
        owner,
        repo
      );
      markdown += `## Project Summary\n\n${summary}\n\n`;
    }

    // Add Kanban board
    if (options?.includeKanban !== false) {
      const kanban = this.issuesToKanban(overview.issues, overview.milestones);
      visualizations.push(kanban);

      markdown += `## Issue Board\n\n`;
      markdown += `| Backlog | In Progress | Done |\n`;
      markdown += `|---------|-------------|------|\n`;
      markdown += `| ${kanban.columns[0].cards.length} | ${kanban.columns[1].cards.length} | ${kanban.columns[2].cards.length} |\n\n`;
    }

    // Add Mind Map
    if (options?.includeMindMap) {
      const mindMap = this.repositoryToMindMap(
        overview.repository,
        overview.issues,
        overview.pullRequests,
        overview.milestones
      );
      visualizations.push(mindMap);
    }

    // Add Timeline
    if (options?.includeTimeline) {
      const timeline = this.milestonesToTimeline(
        overview.milestones,
        overview.issues
      );
      visualizations.push(timeline);

      markdown += `## Timeline\n\n`;
      timeline.events.forEach(event => {
        markdown += `- **${new Date(event.date).toLocaleDateString()}**: ${event.title}\n`;
      });
      markdown += '\n';
    }

    // Add Workflow status
    if (options?.includeWorkflows && overview.recentRuns.length > 0) {
      const flowchart = this.workflowsToFlowChart(overview.recentRuns);
      visualizations.push(flowchart);

      markdown += `## CI/CD Status\n\n`;
      overview.recentRuns.forEach(run => {
        const emoji =
          run.conclusion === 'success'
            ? '✅'
            : run.conclusion === 'failure'
              ? '❌'
              : '🔄';
        markdown += `- ${emoji} ${run.name}: ${run.status}\n`;
      });
      markdown += '\n';
    }

    // Add quick links
    markdown += `## Quick Links\n\n`;
    markdown += `- [Repository](${overview.repository.html_url})\n`;
    markdown += `- [Issues](${overview.repository.html_url}/issues)\n`;
    markdown += `- [Pull Requests](${overview.repository.html_url}/pulls)\n`;
    markdown += `- [Actions](${overview.repository.html_url}/actions)\n`;

    return { markdown, visualizations };
  }

  // #endregion
}
