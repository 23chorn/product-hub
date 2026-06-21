import { describe, it, expect } from 'vitest';
import { renderArtifactMarkdown, isDocumentArtifact } from '../../app/shared/src/artifact-markdown';

describe('isDocumentArtifact', () => {
  it('is true for registered converter types', () => {
    for (const t of ['analyst', 'research', 'prd', 'architecture', 'figma_design']) {
      expect(isDocumentArtifact(t)).toBe(true);
    }
  });

  it('is false for unregistered types', () => {
    expect(isDocumentArtifact('backlog')).toBe(false);
    expect(isDocumentArtifact('qa_tests')).toBe(false);
    expect(isDocumentArtifact('prototype')).toBe(false);
  });
});

describe('renderArtifactMarkdown', () => {
  it('returns null when no converter exists for the type', () => {
    expect(renderArtifactMarkdown('backlog', '{"epic":"x"}')).toBeNull();
  });

  it('returns content unchanged when it is already markdown', () => {
    const md = '# Already markdown\n\nbody';
    expect(renderArtifactMarkdown('prd', md)).toBe(md);
  });

  it('returns content unchanged on unparseable JSON', () => {
    const broken = '{ not valid json';
    expect(renderArtifactMarkdown('prd', broken)).toBe(broken);
  });

  it('renders an analyst brief with a title heading', () => {
    const md = renderArtifactMarkdown('analyst', JSON.stringify({ title: 'My Brief', executive_summary: 'Sum' }));
    expect(md).toContain('# My Brief');
    expect(md).toContain('## Executive Summary');
  });

  it('tolerates trailing prose after the JSON object', () => {
    const md = renderArtifactMarkdown('prd', '{"title":"P1"}\n\nSome trailing commentary the model added.');
    expect(md).toContain('# P1');
  });

  describe('architecture New Dependencies variant', () => {
    const emptyDeps = JSON.stringify({ title: 'Arch', new_dependencies: [] });
    const withDeps = JSON.stringify({
      title: 'Arch',
      new_dependencies: [{ name: 'Redis', type: 'cache', not_solvable_with_existing_stack_because: 'x', existing_alternatives_evaluated: 'y', cost_or_risk: 'z' }],
    });

    it('display variant uses emoji + bold emphasis', () => {
      const empty = renderArtifactMarkdown('architecture', emptyDeps, 'display')!;
      expect(empty).toContain('## ✓ New Dependencies');
      expect(empty).toContain('**No new dependencies introduced.**');
      const filled = renderArtifactMarkdown('architecture', withDeps, 'display')!;
      expect(filled).toContain('## ⚠ New Dependencies (1)');
      expect(filled).toContain('**Review required.**');
    });

    it('publish variant uses plain prose', () => {
      const empty = renderArtifactMarkdown('architecture', emptyDeps, 'publish')!;
      expect(empty).toContain('## New Dependencies');
      expect(empty).not.toContain('✓');
      expect(empty).not.toContain('**No new dependencies introduced.**');
      const filled = renderArtifactMarkdown('architecture', withDeps, 'publish')!;
      expect(filled).toContain('## New Dependencies (1)');
      expect(filled).not.toContain('⚠');
      expect(filled).toContain('require approval before implementation');
    });

    it('defaults to the display variant', () => {
      expect(renderArtifactMarkdown('architecture', emptyDeps)).toBe(renderArtifactMarkdown('architecture', emptyDeps, 'display'));
    });
  });
});
