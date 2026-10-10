import type { Finding } from './detect.js';

// The text with every finding that has a suggestion put right, and those
// findings marked as fixed. Only the flagged characters change, so line
// endings, a byte order mark and everything else stay exactly as they were.
export function applyFixes(text: string, findings: Finding[]): string {
  let out = '';
  let at = 0;
  for (const f of findings) {
    if (f.suggestion === undefined) continue;
    for (const s of f.suspects) {
      out += text.slice(at, s.index) + s.replacement;
      at = s.index + s.char.length;
    }
    f.fixed = true;
  }
  return at ? out + text.slice(at) : text;
}
