import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const rust = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

assert.doesNotMatch(
  rust,
  /to_ascii_lowercase\(\)\.as_str\(\)/,
  'E0716 risk: do not borrow as_str() directly from a temporary lowercase String.'
);
assert.match(
  rust,
  /let normalized = value\.trim\(\)\.to_ascii_lowercase\(\);[\s\S]*let label = match normalized\.as_str\(\)/,
  'GPU vendor parsing must bind the normalized String before matching.'
);
assert.match(
  rust,
  /if !vendors\.iter\(\)\.any\(\|v\| v == &label\) \{[\s\S]*vendors\.push\(label\);/,
  'GPU vendor labels should stay owned through deduplication and insertion.'
);

console.log('✓ rust contract: GPU vendor detection owns normalized strings; E0716 regression blocked');
