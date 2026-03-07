import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';
import Logger from '../utils/logger';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../../../../.env') });

const logger = new Logger('TEST-ADO');

async function testAzureDevOps() {
  logger.info('🧪 Testing Azure DevOps API...\n');

  try {
    // Validate environment variables
    const orgUrl = process.env.AZURE_DEVOPS_ORG;
    const project = process.env.AZURE_DEVOPS_PROJECT;
    const pat = process.env.AZURE_DEVOPS_PAT;

    if (!orgUrl || !project || !pat) {
      throw new Error('Missing Azure DevOps environment variables (AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT, AZURE_DEVOPS_PAT)');
    }

    logger.info('✓ Environment variables found');
    logger.info(`  Organization: ${orgUrl}`);
    logger.info(`  Project: ${project}\n`);

    const baseUrl = `${orgUrl}/${encodeURIComponent(project)}/_apis`;
    const auth = Buffer.from(`:${pat}`).toString('base64');
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    };

    // Test 1: Get project info
    logger.info('Test 1: Fetching project information...');
    const projectResponse = await axios.get(
      `${orgUrl}/_apis/projects/${encodeURIComponent(project)}?api-version=7.0`,
      { headers }
    );

    logger.info(`✓ Project retrieved: ${projectResponse.data.name}`);
    logger.info(`  ID: ${projectResponse.data.id}`);
    logger.info(`  State: ${projectResponse.data.state}`);

    // Test 2: List work item types
    logger.info('\nTest 2: Listing work item types...');
    const witResponse = await axios.get(
      `${baseUrl}/wit/workitemtypes?api-version=7.0`,
      { headers }
    );

    const workItemTypes = witResponse.data.value;
    logger.info(`✓ Found ${workItemTypes.length} work item types:`);

    const relevantTypes = ['Epic', 'Feature', 'User Story', 'Task'];
    const foundTypes = workItemTypes
      .filter((wit: any) => relevantTypes.includes(wit.name))
      .map((wit: any) => wit.name);

    foundTypes.forEach((type: string) => logger.info(`  - ${type}`));

    // Test 3: Query work items
    logger.info('\nTest 3: Querying work items...');
    const wiql = {
      query: `SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State]
              FROM WorkItems
              WHERE [System.TeamProject] = '${project}'
              ORDER BY [System.ChangedDate] DESC`,
    };

    const queryResponse = await axios.post(
      `${baseUrl}/wit/wiql?api-version=7.0`,
      wiql,
      { headers }
    );

    const workItemCount = queryResponse.data.workItems?.length || 0;
    logger.info(`✓ Found ${workItemCount} work items in project`);

    // Test 4: Create a test work item (Task)
    logger.info('\nTest 4: Creating test work item...');
    const testWorkItem = [
      {
        op: 'add',
        path: '/fields/System.Title',
        value: `API Test Task - ${new Date().toISOString()}`,
      },
      {
        op: 'add',
        path: '/fields/System.Description',
        value: 'This task was created by the Product Automation Pipeline API test and can be safely deleted.',
      },
      // Note: Tag creation removed - requires separate permission
    ];

    const createResponse = await axios.post(
      `${baseUrl}/wit/workitems/$Task?api-version=7.0`,
      testWorkItem,
      {
        headers: {
          ...headers,
          'Content-Type': 'application/json-patch+json',
        },
      }
    );

    const createdWorkItem = createResponse.data;
    logger.info(`✓ Test work item created successfully`);
    logger.info(`  ID: ${createdWorkItem.id}`);
    logger.info(`  Title: ${createdWorkItem.fields['System.Title']}`);
    logger.info(`  URL: ${createdWorkItem._links.html.href}`);

    logger.info('\n✅ All Azure DevOps API tests passed!\n');
    logger.info('Summary:');
    logger.info('  ✓ PAT is valid');
    logger.info('  ✓ Can access project information');
    logger.info('  ✓ Can query work item types');
    logger.info('  ✓ Can query existing work items');
    logger.info('  ✓ Can create work items\n');
    logger.info(`💡 You can now delete the test task (ID: ${createdWorkItem.id}) from Azure DevOps`);
    logger.info(`   Note: Tag creation was skipped (requires additional permissions)\n`);

  } catch (error: any) {
    logger.error('❌ Azure DevOps API test failed:', error);
    logger.error('\nTroubleshooting:');
    logger.error('  1. Check that AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT, and AZURE_DEVOPS_PAT are set in .env');
    logger.error('  2. Create PAT at https://dev.azure.com/{org}/_usersSettings/tokens');
    logger.error('  3. Ensure your PAT has "Work Items (Read & Write)" permission');
    logger.error('  4. Verify the organization URL and project name are correct');
    logger.error('  5. Check that your PAT has not expired');

    if (error.response) {
      logger.error(`\nAPI Response: ${error.response.status} ${error.response.statusText}`);
      if (error.response.data) {
        logger.error(JSON.stringify(error.response.data, null, 2));
      }
    }

    process.exit(1);
  }
}

testAzureDevOps();
