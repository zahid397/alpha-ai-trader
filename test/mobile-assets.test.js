// The Flutter app (mobile/) bundles its own copy of the game so it runs
// offline. This keeps that copy identical to public/game and declared in
// pubspec.yaml. Fix a failure with: npm run mobile:assets
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assetBlock } from '../scripts/sync-mobile-assets.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const web = join(root, 'public', 'game');
const app = join(root, 'mobile', 'assets', 'game');

function hashes(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p).split(sep).join('/')] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

test('mobile/assets/game is an exact copy of public/game', { skip: !existsSync(app) && 'no mobile app' }, () => {
  assert.deepEqual(hashes(app), hashes(web));
});

test('mobile/pubspec.yaml declares every bundled folder', { skip: !existsSync(app) && 'no mobile app' }, () => {
  const pubspec = readFileSync(join(root, 'mobile', 'pubspec.yaml'), 'utf8');
  assert.ok(pubspec.includes(assetBlock(app)), 'asset list is stale');
});
