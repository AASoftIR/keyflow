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


assert.match(rust, /reqwest::Proxy::all\(proxy_url\)/, 'Native AI transport must apply the configured proxy to reqwest.');
assert.match(rust, /socks5h?/, 'Native proxy validation must allow SOCKS5/SOCKS5H for local V2Ray.');

console.log('✓ rust contract: owned GPU strings + SOCKS5/SOCKS5H proxy transport + E0716 regression blocked');
