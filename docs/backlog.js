#!/usr/bin/env node
/**
 * backlog.js — read a feature backlog JSON for Claude Code
 *
 * Each feature is decomposed in isolation, then the backlog_merge stage combines
 * them into one final "backlog" artifact containing every feature. Pass that file.
 *
 * Usage:
 *   node backlog.js backlog.json              # summary table of all matching stories
 *   node backlog.js backlog.json F1           # matching stories in Feature 1 only
 *   node backlog.js backlog.json F1.S3        # single story as markdown
 *   node backlog.js backlog.json --json       # raw JSON of all matching stories
 *   node backlog.js backlog.json --json F1    # raw JSON of Feature 1's matching stories
 *   node backlog.js backlog.json --json F1.S3 # raw JSON of one story
 */

// ── Platform filter ────────────────────────────────────────────────────────────
// Set to 'web', 'backend', 'ios', or 'android' to show only stories for that stream.
// Set to null to include all stories regardless of platform.
const PLATFORM = 'web';
// ──────────────────────────────────────────────────────────────────────────────

const fs = require('fs');

const [,, filePath, arg1, arg2] = process.argv;

if (!filePath) {
  console.error('Usage: node backlog.js <backlog.json> [F1 | F1.S3 | --json] [F1 | F1.S3]');
  process.exit(1);
}

const raw = fs.readFileSync(filePath, 'utf8');
const data = JSON.parse(raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim());

const features = Array.isArray(data.features) ? data.features : [data];
const epicTitle = data.epic?.title ?? data.epicTitle ?? '';

if (!features.length || !features[0].stories) {
  console.error('Could not find features/stories. Expected { epic: {...}, features: [{ key, stories: [...] }] }.');
  process.exit(1);
}

const asJson = arg1 === '--json' || arg2 === '--json';
const selector = (asJson ? (arg1 !== '--json' ? arg1 : arg2) : arg1) ?? null;

// selector is either null, a feature key ("F1"), or a story id ("F1.S3")
const isStoryId = selector && /\.\w+$/.test(selector);
const featureKey = selector && !isStoryId ? selector.toUpperCase() : null;
const storyId    = isStoryId ? selector.toUpperCase() : null;

function matchesPlatform(story) {
  if (!PLATFORM) return true;
  const platforms = Array.isArray(story.platform)
    ? story.platform
    : (story.platform ? [story.platform] : []);
  return platforms.map(p => p.toLowerCase()).includes(PLATFORM.toLowerCase());
}

const platformLabel = PLATFORM ? `platform: ${PLATFORM}` : 'all platforms';

// ── Select features ────────────────────────────────────────────────────────────
const selectedFeatures = featureKey
  ? features.filter(f => (f.key ?? '').toUpperCase() === featureKey)
  : features;

if (selectedFeatures.length === 0) {
  console.error(`Feature "${featureKey}" not found in ${filePath}.`);
  process.exit(1);
}

// ── Select stories ─────────────────────────────────────────────────────────────
let matches; // [{ feature, story }]
if (storyId) {
  matches = selectedFeatures.flatMap(f =>
    f.stories
      .filter(s => (s.story_id ?? '').toUpperCase() === storyId)
      .map(s => ({ feature: f, story: s }))
  );
} else {
  matches = selectedFeatures.flatMap(f =>
    f.stories
      .filter(matchesPlatform)
      .map(s => ({ feature: f, story: s }))
  );
}

if (matches.length === 0) {
  const reason = storyId
    ? `Story "${storyId}" not found`
    : `No stories match ${platformLabel}${featureKey ? ` in ${featureKey}` : ''}`;
  console.error(`${reason} in ${filePath}.`);
  process.exit(1);
}

