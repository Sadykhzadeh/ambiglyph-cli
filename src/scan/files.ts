import { spawnSync } from 'child_process';
import { accessSync, constants, globSync, readdirSync, statSync, type Dirent } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';

// Never worth walking into, unless a pattern names them outright.
const SKIP = new Set(['node_modules', '.git']);
const GLOB = /[*?[\]{}]/;

function walk(dir: string, out: string[], unreadable: (message: string) => void, ignored?: (path: string, isDir: boolean) => boolean): void {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) {
    unreadable(`${dir}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name) && !ignored?.(path, true)) walk(path, out, unreadable, ignored);
    } else if (entry.isFile()) out.push(path);
  }
}

// What git ignores below `dir`, as absolute paths: the untracked files and
// directories that a .gitignore, .git/info/exclude or the global excludes file
// matches, as `git status` leaves them out. A file git tracks is never among
// them. Nothing is, outside a work tree or without git.
function gitIgnored(dir: string): Set<string> {
  const ignored = new Set<string>();
  const list = spawnSync('git', ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], { cwd: dir, maxBuffer: 1 << 30 });
  if (list.error || list.status !== 0) return ignored;
  // When `dir` is an ignored directory or lies inside one, git names that
  // directory or gives up. Either way nothing below `dir` is skipped: a
  // directory that is named is checked whole.
  const below = resolve(dir).length;
  for (const path of list.stdout.toString('utf8').split('\0')) {
    const abs = resolve(dir, path);
    if (abs.length > below) ignored.add(abs);
  }
  return ignored;
}

export class InputError extends Error {}

// The files an argument stands for: '-' for stdin, a file as it is, every file
// under a directory, or whatever a glob matches. Globs are expanded here
// because Windows shells leave them alone and CI configs often quote them.
// A directory that cannot be listed is passed to `unreadable` and the walk
// goes on without it. A directory below `arg` that `ignored` or git ignores
// is not walked at all, and a file git ignores is left out.
export function expand(arg: string, unreadable: (message: string) => void, ignored?: (path: string, isDir: boolean) => boolean): string[] {
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
  if (isDir) {
    const git = gitIgnored(arg);
    walk(arg, files, unreadable, (path, isDir) => git.has(resolve(path)) || ignored?.(path, isDir) === true);
    if (git.size) return files.filter(file => !git.has(resolve(file)));
  } else {
    const pattern = process.platform === 'win32' ? arg.replace(/\\/g, '/') : arg;
    // The directories before the first wildcard, which the glob only reaches into.
    const base = pattern.slice(0, pattern.search(GLOB)).replace(/[^/]*$/, '') || '.';
    let git = new Set<string>();
    try { if (statSync(base).isDirectory()) git = gitIgnored(base); } catch { /* matches nothing */ }
    const named = [...SKIP].some(name => pattern.split('/').includes(name));
    // globSync passes over a directory it cannot list without a word, so each
    // one it is about to enter is tried first and, when it cannot be read,
    // reported and left out, as the walk above does.
    const reported = new Set<string>();
    const exclude = (entry: Dirent): boolean => {
      if (!entry.isDirectory()) return false;
      if (!named && SKIP.has(entry.name)) return true;
      const path = resolve(entry.parentPath, entry.name);
      if (git.has(path)) return true;
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
      if (entry.isFile() && !git.has(resolve(entry.parentPath, entry.name))) files.push(join(entry.parentPath, entry.name));
    }
    if (!files.length) throw new InputError(`${arg}: no files match${git.size ? ' that git does not ignore' : ''}`);
  }
  return files;
}
