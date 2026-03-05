import { build } from 'esbuild';
import fs from 'fs';

// Build main process as CJS
await build({
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/main/index.js',
  external: ['electron']
});

// Copy preload.js
fs.mkdirSync('dist/main', { recursive: true });
fs.copyFileSync('src/main/preload.js', 'dist/main/preload.js');

console.log('Main process built successfully!');
