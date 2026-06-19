#!/usr/bin/env node
const http = require('http');

const workflowId = process.argv[2] || '58c2910a-3c08-4369-b09f-ec81530bd584';

const options = {
  hostname: 'localhost',
  port: 3001,
  path: `/api/workflow/${workflowId}/retry`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
};

console.log(`[INFO] Retrying workflow ${workflowId}...`);

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`[INFO] Response status: ${res.statusCode}`);
    try {
      const parsed = JSON.parse(data);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(data);
    }
  });
});

req.on('error', (error) => {
  console.error(`[ERROR] ${error.message}`);
  process.exit(1);
});

req.end();
