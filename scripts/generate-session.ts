/**
 * Session Generation Script
 * 
 * Run this once to generate a Telegram StringSession for the ARCC system.
 * 
 * Usage:
 *   npx tsx scripts/generate-session.ts
 * 
 * You'll need your:
 *   - Telegram API ID (from https://my.telegram.org → API development tools)
 *   - Telegram API Hash (same place)
 *   - Phone number linked to your Telegram account
 *   - (optional) Telegram password if 2FA is enabled
 * 
 * The script will output a session string. Put it in your .env as TELEGRAM_SESSION.
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function main() {
  const rl = readline.createInterface({ input, output });

  console.log('\n🔐 ARCC Telegram Session Generator\n');
  console.log('Get your API credentials from: https://my.telegram.org → API development tools\n');

  const apiIdStr = await rl.question('Enter your API ID: ');
  const apiId = parseInt(apiIdStr.trim(), 10);
  if (!apiId || isNaN(apiId)) {
    console.error('❌ Invalid API ID. It should be a number.');
    process.exit(1);
  }

  const apiHash = await rl.question('Enter your API Hash: ');
  if (!apiHash.trim()) {
    console.error('❌ API Hash is required.');
    process.exit(1);
  }

  const session = new StringSession('');

  console.log('\n⏳ Connecting to Telegram...\n');

  const client = new TelegramClient(session, apiId, apiHash.trim(), {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await rl.question('Enter your phone number (e.g. +1234567890): '),
    password: async () => await rl.question('Enter your 2FA password (or press Enter if none): '),
    phoneCode: async () => await rl.question('Enter the code sent to your Telegram: '),
    onError: (err) => console.error('Auth error:', err),
  });

  const sessionString = client.session.saveAsString();
  
  console.log('\n✅ Authentication successful!\n');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Your TELEGRAM_SESSION string:');
  console.log('═══════════════════════════════════════════════════════');
  console.log(sessionString);
  console.log('═══════════════════════════════════════════════════════');
  console.log('\n📋 Add this to your .env file or Render environment variables:');
  console.log(`TELEGRAM_SESSION=${sessionString}\n`);
  console.log('⚠️  Keep this string safe — it grants access to your Telegram account.');
  console.log('⚠️  Never commit it to git.\n');

  await client.disconnect();
  rl.close();
}

main().catch((err) => {
  console.error('❌ Failed to generate session:', err.message || err);
  process.exit(1);
});
