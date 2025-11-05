#!/usr/bin/env node

/**
 * Generate PWA icons from the MAD logo
 *
 * This script creates all the necessary icon sizes for the PWA.
 * It uses sharp for image processing.
 *
 * Usage: node scripts/generate-pwa-icons.js
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const IMG_DIR = path.join(PUBLIC_DIR, 'img');
const SOURCE_LOGO = path.join(IMG_DIR, 'MAD_Logo.png');

// Icon sizes needed for PWA
const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const MASKABLE_SIZES = [192, 512];

async function generateIcons() {
  console.log('🎨 Generating PWA icons...\n');

  // Check if source logo exists
  if (!fs.existsSync(SOURCE_LOGO)) {
    console.error(`❌ Source logo not found at: ${SOURCE_LOGO}`);
    console.error('Please ensure MAD_Logo.png exists in public/img/');
    process.exit(1);
  }

  // Create img directory if it doesn't exist
  if (!fs.existsSync(IMG_DIR)) {
    fs.mkdirSync(IMG_DIR, { recursive: true });
  }

  try {
    // Get source image metadata
    const metadata = await sharp(SOURCE_LOGO).metadata();
    console.log(`📄 Source image: ${metadata.width}x${metadata.height} ${metadata.format}`);
    console.log(`📍 Source: ${SOURCE_LOGO}\n`);

    // Generate regular icons
    console.log('Creating regular icons:');
    for (const size of ICON_SIZES) {
      const outputPath = path.join(IMG_DIR, `icon-${size}.png`);
      await sharp(SOURCE_LOGO)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 15, g: 15, b: 18, alpha: 1 } // --bg color
        })
        .png()
        .toFile(outputPath);
      console.log(`  ✓ icon-${size}.png`);
    }

    // Generate maskable icons (with padding for safe zone)
    console.log('\nCreating maskable icons (with padding):');
    for (const size of MASKABLE_SIZES) {
      const outputPath = path.join(IMG_DIR, `icon-maskable-${size}.png`);
      const paddedSize = Math.floor(size * 0.8); // 80% of size, leaving 20% padding
      await sharp(SOURCE_LOGO)
        .resize(paddedSize, paddedSize, {
          fit: 'contain',
          background: { r: 15, g: 15, b: 18, alpha: 0 }
        })
        .extend({
          top: Math.floor((size - paddedSize) / 2),
          bottom: Math.floor((size - paddedSize) / 2),
          left: Math.floor((size - paddedSize) / 2),
          right: Math.floor((size - paddedSize) / 2),
          background: { r: 15, g: 15, b: 18, alpha: 1 }
        })
        .png()
        .toFile(outputPath);
      console.log(`  ✓ icon-maskable-${size}.png`);
    }

    console.log('\n✅ All PWA icons generated successfully!');
    console.log(`\n📂 Icons saved to: ${IMG_DIR}`);
    console.log('\n📝 Next steps:');
    console.log('   1. Icons are already configured in public/manifest.json');
    console.log('   2. Start your server: npm start');
    console.log('   3. Visit your site on a mobile device');
    console.log('   4. Look for "Add to Home Screen" prompt');

  } catch (error) {
    console.error('\n❌ Error generating icons:', error.message);
    process.exit(1);
  }
}

// Check if sharp is installed
try {
  await import('sharp');
  generateIcons();
} catch (error) {
  console.error('❌ Error: sharp package not found');
  console.error('\nPlease install sharp:');
  console.error('  npm install --save-dev sharp');
  console.error('\nThen run this script again.');
  process.exit(1);
}
