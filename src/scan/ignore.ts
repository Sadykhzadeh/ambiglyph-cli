import { relative, resolve, sep } from 'path';
import type { Finding } from '../engine/detect.js';

// ** crosses directories, * and ? stay inside one name. A pattern with no
// slash matches a name at any depth, as in .gitignore.
function globToRegExp(glob: string): RegExp {
  const pattern = glob.replace(/^\.\//, '');
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; source += '(?:.*/)?'; } else source += '.*';
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern.includes('/') ? '' : '(?:.*/)?'}${source}$`);
}

// Whether a file, taken relative to the working directory, matches any glob.
export function ignoreMatcher(globs: string[]): (file: string) => boolean {
  const patterns = globs.map(globToRegExp);
  return file => {
    const path = relative(process.cwd(), resolve(file)).split(sep).join('/');
    return patterns.some(p => p.test(path));
  };
}

const MARKER = /ambiglyph-ignore(-next-line)?(?![\w-])/;

// The findings left once the lines marked `ambiglyph-ignore`, and the line
// after one marked `ambiglyph-ignore-next-line`, are set aside.
export function withoutIgnored(text: string, findings: Finding[]): Finding[] {
  if (!findings.length || !text.includes('ambiglyph-ignore')) return findings;
  const skipped = new Set<number>();
  text.split('\n').forEach((line, i) => {
    const marker = MARKER.exec(line);
    if (marker) skipped.add(i + (marker[1] ? 2 : 1));
  });
  return findings.filter(f => !skipped.has(f.line));
}
