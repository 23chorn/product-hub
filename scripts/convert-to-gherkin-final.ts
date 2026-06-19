#!/usr/bin/env node
/**
 * Convert xCube Docs markdown to Gherkin-style feature files (FINAL VERSION).
 * Properly handles all document structures including behavior tables.
 */

import * as fs from 'fs';
import * as path from 'path';

const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
};

const behaviourDir = path.join(process.cwd(), 'context', 'behaviour');
const outputDir = path.join(process.cwd(), 'context', 'behaviour', 'features');

interface Step { keyword: string; text: string; }
interface Scenario { name: string; description?: string; steps: Step[]; }
interface UserFlow { name: string; scenarios: Scenario[]; }
interface GherkinFeature {
  name: string;
  description: string;
  businessRules: Array<{ id: string; rule: string }>;
  userFlows: UserFlow[];
}

function parseMarkdownToGherkin(content: string, fileName: string): GherkinFeature | null {
  const lines = content.split('\n');

  let featureName = '';
  const businessRules: Array<{ id: string; rule: string }> = [];
  const userFlows: UserFlow[] = [];

  let currentH2Section = '';
  let currentH3Subsection = '';
  let currentFlow: UserFlow | null = null;
  let currentScenario: Scenario | null = null;
  let inBusinessRulesTable = false;
  let inBehaviorTable = false;
  let behaviorTableHeaders: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Extract feature name from H1
    if (trimmed.startsWith('# ')) {
      featureName = trimmed.substring(2).trim();
      continue;
    }

    // H2 sections → User Flows
    if (trimmed.startsWith('## ')) {
      currentH2Section = trimmed.substring(3).trim();
      currentH3Subsection = '';

      // Save previous flow
      if (currentFlow && currentFlow.scenarios.length > 0) {
        userFlows.push(currentFlow);
      }

      // Skip business rules section (parsed separately)
      if (currentH2Section.toLowerCase().includes('business rule') ||
          currentH2Section.toLowerCase().includes('global rule')) {
        currentFlow = null;
        inBusinessRulesTable = true;
        continue;
      }

      // Create new flow
      currentFlow = { name: currentH2Section, scenarios: [] };
      currentScenario = null;
      inBusinessRulesTable = false;
      continue;
    }

    // H3 subsections → Scenarios
    if (trimmed.startsWith('### ')) {
      currentH3Subsection = trimmed.substring(4).trim();

      // Save previous scenario
      if (currentScenario && currentFlow && currentScenario.steps.length > 0) {
        currentFlow.scenarios.push(currentScenario);
      }

      // Check if this is a Behaviour subsection (will parse table next)
      if (currentH3Subsection.toLowerCase() === 'behaviour' ||
          currentH3Subsection.toLowerCase() === 'behavior') {
        inBehaviorTable = false; // Will be set when we see table header
        currentScenario = null;
      } else {
        // Regular subsection → create scenario
        currentScenario = {
          name: currentH3Subsection,
          steps: [],
        };
      }
      continue;
    }

    // Parse business rules table
    if (inBusinessRulesTable && trimmed.startsWith('|') && !trimmed.includes('---')) {
      const ruleMatch = trimmed.match(/\|\s*([A-Z]-\d+)\s*\|\s*(.+?)\s*\|/);
      if (ruleMatch) {
        businessRules.push({
          id: ruleMatch[1],
          rule: ruleMatch[2].trim(),
        });
      }
      continue;
    }

    // Parse tables (especially Behaviour tables)
    if (trimmed.startsWith('|') && !trimmed.includes('---')) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);

      if (cells.length > 0) {
        // Check if next line is separator (indicates this is header)
        const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
        if (nextLine.includes('---')) {
          behaviorTableHeaders = cells;
          inBehaviorTable = currentH3Subsection.toLowerCase().includes('behav');
          continue;
        }

        // Process table data row
        if (inBehaviorTable && currentFlow && behaviorTableHeaders.length >= 2 && cells.length >= 2) {
          const action = cells[0];
          const result = cells[1];

          // Parse action/result into Gherkin steps
          const scenario: Scenario = {
            name: action,
            steps: [],
          };

          // Parse the action
          if (action.toLowerCase().startsWith('tap ') ||
              action.toLowerCase().startsWith('click ') ||
              action.toLowerCase().startsWith('select ') ||
              action.toLowerCase().startsWith('upload ')) {
            scenario.steps.push({ keyword: 'When', text: `user ${action.toLowerCase()}` });
          } else if (action.toLowerCase().includes('completed')) {
            scenario.steps.push({ keyword: 'Given', text: action });
          } else {
            scenario.steps.push({ keyword: 'When', text: action });
          }

          // Parse the result (can have → arrows)
          const resultParts = result.split('→').map(p => p.trim()).filter(Boolean);
          resultParts.forEach((part, idx) => {
            const keyword = idx === 0 ? 'Then' : 'And';
            scenario.steps.push({ keyword, text: part });
          });

          currentFlow.scenarios.push(scenario);
        }
      }
      continue;
    }

    // Bullet points → Scenario steps (only for non-Behaviour subsections)
    if (currentScenario && (trimmed.startsWith('- ') || trimmed.startsWith('* '))) {
      const text = trimmed.substring(2).trim();

      // Determine keyword based on content
      let keyword = 'Then';
      if (text.toLowerCase().startsWith('tap ') ||
          text.toLowerCase().startsWith('click ') ||
          text.toLowerCase().startsWith('user ') ||
          text.toLowerCase().startsWith('select ') ||
          text.toLowerCase().startsWith('enter ') ||
          text.toLowerCase().includes('tapping ')) {
        keyword = 'When';
      } else if (text.toLowerCase().includes('field') ||
                 text.toLowerCase().includes('button') ||
                 text.toLowerCase().includes('displayed') ||
                 text.toLowerCase().includes('show') ||
                 text.toLowerCase().includes('title:') ||
                 text.toLowerCase().includes('message:')) {
        keyword = 'Then';
      }

      // Chain with And if same keyword as previous
      if (currentScenario.steps.length > 0) {
        const lastKeyword = currentScenario.steps[currentScenario.steps.length - 1].keyword;
        if (lastKeyword === keyword || lastKeyword === 'And') {
          keyword = 'And';
        }
      }

      currentScenario.steps.push({ keyword, text });
    }
  }

  // Add last scenario and flow
  if (currentScenario && currentFlow && currentScenario.steps.length > 0) {
    currentFlow.scenarios.push(currentScenario);
  }
  if (currentFlow && currentFlow.scenarios.length > 0) {
    userFlows.push(currentFlow);
  }

  // Only create feature if we have meaningful content
  if (businessRules.length === 0 && userFlows.length === 0) {
    return null;
  }

  return {
    name: featureName || fileName,
    description: '',
    businessRules,
    userFlows: userFlows.filter(f => f.scenarios.length > 0),
  };
}

