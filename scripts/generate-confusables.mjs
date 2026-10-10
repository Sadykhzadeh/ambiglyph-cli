#!/usr/bin/env node
// Regenerates src/engine/confusables.ts from the Unicode security data
// (UTS #39): confusables.txt and IdentifierStatus.txt, plus the script names
// in PropertyValueAliases.txt.
//
//   node scripts/generate-confusables.mjs [version] [--data <dir>]
//
// The files are fetched from unicode.org unless --data points at a directory
// that already holds all three. Only the slice this tool can use is kept:
// letters and digits outside ASCII whose prototype is written in Latin letters
// or ASCII digits. Letter categories and scripts come from the regular
// expression engine of the Node running this script. The output is plain
// ASCII, so the repository passes its own check.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const dataAt = args.indexOf('--data');
const dataDir = dataAt === -1 ? null : args.splice(dataAt, 2)[1];
const version = args[0] ?? '18.0.0';
const out = new URL('../src/engine/confusables.ts', import.meta.url);

async function load(path) {
  if (dataDir) return readFileSync(join(dataDir, basename(path)), 'utf8');
  const url = `https://www.unicode.org/Public/${version}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const fields = text => text.split('\n')
  .map(line => line.replace(/#.*/, '').trim())
  .filter(Boolean)
  .map(line => line.split(';').map(f => f.trim()));
const hex = h => parseInt(h, 16);

const [confusablesTxt, statusTxt, aliasesTxt] = await Promise.all(
  ['security/confusables.txt', 'security/IdentifierStatus.txt', 'ucd/PropertyValueAliases.txt'].map(load));
const stated = confusablesTxt.match(/^# Version: (\S+)/m)?.[1];
if (stated && stated !== version) throw new Error(`asked for ${version}, the data says ${stated}`);

const allowed = new Set();
for (const [range, status] of fields(statusTxt)) {
  if (status !== 'Allowed') continue;
  const [from, to = from] = range.split('..').map(hex);
  for (let cp = from; cp <= to; cp++) allowed.add(cp);
}

// The prototype of every character the file lists (anything absent is its
// own), and the character names its comments carry.
const prototype = new Map();
const names = new Map();
for (const line of confusablesTxt.split('\n')) {
  const m = line.match(/^([0-9A-F]+) ;\t([0-9A-F ]+) ;\t\w+\t#\*? \(.*?\) (.+?) \u2192 (.+?)\t#/);
  if (!m) continue;
  const target = String.fromCodePoint(...m[2].trim().split(' ').map(hex));
  prototype.set(hex(m[1]), target);
  names.set(String.fromCodePoint(hex(m[1])), m[3]);
  if ([...target].length === 1) names.set(target, m[4]);
}
if (prototype.size < 6000) throw new Error(`only ${prototype.size} entries parsed from confusables.txt`);
const skeleton = ch => prototype.get(ch.codePointAt(0)) ?? ch;

const isWordChar = /^(?!\p{Extended_Pictographic})[\p{L}\p{N}]$/u;
const isLatinTarget = /^[\p{sc=Latin}0-9]+$/u;
const isLatinLetter = /^\p{sc=Latin}$/u;
const isDigit = /^\p{Nd}$/u;
const isUpper = ch => ch !== ch.toLowerCase();
const isLower = ch => ch !== ch.toUpperCase();
const isAscii = ch => ch.codePointAt(0) < 0x80;

// What a flagged character may be replaced with: ASCII letters and digits,
// plus the Latin letters the identifier profile allows, such as the schwa.
const pool = [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'];
for (const cp of allowed) {
  const ch = String.fromCodePoint(cp);
  if (cp > 0x7f && isLatinLetter.test(ch) && /^\p{L}$/u.test(ch)) pool.push(ch);
}

// The UTS #39 prototype is not a usable replacement on its own: it maps I and
// 1 to l, 0 to O and m to rn. So among the characters that share a prototype,
// pick the one that fits the source: a digit for a digit, the same case for a
// letter, and for a lowercase letter, the one whose capital matches what the
// source's own capital is replaced with. Cyrillic U+04D9 becomes the schwa
// U+0259 because U+04D8 becomes U+018F, although the turned e U+01DD has the
// same prototype.
function choose(target, like, capital) {
  const candidates = pool.filter(c => skeleton(c) === target);
  if (!candidates.length) return pool.includes(target) ? target : '';
  const score = c => (isDigit.test(like) === isDigit.test(c) ? 8 : 0)
    + (isUpper(like) === isUpper(c) ? 4 : 0)
    + (capital && c.toUpperCase() === capital ? 2 : 0)
    + (isAscii(c) ? 1 : 0);
  return candidates.reduce((best, c) => (score(c) > score(best) ? c : best));
}

// Outside ASCII a lookalike is offered only when it is the same letter in
// Latin, judged by name: CYRILLIC SMALL LETTER SCHWA may become LATIN SMALL
// LETTER SCHWA, but GREEK SMALL LETTER EPSILON does not become LATIN SMALL
// LETTER OPEN E just because they look alike - nobody meant to type that.
const sameLetter = (a, b) => names.has(a) && names.has(b)
  && names.get(a).replace(/^\S+ /, '') === names.get(b).replace(/^LATIN /, '');

const replacement = new Map();
function replace(ch) {
  if (replacement.has(ch)) return replacement.get(ch);
  const target = skeleton(ch);
  const upper = ch.toUpperCase();
  const capital = isLower(ch) && [...upper].length === 1 && prototype.has(upper.codePointAt(0)) ? replace(upper) : '';
  let pick = choose(target, ch, capital);
  if (pick && !isAscii(pick) && !sameLetter(ch, pick)) pick = '';
  if (!pick && [...target].length > 1) {
    // A ligature or a numeral is spelled out letter by letter, in its case:
    // U+2165 ROMAN NUMERAL SIX becomes VI, not the prototype Vl.
    const letters = [...target].map(t => choose(t, ch, ''));
    if (letters.every(c => c && isAscii(c))) pick = letters.join('');
  }
  replacement.set(ch, pick);
  return pick;
}

// The scripts the kept characters belong to. Nothing outside them can pass for
// a letter of another script, so these are all the detector has to tell apart.
const scriptTests = fields(aliasesTxt)
  .filter(([property, , name]) => property === 'sc' && !['Common', 'Inherited', 'Unknown', 'Katakana_Or_Hiragana'].includes(name))
  .flatMap(([, , name]) => {
    try { return [[name, new RegExp(`^\\p{sc=${name}}$`, 'u')]]; } catch { return []; }
  });
const scripts = new Map([['Latin', 0]]);

const groups = { allowed: new Map(), restricted: new Map() };
let kept = 0;
for (const [cp, target] of [...prototype].sort((a, b) => a[0] - b[0])) {
  const ch = String.fromCodePoint(cp);
  if (cp < 0x80 || !isWordChar.test(ch) || !isLatinTarget.test(target)) continue;
  const ok = allowed.has(cp);
  // An allowed Latin letter is never suspicious: it cannot mix scripts with
  // Latin text and the identifier profile has nothing against it.
  if (ok && isLatinLetter.test(ch)) continue;
  const to = replace(ch);
  const script = scriptTests.find(([, test]) => test.test(ch))?.[0];
  if (script) scripts.set(script, (scripts.get(script) ?? 0) + 1);
  const group = groups[ok ? 'allowed' : 'restricted'];
  group.set(to, (group.get(to) ?? '') + ch);
  kept++;
}

const escape = s => [...s].map(c => {
  const cp = c.codePointAt(0);
  if (cp >= 0x20 && cp < 0x7f && c !== "'" && c !== '\\') return c;
  return cp > 0xffff ? `\\u{${cp.toString(16).toUpperCase()}}` : `\\u${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}).join('');
