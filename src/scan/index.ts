import { readFileSync } from 'fs';
import { open, writeFile } from 'fs/promises';
import { isAscii } from 'buffer';
import { resolve } from 'path';
import { detect, type Finding } from '../engine/detect.js';
import { applyFixes } from '../engine/fix.js';
import { expand, InputError } from './files.js';
import { ignoreMatcher, withoutIgnored } from './ignore.js';
import { stagedFiles } from './staged.js';

export interface ScanOptions {
  json?: boolean;
  // All findings as one SARIF 2.1.0 log, for code scanning.
  sarif?: boolean;
  // Rewrite each file with the suggestions applied. With '-' as the only
  // input, the corrected text goes to stdout and the report to stderr.
  fix?: boolean;
  // Check what is staged in git, as it will be committed, instead of paths.
  staged?: boolean;
  // Files matching any of these globs are not checked.
  ignore?: string[];
}

// Exit codes, as linters use them: 0 clean, 1 findings, 2 the check itself failed.
export const CLEAN = 0;
export const FOUND = 1;
export const FAILED = 2;

// Git's test for binary content: a NUL byte in the first 8000 bytes.
const isBinary = (data: Buffer): boolean => data.subarray(0, 8000).includes(0);

type Encoding = 'utf8' | 'utf16le' | 'utf16be';

// UTF-16 is full of NUL bytes, so it would pass for binary, but Windows tools
// write it and C# and PowerShell compile and run it. It is taken as text when
// it starts with a byte order mark and holds whole code units, unless it is
// UTF-32, whose little-endian mark starts the same way.
function encodingOf(data: Buffer): Encoding {
  if (data.length % 2) return 'utf8';
  if (data[0] === 0xff && data[1] === 0xfe && !(data[2] === 0 && data[3] === 0)) return 'utf16le';
  if (data[0] === 0xfe && data[1] === 0xff) return 'utf16be';
  return 'utf8';
}

// The byte order mark is kept in the text, so writing it back restores it.
const decode = (data: Buffer, encoding: Encoding): string =>
  encoding === 'utf16be' ? Buffer.from(data).swap16().toString('utf16le') : data.toString(encoding);
const encode = (text: string, encoding: Encoding): string | Buffer =>
  encoding === 'utf8' ? text : encoding === 'utf16le' ? Buffer.from(text, 'utf16le') : Buffer.from(text, 'utf16le').swap16();

// A file's first 8000 bytes, which settle whether it is binary, are read on
// their own, and the rest only when it is not: a video or a disk image in the
// tree costs one small read instead of being loaded whole, and one over 2 GiB,
// which Node cannot read into a Buffer, does not stop the run. null stands for
// a binary file.
async function readText(file: string): Promise<Buffer | null> {
  const handle = await open(file);
  try {
    const head = Buffer.allocUnsafe(8000);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (bytesRead < head.length) return head.subarray(0, bytesRead);
    if (isBinary(head) && encodingOf(head) === 'utf8') return null;
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

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

  const ignored = options.ignore?.length ? ignoreMatcher(options.ignore) : undefined;
  const files: string[] = [];
  let staged = new Map<string, Buffer>();
  try {
    if (options.staged) {
      staged = stagedFiles();
      files.push(...staged.keys());
    } else for (const arg of args) {
      try { files.push(...expand(arg, fail, ignored)); } catch (e) {
        if (e instanceof InputError) fail(e.message); else throw e;
      }
    }
  } catch (e) {
    if (e instanceof InputError) fail(e.message); else throw e;
  }

  // Up to READ_AHEAD files are being read while one is checked, and results
  // are still taken in order, so the output does not depend on timing.
  // A file named twice, as `. ./a.md` or `a.md /abs/a.md` do, is checked once.
  const seen = new Set<string>();
  const queue = files.filter(file => {
    const key = file === '-' ? file : resolve(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return file === '-' || !ignored?.(file);
  });
  const load = (file: string): Promise<Buffer | null | Error> =>
    (options.staged ? Promise.resolve(staged.get(file)!) : file === '-' ? Promise.resolve().then(() => readFileSync(0)) : readText(file)).catch((e: Error) => e);
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
    if (data === null) continue;
    // Most files in a repository are pure ASCII, which is settled on the raw
    // bytes without decoding them at all.
    const encoding = encodingOf(data);
    const binary = encoding === 'utf8' && isBinary(data);
    if (binary || isAscii(data)) {
      if (filter) process.stdout.write(data);
      if (!binary) checked++;
      continue;
    }
    checked++;
    const name = file === '-' ? '<stdin>' : file;
    const text = decode(data, encoding);
    const findings = withoutIgnored(text, detect(text));
    let output = text;
    if (options.fix && findings.length) {
      output = applyFixes(text, findings);
      if (!filter && output !== text) {
        try { await writeFile(file, encode(output, encoding)); } catch (e) {
          fail(`${file}: could not write the fixes: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
          for (const f of findings) f.fixed = false;
        }
      }
    }
    if (filter) process.stdout.write(encode(output, encoding));
    if (!findings.length) continue;
    problems += findings.length;
    withProblems++;
    for (const f of findings) {
      if (f.fixed) fixed++; else if (f.suggestion !== undefined) fixable++;
    }
    if (options.json || options.sarif) for (const f of findings) json.push({ file: name, ...f });
    else report.write(findings.map(f => line(name, f)).join(''));
  }

  if (options.json) report.write(`${JSON.stringify(json, null, 2)}\n`);
  else if (options.sarif) report.write((await import('./sarif.js')).sarif(json));
  else if (problems) {
    const fixes = options.fix ? `, ${fixed} fixed` : fixable ? ` (${fixable} fixable with --fix)` : '';
    console.error(`${plural(problems, 'problem')} in ${withProblems} of ${plural(checked, 'file')} checked${fixes}`);
  } else if (!failed) console.error(`${plural(checked, 'file')} checked, no problems`);
  // With --fix, only what is left unfixed counts.
  return failed ? FAILED : problems > fixed ? FOUND : CLEAN;
}
