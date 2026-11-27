import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const advisory = 'GHSA-mrhx-c7xc-m3w5';
const knownAffected = 'af7deaaff50a14c7d8b52f518e10dac800a350bf8eef43f8454006fa7a44e4da';

// Intentionally empty until an official fixed or removal release is reviewed.
// Each exact Next release needs an auditable match to official upstream bytes.
const reviewed = Object.freeze({});

function readRegular(path, limit) {
  const info = lstatSync(path);
  if (!info.isFile() || info.size < 1 || info.size > limit || realpathSync(path) !== path) {
    throw new Error('unexpected runtime file layout');
  }
  return readFileSync(path);
}

export function measure(runtimeRoot) {
  const root = realpathSync(runtimeRoot);
  readRegular(join(root, 'server.js'), 1024 * 1024);
  const next = join(root, 'node_modules', 'next');
  const nextVersion = JSON.parse(readRegular(join(next, 'package.json'), 1024 * 1024)).version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(nextVersion ?? '')) {
    throw new Error('unrecognised Next version');
  }
  const bundle = join(next, 'dist', 'compiled', 'zod');
  let bundleInfo;
  try {
    bundleInfo = lstatSync(bundle);
  } catch (err) {
    if (err.code === 'ENOENT') return { nextVersion, sha256: null };
    throw err;
  }
  if (!bundleInfo.isDirectory() || realpathSync(bundle) !== bundle) {
    throw new Error('unexpected compiled zod directory');
  }
  const metadata = JSON.parse(readRegular(join(bundle, 'package.json'), 64 * 1024));
  if (metadata.name !== 'zod' || metadata.main !== 'index.cjs') {
    throw new Error('unexpected compiled zod entry point');
  }
  const sha256 = createHash('sha256').update(readRegular(join(bundle, metadata.main), 8 * 1024 * 1024)).digest('hex');
  return { nextVersion, sha256 };
}

export function check(evidence) {
  const { nextVersion, sha256 } = evidence;
  if (sha256 === knownAffected) throw new Error(`${advisory}: affected bundled bytes (Next ${nextVersion})`);
  if (!Object.hasOwn(reviewed, nextVersion) || reviewed[nextVersion] !== sha256) {
    throw new Error(`${advisory}: vendor artifact not reviewed (Next ${nextVersion}; sha256=${sha256 ?? 'absent'})`);
  }
}

if (process.argv[1] === '-' || (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])) {
  try {
    const evidence = measure(process.argv[2] ?? '/app');
    check(evidence);
    console.log(`TABUP_RUNTIME_ZOD_OK next=${evidence.nextVersion} sha256=${evidence.sha256 ?? 'absent'}`);
  } catch (err) {
    console.error(`TABUP_RUNTIME_ZOD_BLOCKED: ${err.message}`);
    process.exitCode = 78;
  }
}
