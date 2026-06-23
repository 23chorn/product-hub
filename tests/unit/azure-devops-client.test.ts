import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock axios so the client's constructor gets a controllable instance instead of
// a real HTTP client. vi.hoisted lets the mock factory reference these spies even
// though vi.mock is hoisted above the imports.
const http = vi.hoisted(() => {
  const instance = {
    post: vi.fn(),
    patch: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  return { instance, create: vi.fn(() => instance) };
});

vi.mock('axios', () => ({
  default: { create: http.create },
}));

import { AzureDevOpsClient } from '../../app/backend/src/integrations/azure-devops';
import type { BacklogStructure } from '@pap/shared';

// Build an axios-style rejection so adoErrorMessage() can pull the message out.
function adoError(message: string, status?: number): any {
  return { response: { status, data: { message } }, message };
}

// Find the operation patching a given JSON-patch path in a captured operations array.
function opFor(operations: any[], path: string): any {
  return operations.find(o => o.path === path);
}

const ORIGINAL_ENV = { ...process.env };

function makeClient(env: Record<string, string> = {}): AzureDevOpsClient {
  process.env = {
    ...ORIGINAL_ENV,
    AZURE_DEVOPS_ORG: 'myorg',
    AZURE_DEVOPS_PROJECT: 'MyProject',
    AZURE_DEVOPS_PAT: 'secret-pat',
    ...env,
  };
  return new AzureDevOpsClient();
}

beforeEach(() => {
  http.instance.post.mockReset();
  http.instance.patch.mockReset();
  http.instance.get.mockReset();
  http.instance.put.mockReset();
  http.instance.delete.mockReset();
  http.create.mockClear();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('constructor / env parsing', () => {
  it('extracts the org name from a full dev.azure.com URL', () => {
    const client = makeClient({ AZURE_DEVOPS_ORG: 'https://dev.azure.com/acme-corp' });
    // organization is private — verify it through the public URL builder.
    expect(client.getEpicUrl(42)).toBe(
      'https://dev.azure.com/acme-corp/MyProject/_workitems/edit/42',
    );
  });

  it('configures the axios baseURL and Basic auth header from env', () => {
    makeClient();
    const config = http.create.mock.calls.at(-1)![0];
    expect(config.baseURL).toBe('https://dev.azure.com/myorg/MyProject/_apis');
    const expectedAuth = `Basic ${Buffer.from(':secret-pat').toString('base64')}`;
    expect(config.headers.Authorization).toBe(expectedAuth);
  });

  it('defaults the wiki identifier to the sanitized project name', () => {
    const client = makeClient({ AZURE_DEVOPS_PROJECT: 'My Project:X' });
    // Non [A-Za-z0-9-_] chars become '-', then ".wiki" is appended.
    expect(client.wikiIdentifier).toBe('My-Project-X.wiki');
  });

  it('extracts the wiki identifier from a full _wiki URL', () => {
    const client = makeClient({
      AZURE_DEVOPS_WIKI_ID:
        'https://dev.azure.com/myorg/MyProject/_wiki/wikis/Custom.wiki/12/Home',
    });
    expect(client.wikiIdentifier).toBe('Custom.wiki');
  });
});

describe('getEpicUrl / getWikiPageUrl', () => {
  it('builds the work-item edit URL', () => {
    const client = makeClient();
    expect(client.getEpicUrl(7)).toBe(
      'https://dev.azure.com/myorg/MyProject/_workitems/edit/7',
    );
  });

  it('URL-encodes the wiki page path and strips the leading slash', () => {
    const client = makeClient();
    const url = client.getWikiPageUrl('Custom.wiki', '/Docs/My Feature');
    expect(url).toBe(
      'https://dev.azure.com/myorg/MyProject/_wiki/wikis/Custom.wiki?pagePath=Docs%2FMy%20Feature',
    );
  });
});

describe('createWorkItem', () => {
  it('posts to the typed endpoint and includes only the provided fields', async () => {
    const client = makeClient();
    http.instance.post.mockResolvedValue({ data: { id: 101 } });

    const result = await client.createWorkItem({
      type: 'User Story',
      title: 'Login screen',
      description: '<b>desc</b>',
      priority: 2,
      effort: 5,
      aiEstimateDevHours: 8,
      aiEstimateQaHours: 3,
      acceptanceCriteria: 'AC',
      tags: 'web; ios',
    });

    expect(result).toEqual({ id: 101 });
    const [url, operations] = http.instance.post.mock.calls[0];
    expect(url).toBe('/wit/workitems/$User Story');
    expect(opFor(operations, '/fields/System.Title').value).toBe('Login screen');
    expect(opFor(operations, '/fields/Microsoft.VSTS.Common.Priority').value).toBe(2);
    expect(opFor(operations, '/fields/Microsoft.VSTS.Scheduling.Effort').value).toBe(5);
    expect(opFor(operations, '/fields/Custom.AIEstimateDev').value).toBe(8);
    expect(opFor(operations, '/fields/Custom.AIEstimateQA').value).toBe(3);
    expect(opFor(operations, '/fields/System.Tags').value).toBe('web; ios');
  });

  it('omits unset optional fields from the patch document', async () => {
    const client = makeClient();
    http.instance.post.mockResolvedValue({ data: { id: 1 } });

    await client.createWorkItem({ type: 'Task', title: 'Bare task' });

    const operations = http.instance.post.mock.calls[0][1];
    expect(operations).toHaveLength(1);
    expect(operations[0].path).toBe('/fields/System.Title');
  });

  it('respects custom AI-estimate field names from env', async () => {
    const client = makeClient({ AZURE_DEVOPS_AI_EST_DEV_FIELD: 'Custom.DevX' });
    http.instance.post.mockResolvedValue({ data: { id: 1 } });

    await client.createWorkItem({ type: 'Task', title: 't', aiEstimateDevHours: 4 });

    const operations = http.instance.post.mock.calls[0][1];
    expect(opFor(operations, '/fields/Custom.DevX').value).toBe(4);
  });

  it('adds a hierarchy-reverse parent relation when parentId is set', async () => {
    const client = makeClient();
    http.instance.post.mockResolvedValue({ data: { id: 1 } });

    await client.createWorkItem({ type: 'Task', title: 't', parentId: 50 });

    const relation = opFor(http.instance.post.mock.calls[0][1], '/relations/-');
    expect(relation.value.rel).toBe('System.LinkTypes.Hierarchy-Reverse');
    expect(relation.value.url).toContain('/workItems/50');
  });

  it('wraps API failures with the ADO error message', async () => {
    const client = makeClient();
    http.instance.post.mockRejectedValue(adoError('TF401349: bad request', 400));

    await expect(client.createWorkItem({ type: 'Task', title: 't' })).rejects.toThrow(
      'Azure DevOps API error: TF401349: bad request',
    );
  });
});

describe('updateWorkItem', () => {
  it('patches only the provided fields', async () => {
    const client = makeClient();
    http.instance.patch.mockResolvedValue({ data: { id: 9 } });

    await client.updateWorkItem(9, { title: 'New title', effort: 13 });

    const [url, operations] = http.instance.patch.mock.calls[0];
    expect(url).toBe('/wit/workitems/9');
    expect(operations).toHaveLength(2);
    expect(opFor(operations, '/fields/System.Title')).toMatchObject({
      op: 'replace',
      value: 'New title',
    });
    expect(opFor(operations, '/fields/Microsoft.VSTS.Scheduling.Effort').value).toBe(13);
  });

  it('skips the PATCH and re-reads the item when there is nothing to update', async () => {
    const client = makeClient();
    http.instance.get.mockResolvedValue({ data: { id: 9, fields: {} } });

    await client.updateWorkItem(9, {});

    expect(http.instance.patch).not.toHaveBeenCalled();
    expect(http.instance.get).toHaveBeenCalledWith('/wit/workitems/9');
  });
});

describe('addHyperlinkToWorkItem', () => {
  it('treats an "already exists" failure as success', async () => {
    const client = makeClient();
    http.instance.patch.mockRejectedValue(adoError('Relation already exists', 400));

    await expect(
      client.addHyperlinkToWorkItem(5, 'https://x', 'c'),
    ).resolves.toBeUndefined();
  });

  it('rethrows other failures', async () => {
    const client = makeClient();
    http.instance.patch.mockRejectedValue(adoError('Boom', 500));

    await expect(client.addHyperlinkToWorkItem(5, 'https://x', 'c')).rejects.toThrow(
      'Azure DevOps API error: Boom',
    );
  });
});

describe('deleteWorkItem', () => {
  it('passes destroy=true to permanently delete', async () => {
    const client = makeClient();
    http.instance.delete.mockResolvedValue({});

    await client.deleteWorkItem(3);

    const [url, config] = http.instance.delete.mock.calls[0];
    expect(url).toBe('/wit/workitems/3');
    expect(config.params.destroy).toBe(true);
  });

  it('swallows a 404 (already deleted) without throwing', async () => {
    const client = makeClient();
    http.instance.delete.mockRejectedValue(adoError('Not found', 404));

    await expect(client.deleteWorkItem(3)).resolves.toBeUndefined();
  });
});

describe('createBacklog', () => {
  // Returns incrementing ids so we can count created work items per call.
  function autoIncrementPost(): void {
    let next = 0;
    http.instance.post.mockImplementation(async () => ({ data: { id: ++next } }));
  }

  function story(title: string) {
    return {
      title,
      persona: 'a user',
      goal: 'do a thing',
      benefit: 'value',
      acceptanceCriteria: ['Given X When Y Then Z'],
      effort: 3,
    };
  }

  it('puts every feature under one epic when no phase split applies', async () => {
    const client = makeClient();
    autoIncrementPost();
    const structure = {
      epic: { title: 'My Epic', description: 'desc' },
      features: [
        { title: 'F-one', description: 'd', phase: 'mvp', stories: [story('s1')] },
        { title: 'F-two', description: 'd', phase: 'mvp', stories: [story('s2')] },
      ],
    } as unknown as BacklogStructure;

    const result = await client.createBacklog(structure);

    expect(result.extraEpicIds).toEqual([]);
    expect(result.featureIds).toHaveLength(2);
    expect(result.storyIds).toHaveLength(2);
    // 1 epic + 2 features + 2 stories = 5 createWorkItem calls.
    expect(http.instance.post).toHaveBeenCalledTimes(5);
  });

  it('creates an extra epic per non-MVP phase when MVP features exist', async () => {
    const client = makeClient();
    autoIncrementPost();
    const structure = {
      epic: { title: 'My Epic', description: 'desc' },
      features: [
        { title: 'F-mvp', description: 'd', phase: 'mvp', stories: [story('s1')] },
        { title: 'F-later', description: 'd', phase: 'Phase 2', stories: [story('s2')] },
      ],
    } as unknown as BacklogStructure;

    const result = await client.createBacklog(structure);

    expect(result.extraEpicIds).toHaveLength(1);
    expect(result.featureIds).toHaveLength(2);
    // The phase epic title is prefixed with the phase name.
    const phaseEpicOp = http.instance.post.mock.calls
      .map(c => c[1])
      .find(ops => opFor(ops, '/fields/System.Title')?.value === '[Phase 2] My Epic');
    expect(phaseEpicOp).toBeTruthy();
  });
});
