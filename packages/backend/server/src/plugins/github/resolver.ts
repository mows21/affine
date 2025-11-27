import {
  Args,
  Field,
  ID,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

import { CurrentUser } from '../../core/auth/session';
import { AccessController } from '../../core/permission';
import { Models } from '../../models';
import { GitHubCanvasService, CanvasVisualization } from './github-canvas.service';
import { GitHubService } from './github.service';

// #region Types

@ObjectType()
export class GitHubRepositoryType {
  @Field(() => ID)
  id!: number;

  @Field()
  name!: string;

  @Field()
  fullName!: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  htmlUrl!: string;

  @Field()
  private!: boolean;

  @Field()
  defaultBranch!: string;

  @Field(() => Int)
  stars!: number;

  @Field(() => Int)
  forks!: number;

  @Field(() => Int)
  openIssues!: number;

  @Field({ nullable: true })
  language?: string;

  @Field(() => [String])
  topics!: string[];
}

@ObjectType()
export class GitHubIssueType {
  @Field(() => ID)
  id!: number;

  @Field(() => Int)
  number!: number;

  @Field()
  title!: string;

  @Field({ nullable: true })
  body?: string;

  @Field()
  state!: string;

  @Field()
  htmlUrl!: string;

  @Field()
  author!: string;

  @Field(() => [String])
  labels!: string[];

  @Field(() => [String])
  assignees!: string[];

  @Field()
  createdAt!: string;

  @Field({ nullable: true })
  closedAt?: string;
}

@ObjectType()
export class GitHubPullRequestType {
  @Field(() => ID)
  id!: number;

  @Field(() => Int)
  number!: number;

  @Field()
  title!: string;

  @Field({ nullable: true })
  body?: string;

  @Field()
  state!: string;

  @Field()
  htmlUrl!: string;

  @Field()
  author!: string;

  @Field()
  headBranch!: string;

  @Field()
  baseBranch!: string;

  @Field()
  draft!: boolean;

  @Field()
  merged!: boolean;

  @Field()
  createdAt!: string;
}

@ObjectType()
export class GitHubCanvasSyncResult {
  @Field()
  markdown!: string;

  @Field(() => GraphQLJSON)
  visualizations!: CanvasVisualization[];

  @Field()
  repositoryName!: string;

  @Field(() => Int)
  issueCount!: number;

  @Field(() => Int)
  prCount!: number;
}

@ObjectType()
export class ExtractedIssue {
  @Field()
  title!: string;

  @Field()
  body!: string;

  @Field(() => [String])
  labels!: string[];

  @Field()
  confidence!: number;
}

@ObjectType()
export class BatchCreateResult {
  @Field(() => Int)
  extracted!: number;

  @Field(() => Int)
  created!: number;

  @Field(() => [GitHubIssueType])
  issues!: GitHubIssueType[];
}

@InputType()
export class CreateGitHubIssueInput {
  @Field()
  owner!: string;

  @Field()
  repo!: string;

  @Field()
  title!: string;

  @Field({ nullable: true })
  body?: string;

  @Field(() => [String], { nullable: true })
  labels?: string[];

  @Field(() => [String], { nullable: true })
  assignees?: string[];
}

@InputType()
export class SyncRepoToCanvasInput {
  @Field()
  owner!: string;

  @Field()
  repo!: string;

  @Field({ nullable: true, defaultValue: true })
  includeKanban?: boolean;

  @Field({ nullable: true, defaultValue: true })
  includeMindMap?: boolean;

  @Field({ nullable: true, defaultValue: true })
  includeTimeline?: boolean;

  @Field({ nullable: true, defaultValue: true })
  includeWorkflows?: boolean;

  @Field({ nullable: true, defaultValue: true })
  generateSummary?: boolean;
}

// #endregion

@Resolver()
export class GitHubResolver {
  constructor(
    private readonly models: Models,
    private readonly ac: AccessController,
    private readonly github: GitHubService,
    private readonly canvasService: GitHubCanvasService
  ) {}

  // #region Queries

  @Query(() => [GitHubRepositoryType])
  async githubRepositories(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ): Promise<GitHubRepositoryType[]> {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');

    const repos = await this.github.listRepositories(workspaceId, {
      per_page: limit || 30,
    });

    return repos.map(r => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description || undefined,
      htmlUrl: r.html_url,
      private: r.private,
      defaultBranch: r.default_branch,
      stars: r.stargazers_count,
      forks: r.forks_count,
      openIssues: r.open_issues_count,
      language: r.language || undefined,
      topics: r.topics,
    }));
  }

  @Query(() => [GitHubIssueType])
  async githubIssues(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('owner') owner: string,
    @Args('repo') repo: string,
    @Args('state', { nullable: true }) state?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ): Promise<GitHubIssueType[]> {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');

    const issues = await this.github.listIssues(workspaceId, owner, repo, {
      state: (state as any) || 'open',
      per_page: limit || 30,
    });

    return issues.map(i => ({
      id: i.id,
      number: i.number,
      title: i.title,
      body: i.body || undefined,
      state: i.state,
      htmlUrl: i.html_url,
      author: i.user.login,
      labels: i.labels.map(l => l.name),
      assignees: i.assignees.map(a => a.login),
      createdAt: i.created_at,
      closedAt: i.closed_at || undefined,
    }));
  }

  @Query(() => [GitHubPullRequestType])
  async githubPullRequests(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('owner') owner: string,
    @Args('repo') repo: string,
    @Args('state', { nullable: true }) state?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ): Promise<GitHubPullRequestType[]> {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');

    const prs = await this.github.listPullRequests(workspaceId, owner, repo, {
      state: (state as any) || 'open',
      per_page: limit || 20,
    });

    return prs.map(pr => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      body: pr.body || undefined,
      state: pr.merged ? 'merged' : pr.state,
      htmlUrl: pr.html_url,
      author: pr.user.login,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      draft: pr.draft,
      merged: pr.merged,
      createdAt: pr.created_at,
    }));
  }

  // #endregion

  // #region Canvas Sync

  @Query(() => GitHubCanvasSyncResult)
  async syncGithubToCanvas(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('input') input: SyncRepoToCanvasInput
  ): Promise<GitHubCanvasSyncResult> {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');

    const result = await this.canvasService.syncRepoToCanvas(
      workspaceId,
      input.owner,
      input.repo,
      {
        includeKanban: input.includeKanban,
        includeMindMap: input.includeMindMap,
        includeTimeline: input.includeTimeline,
        includeWorkflows: input.includeWorkflows,
        generateSummary: input.generateSummary,
      }
    );

    const overview = await this.github.getRepositoryOverview(
      workspaceId,
      input.owner,
      input.repo
    );

    return {
      markdown: result.markdown,
      visualizations: result.visualizations,
      repositoryName: overview.repository.full_name,
      issueCount: overview.issues.length,
      prCount: overview.pullRequests.length,
    };
  }

  @Query(() => String)
  async generateGithubDocument(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('owner') owner: string,
    @Args('repo') repo: string,
    @Args('format') format: string
  ): Promise<string> {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');

    return this.canvasService.generateCanvasMarkdown(
      workspaceId,
      owner,
      repo,
      format as any
    );
  }

  @Query(() => [ExtractedIssue])
  async extractIssuesFromContent(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('content') content: string
  ): Promise<ExtractedIssue[]> {
    await this.ac.user(user.id).workspace(workspaceId).assert('Workspace.Read');

    return this.canvasService.extractIssuesFromCanvas(content);
  }

  // #endregion

  // #region Mutations

  @Mutation(() => GitHubIssueType)
  async createGithubIssue(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('input') input: CreateGitHubIssueInput
  ): Promise<GitHubIssueType> {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings');

    const issue = await this.github.createIssue(
      workspaceId,
      input.owner,
      input.repo,
      {
        title: input.title,
        body: input.body,
        labels: input.labels,
        assignees: input.assignees,
      }
    );

    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body || undefined,
      state: issue.state,
      htmlUrl: issue.html_url,
      author: issue.user.login,
      labels: issue.labels.map(l => l.name),
      assignees: issue.assignees.map(a => a.login),
      createdAt: issue.created_at,
      closedAt: issue.closed_at || undefined,
    };
  }

  @Mutation(() => BatchCreateResult)
  async batchCreateGithubIssues(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('owner') owner: string,
    @Args('repo') repo: string,
    @Args('content') content: string,
    @Args('minConfidence', { nullable: true }) minConfidence?: number
  ): Promise<BatchCreateResult> {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings');

    const threshold = minConfidence ?? 0.7;

    // Extract issues from content
    const extractedIssues =
      await this.canvasService.extractIssuesFromCanvas(content);
    const toCreate = extractedIssues.filter(i => i.confidence >= threshold);

    // Create issues
    const createdIssues: GitHubIssueType[] = [];
    for (const extracted of toCreate) {
      try {
        const issue = await this.github.createIssue(workspaceId, owner, repo, {
          title: extracted.title,
          body: extracted.body,
          labels: extracted.labels,
        });

        createdIssues.push({
          id: issue.id,
          number: issue.number,
          title: issue.title,
          body: issue.body || undefined,
          state: issue.state,
          htmlUrl: issue.html_url,
          author: issue.user.login,
          labels: issue.labels.map(l => l.name),
          assignees: issue.assignees.map(a => a.login),
          createdAt: issue.created_at,
          closedAt: issue.closed_at || undefined,
        });
      } catch {
        // Continue with next issue if one fails
      }
    }

    return {
      extracted: extractedIssues.length,
      created: createdIssues.length,
      issues: createdIssues,
    };
  }

  @Mutation(() => GitHubIssueType)
  async updateGithubIssue(
    @CurrentUser() user: { id: string },
    @Args('workspaceId') workspaceId: string,
    @Args('owner') owner: string,
    @Args('repo') repo: string,
    @Args('issueNumber', { type: () => Int }) issueNumber: number,
    @Args('title', { nullable: true }) title?: string,
    @Args('body', { nullable: true }) body?: string,
    @Args('state', { nullable: true }) state?: string,
    @Args('labels', { type: () => [String], nullable: true }) labels?: string[]
  ): Promise<GitHubIssueType> {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .assert('Workspace.Settings');

    const issue = await this.github.updateIssue(
      workspaceId,
      owner,
      repo,
      issueNumber,
      {
        title,
        body,
        state: state as any,
        labels,
      }
    );

    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body || undefined,
      state: issue.state,
      htmlUrl: issue.html_url,
      author: issue.user.login,
      labels: issue.labels.map(l => l.name),
      assignees: issue.assignees.map(a => a.login),
      createdAt: issue.created_at,
      closedAt: issue.closed_at || undefined,
    };
  }

  // #endregion
}
