#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const minizlibPath = path.join(__dirname, '..', 'node_modules', 'minizlib');
const minipassPath = path.join(minizlibPath, 'node_modules', 'minipass');

// Check if minizlib exists
if (!fs.existsSync(minizlibPath)) {
  console.log('minizlib not found, skipping minipass fix');
  process.exit(0);
}

// Check if minipass v2 is already installed
if (fs.existsSync(minipassPath)) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(minipassPath, 'package.json'), 'utf8'));
    if (packageJson.version && packageJson.version.startsWith('2.')) {
      console.log(`minipass v${packageJson.version} already installed in minizlib`);
      process.exit(0);
    }
  } catch (e) {
    // If we can't read it, reinstall
  }
}

// Install minipass v2 in minizlib's node_modules
console.log('Installing minipass@2.9.0 in minizlib/node_modules...');
try {
  execSync('npm install minipass@2.9.0 --no-save --legacy-peer-deps', {
    cwd: minizlibPath,
    stdio: 'inherit'
  });
  console.log('Successfully installed minipass@2.9.0 in minizlib');
} catch (error) {
  console.error('Failed to install minipass@2.9.0 in minizlib:', error.message);
  process.exit(1);
}