const emit = map => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([to, from]) => `  '${escape(to)}': '${escape(from)}',`).join('\n');

writeFileSync(out, `// Generated by scripts/generate-confusables.mjs from the Unicode ${version}
// security data (confusables.txt, IdentifierStatus.txt), with character
// classes from Unicode ${process.versions.unicode}. Do not edit by hand.
//
// Derived from Unicode data files. Copyright (c) Unicode, Inc. Distributed
// under the Unicode License v3: https://www.unicode.org/license.txt
//
// Each entry maps a replacement to the characters that can pass for it.
// ${kept} characters in all.

export const unicodeVersion = '${version}';

// Latin first, then by how many of the characters below each one owns.
export const scripts = '${[...scripts].sort((a, b) => (a[0] === 'Latin' ? -1 : b[0] === 'Latin' ? 1 : b[1] - a[1])).map(([name]) => name).join(' ')}';

// Ordinary letters of their own script (UTS #39 "Allowed"): suspicious only
// inside a word that is mostly another script.
export const allowed: Record<string, string> = {
${emit(groups.allowed)}
};

// Compatibility, mathematical and technical forms (UTS #39 "Restricted"):
// suspicious wherever they appear.
export const restricted: Record<string, string> = {
${emit(groups.restricted)}
};
`);
console.log(`wrote ${kept} characters (${groups.allowed.size} + ${groups.restricted.size} replacements) to ${out.pathname}`);
