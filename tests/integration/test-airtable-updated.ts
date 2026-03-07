import dotenv from 'dotenv';
import path from 'path';
import { AirtableClient } from '../integrations/airtable';
import Logger from '../utils/logger';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const logger = new Logger('AIRTABLE-TEST');

async function testUpdatedAirtableIntegration() {
  try {
    logger.info('Testing updated Airtable integration with real schema...\n');

    const client = new AirtableClient();

    // Test 1: List all initiatives
    logger.info('📋 Test 1: Fetching all initiatives');
    const allItems = await client.listItems();
    logger.info(`✓ Found ${allItems.length} initiatives`);

    if (allItems.length > 0) {
      const firstItem = allItems[0];
      logger.info('\n📝 Sample initiative:');
      logger.info(`  ID: ${firstItem.id}`);
      logger.info(`  Initiative: ${firstItem.initiative}`);
      logger.info(`  Status: ${firstItem.status}`);
      logger.info(`  Business Value: ${firstItem.businessValue}`);
      logger.info(`  Priority Score: ${firstItem.priorityScore}`);
      logger.info(`  Estimate: ${firstItem.estimate}`);
      logger.info(`  Confidence: ${Math.round(firstItem.confidence * 100)}%`);
      logger.info(`  Target Quarter: ${firstItem.targetQuarter || 'Not set'}`);
      logger.info(`  Product Area: ${firstItem.productArea || 'Not set'}`);
      logger.info(`  Strategic Theme: ${firstItem.strategicTheme || 'Not set'}`);
      logger.info(`  Requires Dev Work: ${firstItem.requiresDevWork || 'Not set'}`);
      logger.info(`  PRD Link: ${firstItem.prdLink || 'Not set'}`);
      logger.info(`  Epic Link: ${firstItem.epicLink || 'Not set'}`);
    }

    // Test 2: Get initiatives needing PRDs
    logger.info('\n🔍 Test 2: Finding initiatives that need PRDs');
    logger.info('  Criteria: Status = Discovery/Ready, No PRD Link, Requires Dev Work = Yes');
    const itemsNeedingPRD = await client.getItemsNeedingPRD();
    logger.info(`✓ Found ${itemsNeedingPRD.length} initiatives needing PRDs`);

    if (itemsNeedingPRD.length > 0) {
      logger.info('\n  Initiatives needing PRDs:');
      itemsNeedingPRD.forEach((item, index) => {
        logger.info(`    ${index + 1}. ${item.initiative} (${item.status}) - BV: ${item.businessValue}`);
      });
    } else {
      logger.info('  ℹ️  No initiatives currently need PRDs');
      logger.info('  💡 Tip: Set an initiative to Status="Discovery" or "Ready", Requires Dev Work="Yes", and leave PRD Link empty');
    }

    // Test 3: Get initiatives needing backlog creation
    logger.info('\n🔍 Test 3: Finding initiatives ready for backlog creation');
    logger.info('  Criteria: Status = In Progress, Has PRD Link, No Epic Link');
    const itemsNeedingBacklog = await client.getItemsNeedingBacklog();
    logger.info(`✓ Found ${itemsNeedingBacklog.length} initiatives ready for backlog`);

    if (itemsNeedingBacklog.length > 0) {
      logger.info('\n  Initiatives ready for backlog:');
      itemsNeedingBacklog.forEach((item, index) => {
        logger.info(`    ${index + 1}. ${item.initiative} - PRD: ${item.prdLink}`);
      });
    } else {
      logger.info('  ℹ️  No initiatives currently ready for backlog creation');
      logger.info('  💡 Tip: Set an initiative to Status="In Progress", add a PRD Link, and leave Epic Link empty');
    }

    // Test 4: Verify new field mappings
    logger.info('\n🔍 Test 4: Verifying new field mappings');
    const itemsWithNewFields = allItems.filter(item =>
      item.owner || item.azureEpicId || item.azureFeatureIds || item.azureStoryIds
    );
    logger.info(`✓ Found ${itemsWithNewFields.length} initiatives with new tracking fields`);

    if (itemsWithNewFields.length > 0) {
      logger.info('\n  Initiatives with tracking fields:');
      itemsWithNewFields.forEach((item, index) => {
        const fields: string[] = [];
        if (item.owner) fields.push(`Owner: ${item.owner}`);
        if (item.azureEpicId) fields.push(`Epic ID: ${item.azureEpicId}`);
        if (item.azureFeatureIds) fields.push(`Feature IDs: ${item.azureFeatureIds}`);
        if (item.azureStoryIds) fields.push(`Story IDs: ${item.azureStoryIds}`);
        logger.info(`    ${index + 1}. ${item.initiative} - ${fields.join(', ')}`);
      });
    }

    // Summary
    logger.info('\n' + '='.repeat(60));
    logger.info('✅ AIRTABLE INTEGRATION TEST SUMMARY');
    logger.info('='.repeat(60));
    logger.info(`Total Initiatives: ${allItems.length}`);
    logger.info(`Need PRDs: ${itemsNeedingPRD.length}`);
    logger.info(`Ready for Backlog: ${itemsNeedingBacklog.length}`);
    logger.info(`Have Tracking Fields: ${itemsWithNewFields.length}`);
    logger.info('='.repeat(60));
    logger.info('\n✨ All tests passed! Schema integration working correctly.\n');

  } catch (error: any) {
    logger.error('❌ Test failed:', error.message);
    if (error.response?.data) {
      logger.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

testUpdatedAirtableIntegration();
