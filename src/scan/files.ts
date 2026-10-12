import { globSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Never worth walking into, unless a pattern names them outright.
const SKIP = new Set(['node_modules', '.git']);
const GLOB = /[*?[\]{}]/;

function walk(dir: string, out: string[], unreadable: (message: string) => void): void {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) {
    unreadable(`${dir}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(path, out, unreadable);
    } else if (entry.isFile()) out.push(path);
  }
}

export class InputError extends Error {}

// The files an argument stands for: '-' for stdin, a file as it is, every file
// under a directory, or whatever a glob matches. Globs are expanded here
// because Windows shells leave them alone and CI configs often quote them.
// A directory that cannot be listed is passed to `unreadable` and the walk
// goes on without it.
export function expand(arg: string, unreadable: (message: string) => void): string[] {
  if (arg === '-') return [arg];
  let isDir = false;
  try {
    const stat = statSync(arg);
    if (!stat.isDirectory()) return [arg];
    isDir = true;
  } catch {
    if (!GLOB.test(arg)) throw new InputError(`${arg}: no such file or directory`);
  }
  const files: string[] = [];
  if (isDir) walk(arg, files, unreadable);
  else {
    const pattern = process.platform === 'win32' ? arg.replace(/\\/g, '/') : arg;
    const named = [...SKIP].some(name => pattern.split('/').includes(name));
    for (const entry of globSync(pattern, {
      withFileTypes: true,
      exclude: entry => !named && typeof entry !== 'string' && entry.isDirectory() && SKIP.has(entry.name),
    })) {
      if (entry.isFile()) files.push(join(entry.parentPath, entry.name));
    }
    if (!files.length) throw new InputError(`${arg}: no files match`);
  }
  return files;
}
