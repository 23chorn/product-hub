import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

// No explicit credentials — the SDK default credential provider chain handles:
//   1. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN env vars
//   2. ~/.aws/credentials + ~/.aws/config profiles
//   3. SSO / IAM Identity Center sessions
//   4. EC2/ECS instance roles
// This ensures temporary credentials (SSO, STS assume-role) include the session token.
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'me-central-1',
});

export default bedrockClient;
