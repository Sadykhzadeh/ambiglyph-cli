import { spawnSync } from 'child_process';
import { InputError } from './files.js';

// Files with this much staged content or more would not fit the pipe buffers
// below; nothing a text check is run on comes close.
const MAX_OUTPUT = 1 << 30;

// What is about to be committed: the staged content of every added, copied,
// modified or renamed file under the current directory, keyed by its path
// relative to it. The working tree is not looked at, so a file that was
// edited after `git add` is checked as it will be committed, not as it is on
// disk. A submodule has nothing of its own staged, only the commit it points
// at, and is passed over.
export function stagedFiles(): Map<string, Buffer> {
  const diff = spawnSync('git', ['diff', '--cached', '--raw', '--no-abbrev', '--relative', '--diff-filter=ACMR', '-z'], { maxBuffer: MAX_OUTPUT });
  if (diff.error || diff.status !== 0) {
    throw new InputError('--staged needs git and a git repository');
  }
  // Each entry is ":<old mode> <new mode> <old oid> <new oid> <status>", then
  // the path, or for a copy or a rename the old path and the new one.
  const fields = diff.stdout.toString('utf8').split('\0');
  const blobs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [, mode, , oid, status] = fields[i].split(' ');
    if (status[0] === 'R' || status[0] === 'C') i++;
    if (mode !== '160000') blobs.push([fields[i + 1], oid]);
  }
  const staged = new Map<string, Buffer>();
  if (!blobs.length) return staged;

  // One process answers for all of them, which beats a `git show` per file.
  // They are asked for by object name, which any path can be read by.
  const cat = spawnSync('git', ['cat-file', '--batch'], {
    input: blobs.map(([, oid]) => `${oid}\n`).join(''),
    maxBuffer: MAX_OUTPUT,
  });
  if (cat.error || cat.status !== 0) throw new InputError('could not read the staged files from git');

  // Each answer is "<oid> <type> <size>\n", that many bytes, then "\n".
  const out = cat.stdout;
  let at = 0;
  for (const [name] of blobs) {
    const eol = out.indexOf(10, at);
    const [, type, size] = out.toString('latin1', at, eol).split(' ');
    at = eol + 1;
    if (type !== 'blob') throw new InputError(`${name}: could not be read from git`);
    const length = +size;
    staged.set(name, out.subarray(at, at + length));
    at += length + 1;
  }
  return staged;
}
