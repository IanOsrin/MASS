// Test script to verify FileMaker token lookup works
import { fetch } from 'undici';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

const FM_HOST = process.env.FM_HOST;
const FM_DB = process.env.FM_DB;
const FM_USER = process.env.FM_USER;
const FM_PASS = process.env.FM_PASS;

let fmToken = null;

async function fmLogin() {
  const url = `${FM_HOST}/fmi/data/vLatest/databases/${FM_DB}/sessions`;
  const auth = Buffer.from(`${FM_USER}:${FM_PASS}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`FileMaker login failed: ${JSON.stringify(data)}`);
  }

  fmToken = data.response.token;
  console.log('✅ FileMaker login successful');
  return fmToken;
}

async function testTokenLookup(tokenCode) {
  console.log(`\n🔍 Looking up token: ${tokenCode}`);

  const url = `${FM_HOST}/fmi/data/vLatest/databases/${FM_DB}/layouts/API_Access_Tokens/_find`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${fmToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: [
        { 'Token_Code': `==${tokenCode}` }
      ],
      limit: 1
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.log('❌ Token lookup failed:', data);
    return;
  }

  if (data.response.data.length === 0) {
    console.log('❌ Token not found');
    return;
  }

  const token = data.response.data[0].fieldData;
  console.log('✅ Token found!');
  console.log('   Token Code:', token.Token_Code);
  console.log('   Token Type:', token.Token_Type);
  console.log('   Active:', token.Active);
  console.log('   Notes:', token.Notes);
  console.log('   Issued Date:', token.Issued_Date || 'Not set');
  console.log('   Expiration Date:', token.Expiration_Date || 'Not set');
  console.log('   Last Used:', token.Last_Used || 'Never');
  console.log('   Use Count:', token.Use_Count || 0);
}

// Run the test
async function runTest() {
  try {
    await fmLogin();
    await testTokenLookup('MASS-TEST-123');
    console.log('\n✅ Test completed successfully!');
  } catch (err) {
    console.error('❌ Test failed:', err);
  }
}

runTest();
