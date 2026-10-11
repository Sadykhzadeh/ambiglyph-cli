import { spawnSync } from 'child_process';
import { InputError } from './files.js';

// Files with this much staged content or more would not fit the pipe buffers
// below; nothing a text check is run on comes close.
const MAX_OUTPUT = 1 << 30;

// What is about to be committed: the staged content of every added, copied,
// modified or renamed file under the current directory, keyed by its path
// relative to it. The working tree is not looked at, so a file that was
// edited after `git add` is checked as it will be committed, not as it is on
// disk.
export function stagedFiles(): Map<string, Buffer> {
  const diff = spawnSync('git', ['diff', '--cached', '--name-only', '--relative', '--diff-filter=ACMR', '-z'], { maxBuffer: MAX_OUTPUT });
  if (diff.error || diff.status !== 0) {
    throw new InputError('--staged needs git and a git repository');
  }
  const names = diff.stdout.toString('utf8').split('\0').filter(Boolean);
  const staged = new Map<string, Buffer>();
  if (!names.length) return staged;

  // One process answers for all of them, which beats a `git show` per file.
  // A name holding a newline cannot be asked for this way; git quotes such
  // names for humans only, and they are rare enough to just report.
  const asked = names.filter(name => !name.includes('\n'));
  if (asked.length < names.length) {
    throw new InputError('--staged cannot read a path with a newline in it');
  }
  const cat = spawnSync('git', ['cat-file', '--batch'], {
    input: asked.map(name => `:./${name}\n`).join(''),
    maxBuffer: MAX_OUTPUT,
  });
  if (cat.error || cat.status !== 0) throw new InputError('could not read the staged files from git');

  // Each answer is "<oid> <type> <size>\n", that many bytes, then "\n".
  const out = cat.stdout;
  let at = 0;
  for (const name of asked) {
    const eol = out.indexOf(10, at);
    const [, type, size] = out.toString('latin1', at, eol).split(' ');
    at = eol + 1;
    if (type === 'missing' || type === 'ambiguous') throw new InputError(`${name}: not in the index`);
    const length = +size;
    // A submodule shows up as a commit; there is nothing in it to read.
    if (type === 'blob') staged.set(name, out.subarray(at, at + length));
    at += length + 1;
  }
  return staged;
}