function formatGherkinFeature(feature: GherkinFeature): string {
  let output = `Feature: ${feature.name}\n`;
  if (feature.description) {
    output += `  ${feature.description}\n`;
  }
  output += `\n`;

  // Business Rules as Background
  if (feature.businessRules.length > 0) {
    output += `  Background: Business Rules\n`;
    for (const rule of feature.businessRules) {
      output += `    # ${rule.id}: ${rule.rule}\n`;
    }
    output += `\n`;
  }

  // User Flows with Scenarios
  for (const flow of feature.userFlows) {
    output += `  #################################################\n`;
    output += `  # USER FLOW: ${flow.name}\n`;
    output += `  #################################################\n\n`;

    for (const scenario of flow.scenarios) {
      output += `  Scenario: ${scenario.name}\n`;

      if (scenario.steps.length === 0 && scenario.description) {
        // Fallback if no steps but has description
        output += `    Then ${scenario.description}\n`;
      } else {
        // Output steps
        for (const step of scenario.steps) {
          output += `    ${step.keyword} ${step.text}\n`;
        }
      }

      output += `\n`;
    }
  }

  return output;
}

function main() {
  // Create features output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    logger.info(`Created directory: ${outputDir}`);
  }

  // Read all markdown files
  const files = fs.readdirSync(behaviourDir)
    .filter(f => f.endsWith('.md') && f.startsWith('xcube-docs_') &&
      !f.includes('README') && !f.includes('USAGE'));

  let convertedCount = 0;
  let skippedCount = 0;
  let totalFlows = 0;
  let totalScenarios = 0;

  for (const file of files) {
    const filePath = path.join(behaviourDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    logger.info(`Processing: ${file}`);

    const fileName = file.replace('xcube-docs_', '').replace('.md', '')
      .split(/[-_]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const feature = parseMarkdownToGherkin(content, fileName);

    if (!feature) {
      logger.warn(`  Skipped: No meaningful content extracted`);
      skippedCount++;
      continue;
    }

    const outputFileName = file.replace('xcube-docs_', '').replace('.md', '.feature');
    const outputPath = path.join(outputDir, outputFileName);

    const gherkinContent = formatGherkinFeature(feature);
    fs.writeFileSync(outputPath, gherkinContent);

    const scenarioCount = feature.userFlows.reduce((sum, f) => sum + f.scenarios.length, 0);
    totalFlows += feature.userFlows.length;
    totalScenarios += scenarioCount;

    logger.info(`  ✓ Created: ${outputFileName} (${feature.userFlows.length} flows, ${scenarioCount} scenarios, ${feature.businessRules.length} rules)`);
    convertedCount++;
  }

  logger.info(`\n=== Conversion Complete ===`);
  logger.info(`Converted: ${convertedCount} features`);
  logger.info(`Skipped: ${skippedCount} files`);
  logger.info(`Total Flows: ${totalFlows}`);
  logger.info(`Total Scenarios: ${totalScenarios}`);
  logger.info(`Output: ${outputDir}`);
}

main();
