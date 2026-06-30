import { describe, it, expect } from 'vitest';
import { parseOpenQuestions } from './artifact-to-markdown';

describe('parseOpenQuestions — JSON PRDs', () => {
  it('returns only questions whose status is open (defaulting missing status to open)', () => {
    const content = JSON.stringify({
      open_questions: [
        { id: 'Q1', type: 'Risk', description: 'd1', impact: 'i1', owner: 'o1', status: 'open' },
        { id: 'Q2', description: 'no status', impact: '', owner: '' }, // defaults to open
        { id: 'Q3', description: 'resolved one', status: 'Resolved' },
      ],
    });
    const result = parseOpenQuestions(content);
    expect(result.map(q => q.id)).toEqual(['Q1', 'Q2']);
    expect(result[0]).toEqual({ id: 'Q1', type: 'Risk', description: 'd1', impact: 'i1', owner: 'o1' });
  });

  it('coerces missing fields to safe string defaults', () => {
    const content = JSON.stringify({ open_questions: [{ description: 'only desc' }] });
    expect(parseOpenQuestions(content)[0]).toEqual({
      id: '', type: 'Question', description: 'only desc', impact: '', owner: '',
    });
  });

  it('returns [] for malformed JSON or a missing open_questions array', () => {
    expect(parseOpenQuestions('{ not valid json')).toEqual([]);
    expect(parseOpenQuestions(JSON.stringify({ something_else: true }))).toEqual([]);
  });
});

describe('parseOpenQuestions — markdown-table PRDs', () => {
  const md = `# PRD

## Open Questions

| ID | Type | Description | Impact | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| Q1 | Risk | desc one | high | Alice | Open |
| Q2 | Dep | desc two | low | Bob | Resolved |

## Next Section
| ignored | table |
`;

  it('parses only open rows from the Open Questions table', () => {
    const result = parseOpenQuestions(md);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 'Q1', type: 'Risk', description: 'desc one', impact: 'high', owner: 'Alice' });
  });

  it('returns [] when there is no Open Questions section', () => {
    expect(parseOpenQuestions('# PRD\n\n## Scope\nsome text')).toEqual([]);
  });

  it('skips rows with too few columns', () => {
    const short = `## Open Questions
| ID | Type | Status |
| --- | --- | --- |
| Q1 | Risk | Open |
`;
    expect(parseOpenQuestions(short)).toEqual([]);
  });
});
