import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { check, measure } from './verify-runtime-zod.mjs';

function runtime(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'tabup-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const next = join(root, 'node_modules', 'next');
  mkdirSync(next, { recursive: true });
  writeFileSync(join(root, 'server.js'), '// fixture, never executed');
  writeFileSync(join(next, 'package.json'), '{"name":"next","version":"16.4.6"}');
  return { root, zod: join(next, 'dist', 'compiled', 'zod') };
}

test('checks bytes not the package lock or unversioned vendored metadata', (t) => {
  const { root, zod } = runtime(t);
  mkdirSync(zod, { recursive: true });
  writeFileSync(join(zod, 'package.json'), '{"name":"zod","main":"index.cjs"}');
  writeFileSync(join(zod, 'index.cjs'), 'fixture');
  const evidence = measure(root);
  assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => check(evidence), /vendor artifact not reviewed/);
  assert.throws(() => check({ nextVersion: '16.5.0', sha256: 'af7deaaff50a14c7d8b52f518e10dac800a350bf8eef43f8454006fa7a44e4da' }), /affected bundled bytes/);
});

test('absence is not proof of a reviewed upstream removal', (t) => {
  const { root } = runtime(t);
  assert.equal(measure(root).sha256, null);
  assert.throws(() => check(measure(root)), /sha256=absent/);
});

test('linked files cannot masquerade as verified runtime files', (t) => {
  const { root, zod } = runtime(t);
  mkdirSync(zod, { recursive: true });
  writeFileSync(join(zod, 'package.json'), '{"name":"zod","main":"index.cjs"}');
  symlinkSync(join(root, 'server.js'), join(zod, 'index.cjs'));
  assert.throws(() => measure(root), /unexpected runtime file layout/);
});

test('unrecognised metadata cannot pick a different file to hash', (t) => {
  const { root, zod } = runtime(t);
  mkdirSync(zod, { recursive: true });
  writeFileSync(join(zod, 'package.json'), '{"name":"zod","main":"../other.cjs"}');
  assert.throws(() => measure(root), /unexpected compiled zod entry point/);
});
