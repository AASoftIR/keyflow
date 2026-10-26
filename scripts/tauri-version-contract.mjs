import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');

const exact = (name, expected, section = cargo) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}\\s*=\\s*\\{[^\\n]*version\\s*=\\s*"=([^"\\n]+)"`, 'm');
  const m = section.match(re);
  assert.ok(m, `${name} must be exact-pinned with version = "=x.y.z".`);
  assert.equal(m[1], expected, `${name} expected ${expected}, got ${m[1]}.`);
};

assert.equal(pkg.dependencies?.['@tauri-apps/api'], '2.12.0', '@tauri-apps/api must match the Tauri 2.12 release line.');
exact('tauri', '2.12.0');
exact('tauri-runtime', '2.12.0');
exact('tauri-runtime-wry', '2.12.0');
exact('tauri-utils', '2.10.0');
exact('tauri-macros', '2.7.0');
exact('tauri-build', '2.7.0');
exact('tauri-codegen', '2.7.0');

console.log('✓ Tauri stack contract: tauri/runtime/runtime-wry 2.12.0 / utils 2.10.0 / macros+codegen+build 2.7.0 / JS API 2.12.0');
