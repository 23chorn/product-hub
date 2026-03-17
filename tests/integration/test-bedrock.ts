import dotenv from 'dotenv';
import path from 'path';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import Logger from '../utils/logger';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const logger = new Logger('TEST-BEDROCK');

async function testBedrock() {
  logger.info('Testing AWS Bedrock Converse API...\n');

  try {
    // Validate credentials
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION;

    if (!accessKeyId || !secretAccessKey || !region) {
      throw new Error(
        'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION must be set in environment variables'
      );
    }

    logger.info('AWS credentials found');

    // Initialize client
    const client = new BedrockRuntimeClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    const modelId = 'global.anthropic.claude-opus-4-6-v1';
    logger.info(`Using model: ${modelId}\n`);

    // Test 1: Simple Converse call
    logger.info('Test 1: Sending simple Converse message...');
    const converseResponse = await client.send(
      new ConverseCommand({
        modelId,
        messages: [
          {
            role: 'user',
            content: [
              { text: 'Say "Hello from Product Automation Pipeline!" in exactly those words.' },
            ],
          },
        ],
        inferenceConfig: { maxTokens: 100 },
      })
    );

    const responseText = converseResponse.output?.message?.content?.[0]?.text || '';
    logger.info(`Response received: "${responseText}"`);

    // Test 2: Streaming with ConverseStream
    logger.info('\nTest 2: Testing ConverseStream response...');
    let streamedText = '';

    const streamResponse = await client.send(
      new ConverseStreamCommand({
        modelId,
        messages: [
          {
            role: 'user',
            content: [{ text: 'Count from 1 to 5, separated by spaces.' }],
          },
        ],
        inferenceConfig: { maxTokens: 100 },
      })
    );

    if (streamResponse.stream) {
      for await (const event of streamResponse.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          streamedText += event.contentBlockDelta.delta.text;
          process.stdout.write(event.contentBlockDelta.delta.text);
        }
      }
    }

    console.log(); // New line
    logger.info(`Streamed ${streamedText.length} characters\n`);

    // Test 3: Check token usage
    logger.info('Test 3: Checking token usage...');
    const usageResponse = await client.send(
      new ConverseCommand({
        modelId,
        messages: [
          {
            role: 'user',
            content: [{ text: 'Hello' }],
          },
        ],
        inferenceConfig: { maxTokens: 50 },
      })
    );

    const inputTokens = usageResponse.usage?.inputTokens || 0;
    const outputTokens = usageResponse.usage?.outputTokens || 0;

    logger.info(`Input tokens: ${inputTokens}`);
    logger.info(`Output tokens: ${outputTokens}\n`);

    logger.info('All Bedrock API tests passed!\n');
    logger.info('Summary:');
    logger.info('  - AWS credentials are valid');
    logger.info('  - Converse API works');
    logger.info('  - ConverseStream works');
    logger.info('  - Token usage tracking works\n');
  } catch (error: any) {
    logger.error('Bedrock API test failed:', error);
    logger.error('\nTroubleshooting:');
    logger.error('  1. Check that AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION are set correctly in .env');
    logger.error('  2. Verify your IAM user has bedrock:InvokeModel and bedrock:InvokeModelWithResponseStream permissions');
    logger.error('  3. Ensure the model is enabled in your AWS Bedrock console for the configured region');
    process.exit(1);
  }
}

testBedrock();
