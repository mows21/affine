import { Injectable, Logger } from '@nestjs/common';

import { Models } from '../../models';

// GitHub API Types
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  private: boolean;
  owner: {
    login: string;
    avatar_url: string;
  };
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics: string[];
  created_at: string;
  updated_at: string;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  html_url: string;
  user: {
    login: string;
    avatar_url: string;
  };
  labels: Array<{
    id: number;
    name: string;
    color: string;
    description: string | null;
  }>;
  assignees: Array<{
    login: string;
    avatar_url: string;
  }>;
  milestone: {
    id: number;
    title: string;
    description: string | null;
    state: 'open' | 'closed';
    due_on: string | null;
  } | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  html_url: string;
  user: {
    login: string;
    avatar_url: string;
  };
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  labels: Array<{
    id: number;
    name: string;
    color: string;
  }>;
  assignees: Array<{
    login: string;
    avatar_url: string;
  }>;
  reviewers: Array<{
    login: string;
    avatar_url: string;
  }>;
  draft: boolean;
  mergeable: boolean | null;
  merged: boolean;
  merged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubMilestone {
  id: number;
  number: number;
  title: string;
  description: string | null;
  state: 'open' | 'closed';
  html_url: string;
  open_issues: number;
  closed_issues: number;
  due_on: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubProject {
  id: number;
  name: string;
  body: string | null;
  html_url: string;
  state: 'open' | 'closed';
  columns?: Array<{
    id: number;
    name: string;
    cards_url: string;
  }>;
}

export interface GitHubWorkflow {
  id: number;
  name: string;
  path: string;
  state: 'active' | 'disabled';
  html_url: string;
  badge_url: string;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  head_branch: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  milestone?: number;
}

export interface CreatePullRequestInput {
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);
  private readonly baseUrl = 'https://api.github.com';

  constructor(private readonly models: Models) {}

  /**
   * Get access token for a workspace's GitHub integration
   */
  private async getAccessToken(
    workspaceId: string
  ): Promise<string | null> {
    const integration = await this.models.integration.getByTypeAndName(
      workspaceId,
      'github' as any,
      'github'
    );

    if (!integration || !integration.credentials) {
      return null;
    }

    const credentials = integration.credentials as { accessToken?: string };
    return credentials.accessToken || null;
  }

  /**
   * Make authenticated GitHub API request
   */
  private async request<T>(
    accessToken: string,
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // #region Repositories

  /**
   * List user's repositories
   */
  async listRepositories(
    workspaceId: string,
    options?: {
      type?: 'all' | 'owner' | 'public' | 'private' | 'member';
      sort?: 'created' | 'updated' | 'pushed' | 'full_name';
      per_page?: number;
      page?: number;
    }
  ): Promise<GitHubRepository[]> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    const params = new URLSearchParams({
      type: options?.type || 'all',
      sort: options?.sort || 'updated',
      per_page: String(options?.per_page || 30),
      page: String(options?.page || 1),
    });

    return this.request<GitHubRepository[]>(
      token,
      `/user/repos?${params}`
    );
  }

  /**
   * Get repository details
   */
  async getRepository(
    workspaceId: string,
    owner: string,
    repo: string
  ): Promise<GitHubRepository> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    return this.request<GitHubRepository>(token, `/repos/${owner}/${repo}`);
  }

  // #endregion

  // #region Issues

  /**
   * List repository issues
   */
  async listIssues(
    workspaceId: string,
    owner: string,
    repo: string,
    options?: {
      state?: 'open' | 'closed' | 'all';
      labels?: string;
      milestone?: string;
      assignee?: string;
      sort?: 'created' | 'updated' | 'comments';
      per_page?: number;
      page?: number;
    }
  ): Promise<GitHubIssue[]> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    const params = new URLSearchParams({
      state: options?.state || 'open',
      sort: options?.sort || 'updated',
      per_page: String(options?.per_page || 30),
      page: String(options?.page || 1),
    });

    if (options?.labels) params.set('labels', options.labels);
    if (options?.milestone) params.set('milestone', options.milestone);
    if (options?.assignee) params.set('assignee', options.assignee);

    return this.request<GitHubIssue[]>(
      token,
      `/repos/${owner}/${repo}/issues?${params}`
    );
  }

  /**
   * Get single issue
   */
  async getIssue(
    workspaceId: string,
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<GitHubIssue> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    return this.request<GitHubIssue>(
      token,
      `/repos/${owner}/${repo}/issues/${issueNumber}`
    );
  }

  /**
   * Create issue
   */
  async createIssue(
    workspaceId: string,
    owner: string,
    repo: string,
    input: CreateIssueInput
  ): Promise<GitHubIssue> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    return this.request<GitHubIssue>(
      token,
      `/repos/${owner}/${repo}/issues`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
  }

  /**
   * Update issue
   */
  async updateIssue(
    workspaceId: string,
    owner: string,
    repo: string,
    issueNumber: number,
    input: Partial<CreateIssueInput> & { state?: 'open' | 'closed' }
  ): Promise<GitHubIssue> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    return this.request<GitHubIssue>(
      token,
      `/repos/${owner}/${repo}/issues/${issueNumber}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    );
  }

  // #endregion

  // #region Pull Requests

  /**
   * List pull requests
   */
  async listPullRequests(
    workspaceId: string,
    owner: string,
    repo: string,
    options?: {
      state?: 'open' | 'closed' | 'all';
      sort?: 'created' | 'updated' | 'popularity' | 'long-running';
      per_page?: number;
      page?: number;
    }
  ): Promise<GitHubPullRequest[]> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    const params = new URLSearchParams({
      state: options?.state || 'open',
      sort: options?.sort || 'updated',
      per_page: String(options?.per_page || 30),
      page: String(options?.page || 1),
    });

    return this.request<GitHubPullRequest[]>(
      token,
      `/repos/${owner}/${repo}/pulls?${params}`
    );
  }

  /**
   * Get single pull request
   */
  async getPullRequest(
    workspaceId: string,
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<GitHubPullRequest> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    return this.request<GitHubPullRequest>(
      token,
      `/repos/${owner}/${repo}/pulls/${pullNumber}`
    );
  }

  /**
   * Create pull request
   */
  async createPullRequest(
    workspaceId: string,
    owner: string,
    repo: string,
    input: CreatePullRequestInput
  ): Promise<GitHubPullRequest> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    return this.request<GitHubPullRequest>(
      token,
      `/repos/${owner}/${repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
  }

  // #endregion

  // #region Milestones

  /**
   * List milestones
   */
  async listMilestones(
    workspaceId: string,
    owner: string,
    repo: string,
    options?: {
      state?: 'open' | 'closed' | 'all';
      sort?: 'due_on' | 'completeness';
    }
  ): Promise<GitHubMilestone[]> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    const params = new URLSearchParams({
      state: options?.state || 'open',
      sort: options?.sort || 'due_on',
    });

    return this.request<GitHubMilestone[]>(
      token,
      `/repos/${owner}/${repo}/milestones?${params}`
    );
  }

  // #endregion

  // #region Actions/Workflows

  /**
   * List workflows
   */
  async listWorkflows(
    workspaceId: string,
    owner: string,
    repo: string
  ): Promise<{ workflows: GitHubWorkflow[] }> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    return this.request<{ workflows: GitHubWorkflow[] }>(
      token,
      `/repos/${owner}/${repo}/actions/workflows`
    );
  }

  /**
   * List workflow runs
   */
  async listWorkflowRuns(
    workspaceId: string,
    owner: string,
    repo: string,
    options?: {
      workflow_id?: number;
      status?: 'queued' | 'in_progress' | 'completed';
      per_page?: number;
    }
  ): Promise<{ workflow_runs: GitHubWorkflowRun[] }> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    const params = new URLSearchParams({
      per_page: String(options?.per_page || 10),
    });

    if (options?.status) params.set('status', options.status);

    const path = options?.workflow_id
      ? `/repos/${owner}/${repo}/actions/workflows/${options.workflow_id}/runs?${params}`
      : `/repos/${owner}/${repo}/actions/runs?${params}`;

    return this.request<{ workflow_runs: GitHubWorkflowRun[] }>(token, path);
  }

  // #endregion

  // #region Repository Overview

  /**
   * Get comprehensive repository overview for canvas visualization
   */
  async getRepositoryOverview(
    workspaceId: string,
    owner: string,
    repo: string
  ): Promise<{
    repository: GitHubRepository;
    issues: GitHubIssue[];
    pullRequests: GitHubPullRequest[];
    milestones: GitHubMilestone[];
    recentRuns: GitHubWorkflowRun[];
  }> {
    const token = await this.getAccessToken(workspaceId);
    if (!token) throw new Error('GitHub not connected');

    const [repository, issues, pullRequests, milestones, runs] =
      await Promise.all([
        this.getRepository(workspaceId, owner, repo),
        this.listIssues(workspaceId, owner, repo, { per_page: 50 }),
        this.listPullRequests(workspaceId, owner, repo, { per_page: 20 }),
        this.listMilestones(workspaceId, owner, repo),
        this.listWorkflowRuns(workspaceId, owner, repo, { per_page: 5 }),
      ]);

    return {
      repository,
      issues,
      pullRequests,
      milestones,
      recentRuns: runs.workflow_runs,
    };
  }

  // #endregion
}
