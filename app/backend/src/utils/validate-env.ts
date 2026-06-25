import dotenv from 'dotenv';
import path from 'path';
import { findRepoRoot } from './find-repo-root';

dotenv.config({ path: path.join(findRepoRoot(__dirname), '.env') });

interface EnvValidation {
  key: string;
  required: boolean;
  description: string;
}

const ENV_VALIDATIONS: EnvValidation[] = [
  { key: 'AI_PROVIDER', required: false, description: 'AI provider: "anthropic" (default) or "bedrock"' },
  // Anthropic direct API
  { key: 'ANTHROPIC_API_KEY', required: false, description: 'Anthropic API key (required when AI_PROVIDER=anthropic)' },
  // AWS Bedrock (required when AI_PROVIDER=bedrock)
  { key: 'AWS_ACCESS_KEY_ID', required: false, description: 'AWS access key (required when AI_PROVIDER=bedrock)' },
  { key: 'AWS_SECRET_ACCESS_KEY', required: false, description: 'AWS secret access key (required when AI_PROVIDER=bedrock)' },
  { key: 'AWS_REGION', required: false, description: 'AWS region for Bedrock (required when AI_PROVIDER=bedrock)' },
  { key: 'AIRTABLE_API_KEY', required: true, description: 'Airtable personal access token' },
  { key: 'AIRTABLE_BASE_ID', required: true, description: 'Airtable base ID' },
  { key: 'AIRTABLE_TABLE_NAME', required: true, description: 'Airtable table name' },
  { key: 'AZURE_DEVOPS_ORG', required: true, description: 'Azure DevOps organization URL' },
  { key: 'AZURE_DEVOPS_PROJECT', required: true, description: 'Azure DevOps project name' },
  { key: 'AZURE_DEVOPS_PAT', required: true, description: 'Azure DevOps personal access token' },
  { key: 'AZURE_DEVOPS_WIKI_ID', required: false, description: 'Azure DevOps Wiki identifier (default: {PROJECT}.wiki)' },
  { key: 'PORT', required: false, description: 'Server port (default: 3001)' },
  { key: 'FRONTEND_URL', required: false, description: 'Frontend URL (default: http://localhost:5173)' },
  { key: 'NODE_ENV', required: false, description: 'Node environment (default: development)' },
];

function validateEnvironment(): void {
  console.log('🔍 Validating environment variables...\n');

  let hasErrors = false;
  const missing: string[] = [];
  const present: string[] = [];

  for (const validation of ENV_VALIDATIONS) {
    const value = process.env[validation.key];
    const isSet = value !== undefined && value !== '';

    if (validation.required && !isSet) {
      hasErrors = true;
      missing.push(`❌ ${validation.key} - ${validation.description}`);
    } else if (isSet) {
      // Mask sensitive values
      const displayValue = validation.key.includes('KEY') ||
                          validation.key.includes('TOKEN') ||
                          validation.key.includes('PAT')
        ? `${value.substring(0, 8)}...`
        : value;
      present.push(`✅ ${validation.key} - ${displayValue}`);
    } else {
      present.push(`⚠️  ${validation.key} - Not set (optional)`);
    }
  }

  console.log('Present:');
  present.forEach(msg => console.log(`  ${msg}`));

  if (missing.length > 0) {
    console.log('\nMissing required variables:');
    missing.forEach(msg => console.log(`  ${msg}`));
    console.log('\n💡 Copy .env.example to .env and fill in your API keys');
    process.exit(1);
  }

  console.log('\n✅ All required environment variables are set!');
  console.log('🚀 Ready to run the application\n');
}

if (require.main === module) {
  validateEnvironment();
}

export { validateEnvironment };
