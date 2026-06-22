import { describe, it, expect } from 'vitest';
import {
  stripWholeResponseDuplication,
  cleanStageArtifactJson,
} from '../../app/backend/src/agents/stage-output-parser';

// A document long enough (>200 chars) to clear the duplication guard, with a
// distinct first line that serves as the dedup anchor.
const DOC =
  '# Research Brief: Onboarding\n' +
  'This is the body of the document. '.repeat(8);

describe('stripWholeResponseDuplication', () => {
  it('leaves short text untouched (below the length guard)', () => {
    const short = '# Title\nsmall body';
    expect(stripWholeResponseDuplication(short, 'analyst')).toBe(short);
  });

  it('strips an exact whole-response echo, keeping the first copy', () => {
    const doubled = DOC + '\n' + DOC;
    expect(stripWholeResponseDuplication(doubled, 'analyst')).toBe(DOC.trimEnd());
  });

  it('keeps the text when the two halves differ in content', () => {
    const second = DOC.replace('Onboarding', 'Checkout');
    const combined = DOC + '\n' + second;
    expect(stripWholeResponseDuplication(combined, 'analyst')).toBe(combined);
  });

  it('keeps the text when the anchor recurs but the halves are very unequal in length', () => {
    // Anchor line reappears, but only a short fragment follows — not a true double.
    const combined = DOC + '\n# Research Brief: Onboarding\nshort tail';
    expect(stripWholeResponseDuplication(combined, 'analyst')).toBe(combined);
  });

  it('leaves a long document with no recurring anchor untouched', () => {
    expect(stripWholeResponseDuplication(DOC, 'analyst')).toBe(DOC);
  });
});

describe('cleanStageArtifactJson — non-prototype stages', () => {
  it('strips a ```json fence and pretty-prints', () => {
    const raw = '```json\n{"a":1,"b":2}\n```';
    const out = cleanStageArtifactJson('pm_prd', raw);
    expect(JSON.parse(out)).toEqual({ a: 1, b: 2 });
    expect(out).toContain('\n  "a": 1'); // 2-space pretty print
  });

  it('parses bare JSON with no fence', () => {
    const out = cleanStageArtifactJson('analyst', '{"x":true}');
    expect(JSON.parse(out)).toEqual({ x: true });
  });

  it('recovers the first object when extra content trails a valid object', () => {
    const raw = '{"valid":1} and then the model rambled on with prose afterwards';
    const out = cleanStageArtifactJson('pm_prd', raw);
    expect(JSON.parse(out)).toEqual({ valid: 1 });
  });

  it('falls back to the fence-stripped content when nothing parses', () => {
    const raw = 'this is not json at all';
    expect(cleanStageArtifactJson('analyst', raw)).toBe('this is not json at all');
  });
});

describe('cleanStageArtifactJson — prototype stage', () => {
  it('pretty-prints valid prototype JSON', () => {
    const out = cleanStageArtifactJson('prototype', '{"files":{"App.tsx":"x"}}');
    expect(JSON.parse(out)).toEqual({ files: { 'App.tsx': 'x' } });
  });

  it('repairs truncated JSON rather than dropping it', () => {
    // Missing closing braces — repairTruncatedJson should still yield parseable JSON.
    const truncated = '{"files":{"App.tsx":"export default App"';
    const out = cleanStageArtifactJson('prototype', truncated);
    const parsed = JSON.parse(out);
    expect(parsed.files['App.tsx']).toBe('export default App');
  });
});
