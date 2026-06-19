#!/usr/bin/env node
/**
 * Convert xCube Docs markdown to Gherkin-style feature files (v2).
 * Improved parser that understands the actual document structure better.
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
    scenarios: Array<{
      name: string;
      description?: string;
      steps: Array<{ keyword: string; text: string }>;
    }>;
  }>;
}

function parseMarkdownToGherkin(content: string, fileName: string): GherkinFeature | null {
  const lines = content.split('\n');

  let featureName = '';
  let description = '';
  const businessRules: Array<{ id: string; rule: string }> = [];
  const userFlows: GherkinFeature['userFlows'] = [];

  let currentSection = '';
  let currentSubsection = '';
  let currentFlow: GherkinFeature['userFlows'][0] | null = null;
  let inTable = false;
  let tableHeaders: string[] = [];
  let isInBehaviourSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Extract feature name from H1
    if (trimmed.startsWith('# ')) {
      featureName = trimmed.substring(2).trim();
      continue;
    }

    // H2 sections become user flows
    if (trimmed.startsWith('## ')) {
      currentSection = trimmed.substring(3).trim();
      currentSubsection = '';

      // Save previous flow
      if (currentFlow && currentFlow.scenarios.length > 0) {
        userFlows.push(currentFlow);
      }

      // Skip business rules section
      if (currentSection.toLowerCase().includes('business rule') ||
          currentSection.toLowerCase().includes('global rule')) {
        currentFlow = null;
        continue;
      }

      // Start new flow
      currentFlow = {
        name: currentSection,
        scenarios: [],
      };
      continue;
    }

    // H3 subsections become scenarios
    if (trimmed.startsWith('### ')) {
      currentSubsection = trimmed.substring(4).trim();
      isInBehaviourSection = currentSubsection.toLowerCase() === 'behaviour';

      // Create scenario for non-behaviour subsections
      if (!isInBehaviourSection && currentFlow) {
        currentFlow.scenarios.push({
          name: currentSubsection,
          steps: [],
        });
      }
      continue;
    }

    // Extract business rules from tables
    if (currentSection.toLowerCase().includes('business rule') ||
        currentSection.toLowerCase().includes('global rule')) {
      const ruleMatch = trimmed.match(/\|\s*([A-Z]-\d+)\s*\|\s*(.+?)\s*\|/);
      if (ruleMatch) {
        businessRules.push({
          id: ruleMatch[1],
          rule: ruleMatch[2].trim(),
        });
      }
      continue;
    }

    // Handle tables (for behaviour sections)
    if (trimmed.startsWith('|') && !trimmed.includes('---')) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);

      if (cells.length > 0) {
        // Check if this is a header row
        const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
        if (nextLine.includes('---')) {
          tableHeaders = cells;
          inTable = true;
          continue;
        }

        // Process table data row (create scenario from each row)
        if (inTable && currentFlow && tableHeaders.length > 0) {
          const scenarioName = cells[0] || 'Scenario';
          const scenarioDesc = cells.length > 1 ? cells[1] : '';

          const scenario = {
            name: scenarioName,
            description: scenarioDesc,
            steps: [] as Array<{ keyword: string; text: string }>,
          };

          // Parse behaviour description into steps
          if (scenarioDesc) {
            const parts = scenarioDesc.split('→').map(p => p.trim());

            if (parts.length === 1) {
              // Simple assertion
              scenario.steps.push({ keyword: 'Then', text: parts[0] });
            } else if (parts.length === 2) {
              // Action → Result
              if (parts[0].toLowerCase().startsWith('tap') ||
                  parts[0].toLowerCase().startsWith('click') ||
                  parts[0].toLowerCase().startsWith('select') ||
                  parts[0].toLowerCase().startsWith('upload')) {
                scenario.steps.push({ keyword: 'When', text: parts[0] });
                scenario.steps.push({ keyword: 'Then', text: parts[1] });
              } else {
                scenario.steps.push({ keyword: 'Given', text: parts[0] });
                scenario.steps.push({ keyword: 'Then', text: parts[1] });
              }
            } else {
              // Multiple parts - chain with And
              scenario.steps.push({ keyword: 'When', text: parts[0] });
              for (let j = 1; j < parts.length; j++) {
                scenario.steps.push({ keyword: 'And', text: parts[j] });
              }
            }
          }

          currentFlow.scenarios.push(scenario);
        }
      }
      continue;
    } else {
      inTable = false;
      tableHeaders = [];
    }

    // Handle bullet points as scenario steps
    if (currentFlow && currentFlow.scenarios.length > 0 && !isInBehaviourSection) {
      const currentScenario = currentFlow.scenarios[currentFlow.scenarios.length - 1];

      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const text = trimmed.substring(2).trim();

        // Determine keyword based on content
        let keyword = 'Then';
        if (text.toLowerCase().startsWith('tap ') ||
            text.toLowerCase().startsWith('click ') ||
            text.toLowerCase().startsWith('user ') ||
            text.toLowerCase().startsWith('select ') ||
            text.toLowerCase().startsWith('enter ')) {
          keyword = 'When';
        } else if (text.toLowerCase().includes('field') ||
                   text.toLowerCase().includes('button') ||
                   text.toLowerCase().includes('displayed') ||
                   text.toLowerCase().includes('shows') ||
                   text.toLowerCase().includes('title:')) {
          keyword = 'Then';
        }

        // If this is the first step, use appropriate keyword
        if (currentScenario.steps.length > 0 &&
            currentScenario.steps[currentScenario.steps.length - 1].keyword === keyword) {
          keyword = 'And';
        }

        currentScenario.steps.push({ keyword, text });
      }
    }
  }

  // Add last flow
  if (currentFlow && currentFlow.scenarios.length > 0) {
    userFlows.push(currentFlow);
  }

  // Only create feature if we have meaningful content
  if (businessRules.length === 0 && userFlows.length === 0) {
    return null;
  }

  return {
    name: featureName || fileName,
    description,
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

  // Business Rules
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

      if (scenario.description && scenario.steps.length === 0) {
        // If we have a description but no steps, format it nicely
        const desc = scenario.description.split('.').map(s => s.trim()).filter(Boolean);
        desc.forEach((line, i) => {
          const keyword = i === 0 ? 'Then' : 'And';
          output += `    ${keyword} ${line}\n`;
        });
      } else {
        // Output parsed steps
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

    logger.info(`  ✓ Created: ${outputFileName} (${feature.userFlows.length} flows, ${feature.businessRules.length} rules)`);
    convertedCount++;
  }

  logger.info(`\n=== Conversion Complete ===`);
  logger.info(`Converted: ${convertedCount} features`);
  logger.info(`Skipped: ${skippedCount} files`);
  logger.info(`Output: ${outputDir}`);
}

main();
