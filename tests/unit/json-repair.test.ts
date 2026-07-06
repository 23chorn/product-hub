import { describe, it, expect } from 'vitest';
import {
  stripJsonFence,
  parseJsonLoose,
  extractFirstJsonObject,
  extractLastJsonObject,
  repairTruncatedJson,
} from '../../app/backend/src/utils/json-repair';

describe('stripJsonFence', () => {
  it('strips a ```json fence', () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('strips a plain ``` fence', () => {
    expect(stripJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('drops preamble before the first brace', () => {
    expect(stripJsonFence('Here is the output: {"a":1}')).toBe('{"a":1}');
  });

  it('returns already-clean JSON unchanged', () => {
    expect(stripJsonFence('{"a":1}')).toBe('{"a":1}');
  });

  it('leaves a string with no object untouched (trimmed)', () => {
    expect(stripJsonFence('  no object here  ')).toBe('no object here');
  });
});

describe('parseJsonLoose', () => {
  it('parses fenced JSON to an object', () => {
    expect(parseJsonLoose('```json\n{"a":1,"b":[2,3]}\n```')).toEqual({ a: 1, b: [2, 3] });
  });

  it('parses JSON with leading prose', () => {
    expect(parseJsonLoose('Result:\n{"ok":true}')).toEqual({ ok: true });
  });

  it('returns null on malformed JSON instead of throwing', () => {
    expect(parseJsonLoose('{not valid')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseJsonLoose('')).toBeNull();
  });
});

describe('extractFirstJsonObject', () => {
  it('extracts an object and ignores trailing prose', () => {
    expect(extractFirstJsonObject('{"a":1} and then some commentary')).toBe('{"a":1}');
  });

  it('is string-aware — braces inside quoted values do not break balancing', () => {
    expect(extractFirstJsonObject('{"tpl":"use {{ x }} here"} done')).toBe('{"tpl":"use {{ x }} here"}');
  });

  it('handles escaped quotes inside strings', () => {
    expect(extractFirstJsonObject('{"q":"a \\" brace } inside"} tail')).toBe('{"q":"a \\" brace } inside"}');
  });

  it('handles nested objects', () => {
    expect(extractFirstJsonObject('prefix {"a":{"b":2}} suffix')).toBe('{"a":{"b":2}}');
  });

  it('returns null when there is no object', () => {
    expect(extractFirstJsonObject('no braces at all')).toBeNull();
  });

  it('returns null when the object is truncated mid-stream', () => {
    expect(extractFirstJsonObject('{"a":1')).toBeNull();
  });
});

describe('extractLastJsonObject', () => {
  it('extracts an object and ignores trailing prose', () => {
    expect(extractLastJsonObject('{"a":1} and then some commentary')).toBe('{"a":1}');
  });

  it('picks the second object when two complete objects are concatenated', () => {
    // The tool-loop case this exists for: a stale draft followed by the corrected final one.
    expect(extractLastJsonObject('{"a":1}{"a":2}')).toBe('{"a":2}');
  });

  it('is string-aware — braces inside quoted values do not break balancing', () => {
    expect(extractLastJsonObject('prefix {"tpl":"use {{ x }} here"} tail')).toBe('{"tpl":"use {{ x }} here"}');
  });

  it('returns null when there is no object', () => {
    expect(extractLastJsonObject('no braces at all')).toBeNull();
  });

  it('returns null when the only object is truncated mid-stream', () => {
    expect(extractLastJsonObject('{"a":1')).toBeNull();
  });
});

describe('repairTruncatedJson', () => {
  it('returns already-valid JSON unchanged (after fence strip)', () => {
    expect(repairTruncatedJson('{"a":1}')).toBe('{"a":1}');
  });

  it('closes an unterminated string and unbalanced brace', () => {
    const repaired = repairTruncatedJson('{"a":"hello');
    expect(JSON.parse(repaired)).toEqual({ a: 'hello' });
  });

  it('closes a truncated array and object', () => {
    const repaired = repairTruncatedJson('{"items":["a","b"');
    expect(JSON.parse(repaired)).toEqual({ items: ['a', 'b'] });
  });

  it('drops a dangling trailing comma before closing', () => {
    const repaired = repairTruncatedJson('{"a":1,');
    expect(JSON.parse(repaired)).toEqual({ a: 1 });
  });

  it('repairs nested structure truncated mid-object', () => {
    const repaired = repairTruncatedJson('{"outer":{"inner":[1,2');
    expect(JSON.parse(repaired)).toEqual({ outer: { inner: [1, 2] } });
  });

  it('strips a code fence before repairing', () => {
    const repaired = repairTruncatedJson('```json\n{"a":"x');
    expect(JSON.parse(repaired)).toEqual({ a: 'x' });
  });

  it('does not treat braces inside a closed string as structure', () => {
    const repaired = repairTruncatedJson('{"note":"a } b"');
    expect(JSON.parse(repaired)).toEqual({ note: 'a } b' });
  });
});
