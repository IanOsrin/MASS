// Debug script to check a specific token
import { fetch } from 'undici';
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
  return fmToken;
}

async function debugToken(tokenCode) {
  console.log(`\n🔍 Debugging token: ${tokenCode}`);
  const trimmedCode = tokenCode.trim().toUpperCase();
  console.log(`   Uppercase: ${trimmedCode}`);

  // Special case: unlimited cheat token (matches server.js:1780)
  if (trimmedCode === 'MASS-UNLIMITED-ACCESS') {
    console.log('\n✅ Special unlimited access token detected!');
    console.log('   This token is hardcoded in server.js and bypasses FileMaker lookup');
    console.log('   Type: unlimited');
    console.log('   Expiration: Never');
    console.log('\n💡 Validation Result:');
    console.log('   ✅ Token will be ACCEPTED (no FileMaker lookup needed)');
    return;
  }

  const url = `${FM_HOST}/fmi/data/vLatest/databases/${FM_DB}/layouts/API_Access_Tokens/_find`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${fmToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: [
        { 'Token_Code': `==${trimmedCode}` }
      ],
      limit: 1
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.log('\n❌ FileMaker search failed:');
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.response.data.length === 0) {
    console.log('\n❌ Token NOT FOUND in FileMaker');
    console.log('   The token does not exist in the database');
    return;
  }

  const token = data.response.data[0].fieldData;
  const now = Date.now();

  console.log('\n✅ Token found in FileMaker!');
  console.log('\n📋 Raw Field Values:');
  console.log(`   Token_Code: "${token.Token_Code}"`);
  console.log(`   Token_Type: "${token.Token_Type}"`);
  console.log(`   Active: ${token.Active} (type: ${typeof token.Active})`);
  console.log(`   First_Used: "${token.First_Used}"`);
  console.log(`   Token_Duration_Hours: ${token.Token_Duration_Hours}`);
  console.log(`   Expiration_Date: "${token.Expiration_Date}" ${!token.Expiration_Date || token.Expiration_Date === '' ? '⚠️  EMPTY!' : ''}`);
  console.log(`   Issued_Date: "${token.Issued_Date}"`);
  console.log(`   Notes: "${token.Notes}"`);
  console.log(`   Last_Used: "${token.Last_Used}"`);
  console.log(`   Use_Count: ${token.Use_Count}`);

  console.log('\n🔎 Validation Checks:');

  // Check 1: Active field
  if (token.Active === 0 || token.Active === '0') {
    console.log('   ❌ PROBLEM: Token is DISABLED (Active = 0)');
  } else {
    console.log('   ✅ Active field is OK');
  }

  // Check 2: Expiration Date calculation
  if (!token.Expiration_Date || token.Expiration_Date === '') {
    // Check if expiration SHOULD have been calculated
    if (token.Token_Duration_Hours && token.First_Used && token.First_Used !== '') {
      console.log('   ❌ PROBLEM: Expiration_Date is EMPTY but should have been calculated!');
      console.log(`      Token_Duration_Hours: ${token.Token_Duration_Hours} seconds (${token.Token_Duration_Hours / 3600} hours)`);
      console.log(`      First_Used: ${token.First_Used}`);
      console.log('   💡 FIX: Update the FileMaker calculation field for Expiration_Date');
      console.log('      Correct formula: First_Used + (Token_Duration_Hours / 86400)');
      console.log('      (FileMaker adds DAYS to timestamps, so convert seconds to days)');
    } else {
      console.log('   ✅ No expiration (token never expires)');
    }
  } else {
    // Expiration date is set - validate it
    const expirationTime = new Date(token.Expiration_Date).getTime();
    if (isNaN(expirationTime)) {
      console.log('   ❌ PROBLEM: Invalid expiration date format');
    } else if (now > expirationTime) {
      console.log(`   ❌ PROBLEM: Token EXPIRED`);
      console.log(`      Expired: ${token.Expiration_Date}`);
      console.log(`      Current time: ${new Date().toISOString()}`);
    } else {
      const hoursLeft = (expirationTime - now) / 1000 / 60 / 60;
      console.log(`   ✅ Expiration is OK (${hoursLeft.toFixed(1)} hours remaining)`);
    }
  }

  // Check 3: Token type
  if (!token.Token_Type || token.Token_Type.trim() === '') {
    console.log('   ⚠️  WARNING: Token_Type is empty (should be "trial" or "unlimited")');
  } else {
    console.log(`   ✅ Token_Type is set`);
  }

  console.log('\n💡 Validation Result:');
  if ((token.Active === 0 || token.Active === '0')) {
    console.log('   ❌ Token will be REJECTED: Disabled');
  } else if (token.Expiration_Date && now > new Date(token.Expiration_Date).getTime()) {
    console.log('   ❌ Token will be REJECTED: Expired');
  } else if (!token.Expiration_Date && token.Token_Duration_Hours && token.First_Used) {
    console.log('   ⚠️  Token ACCEPTED but expiration calculation is BROKEN');
    console.log('      Fix the Expiration_Date calculation field in FileMaker');
  } else {
    console.log('   ✅ Token should be ACCEPTED');
  }
}

const tokenToCheck = process.argv[2];

if (!tokenToCheck) {
  console.log('Usage: node debug-token.js <TOKEN_CODE>');
  console.log('Example: node debug-token.js MASS-ABC-123');
  process.exit(1);
}

async function run() {
  try {
    await fmLogin();
    await debugToken(tokenToCheck);
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

run();
