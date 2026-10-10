import { readFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { isAscii } from 'buffer';
import { detect, type Finding } from '../engine/detect.js';
import { applyFixes } from '../engine/fix.js';
import { expand, InputError } from './files.js';

export interface ScanOptions {
  json?: boolean;
  // Rewrite each file with the suggestions applied. With '-' as the only
  // input, the corrected text goes to stdout and the report to stderr.
  fix?: boolean;
}

// Exit codes, as linters use them: 0 clean, 1 findings, 2 the check itself failed.
export const CLEAN = 0;
export const FOUND = 1;
export const FAILED = 2;

// Git's test for binary content: a NUL byte in the first 8000 bytes.
const isBinary = (data: Buffer): boolean => data.subarray(0, 8000).includes(0);

// Reading is most of the work on a large tree. Keeping a few reads in flight
// took a 3,100-file scan from 240 to 190 ms; more than this stopped helping.
const READ_AHEAD = 8;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function line(file: string, f: Finding): string {
  const fix = f.suggestion === undefined ? ''
    : f.suggestion === '' ? (f.fixed ? ' (removed)' : ' (remove it)')
      : ` -> ${f.suggestion}${f.fixed ? ' (fixed)' : ''}`;
  return `${file}:${f.line}:${f.column}  ${f.rule}  ${f.message}${fix}\n`;
}

export async function scan(args: string[], options: ScanOptions): Promise<number> {
  let failed = false;
  const fail = (message: string): void => {
    failed = true;
    console.error(`ambiglyph: ${message}`);
  };
  // `ambiglyph check . | head` closes the pipe early; that is not an error.
  process.stdout.on('error', e => {
    if ((e as NodeJS.ErrnoException).code === 'EPIPE') process.exit(failed ? FAILED : FOUND);
    throw e;
  });

  const files: string[] = [];
  for (const arg of args) {
    try { files.push(...expand(arg)); } catch (e) {
      if (e instanceof InputError) fail(e.message); else throw e;
    }
  }

  // Up to READ_AHEAD files are being read while one is checked, and results
  // are still taken in order, so the output does not depend on timing.
  const queue = [...new Set(files)];
  const load = (file: string): Promise<Buffer | Error> =>
    (file === '-' ? Promise.resolve().then(() => readFileSync(0)) : readFile(file)).catch((e: Error) => e);
  const reads = queue.slice(0, READ_AHEAD).map(load);

  const filter = options.fix === true && queue.length === 1 && queue[0] === '-';
  const report = filter ? process.stderr : process.stdout;

  const json: Array<Finding & { file: string }> = [];
  let problems = 0;
  let fixable = 0;
  let fixed = 0;
  let checked = 0;
  let withProblems = 0;
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i];
    const data = await reads[i];
    reads[i] = undefined!;
    if (i + READ_AHEAD < queue.length) reads.push(load(queue[i + READ_AHEAD]));
    if (data instanceof Error) {
      fail(`${file}: ${(data as NodeJS.ErrnoException).code ?? data.message}`);
      continue;
    }
    // Most files in a repository are pure ASCII, which is settled on the raw
    // bytes without decoding them at all.
    const binary = isBinary(data);
    if (binary || isAscii(data)) {
      if (filter) process.stdout.write(data);
      if (!binary) checked++;
      continue;
    }
    checked++;
    const name = file === '-' ? '<stdin>' : file;
    const text = data.toString('utf8');
    const findings = detect(text);
    let output = text;
    if (options.fix && findings.length) {
      output = applyFixes(text, findings);
      if (!filter && output !== text) {
        try { await writeFile(file, output); } catch (e) {
          fail(`${file}: could not write the fixes: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
          for (const f of findings) f.fixed = false;
        }
      }
    }
    if (filter) process.stdout.write(output);
    if (!findings.length) continue;
    problems += findings.length;
    withProblems++;
    for (const f of findings) {
      if (f.fixed) fixed++; else if (f.suggestion !== undefined) fixable++;
    }
    if (options.json) for (const f of findings) json.push({ file: name, ...f });
    else report.write(findings.map(f => line(name, f)).join(''));
  }

  if (options.json) process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  else if (problems) {
    const fixes = options.fix ? `, ${fixed} fixed` : fixable ? ` (${fixable} fixable with --fix)` : '';
    console.error(`${plural(problems, 'problem')} in ${withProblems} of ${plural(checked, 'file')} checked${fixes}`);
  } else if (!failed) console.error(`${plural(checked, 'file')} checked, no problems`);
  // With --fix, only what is left unfixed counts.
  return failed ? FAILED : problems > fixed ? FOUND : CLEAN;
}
