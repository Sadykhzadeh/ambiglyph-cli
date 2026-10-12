import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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

test('UTF-16 with a byte order mark is checked, and fixed in UTF-16', () => {
  const text = '\uFEFFok\r\nlet a = b \u202E; // p\u0430ypal\r\n';
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.from(le).swap16();
  const root = tree({ 'le.cs': le, 'be.ps1': be, 'utf32.bin': Buffer.from([0xff, 0xfe, 0, 0, 0x61, 0, 0, 0]) });
  const r = run(root, ['check', '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(
    JSON.parse(r.out).map((f: { file: string, line: number, column: number, rule: string }) => [f.file, f.line, f.column, f.rule]),
    [['be.ps1', 2, 11, 'invisible'], ['be.ps1', 2, 18, 'mixed-script'], ['le.cs', 2, 11, 'invisible'], ['le.cs', 2, 18, 'mixed-script']],
  );
  assert.equal(run(root, ['check', '--fix']).code, 0);
  const fixed = '\uFEFFok\r\nlet a = b ; // paypal\r\n';
  assert.deepEqual(readFileSync(join(root, 'le.cs')), Buffer.from(fixed, 'utf16le'));
  assert.deepEqual(readFileSync(join(root, 'be.ps1')), Buffer.from(fixed, 'utf16le').swap16());
  const filtered = spawnSync(process.execPath, [cli, 'check', '--fix', '-'], { input: le });
  assert.deepEqual(filtered.stdout, Buffer.from(fixed, 'utf16le'));
});

test('a file named twice is checked and fixed once', () => {
  const root = tree({ 'a.md': spoofed });
  const r = run(root, ['check', '.', './a.md', join(root, 'a.md'), 'a.md']);
  assert.equal(r.code, 1);
  assert.equal(r.out.split('\n').filter(Boolean).length, 1);
  assert.match(r.err, /1 problem in 1 of 1 file checked/);
  const fixed = run(root, ['check', '--fix', 'a.md', './a.md']);
  assert.match(fixed.err, /1 problem in 1 of 1 file checked, 1 fixed/);
});

test('binary files are skipped', () => {
  const root = tree({ 'img.png': Buffer.from([0x89, 0x50, 0x00, 0xd0, 0xb0]), 'a.txt': 'ok\n' });
  const r = run(root, ['check']);
  assert.equal(r.code, 0);
  assert.match(r.err, /1 file checked/);
});

// Permissions do not keep root out, nor anyone on Windows.
test('a directory that cannot be read is reported, the rest is checked, and it exits 2', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const root = tree({ 'locked/a.md': spoofed, 'open/b.md': spoofed });
  chmodSync(join(root, 'locked'), 0o000);
  try {
    const r = run(root, ['check']);
    assert.equal(r.code, 2);
    assert.match(r.err, /^ambiglyph: locked: EACCES$/m);
    assert.match(r.out, /^open[\\/]b\.md:1:12 /);
  } finally {
    chmodSync(join(root, 'locked'), 0o755);
  }
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

test('--fix rewrites the files and exits 0 once nothing is left', () => {
  const root = tree({ 'a.md': spoofed, 'b.txt': 'x\u200By\r\n', 'c.txt': 'plain\n' });
  const r = run(root, ['check', '--fix']);
  assert.equal(r.code, 0);
  assert.match(r.out, /a\.md:1:12 .* -> paypal \(fixed\)/);
  assert.match(r.out, /b\.txt:1:2 .* \(removed\)/);
  assert.match(r.err, /2 problems in 2 of 3 files checked, 2 fixed/);
  assert.equal(readFileSync(join(root, 'a.md'), 'utf8'), 'log in at paypal.com\n');
  assert.equal(readFileSync(join(root, 'b.txt'), 'utf8'), 'xy\r\n');
  assert.equal(run(root, ['check']).code, 0);
});

test('--fix exits 1 while something it cannot fix is left', () => {
  const root = tree({ 'a.md': `Gr\u03B5ece ${spoofed}` });
  const r = run(root, ['check', '--fix', '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.out).map((f: { fixed?: boolean }) => f.fixed ?? false), [false, true]);
  assert.equal(readFileSync(join(root, 'a.md'), 'utf8'), 'Gr\u03B5ece log in at paypal.com\n');
});

test('--fix - is a filter: fixed text out, report on stderr', () => {
  const r = run(tree({}), ['check', '--fix', '-'], `a\r\n${spoofed}`);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'a\r\nlog in at paypal.com\n');
  assert.match(r.err, /<stdin>:2:12 .* \(fixed\)/);
  assert.equal(run(tree({}), ['check', '--fix', '-'], 'plain\n').out, 'plain\n');
});

test('usage errors exit 2', () => {
  const root = tree({});
  assert.equal(run(root, ['check', '--nope']).code, 2);
  assert.equal(run(root, ['check', '--server', 'a', 'b']).code, 2);
  assert.equal(run(root, ['check', '--fix', '-', 'a.txt']).code, 2);
  const r = run(root, ['check', '--server', 'a.txt']);
  assert.equal(r.code, 2);
  assert.match(r.err, /set `url`/);
});

test('check --server writes <path>.remove next to the file, even from elsewhere', async () => {
  // Stands in for an Ambiglyph server that finds nothing.
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ text: JSON.parse(body).text, haveDetections: false, candidates: [] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = tree({ 'work/.ambi': 'token', 'data/a.txt': 'hello there world\n' });
  try {
    const env = { ...process.env, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    await promisify(execFile)(process.execPath, [cli, 'check', '--server', join(root, 'data', 'a.txt')], { cwd: join(root, 'work'), env });
  } finally {
    server.close();
  }
  assert.equal(readFileSync(join(root, 'data', 'a.txt.remove'), 'utf8'), 'hello there world\n');
});

function repo(files: Record<string, string>): string {
  const root = tree(files);
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  return root;
}

test('--staged checks the index, not the working tree', () => {
  const root = repo({ 'bad.md': spoofed, 'fixed.md': spoofed, 'untracked-later.txt': 'x\n' });
  writeFileSync(join(root, 'fixed.md'), 'log in at paypal.com\n');
  writeFileSync(join(root, 'unstaged.md'), spoofed);
  const r = run(root, ['check', '--staged']);
  assert.equal(r.code, 1);
  assert.match(r.out, /^bad\.md:1:12 /);
  assert.equal(r.out.split('\n').filter(Boolean).length, 2);
  assert.match(r.out, /fixed\.md:1:12 /);
  assert.match(r.err, /2 problems in 2 of 3 files checked/);
});

test('--staged is clean when the staged content is clean, whatever is on disk', () => {
  const root = repo({ 'a.md': 'plain\n' });
  writeFileSync(join(root, 'a.md'), spoofed);
  assert.equal(run(root, ['check', '--staged']).code, 0);
});

test('--staged with nothing staged checks nothing and exits 0', () => {
  const root = tree({ 'a.md': spoofed });
  spawnSync('git', ['init', '-q'], { cwd: root });
  const r = run(root, ['check', '--staged']);
  assert.equal(r.code, 0);
  assert.match(r.err, /0 files checked, no problems/);
});

test('--staged outside a repository exits 2, and refuses paths and --fix', () => {
  const root = tree({ 'a.md': spoofed });
  const r = run(root, ['check', '--staged']);
  assert.equal(r.code, 2);
  assert.match(r.err, /needs git and a git repository/);
  assert.equal(run(root, ['check', '--staged', 'a.md']).code, 2);
  assert.equal(run(root, ['check', '--staged', '--fix']).code, 2);
});

test('--staged works from a subdirectory and reports paths relative to it', () => {
  const root = repo({ 'sub/a.md': spoofed, 'top.md': spoofed });
  const r = run(join(root, 'sub'), ['check', '--staged']);
  assert.equal(r.code, 1);
  assert.match(r.out, /^a\.md:1:12 /);
  assert.equal(r.out.split('\n').filter(Boolean).length, 1);
});

test('--sarif prints a SARIF 2.1.0 log with one result per finding', () => {
  const root = tree({ 'docs/a b.md': `x\n${spoofed}`, 'ok.txt': 'fine\n' });
  const r = run(root, ['check', '--sarif']);
  assert.equal(r.code, 1);
  const log = JSON.parse(r.out);
  assert.equal(log.version, '2.1.0');
  const [run0] = log.runs;
  assert.equal(run0.tool.driver.name, 'ambiglyph');
  assert.deepEqual(run0.tool.driver.rules.map((x: { id: string }) => x.id), ['mixed-script', 'confusable', 'invisible']);
  assert.equal(run0.results.length, 1);
  const [res] = run0.results;
  assert.equal(res.ruleId, 'mixed-script');
  assert.equal(res.ruleIndex, 0);
  assert.match(res.message.text, /-> paypal$/);
  const loc = res.locations[0].physicalLocation;
  assert.equal(loc.artifactLocation.uri, 'docs/a%20b.md');
  assert.deepEqual(loc.region, { startLine: 2, startColumn: 12 });
  assert.equal(r.err, '');
  const absolute = JSON.parse(run(root, ['check', '--sarif', join(root, 'docs')]).out);
  assert.equal(absolute.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, 'docs/a%20b.md');
});

test('--sarif on a clean tree is a log with no results, and --json cannot join it', () => {
  const root = tree({ 'ok.txt': 'fine\n' });
  const r = run(root, ['check', '--sarif']);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out).runs[0].results, []);
  assert.equal(run(root, ['check', '--sarif', '--json']).code, 2);
});

test('--ignore skips the files a glob matches, and can be repeated', () => {
  const root = tree({
    'a.md': spoofed,
    'docs/b.md': spoofed,
    'vendor/lib/c.txt': spoofed,
    'src/d.txt': spoofed,
  });
  const only = (args: string[]) => run(root, ['check', '--json', ...args]).out;
  const files = (args: string[]) => JSON.parse(only(args)).map((f: { file: string }) => f.file.replace(/\\/g, '/')).sort();
  assert.deepEqual(files([]), ['a.md', 'docs/b.md', 'src/d.txt', 'vendor/lib/c.txt']);
  assert.deepEqual(files(['--ignore', '*.md']), ['src/d.txt', 'vendor/lib/c.txt']);
  assert.deepEqual(files(['--ignore', 'vendor/**', '--ignore', 'docs/*.md']), ['a.md', 'src/d.txt']);
  assert.deepEqual(files(['--ignore', '**/*.txt', 'src', 'a.md']), ['a.md']);
  assert.deepEqual(files(['--ignore', 'vendor']), ['a.md', 'docs/b.md', 'src/d.txt']);
  assert.deepEqual(files(['--ignore', 'lib/']), ['a.md', 'docs/b.md', 'src/d.txt']);
  assert.deepEqual(files(['--ignore', './docs']), ['a.md', 'src/d.txt', 'vendor/lib/c.txt']);
  assert.deepEqual(files(['--ignore', 'a.md/']), ['a.md', 'docs/b.md', 'src/d.txt', 'vendor/lib/c.txt']);
  assert.deepEqual(files(['--ignore', 'src/d']), ['a.md', 'docs/b.md', 'src/d.txt', 'vendor/lib/c.txt']);
  const all = run(root, ['check', '--ignore', '**']);
  assert.equal(all.code, 0);
  assert.match(all.err, /0 files checked, no problems/);
});

test('--ignore does not touch standard input, and --server refuses it', () => {
  const root = tree({});
  assert.equal(run(root, ['check', '--ignore', '*', '-'], spoofed).code, 1);
  assert.equal(run(root, ['check', '--server', '--ignore', 'x', 'a.txt']).code, 2);
});

test('a line marked ambiglyph-ignore is not reported, nor fixed', () => {
  const marked = 'p\u0430ypal # ambiglyph-ignore\n';
  const root = tree({
    'a.txt': `${marked}${spoofed}`,
    'b.txt': `// ambiglyph-ignore-next-line\n${spoofed}${spoofed}`,
    'c.txt': `<!-- ambiglyph-ignored -->${spoofed}`,
  });
  const r = run(root, ['check', '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(
    JSON.parse(r.out).map((f: { file: string, line: number }) => [f.file, f.line]),
    [['a.txt', 2], ['b.txt', 3], ['c.txt', 1]],
  );
  const fixed = run(root, ['check', '--fix', 'a.txt', 'b.txt']);
  assert.equal(fixed.code, 0);
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), `${marked}log in at paypal.com\n`);
  assert.equal(readFileSync(join(root, 'b.txt'), 'utf8'), `// ambiglyph-ignore-next-line\n${spoofed}log in at paypal.com\n`);
});
