import { vi } from 'vitest';
import * as aiProvider from '../../app/backend/src/utils/ai-provider';

/**
 * Replace streamAI with a mock that yields the given string as a single chunk.
 * Call this in beforeEach / at the top of a test. Vitest restores mocks automatically
 * when vi.restoreAllMocks() is called or `restoreMocks: true` is set in config.
 */
export function mockStreamAI(response: string): void {
  vi.spyOn(aiProvider, 'streamAI').mockImplementation(async function* () {
    yield response;
  });
}

/**
 * Like mockStreamAI but serialises an object to JSON — used for agents that
 * return structured JSON (Curator, Export Agent, etc.).
 */
export function mockStreamAIJson(obj: object): void {
  mockStreamAI(JSON.stringify(obj));
}
