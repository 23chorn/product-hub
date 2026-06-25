import fs from 'fs';
import path from 'path';

/**
 * Locates the monorepo root (the directory holding the root package.json with a
 * "workspaces" field) by walking up from a starting directory.
 *
 * A fixed `path.resolve(__dirname, '../../../...')` doesn't work here because three
 * backend source files reach outside app/backend/src to import a shared test fixture
 * (`tests/fixtures/mock-airtable-data`), which forces tsc's rootDir to the repo root.
 * That mirrors the full source path under dist/ at build time, so __dirname sits at a
 * different depth in dev (tsx, runs from src/) than in prod (node, runs from the
 * mirrored dist/app/backend/src/) — a hardcoded "../.." count can only be right for one.
 */
export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (Array.isArray(pkg.workspaces)) return dir;
      } catch {
        // Malformed package.json — keep walking up rather than failing here.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate monorepo root above ${startDir}`);
}
