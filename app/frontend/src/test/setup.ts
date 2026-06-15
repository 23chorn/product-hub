import * as matchers from '@testing-library/jest-dom/matchers';
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Register jest-dom's DOM matchers (toBeInTheDocument, etc.) on vitest's expect.
expect.extend(matchers);

// Unmount React trees between tests to keep the jsdom DOM isolated.
afterEach(() => {
  cleanup();
});
