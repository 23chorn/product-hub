import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// Augment vitest's expect with jest-dom's DOM matchers (registered in src/test/setup.ts).
declare module 'vitest' {
  interface Assertion<T = any> extends TestingLibraryMatchers<unknown, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, any> {}
}
