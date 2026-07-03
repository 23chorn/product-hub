/**
 * Generate version.json with build metadata
 * Usage: node scripts/generate-version.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getGitInfo() {
  try {
    const commit = execSync('git rev-parse HEAD').toString().trim();
    const commitShort = execSync('git rev-parse --short HEAD').toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    const commitCount = parseInt(execSync('git rev-list --count HEAD').toString().trim(), 10);

    let tag = null;
    try {
      tag = execSync('git describe --tags --abbrev=0', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim() || null;
    } catch {
      // no tags yet
    }

    let isDirty = false;
    try {
      execSync('git diff --quiet', { stdio: 'pipe' });
    } catch {
      isDirty = true;
    }

    return { commit, commitShort, branch, commitCount, tag, isDirty };
  } catch (err) {
    console.warn('Warning: Could not get git info:', err.message);
    return {
      commit: 'unknown',
      commitShort: 'unknown',
      branch: 'unknown',
      commitCount: 0,
      tag: null,
      isDirty: false,
    };
  }
}

function generateVersion() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const git = getGitInfo();

  // Derive patch from commit count so version auto-increments on every new commit.
  const [major, minor] = packageJson.version.split('.').map(Number);
  const versionString = `${major}.${minor}.${git.commitCount}`;

  const version = {
    version: versionString,
    buildTime: new Date().toISOString(),
    git,
    nodeVersion: process.version,
  };

  // Write to backend src (for dev mode)
  const backendSrcPath = path.join(__dirname, '../app/backend/src/version.json');
  fs.mkdirSync(path.dirname(backendSrcPath), { recursive: true });
  fs.writeFileSync(backendSrcPath, JSON.stringify(version, null, 2));
  console.log('✓ Generated version.json for backend/src');

  // Write to backend dist (for production builds)
  const backendDistPath = path.join(__dirname, '../app/backend/dist/app/backend/src/version.json');
  try {
    fs.mkdirSync(path.dirname(backendDistPath), { recursive: true });
    fs.writeFileSync(backendDistPath, JSON.stringify(version, null, 2));
    console.log('✓ Generated version.json for backend/dist');
  } catch (err) {
    // Dist folder might not exist yet during prebuild
    console.log('⚠ Could not write to backend/dist (run this after build for production)');
  }

  // Write to frontend public folder (so it's accessible at /version.json)
  const frontendPath = path.join(__dirname, '../app/frontend/public/version.json');
  fs.mkdirSync(path.dirname(frontendPath), { recursive: true });
  fs.writeFileSync(frontendPath, JSON.stringify(version, null, 2));
  console.log('✓ Generated version.json for frontend/public');

  return version;
}

const version = generateVersion();
console.log('\nVersion info:', JSON.stringify(version, null, 2));
