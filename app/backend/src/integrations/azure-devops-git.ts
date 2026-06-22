import type { AxiosInstance } from 'axios';
import { adoErrorMessage } from './azure-devops-format';

/**
 * Shared primitives the Git Items API helpers need from the AzureDevOpsClient.
 * Same shape/intent as TestPlanContext in azure-devops-test-plans.ts — this module
 * owns the ADO Git surface without coupling to the client class.
 */
export interface GitContext {
  client: AxiosInstance;
  organization: string;
  project: string;
}

export interface AdoRepository {
  id: string;
  name: string;
  defaultBranch?: string;
}

export interface AdoMarkdownFile {
  path: string;
  objectId: string;
}

export interface AdoFileCommit {
  commitId: string;
  authorName: string;
  authorEmail: string;
  date: number;
  message: string;
}

function versionParams(branch?: string): Record<string, string> {
  return branch
    ? { 'versionDescriptor.version': branch, 'versionDescriptor.versionType': 'branch' }
    : {};
}

function commitVersionParams(commitId: string): Record<string, string> {
  return { 'versionDescriptor.version': commitId, 'versionDescriptor.versionType': 'commit' };
}

/**
 * Builds an absolute Git API URL scoped to ctx.project rather than relying on the
 * client's baseURL (which is fixed to the globally configured AZURE_DEVOPS_PROJECT).
 * Knowledge Studio repos can live in a different ADO project than that default, so
 * every Git call here must be explicit about which project it targets.
 */
function gitApiUrl(ctx: GitContext, subPath: string): string {
  return `https://dev.azure.com/${ctx.organization}/${ctx.project}/_apis/git${subPath}`;
}

/** List every Git repository in the given project. */
export async function listRepositories(ctx: GitContext): Promise<AdoRepository[]> {
  try {
    const response = await ctx.client.get(gitApiUrl(ctx, '/repositories'), {
      params: { 'api-version': '7.1' },
    });
    return (response.data.value ?? []).map((repo: any) => ({
      id: repo.id,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
    }));
  } catch (error: any) {
    throw new Error(`Failed to list Azure DevOps repositories: ${adoErrorMessage(error)}`);
  }
}

/** List every `.md` file in a repository (full recursive tree, filtered to markdown blobs). */
export async function listMarkdownFiles(ctx: GitContext, repoName: string, branch?: string): Promise<AdoMarkdownFile[]> {
  try {
    const response = await ctx.client.get(gitApiUrl(ctx, `/repositories/${encodeURIComponent(repoName)}/items`), {
      params: { 'api-version': '7.1', recursionLevel: 'Full', ...versionParams(branch) },
    });
    return (response.data.value ?? [])
      .filter((item: any) => !item.isFolder && item.gitObjectType === 'blob' && /\.md$/i.test(item.path))
      .map((item: any) => ({ path: item.path, objectId: item.objectId }));
  } catch (error: any) {
    throw new Error(`Failed to list files in repository "${repoName}": ${adoErrorMessage(error)}`);
  }
}

/** Fetch the raw text content of a single file at the given repo-relative path. */
export async function getFileContent(ctx: GitContext, repoName: string, path: string, branch?: string): Promise<{ content: string; commitId: string }> {
  try {
    const response = await ctx.client.get(gitApiUrl(ctx, `/repositories/${encodeURIComponent(repoName)}/items`), {
      params: { 'api-version': '7.1', path, includeContent: true, ...versionParams(branch) },
    });
    return { content: response.data.content ?? '', commitId: response.data.commitId ?? '' };
  } catch (error: any) {
    throw new Error(`Failed to fetch "${path}" from repository "${repoName}": ${adoErrorMessage(error)}`);
  }
}

/** Fetch a file's content as it existed at a specific commit. */
export async function getFileContentAtCommit(ctx: GitContext, repoName: string, path: string, commitId: string): Promise<{ content: string }> {
  try {
    const response = await ctx.client.get(gitApiUrl(ctx, `/repositories/${encodeURIComponent(repoName)}/items`), {
      params: { 'api-version': '7.1', path, includeContent: true, ...commitVersionParams(commitId) },
    });
    return { content: response.data.content ?? '' };
  } catch (error: any) {
    throw new Error(`Failed to fetch "${path}" at commit ${commitId.slice(0, 8)} from repository "${repoName}": ${adoErrorMessage(error)}`);
  }
}

/** List commits that touched a given file path, newest first. */
export async function listFileCommits(ctx: GitContext, repoName: string, path: string, branch?: string): Promise<AdoFileCommit[]> {
  try {
    const response = await ctx.client.get(gitApiUrl(ctx, `/repositories/${encodeURIComponent(repoName)}/commits`), {
      params: {
        'api-version': '7.1',
        'searchCriteria.itemPath': path,
        ...(branch ? { 'searchCriteria.itemVersion.version': branch, 'searchCriteria.itemVersion.versionType': 'branch' } : {}),
      },
    });
    return (response.data.value ?? []).map((commit: any) => ({
      commitId: commit.commitId,
      authorName: commit.author?.name ?? 'Unknown',
      authorEmail: commit.author?.email ?? '',
      date: commit.author?.date ? new Date(commit.author.date).getTime() : 0,
      message: (commit.comment ?? '').split('\n')[0],
    }));
  } catch (error: any) {
    throw new Error(`Failed to list commit history for "${path}" in repository "${repoName}": ${adoErrorMessage(error)}`);
  }
}
