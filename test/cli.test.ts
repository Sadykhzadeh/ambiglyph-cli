import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../index.js', import.meta.url));

const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function tree(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'ambiglyph-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function run(cwd: string, args: string[], input?: string) {
  const env = { ...process.env };
  delete env.url;
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, input, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const spoofed = 'log in at p\u0430ypal.com\n';

test('a clean tree exits 0', () => {
  const root = tree({ 'a.txt': 'plain\n', 'b.md': 'caf\u00E9 \u201Cquoted\u201D\n' });
  const r = run(root, ['check']);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.match(r.err, /2 files checked, no problems/);
});

test('findings are listed as file:line:column and exit 1', () => {
  const root = tree({ 'doc.md': `# title\n${spoofed}`, 'ok.txt': 'fine\n' });
  const r = run(root, ['check', '.']);
  assert.equal(r.code, 1);
  assert.equal(r.out, `doc.md:2:12  mixed-script  "p\u0430ypal" mixes Latin with Cyrillic: \u0430 U+0430 (Cyrillic) -> paypal\n`);
  assert.match(r.err, /1 problem in 1 of 2 files checked/);
});

test('--json prints every finding with its file', () => {
  const root = tree({ 'doc.md': spoofed });
  const r = run(root, ['check', 'doc.md', '--json']);
  assert.equal(r.code, 1);
  const [f, ...rest] = JSON.parse(r.out);
  assert.equal(rest.length, 0);
  assert.deepEqual([f.file, f.line, f.column, f.rule, f.suggestion], ['doc.md', 1, 12, 'mixed-script', 'paypal']);
  assert.equal(r.err, '');
});

test('directories skip node_modules and .git, globs are expanded here', () => {
  const root = tree({
    'src/a.ts': spoofed,
    'src/b.js': spoofed,
    'node_modules/dep/index.js': spoofed,
    '.git/x': spoofed,
    '.github/ci.yml': spoofed,
  });
  const files = (args: string[]) => JSON.parse(run(root, ['check', '--json', ...args]).out)
    .map((f: { file: string }) => f.file.replace(/\\/g, '/')).sort();
  assert.deepEqual(files(['.']), ['.github/ci.yml', 'src/a.ts', 'src/b.js']);
  assert.deepEqual(files(['src/**/*.ts']), ['src/a.ts']);
  assert.deepEqual(files(['**/*.js']), ['src/b.js']);
  assert.deepEqual(files(['node_modules/**/*.js']), ['node_modules/dep/index.js']);
});

test('binary files are skipped', () => {
  const root = tree({ 'img.png': Buffer.from([0x89, 0x50, 0x00, 0xd0, 0xb0]), 'a.txt': 'ok\n' });
  const r = run(root, ['check']);
  assert.equal(r.code, 0);
  assert.match(r.err, /1 file checked/);
});

test('a missing path or an empty glob exits 2, even with findings elsewhere', () => {
  const root = tree({ 'doc.md': spoofed });
  const r = run(root, ['check', 'doc.md', 'missing.txt', 'none/*.ts']);
  assert.equal(r.code, 2);
  assert.match(r.err, /missing\.txt: no such file or directory/);
  assert.match(r.err, /none\/\*\.ts: no files match/);
  assert.match(r.out, /doc\.md:1:12/);
});

test('- reads stdin', () => {
  const r = run(tree({}), ['check', '-'], spoofed);
  assert.equal(r.code, 1);
  assert.match(r.out, /^<stdin>:1:12 /);
});

test('usage errors exit 2', () => {
  const root = tree({});
  assert.equal(run(root, ['check', '--nope']).code, 2);
  assert.equal(run(root, ['check', '--server', 'a', 'b']).code, 2);
  const r = run(root, ['check', '--server', 'a.txt']);
  assert.equal(r.code, 2);
  assert.match(r.err, /set `url`/);
});