// ── Raw JSON output ────────────────────────────────────────────────────────────
if (asJson) {
  const out = storyId ? matches[0].story : matches.map(m => m.story);
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// ── Summary table ──────────────────────────────────────────────────────────────
if (!storyId) {
  if (epicTitle) {
    console.log(`\n${'='.repeat(90)}`);
    console.log(`EPIC: ${epicTitle}`);
    if (data.epic?.description)      console.log(`${data.epic.description}`);
    if (data.epic?.business_value)   console.log(`Business value: ${data.epic.business_value}`);
    if (data.epic?.definition_of_done) console.log(`Definition of done: ${data.epic.definition_of_done}`);
    if (data.epic?.out_of_scope?.length) {
      console.log(`Out of scope: ${data.epic.out_of_scope.join(' · ')}`);
    }
    console.log(`${'='.repeat(90)}\n`);
  }
  console.log(`Showing: ${featureKey ?? 'all features'} — ${platformLabel}\n`);

  const totalFeatures = features.length;
  let lastKey = null;
  let storyIndexInFeature = 0;

  matches.forEach(({ feature: f, story: s }) => {
    if (f.key !== lastKey) {
      if (lastKey !== null) console.log('');
      const featureIndex = features.findIndex(ft => ft.key === f.key) + 1;
      const phase = f.phase ? ` — ${f.phase}` : '';
      console.log(`Feature ${featureIndex} of ${totalFeatures}: [${f.key}] ${f.title}${phase}`);
      if (f.description) console.log(`  ${f.description}`);
      const fac = f.acceptance_criteria ?? f.acceptanceCriteria ?? [];
      if (fac.length) {
        console.log(`  Acceptance criteria:`);
        fac.forEach(ac => console.log(`    ✓ ${ac}`));
      }
      console.log(`  ${'#'.padEnd(4)} ${'Story ID'.padEnd(10)} ${'Pts'.padEnd(4)} ${'Platform'.padEnd(24)} Title`);
      console.log(`  ${'-'.repeat(82)}`);
      lastKey = f.key;
      storyIndexInFeature = 0;
    }
    storyIndexInFeature++;
    const totalInFeature = f.stories.filter(matchesPlatform).length;
    const num  = `${storyIndexInFeature}/${totalInFeature}`.padEnd(4);
    const id   = (s.story_id ?? '').padEnd(10);
    const pts  = String(s.estimated_points ?? s.effort ?? '?').padEnd(4);
    const plat = (Array.isArray(s.platform) ? s.platform.join(', ') : s.platform ?? '').padEnd(24);
    console.log(`  ${num} ${id} ${pts} ${plat} ${s.title}`);
  });
  console.log(`\n${matches.length} stories matched.\n`);
  process.exit(0);
}

// ── Single story markdown ──────────────────────────────────────────────────────
const { feature, story } = matches[0];
const platform = Array.isArray(story.platform) ? story.platform.join(', ') : story.platform ?? '';
const pts  = story.estimated_points ?? story.effort ?? '?';
const deps = story.depends_on?.length ? story.depends_on.join(', ') : 'none';

if (epicTitle) console.log(`**Epic:** ${epicTitle}`);
if (data.epic?.definition_of_done) console.log(`**Epic definition of done:** ${data.epic.definition_of_done}`);
console.log(`**Feature:** [${feature.key}] ${feature.title} (${feature.phase ?? ''})`);
if (feature.description) console.log(`${feature.description}`);
const featureAc = feature.acceptance_criteria ?? feature.acceptanceCriteria ?? [];
if (featureAc.length) {
  console.log(`**Feature acceptance criteria:**`);
  featureAc.forEach(ac => console.log(`  ✓ ${ac}`));
}
console.log('');
console.log(`---\n`);
console.log(`## ${story.story_id ?? ''}: ${story.title}`);
console.log(`**Platform:** ${platform} | **Points:** ${pts} | **Depends on:** ${deps}\n`);

console.log(`**User story:**`);
console.log(`As a ${story.as_a ?? story.persona ?? ''}`);
console.log(`I want ${story.i_want ?? story.goal ?? ''}`);
console.log(`So that ${story.so_that ?? story.benefit ?? ''}\n`);

const acs = story.acceptance_criteria ?? story.acceptanceCriteria ?? [];
if (acs.length) {
  console.log(`**Acceptance criteria:**`);
  acs.forEach(ac => console.log(`- ${ac}`));
  console.log('');
}

const tacs = story.technical_acceptance_criteria ?? [];
if (tacs.length) {
  console.log(`**Technical acceptance criteria:**`);
  tacs.forEach(tac => console.log(`- ${tac}`));
  console.log('');
}

if (story.technical_notes) {
  console.log(`**Technical notes:**`);
  const notes = typeof story.technical_notes === 'string'
    ? story.technical_notes
    : JSON.stringify(story.technical_notes, null, 2);
  console.log(notes);
  console.log('');
}
