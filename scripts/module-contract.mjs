import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = resolve(root, 'app');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else if (entry.isFile() && extname(entry.name) === '.js') out.push(path);
  }
  return out.sort();
}

function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const raw of match[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      const alias = part.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      names.add(alias ? alias[1] : part.split(/\s+/)[0]);
    }
  }
  if (/\bexport\s+default\b/.test(source)) names.add('default');
  return names;
}

function localImports(source) {
  const imports = [];
  const pattern = /\bimport\s+([^;\n]+?)\s+from\s+['"](\.\.?\/[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const clause = match[1].trim();
    const specifier = match[2];
    const names = [];

    const named = clause.match(/\{([^}]+)\}/);
    if (named) {
      for (const raw of named[1].split(',')) {
        const part = raw.trim();
        if (!part) continue;
        names.push(part.split(/\s+as\s+/)[0].trim());
      }
    }

    const withoutNamed = clause.replace(/\{[^}]*\}/, '').replace(/^\s*,|,\s*$/g, '').trim();
    if (withoutNamed && !withoutNamed.startsWith('*')) {
      const first = withoutNamed.split(',')[0].trim();
      if (first && /^[A-Za-z_$][\w$]*$/.test(first)) names.push('default');
    }
    imports.push({ specifier, names });
  }
  return imports;
}

const files = await walk(appRoot);
const cache = new Map();
for (const file of files) cache.set(file, await readFile(file, 'utf8'));

const errors = [];
for (const file of files) {
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) errors.push(`${file}: syntax check failed\n${syntax.stderr || syntax.stdout}`);

  const source = cache.get(file);
  for (const imp of localImports(source)) {
    let target = resolve(dirname(file), imp.specifier);
    if (!extname(target)) target += '.js';
    let targetSource = cache.get(target);
    if (targetSource === undefined) {
      try { targetSource = await readFile(target, 'utf8'); cache.set(target, targetSource); }
      catch { errors.push(`${file}: local module not found: ${imp.specifier}`); continue; }
    }
    const exports = exportedNames(targetSource);
    for (const name of imp.names) {
      if (!exports.has(name)) errors.push(`${file}: imports ${name} from ${imp.specifier}, but that module does not export it`);
    }
  }
}

assert.deepEqual(errors, [], `Local ESM contract failures:\n${errors.join('\n')}`);
console.log(`✓ module contract: ${files.length} app modules parsed; all local imports resolve to real exports`);
