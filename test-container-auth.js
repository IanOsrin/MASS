#!/usr/bin/env node
/**
 * Test script to verify FileMaker container authentication
 * Tests wake endpoint and sample container access
 */

import 'dotenv/config';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function testWakeAndContainer() {
  console.log('🧪 Testing FileMaker Container Authentication\n');

  // Test 1: Wake endpoint
  console.log('1️⃣  Testing /api/wake endpoint...');
  try {
    const wakeRes = await fetch(`${BASE_URL}/api/wake`);
    const wakeData = await wakeRes.json();

    if (wakeData.status === 'ok' && wakeData.tokenValid) {
      console.log('   ✅ Wake successful - Token is valid');
      console.log(`   🕐 Timestamp: ${new Date(wakeData.timestamp).toISOString()}\n`);
    } else {
      console.log('   ❌ Wake failed:', wakeData);
      return;
    }
  } catch (err) {
    console.error('   ❌ Wake request failed:', err.message);
    return;
  }

  // Test 2: Get a random song to find a container URL
  console.log('2️⃣  Fetching random songs to find container URLs...');
  try {
    const songsRes = await fetch(`${BASE_URL}/api/random-songs?count=5`);
    const songsData = await songsRes.json();

    if (!songsData.items || songsData.items.length === 0) {
      console.log('   ⚠️  No songs returned\n');
      return;
    }

    console.log(`   ✅ Got ${songsData.items.length} songs\n`);

    // Test 3: Try to fetch containers
    console.log('3️⃣  Testing container access...\n');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < Math.min(3, songsData.items.length); i++) {
      const song = songsData.items[i];
      const fields = song.fieldData || song.fields || {};

      // Find audio container URL
      const audioFields = ['mp3', 'MP3', 'Audio File', 'Audio::mp3'];
      let audioUrl = null;

      for (const field of audioFields) {
        if (fields[field]) {
          audioUrl = fields[field];
          break;
        }
      }

      if (!audioUrl) {
        console.log(`   ⏭️  Song ${i + 1}: No audio URL found`);
        continue;
      }

      const trackName = fields['Track Name'] || fields['Song Name'] || 'Unknown';
      console.log(`   🎵 Song ${i + 1}: ${trackName}`);

      // Extract direct URL if it's in FileMaker format
      let testUrl = audioUrl;
      if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
        testUrl = audioUrl;
      }

      // Test container access via proxy
      try {
        const containerRes = await fetch(`${BASE_URL}/api/container?u=${encodeURIComponent(testUrl)}`);

        if (containerRes.ok || containerRes.status === 206) {
          console.log(`      ✅ Container accessible (${containerRes.status})`);
          successCount++;
        } else if (containerRes.status === 401) {
          console.log(`      ❌ Container returned 401 (authentication failed)`);
          console.log(`         URL: ${testUrl.substring(0, 80)}...`);
          failCount++;
        } else {
          console.log(`      ⚠️  Container returned ${containerRes.status}`);
          failCount++;
        }
      } catch (err) {
        console.log(`      ❌ Container request failed: ${err.message}`);
        failCount++;
      }
    }

    console.log(`\n📊 Results:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);

    if (failCount > 0) {
      console.log('\n⚠️  Some containers failed authentication.');
      console.log('   This indicates FileMaker Server container settings need adjustment.');
      console.log('   See Option 1 configuration steps above.');
    } else if (successCount > 0) {
      console.log('\n🎉 All tested containers are accessible!');
      console.log('   The wake call is working correctly.');
    }

  } catch (err) {
    console.error('   ❌ Random songs request failed:', err.message);
  }
}

testWakeAndContainer().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
