// Safe SMTP Testing Utility for AloDoc Email Delivery (DEC-067)
// Usage: node server/scripts/test-email.mjs <recipient-email>
// Note: This script is only run when explicitly invoked by the administrator.

import { verifySmtpConnection, sendStaffActivationEmail } from '../services/mailService.js';

const targetEmail = process.argv[2];

console.log('====================================================');
console.log('   AloDoc SMTP Email Delivery Verification Tool     ');
console.log('====================================================\n');

async function main() {
  console.log('1. Checking SMTP Server Connection & Handshake...');
  const isConnected = await verifySmtpConnection();
  if (!isConnected) {
    console.error('❌ SMTP Connection failed. Please check host, port, user, and password in .env');
    process.exit(1);
  }
  console.log('✅ SMTP Connection verified successfully!\n');

  if (!targetEmail) {
    console.log('ℹ️  No test recipient specified.');
    console.log('To send a test activation email, run:');
    console.log('   node server/scripts/test-email.mjs <your-email@example.com>\n');
    process.exit(0);
  }

  console.log(`2. Sending test staff activation invitation to: ${targetEmail}`);
  try {
    const result = await sendStaffActivationEmail({
      to: targetEmail,
      fullName: 'Test Staff User',
      role: 'doctor',
      token: 'test_token_' + Date.now()
    });

    console.log('✅ Test email successfully sent!');
    console.log(`   Message ID: ${result.messageId}`);
    console.log(`   Accepted: ${result.accepted?.join(', ')}`);
    console.log('\nPlease check your inbox (and spam/junk folder) for the AloDoc activation email.');
  } catch (err) {
    console.error('❌ Failed to deliver test email:', err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
