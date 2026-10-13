import { accessSync, constants, globSync, readdirSync, statSync, type Dirent } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';

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
    // globSync passes over a directory it cannot list without a word, so each
    // one it is about to enter is tried first and, when it cannot be read,
    // reported and left out, as the walk above does.
    const reported = new Set<string>();
    const exclude = (entry: Dirent): boolean => {
      if (!entry.isDirectory()) return false;
      if (!named && SKIP.has(entry.name)) return true;
      const path = resolve(entry.parentPath, entry.name);
      try { accessSync(path, constants.R_OK); } catch (e) {
        if (!reported.has(path)) {
          reported.add(path);
          unreadable(`${isAbsolute(pattern) ? path : relative('.', path)}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
        }
        return true;
      }
      return false;
    };
    for (const entry of globSync(pattern, {
      withFileTypes: true,
      exclude: entry => typeof entry !== 'string' && exclude(entry),
    })) {
      if (entry.isFile()) files.push(join(entry.parentPath, entry.name));
    }
    if (!files.length) throw new InputError(`${arg}: no files match`);
  }
  return files;
}
