#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try multiple possible paths
const possiblePaths = [
  path.join(__dirname, '../.output/chrome-mv3/manifest.json'),
  path.join(process.cwd(), '.output/chrome-mv3/manifest.json'),
];

let manifestPath = null;
for (const possiblePath of possiblePaths) {
  if (fs.existsSync(possiblePath)) {
    manifestPath = possiblePath;
    break;
  }
}

if (manifestPath && fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  // Remove default_popup if it's null, undefined, or empty string
  if (manifest.action) {
    if (manifest.action.default_popup === null || 
        manifest.action.default_popup === undefined || 
        manifest.action.default_popup === '') {
      delete manifest.action.default_popup;
    }
    
    // If action object is now empty, we can remove it (optional)
    // But keeping it empty is fine for Chrome
  }
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('✅ Fixed manifest.json - removed invalid default_popup');
} else {
  console.warn('⚠️  manifest.json not found. Tried paths:', possiblePaths);
  process.exit(1);
}

