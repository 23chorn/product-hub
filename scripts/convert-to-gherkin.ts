#!/usr/bin/env node
/**
 * Convert xCube Docs markdown to Gherkin-style feature files.
 * Structure: Feature > User Flow > Scenario
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

interface GherkinFeature {
  name: string;
  description: string;
  businessRules: Array<{ id: string; rule: string }>;
  userFlows: Array<{
    name: string;
    description?: string;
    scenarios: Array<{
      name: string;
      given: string[];
      when: string[];
      then: string[];
      notes?: string;
    }>;
  }>;
}

function parseMarkdownToGherkin(filePath: string, content: string): GherkinFeature | null {
  const lines = content.split('\n');
  const fileName = path.basename(filePath, '.md').replace('xcube-docs_', '');

  // Extract feature name from first heading or filename
  let featureName = fileName.replace(/-/g, ' ').replace(/_/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  let description = '';
  const businessRules: Array<{ id: string; rule: string }> = [];
  const userFlows: GherkinFeature['userFlows'] = [];

  let currentSection = '';
  let currentFlow: GherkinFeature['userFlows'][0] | null = null;
  let currentScenario: GherkinFeature['userFlows'][0]['scenarios'][0] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Extract feature name from H1
    if (line.startsWith('# ') && !featureName.includes(line.substring(2).trim())) {
      featureName = line.substring(2).trim();
      continue;
    }

    // Section detection
    if (line.startsWith('## ')) {
      currentSection = line.substring(3).trim();

      // If it's a flow section, create a new user flow
      if (currentSection.toLowerCase().includes('flow') ||
          currentSection.toLowerCase().includes('screen') ||
          currentSection.toLowerCase().includes('process')) {
        if (currentFlow) {
          userFlows.push(currentFlow);
        }
        currentFlow = {
          name: currentSection,
          scenarios: [],
        };
      }
      continue;
    }

    // Business rules extraction
    if (currentSection.toLowerCase().includes('business rule') ||
        currentSection.toLowerCase().includes('global rule')) {
      const ruleMatch = line.match(/\|\s*([A-Z]-\d+)\s*\|\s*(.+?)\s*\|/);
      if (ruleMatch) {
        businessRules.push({
          id: ruleMatch[1],
          rule: ruleMatch[2],
        });
      }
      continue;
    }

    // Scenario detection from H3 or bold text
    if (line.startsWith('### ') || (line.startsWith('**') && line.endsWith('**'))) {
      const scenarioName = line.startsWith('### ')
        ? line.substring(4).trim()
        : line.replace(/\*\*/g, '').trim();

      if (currentFlow && scenarioName && !scenarioName.toLowerCase().includes('calculation')) {
        if (currentScenario) {
          currentFlow.scenarios.push(currentScenario);
        }
        currentScenario = {
          name: scenarioName,
          given: [],
          when: [],
          then: [],
        };
      }
      continue;
    }

    // Extract steps from bullet points
    if (currentScenario && (line.startsWith('-') || line.startsWith('*'))) {
      const step = line.substring(1).trim();

      // Categorize steps
      if (step.toLowerCase().startsWith('user ') ||
          step.toLowerCase().startsWith('tap') ||
          step.toLowerCase().startsWith('click') ||
          step.toLowerCase().startsWith('select') ||
          step.toLowerCase().startsWith('enter')) {
        currentScenario.when.push(step);
      } else if (step.toLowerCase().includes('display') ||
                 step.toLowerCase().includes('show') ||
                 step.toLowerCase().includes('visible') ||
                 step.toLowerCase().includes('redirect')) {
        currentScenario.then.push(step);
      } else if (step.toLowerCase().includes('if ') ||
                 step.toLowerCase().includes('when ') ||
                 step.toLowerCase().includes('available')) {
        currentScenario.given.push(step);
      } else {
        // Default to "Then" for descriptive statements
        currentScenario.then.push(step);
      }
    }
  }

  // Add last scenario and flow
  if (currentScenario && currentFlow) {
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
    name: featureName,
    description,
    businessRules,
    userFlows: userFlows.filter(f => f.scenarios.length > 0),
  };
}

function formatGherkinFeature(feature: GherkinFeature): string {
  let output = `Feature: ${feature.name}\n\n`;

  if (feature.description) {
    output += `  ${feature.description}\n\n`;
  }

  // Business Rules
  if (feature.businessRules.length > 0) {
    output += `  Business Rules:\n`;
    for (const rule of feature.businessRules) {
      output += `    ${rule.id}: ${rule.rule}\n`;
    }
    output += `\n`;
  }

  // User Flows with Scenarios
  for (const flow of feature.userFlows) {
    output += `  # User Flow: ${flow.name}\n`;
    if (flow.description) {
      output += `  # ${flow.description}\n`;
    }
    output += `\n`;

    for (const scenario of flow.scenarios) {
      output += `  Scenario: ${scenario.name}\n`;

      // Given
      if (scenario.given.length > 0) {
        scenario.given.forEach((step, i) => {
          const keyword = i === 0 ? 'Given' : 'And';
          output += `    ${keyword} ${step}\n`;
        });
      }

      // When
      if (scenario.when.length > 0) {
        scenario.when.forEach((step, i) => {
          const keyword = i === 0 ? 'When' : 'And';
          output += `    ${keyword} ${step}\n`;
        });
      }

      // Then
      if (scenario.then.length > 0) {
        scenario.then.forEach((step, i) => {
          const keyword = i === 0 ? 'Then' : 'And';
          output += `    ${keyword} ${step}\n`;
        });
      }

      if (scenario.notes) {
        output += `    # Note: ${scenario.notes}\n`;
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
    .filter(f => f.endsWith('.md') && f.startsWith('xcube-docs_') && !f.includes('README') && !f.includes('USAGE'));

  let convertedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const filePath = path.join(behaviourDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    logger.info(`Processing: ${file}`);

    const feature = parseMarkdownToGherkin(filePath, content);

    if (!feature) {
      logger.warn(`  Skipped: No meaningful content extracted`);
      skippedCount++;
      continue;
    }

    const outputFileName = file.replace('xcube-docs_', '').replace('.md', '.feature');
    const outputPath = path.join(outputDir, outputFileName);

    const gherkinContent = formatGherkinFeature(feature);
    fs.writeFileSync(outputPath, gherkinContent);

    logger.info(`  ✓ Created: ${outputFileName}`);
    convertedCount++;
  }

  logger.info(`\n=== Conversion Complete ===`);
  logger.info(`Converted: ${convertedCount} features`);
  logger.info(`Skipped: ${skippedCount} files`);
  logger.info(`Output: ${outputDir}`);
}

main();
