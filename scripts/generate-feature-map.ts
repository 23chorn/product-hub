#!/usr/bin/env node
/**
 * Generate a structured map of all Gherkin feature files.
 * This helps AI agents understand the feature landscape and find relevant context.
 */

import * as fs from 'fs';
import * as path from 'path';

const logger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};

interface FeatureMap {
  generated: string;
  totalFeatures: number;
  totalFlows: number;
  totalScenarios: number;
  totalBusinessRules: number;
  categories: {
    [category: string]: {
      description: string;
      features: Array<{
        name: string;
        file: string;
        businessRules: number;
        flows: Array<{
          name: string;
          scenarioCount: number;
        }>;
      }>;
    };
  };
  index: Array<{
    feature: string;
    file: string;
    category: string;
    keywords: string[];
  }>;
}

function parseFeatureFile(filePath: string): {
  name: string;
  businessRules: number;
  flows: Array<{ name: string; scenarioCount: number }>;
} {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let featureName = '';
  let businessRules = 0;
  const flows: Array<{ name: string; scenarioCount: number }> = [];
  let currentFlow: { name: string; scenarioCount: number } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract feature name
    if (trimmed.startsWith('Feature:')) {
      featureName = trimmed.substring(8).trim();
    }

    // Count business rules
    if (trimmed.startsWith('#') && trimmed.match(/[A-Z]-\d+:/)) {
      businessRules++;
    }

    // Parse user flows
    if (trimmed.startsWith('# USER FLOW:')) {
      if (currentFlow) {
        flows.push(currentFlow);
      }
      const flowName = trimmed.replace('# USER FLOW:', '').trim();
      currentFlow = { name: flowName, scenarioCount: 0 };
    }

    // Count scenarios
    if (trimmed.startsWith('Scenario:') && currentFlow) {
      currentFlow.scenarioCount++;
    }
  }

  // Add last flow
  if (currentFlow) {
    flows.push(currentFlow);
  }

  return { name: featureName, businessRules, flows };
}

function categorizeFeature(fileName: string): string {
  const name = fileName.toLowerCase();

  if (name.includes('login') || name.includes('onboard') || name.includes('signup') ||
      name.includes('recover') || name.includes('forget')) {
    return 'authentication';
  }
  if (name.includes('trade') || name.includes('order') || name.includes('buy') ||
      name.includes('sell') || name.includes('future')) {
    return 'trading';
  }
  if (name.includes('portfolio') || name.includes('account') || name.includes('watchlist')) {
    return 'portfolio';
  }
  if (name.includes('deposit') || name.includes('bank') || name.includes('transfer')) {
    return 'funding';
  }
  if (name.includes('explore') || name.includes('search') || name.includes('company') ||
      name.includes('chart') || name.includes('market')) {
    return 'discovery';
  }
  if (name.includes('ipo')) {
    return 'ipo';
  }
  if (name.includes('advisor')) {
    return 'advisor';
  }
  if (name.includes('more') || name.includes('cd-')) {
    return 'other';
  }

  return 'other';
}

function extractKeywords(featureName: string, fileName: string, flows: Array<{ name: string }>): string[] {
  const keywords = new Set<string>();

  // From filename
  fileName.replace('.feature', '').split(/[-_]/).forEach(w => {
    if (w.length > 2) keywords.add(w.toLowerCase());
  });

  // From feature name
  featureName.split(/\s+/).forEach(w => {
    const clean = w.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (clean.length > 2) keywords.add(clean);
  });

  // From flow names
  flows.forEach(f => {
    f.name.split(/\s+/).forEach(w => {
      const clean = w.replace(/[^a-zA-Z]/g, '').toLowerCase();
      if (clean.length > 3) keywords.add(clean);
    });
  });

  return Array.from(keywords).sort();
}

function main() {
  const featuresDir = path.join(process.cwd(), 'context', 'behaviour', 'features');
  const outputPath = path.join(process.cwd(), 'context', 'behaviour', 'feature-map.json');

  const featureMap: FeatureMap = {
    generated: new Date().toISOString(),
    totalFeatures: 0,
    totalFlows: 0,
    totalScenarios: 0,
    totalBusinessRules: 0,
    categories: {
      authentication: {
        description: 'Login, signup, onboarding, password reset, account recovery',
        features: [],
      },
      trading: {
        description: 'Buy/sell flows, order entry, futures trading, order validation',
        features: [],
      },
      portfolio: {
        description: 'Portfolio view, holdings, account management, watchlists',
        features: [],
      },
      funding: {
        description: 'Deposits, withdrawals, bank transfers',
        features: [],
      },
      discovery: {
        description: 'Explore, search, company details, charts, market depth',
        features: [],
      },
      ipo: {
        description: 'IPO subscription and application flows',
        features: [],
      },
      advisor: {
        description: 'Advisor-specific workflows and features',
        features: [],
      },
      other: {
        description: 'Settings, CDs, and miscellaneous features',
        features: [],
      },
    },
    index: [],
  };

  // Read all feature files
  const files = fs.readdirSync(featuresDir)
    .filter(f => f.endsWith('.feature'))
    .sort();

  for (const file of files) {
    const filePath = path.join(featuresDir, file);
    const parsed = parseFeatureFile(filePath);
    const category = categorizeFeature(file);

    const featureEntry = {
      name: parsed.name,
      file,
      businessRules: parsed.businessRules,
      flows: parsed.flows,
    };

    featureMap.categories[category].features.push(featureEntry);

    // Update totals
    featureMap.totalFeatures++;
    featureMap.totalBusinessRules += parsed.businessRules;
    featureMap.totalFlows += parsed.flows.length;
    featureMap.totalScenarios += parsed.flows.reduce((sum, f) => sum + f.scenarioCount, 0);

    // Add to index
    featureMap.index.push({
      feature: parsed.name,
      file,
      category,
      keywords: extractKeywords(parsed.name, file, parsed.flows),
    });

    logger.info(`Processed: ${file} (${parsed.flows.length} flows, ${parsed.businessRules} rules)`);
  }

  // Write output
  fs.writeFileSync(outputPath, JSON.stringify(featureMap, null, 2));

  logger.info(`\n=== Feature Map Generated ===`);
  logger.info(`Total Features: ${featureMap.totalFeatures}`);
  logger.info(`Total Flows: ${featureMap.totalFlows}`);
  logger.info(`Total Scenarios: ${featureMap.totalScenarios}`);
  logger.info(`Total Business Rules: ${featureMap.totalBusinessRules}`);
  logger.info(`\nCategories:`);
  Object.entries(featureMap.categories).forEach(([cat, data]) => {
    logger.info(`  ${cat}: ${data.features.length} features`);
  });
  logger.info(`\nOutput: ${outputPath}`);
}

main();
