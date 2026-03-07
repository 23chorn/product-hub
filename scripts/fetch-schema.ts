import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import Logger from '../utils/logger';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../../../.env') });

const logger = new Logger('SCHEMA-FETCH');

async function fetchAirtableSchema() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!apiKey || !baseId) {
    logger.error('Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID');
    process.exit(1);
  }

  try {
    logger.info('Fetching Airtable schema...');

    const response = await axios.get(
      `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    const schema = response.data;
    logger.info(`✓ Successfully fetched schema for base: ${baseId}`);
    logger.info(`  Tables found: ${schema.tables.length}`);

    // Save raw JSON
    const rawPath = path.resolve(__dirname, '../../../../../docs/airtable-schema-raw.json');
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    fs.writeFileSync(rawPath, JSON.stringify(schema, null, 2));
    logger.info(`✓ Raw schema saved to: docs/airtable-schema-raw.json`);

    // Generate markdown documentation
    const markdown = generateMarkdown(schema);
    const mdPath = path.resolve(__dirname, '../../../../../docs/airtable-schema.md');
    fs.writeFileSync(mdPath, markdown);
    logger.info(`✓ Schema documentation saved to: docs/airtable-schema.md`);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('AIRTABLE SCHEMA SUMMARY');
    console.log('='.repeat(60));

    for (const table of schema.tables) {
      console.log(`\n📋 Table: ${table.name} (${table.id})`);
      console.log(`   Primary field: ${table.primaryFieldId}`);
      console.log(`   Fields: ${table.fields.length}`);

      for (const field of table.fields) {
        const typeInfo = field.type === 'singleSelect'
          ? ` (${field.options?.choices?.length || 0} options)`
          : field.type === 'multipleSelects'
          ? ` (${field.options?.choices?.length || 0} options)`
          : '';
        console.log(`      - ${field.name} [${field.type}]${typeInfo}`);
      }
    }

    console.log('\n' + '='.repeat(60));

  } catch (error: any) {
    logger.error('Failed to fetch schema:', error.response?.data || error.message);
    process.exit(1);
  }
}

function generateMarkdown(schema: any): string {
  let md = `# Airtable Schema Documentation\n\n`;
  md += `**Base ID:** \`${schema.tables[0]?.id?.split('tbl')[0] || 'unknown'}\`\n`;
  md += `**Generated:** ${new Date().toISOString()}\n\n`;
  md += `---\n\n`;

  for (const table of schema.tables) {
    md += `## Table: ${table.name}\n\n`;
    md += `**Table ID:** \`${table.id}\`\n`;
    md += `**Primary Field ID:** \`${table.primaryFieldId}\`\n\n`;

    md += `### Fields\n\n`;
    md += `| Field Name | Type | Description | Options |\n`;
    md += `|------------|------|-------------|---------|\n`;

    for (const field of table.fields) {
      const fieldName = field.name;
      const fieldType = field.type;
      const fieldDesc = field.description || '';

      let options = '';
      if (field.type === 'singleSelect' || field.type === 'multipleSelects') {
        const choices = field.options?.choices || [];
        options = choices.map((c: any) => c.name).join(', ');
      } else if (field.type === 'formula') {
        options = `Formula: \`${field.options?.formula || ''}\``;
      } else if (field.type === 'rollup') {
        options = `Rollup from ${field.options?.linkedRecordFieldId || ''}`;
      }

      md += `| ${fieldName} | \`${fieldType}\` | ${fieldDesc} | ${options} |\n`;
    }

    md += `\n`;
  }

  md += `---\n\n`;
  md += `## Current Implementation Mapping\n\n`;
  md += `### TypeScript Interface (AirtableItem)\n\n`;
  md += `\`\`\`typescript\n`;
  md += `export interface AirtableItem {\n`;
  md += `  id: string;\n`;
  md += `  title: string;\n`;
  md += `  description: string;\n`;
  md += `  status: 'Up Next' | 'Needs PRD' | 'PRD In Review' | 'Ready for Backlog' | 'Ready for Grooming' | 'Ready for Dev';\n`;
  md += `  priority: 'P0' | 'P1' | 'P2';\n`;
  md += `  owner: string;\n`;
  md += `  prdLink: string;\n`;
  md += `  epicId: string;\n`;
  md += `  featureIds: string[];\n`;
  md += `  storyIds: string[];\n`;
  md += `  createdAt: string;\n`;
  md += `  updatedAt: string;\n`;
  md += `}\n`;
  md += `\`\`\`\n\n`;

  md += `### Field Mapping in Code\n\n`;
  md += `| Code Field | Airtable Field Name | Notes |\n`;
  md += `|------------|---------------------|-------|\n`;
  md += `| \`id\` | Record ID | System generated |\n`;
  md += `| \`title\` | "Title" or "Name" | Primary field |\n`;
  md += `| \`description\` | "Description" | Text field |\n`;
  md += `| \`status\` | "Status" | Single select |\n`;
  md += `| \`priority\` | "Priority" | Single select |\n`;
  md += `| \`owner\` | "Owner" | User/text field |\n`;
  md += `| \`prdLink\` | "PRD Link" | URL field |\n`;
  md += `| \`epicId\` | "Epic ID" | Text field |\n`;
  md += `| \`featureIds\` | "Feature IDs" | Multiple values |\n`;
  md += `| \`storyIds\` | "Story IDs" | Multiple values |\n`;
  md += `| \`createdAt\` | "Created Time" | System field |\n`;
  md += `| \`updatedAt\` | "Last Modified" | System field |\n\n`;

  return md;
}

fetchAirtableSchema();
