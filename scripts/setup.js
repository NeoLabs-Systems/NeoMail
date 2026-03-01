'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

function generate() {
  const encryptionKey = crypto.randomBytes(32).toString('hex');
  const sessionSecret = crypto.randomBytes(32).toString('hex');

  const envContent = `# NeoMail Environment Configuration
# Generated: ${new Date().toISOString()}

# Server
PORT=3000

# Security (DO NOT SHARE OR COMMIT)
ENCRYPTION_KEY=${encryptionKey}
SESSION_SECRET=${sessionSecret}

# OpenAI API Key (optional – enables AI features)
# Get yours at: https://platform.openai.com/api-keys
OPENAI_API_KEY=

# Node environment
NODE_ENV=development
`;

  if (fs.existsSync(envPath)) {
    const backup = envPath + '.backup.' + Date.now();
    fs.copyFileSync(envPath, backup);
    console.log(`Backed up existing .env to ${backup}`);
  }

  fs.writeFileSync(envPath, envContent);
  fs.chmodSync(envPath, 0o600);

  console.log('✅ .env file created with fresh keys');
  console.log('→ Add your OPENAI_API_KEY to enable AI features');
  console.log('→ Start server: npm start');
}

generate();
