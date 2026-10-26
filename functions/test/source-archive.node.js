const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readdirRecursive } = require('firebase-tools/lib/fsAsync');

test('hosted Functions archives exclude emulator environments and sandbox secrets', async () => {
  const root = path.resolve(__dirname, '../..');
  const config = JSON.parse(readFileSync(path.join(root, 'firebase.json'), 'utf8')).functions;
  const files = await readdirRecursive({ path: path.join(root, config.source), ignoreStrings: config.ignore });
  const names = files.map(file => file.name.replaceAll('\\', '/'));
  assert.ok(names.some(name => name.endsWith('/index.js')));
  assert.ok(names.some(name => name.endsWith('/package-lock.json')));
  assert.equal(names.some(name => /\/(?:\.env(?:\.|$)|\.secret|node_modules\/|test\/)/.test(name)), false);
  for (const exclusion of ['.env', '.env.*', '.secret*']) assert.ok(config.ignore.includes(exclusion));
});
