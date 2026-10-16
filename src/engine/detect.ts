import { allowed, rare, restricted, scripts } from './confusables.js';

export type Rule = 'mixed-script' | 'confusable' | 'invisible';

export interface Suspect {
  char: string;
  codePoint: string;
  // The character's script, or '' for digits, symbols and marks shared by all.
  script: string;
  // UTF-16 offset into the scanned text.
  index: number;
  // What to put in its place: '' deletes it, undefined means no suggestion.
  replacement?: string;
}

export interface Finding {
  rule: Rule;
  // 1-based; the column counts UTF-16 code units, the way ESLint and tsc do.
  line: number;
  column: number;
  index: number;
  // The word as written, or the name of the invisible character.
  text: string;
  message: string;
  suspects: Suspect[];
  // The word with every suspect replaced, when each of them has a replacement.
  suggestion?: string;
  // Set by applyFixes once the suggestion has been applied.
  fixed?: boolean;
}

interface CharInfo {
  // Whether it can be part of a word (see WORD_CHAR).
  word: boolean;
  script: string;
  // Present when the confusables table lists the character.
  to?: string;
  restricted: boolean;
}

const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

// Everything about a code point is worked out once and cached: a document in
// one script repeats the same few dozen letters thousands of times. In the
// Basic Multilingual Plane, where nearly all text lives, a typed array maps
// the code point to its slot in `bmpInfos`; a sparse plain array would fall
// back to dictionary lookups, which about doubled the time on Russian text.
let bmpSlots: Uint16Array | undefined;
const bmpInfos: CharInfo[] = [];
const astralCache = new Map<number, CharInfo>();
let table: Map<number, { to: string, restricted: boolean }> | undefined;
// Allowed letters by the replacement they share, for turning a stray
// character into the right letter of a word's own script.
let twins: Map<string, string[]> | undefined;

function loadTable(): Map<number, { to: string, restricted: boolean }> {
  table = new Map();
  twins = new Map();
  for (const [group, isRestricted] of [[allowed, false], [rare, false], [restricted, true]] as const) {
    for (const to in group) {
      for (const ch of group[to]) {
        table.set(ch.codePointAt(0)!, { to, restricted: isRestricted });
        if (group === allowed && to) {
          const list = twins.get(to);
          if (list) list.push(ch); else twins.set(to, [ch]);
        }
      }
    }
  }
  return table;
}

// Script regexes are compiled one at a time and only when a character gets
// that far down the list, most-used scripts first. A name the running Node
// does not know yet is skipped.
const scriptNames = scripts.split(' ');
const scriptTests: Array<RegExp | null> = [];

function scriptOf(ch: string): string {
  for (let i = 0; i < scriptNames.length; i++) {
    let test = scriptTests[i];
    if (test === undefined) {
      try { test = new RegExp(`^\\p{sc=${scriptNames[i]}}`, 'u'); } catch { test = null; }
      scriptTests[i] = test;
    }
    if (test?.test(ch)) return scriptNames[i];
  }
  return '';
}

function infoOf(cp: number): CharInfo {
  if (cp < 0x10000) {
    const slot = (bmpSlots ??= new Uint16Array(0x10000))[cp];
    if (slot) return bmpInfos[slot - 1];
  } else {
    const cached = astralCache.get(cp);
    if (cached) return cached;
  }
  const ch = String.fromCodePoint(cp);
  const entry = (table ?? loadTable()).get(cp);
  const info: CharInfo = { word: WORD_CHAR.test(ch), script: scriptOf(ch), to: entry?.to, restricted: entry?.restricted ?? false };
  if (cp < 0x10000) bmpSlots![cp] = bmpInfos.push(info); else astralCache.set(cp, info);
  return info;
}

const ASCII_LETTER: CharInfo = { word: true, script: 'Latin', restricted: false };
const ASCII_DIGIT: CharInfo = { word: true, script: '', restricted: false };

// The letter of `script` that passes for the same replacement as `like`,
// in the same case where there is a choice.
function twinIn(script: string, key: string, like: string): string | undefined {
  if (!twins) loadTable();
  const list = twins!.get(key);
  if (!list) return undefined;
  const upper = like !== like.toLowerCase();
  let fallback: string | undefined;
  for (const ch of list) {
    if (infoOf(ch.codePointAt(0)!).script !== script) continue;
    if ((ch !== ch.toLowerCase()) === upper) return ch;
    fallback ??= ch;
  }
  return fallback;
}

// Default-ignorable and bidi formatting characters that have no business
// inside ordinary text: they make two different strings render the same, or
// reorder what is displayed (CVE-2021-42574, "Trojan Source"). Variation
// selectors are left alone, as emoji and several scripts need them, and so
// are joiners, except where JOINER_NAMES says.
const INVISIBLE_NAMES: Record<number, string> = {
  0x00ad: 'SOFT HYPHEN',
  0x115f: 'HANGUL CHOSEONG FILLER',
  0x1160: 'HANGUL JUNGSEONG FILLER',
  0x180e: 'MONGOLIAN VOWEL SEPARATOR',
  0x200b: 'ZERO WIDTH SPACE',
  0x202a: 'LEFT-TO-RIGHT EMBEDDING',
  0x202b: 'RIGHT-TO-LEFT EMBEDDING',
  0x202c: 'POP DIRECTIONAL FORMATTING',
  0x202d: 'LEFT-TO-RIGHT OVERRIDE',
  0x202e: 'RIGHT-TO-LEFT OVERRIDE',
  0x2060: 'WORD JOINER',
  0x2061: 'FUNCTION APPLICATION',
  0x2062: 'INVISIBLE TIMES',
  0x2063: 'INVISIBLE SEPARATOR',
  0x2064: 'INVISIBLE PLUS',
  0x2066: 'LEFT-TO-RIGHT ISOLATE',
  0x2067: 'RIGHT-TO-LEFT ISOLATE',
  0x2068: 'FIRST STRONG ISOLATE',
  0x2069: 'POP DIRECTIONAL ISOLATE',
  0x3164: 'HANGUL FILLER',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE',
  0xffa0: 'HALFWIDTH HANGUL FILLER',
};
const BLACK_FLAG = '\u{1F3F4}';
// Joiners shape Arabic and Indic text and build emoji sequences, but the
// alphabets homoglyphs imitate have no use for them: next to a Latin, Greek or
// Cyrillic letter or digit, one only makes a word differ from its lookalike.
const JOINER_NAMES: Record<number, string> = {
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x200d: 'ZERO WIDTH JOINER',
};
const ALPHABETS = new Set(['Latin', 'Greek', 'Cyrillic']);
// Marks and format controls that display nothing but have uses of their own:
// bidi marks at the edge of right-to-left text, the grapheme joiner between a
// letter and its accent, Mongolian variation selectors. Between two letters or
// digits of ALPHABETS none of them does anything a reader could see.
const IN_WORD_NAMES: Record<number, string> = {
  0x034f: 'COMBINING GRAPHEME JOINER',
  0x061c: 'ARABIC LETTER MARK',
  0x17b4: 'KHMER VOWEL INHERENT AQ',
  0x17b5: 'KHMER VOWEL INHERENT AA',
  0x180b: 'MONGOLIAN FREE VARIATION SELECTOR ONE',
  0x180c: 'MONGOLIAN FREE VARIATION SELECTOR TWO',
  0x180d: 'MONGOLIAN FREE VARIATION SELECTOR THREE',
  0x180f: 'MONGOLIAN FREE VARIATION SELECTOR FOUR',
  0x200e: 'LEFT-TO-RIGHT MARK',
  0x200f: 'RIGHT-TO-LEFT MARK',
  0x206a: 'INHIBIT SYMMETRIC SWAPPING',
  0x206b: 'ACTIVATE SYMMETRIC SWAPPING',
  0x206c: 'INHIBIT ARABIC FORM SHAPING',
  0x206d: 'ACTIVATE ARABIC FORM SHAPING',
  0x206e: 'NATIONAL DIGIT SHAPES',
  0x206f: 'NOMINAL DIGIT SHAPES',
  0x1bca0: 'SHORTHAND FORMAT LETTER OVERLAP',
  0x1bca1: 'SHORTHAND FORMAT CONTINUING OVERLAP',
  0x1bca2: 'SHORTHAND FORMAT DOWN STEP',
  0x1bca3: 'SHORTHAND FORMAT UP STEP',
  0x1d173: 'MUSICAL SYMBOL BEGIN BEAM',
  0x1d174: 'MUSICAL SYMBOL END BEAM',
  0x1d175: 'MUSICAL SYMBOL BEGIN TIE',
  0x1d176: 'MUSICAL SYMBOL END TIE',
  0x1d177: 'MUSICAL SYMBOL BEGIN SLUR',
  0x1d178: 'MUSICAL SYMBOL END SLUR',
  0x1d179: 'MUSICAL SYMBOL BEGIN PHRASE',
  0x1d17a: 'MUSICAL SYMBOL END PHRASE',
};

const isSelector = (cp: number): boolean => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);

const NON_ASCII = /[\x80-\uFFFF]/g;
// Words are runs of letters, marks and digits, minus emoji such as U+2139 and
// the characters Unicode says to render as nothing when unsupported: the
// Hangul fillers, which are letters by category, and marks such as the
// variation selectors, which are checked on their own.
const WORD_CHAR = /^(?!\p{Extended_Pictographic}|\p{Default_Ignorable_Code_Point})[\p{L}\p{M}\p{N}]/u;

// Chinese, Japanese and Korean text writes letters and digits fullwidth, so in
// a word that holds one of their characters, or next to one, a fullwidth form
// imitates nothing.
const CJK = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\p{sc=Bopomofo}]/u;
const CJK_FIRST = new RegExp(`^${CJK.source}`, 'u');
// Ideographic punctuation and the fullwidth forms, which can set a fullwidth
// word apart from the CJK text it belongs to, as the parentheses of a
// fullwidth "(1)" do before a heading or the commas of "1, 2, 3" in a list.
const CJK_GAP = /[\u3000-\u303F\u30FB\uFF01-\uFF65]/;
// How far either way to look for that text, which keeps a long fullwidth run
// with none in it from being walked again for each of its words.
const CJK_REACH = 32;

// Whether CJK text lies on either side of start..end, across nothing but
// CJK_GAP characters.
function cjkAround(text: string, start: number, end: number): boolean {
  let i = start - 1;
  while (i >= 0 && i >= start - CJK_REACH && CJK_GAP.test(text[i])) i--;
  if (i >= 0) {
    const c = text.charCodeAt(i);
    if (CJK_FIRST.test(text.slice(c >= 0xdc00 && c <= 0xdfff && i > 0 ? i - 1 : i, i + 1))) return true;
  }
  i = end;
  while (i < text.length && i < end + CJK_REACH && CJK_GAP.test(text[i])) i++;
  return CJK_FIRST.test(text.slice(i, i + 2));
}

const isAsciiWordChar = (c: number): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

// Whether the UTF-16 unit at `index` is a BMP letter or digit of ALPHABETS.
function isAlphabetic(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false;
  const c = text.charCodeAt(index);
  if (c < 0x80) return isAsciiWordChar(c);
  if (c >= 0xd800 && c <= 0xdfff) return false;
  const info = infoOf(c);
  return info.word && ALPHABETS.has(info.script);
}

function describe(s: Suspect): string {
  return `${s.char} ${s.codePoint}${s.script ? ` (${s.script})` : ''}`;
}

function listed(suspects: Suspect[]): string {
  const shown = suspects.slice(0, 3).map(describe).join(', ');
  return suspects.length > 3 ? `${shown} and ${suspects.length - 3} more` : shown;
}

function checkWord(text: string, start: number, end: number, out: Finding[]): void {
  const word = text.slice(start, end);
  // Count letters per script; a word rarely has more than two.
  const seen: string[] = [];
  const counts: number[] = [];
  const infos: CharInfo[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < word.length; i++) {
    const c = word.charCodeAt(i);
    let info: CharInfo;
    if (c < 0x80) info = c <= 0x39 ? ASCII_DIGIT : ASCII_LETTER;
    else info = infoOf(word.codePointAt(i)!);
    infos.push(info);
    offsets.push(i);
    if (info.script) {
      const k = seen.indexOf(info.script);
      if (k === -1) { seen.push(info.script); counts.push(1); } else counts[k]++;
    }
    if (c >= 0xd800 && c <= 0xdbff) i++;
  }

  // The word's own script is the one most of its letters are in; on a tie,
  // Latin, which is what nearly every homoglyph attack imitates.
  let base = '';
  let best = 0;
  for (let k = 0; k < seen.length; k++) {
    if (counts[k] > best || (counts[k] === best && seen[k] === 'Latin')) { base = seen[k]; best = counts[k]; }
  }

  let suspects: Suspect[] | undefined;
  let mixed = false;
  let cjk: boolean | undefined;
  for (let j = 0; j < infos.length; j++) {
    const info = infos[j];
    const foreign = info.script !== '' && info.script !== base;
    if (!info.restricted && !(foreign && (info.to !== undefined || base !== 'Latin'))) continue;
    const i = offsets[j];
    const cp = word.codePointAt(i)!;
    if (cp >= 0xff01 && cp <= 0xff5e && (cjk ??= CJK.test(word) || cjkAround(text, start, end))) continue;
    const ch = String.fromCodePoint(cp);
    let replacement: string | undefined;
    if (base === 'Latin' || base === '') replacement = info.to || undefined;
    else {
      // Into another script through the shared replacement: Latin p in a
      // Cyrillic word becomes Cyrillic er.
      const key = info.to ?? (info.script === 'Latin' ? ch : undefined);
      replacement = key ? twinIn(base, key, ch) : undefined;
      // An ordinary letter that has no twin in this script cannot be mistaken
      // for one of its letters, so it is just a word in two scripts.
      if (!info.restricted && replacement === undefined) continue;
    }
    if (foreign) mixed = true;
    (suspects ??= []).push({ char: ch, codePoint: hex(cp), script: info.script, index: start + i, replacement });
  }
  if (!suspects) return;

  const fixable = suspects.every(s => s.replacement !== undefined);
  let suggestion: string | undefined;
  if (fixable) {
    suggestion = '';
    let at = 0;
    for (const s of suspects) {
      suggestion += word.slice(at, s.index - start) + s.replacement;
      at = s.index - start + s.char.length;
    }
    suggestion += word.slice(at);
  }
  const others = [...new Set(suspects.filter(s => s.script && s.script !== base).map(s => s.script))];
  out.push({
    rule: mixed ? 'mixed-script' : 'confusable',
    line: 0,
    column: 0,
    index: suspects[0].index,
    text: word,
    message: mixed
      ? `"${word}" mixes ${base} with ${others.join(' and ')}: ${listed(suspects)}`
      : `"${word}" has lookalike characters: ${listed(suspects)}`,
    suspects,
    suggestion,
  });
}

// Whether the character at `at` is a dot, slash, underscore or @ with an ASCII
// letter beyond it, `step` further on: what joins the parts of a domain name,
// a URL, an address or an identifier. Not a hyphen, which Slavic languages
// put between a Latin acronym and its case ending, as in Serbian "API-je".
function linkedToLatin(text: string, at: number, step: 1 | -1): boolean {
  const c = text.charCodeAt(at);
  if (c !== 0x2e && c !== 0x2f && c !== 0x5f && c !== 0x40) return false;
  const d = text.charCodeAt(at + step) | 0x20;
  return d >= 0x61 && d <= 0x7a;
}

// A word all in one script but Latin, every letter of which passes for a Latin
// one, as Cyrillic "apple" does in a link to it. Reported only where it is
// linked to Latin text, since on its own it is an ordinary word of its script,
// and only from two letters up, which spares a lone Greek letter in a name
// such as "rho_water".
function checkWhole(text: string, start: number, end: number, script: string, out: Finding[]): void {
  const word = text.slice(start, end);
  const suspects: Suspect[] = [];
  let suggestion = '';
  for (let i = 0; i < word.length;) {
    const cp = word.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const info = cp < 0x80 ? ASCII_DIGIT : infoOf(cp);
    if (info.script === '') suggestion += ch;
    else if (info.to && /^[A-Za-z]+$/.test(info.to)) {
      suspects.push({ char: ch, codePoint: hex(cp), script: info.script, index: start + i, replacement: info.to });
      suggestion += info.to;
    } else return;
    i += ch.length;
  }
  if (suspects.length < 2) return;
  out.push({
    rule: 'mixed-script',
    line: 0,
    column: 0,
    index: suspects[0].index,
    text: word,
    message: `"${word}" is all ${script}, next to Latin: ${listed(suspects)}`,
    suspects,
    suggestion,
  });
}

// Reports the invisible character at `index`, if it is one, and returns where
// the scan should go on; a run of tag characters is reported as a whole, and
// so is a run of variation selectors, but for its first.
function checkInvisible(text: string, index: number, cp: number, out: Finding[]): number {
  let next = index + (cp > 0xffff ? 2 : 1);
  let name = INVISIBLE_NAMES[cp];
  if ((cp === 0x200c || cp === 0x200d) && (isAlphabetic(text, index - 1) || isAlphabetic(text, next))) name = JOINER_NAMES[cp];
  else if (cp in IN_WORD_NAMES && isAlphabetic(text, index - 1) && isAlphabetic(text, next)) name = IN_WORD_NAMES[cp];
  let message: string;
  if (name !== undefined) {
    // A byte order mark is only invisible noise when it is not the first character.
    if (cp === 0xfeff && index === 0) return next;
    const isBidi = (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
    message = `${hex(cp)} ${name}${isBidi ? ' can reorder how the text around it is displayed' : ' is invisible'}`;
  } else if (cp >= 0xe0000 && cp <= 0xe007f) {
    const hidden: number[] = [];
    next = index;
    for (let c = cp; c >= 0xe0000 && c <= 0xe007f; c = text.codePointAt(next) ?? 0) {
      if (c >= 0xe0020 && c < 0xe007f) hidden.push(c - 0xe0000);
      next += 2;
    }
    // Tag characters legitimately follow a black flag in subdivision flags
    // such as England's; anywhere else they smuggle text nobody can see.
    if (text.slice(index - 2, index) === BLACK_FLAG) return next;
    const shown = String.fromCharCode(...hidden.slice(0, 40)) + (hidden.length > 40 ? '...' : '');
    name = 'TAG CHARACTERS';
    message = `${(next - index) / 2} invisible tag characters${hidden.length ? ` spelling ${JSON.stringify(shown)}` : ''}`;
  } else if (isSelector(cp)) {
    // A character takes one variation selector at most, as emoji, keycaps and
    // Han variants do. Any more change nothing on screen, yet each can carry a
    // byte, which is how data is smuggled inside an emoji or a word. The same
    // selector repeated, as some keyboards double U+FE0F, carries nothing.
    // Between two letters of ALPHABETS even the first has nothing to vary.
    let end = next;
    let repeated = true;
    for (let c = text.codePointAt(end) ?? 0; isSelector(c); c = text.codePointAt(end) ?? 0) {
      end += c > 0xffff ? 2 : 1;
      repeated &&= c === cp;
    }
    const inWord = isAlphabetic(text, index - 1) && isAlphabetic(text, end);
    if (!inWord) {
      if (repeated) return end;
      index = next;
      cp = text.codePointAt(index)!;
    }
    let count = 0;
    for (let i = index; i < end; i += text.codePointAt(i)! > 0xffff ? 2 : 1) count++;
    next = end;
    name = 'VARIATION SELECTORS';
    message = `${count} variation selector${count === 1 ? '' : 's'} ${inWord ? 'inside a word' : 'after another one'}, which nothing displays`;
  } else return next;
  out.push({
    rule: 'invisible',
    line: 0,
    column: 0,
    index,
    text: name,
    message,
    suspects: [{ char: text.slice(index, next), codePoint: hex(cp), script: '', index, replacement: '' }],
    suggestion: '',
  });
  return next;
}

function locate(text: string, findings: Finding[]): void {
  let line = 1;
  let lineStart = 0;
  for (const f of findings) {
    for (let nl = text.indexOf('\n', lineStart); nl !== -1 && nl < f.index; nl = text.indexOf('\n', lineStart)) {
      line++;
      lineStart = nl + 1;
    }
    f.line = line;
    f.column = f.index - lineStart + 1;
  }
}

// Every finding in `text`, in order. Pure ASCII has nothing to find, which is
// checked first because it is most of what a repository holds.
export function detect(text: string): Finding[] {
  NON_ASCII.lastIndex = 0;
  if (!NON_ASCII.test(text)) return [];
  const findings: Finding[] = [];

  // Walk from one non-ASCII character to the next and measure the word it is
  // in. Text between them is ASCII, so a word can only reach back into it.
  // Most words are in one script and hold nothing the table restricts; only
  // the rest are looked at closely. A character that is no part of a word is
  // checked for being invisible. Findings come out in order.
  const length = text.length;
  NON_ASCII.lastIndex = 0;
  for (let m = NON_ASCII.exec(text); m; m = NON_ASCII.exec(text)) {
    const at = m.index;
    let start = at;
    let first = '';
    while (start > 0 && isAsciiWordChar(text.charCodeAt(start - 1))) {
      if (text.charCodeAt(--start) > 0x39) first = 'Latin';
    }
    let closer = false;
    let end = at;
    while (end < length) {
      const c = text.charCodeAt(end);
      if (c < 0x80) {
        if (!isAsciiWordChar(c)) break;
        if (c > 0x39) {
          if (first === '') first = 'Latin'; else if (first !== 'Latin') closer = true;
        }
        end++;
        continue;
      }
      const cp = c >= 0xd800 && c <= 0xdbff ? text.codePointAt(end)! : c;
      const info = infoOf(cp);
      if (!info.word) break;
      if (info.restricted) closer = true;
      else if (info.script !== '') {
        if (first === '') first = info.script; else if (first !== info.script) closer = true;
      }
      end += cp > 0xffff ? 2 : 1;
    }
    if (end === at) {
      NON_ASCII.lastIndex = checkInvisible(text, at, text.codePointAt(at)!, findings);
      continue;
    }
    if (closer) checkWord(text, start, end, findings);
    else if (first !== '' && first !== 'Latin' && (linkedToLatin(text, start - 1, -1) || linkedToLatin(text, end, 1))) {
      checkWhole(text, start, end, first, findings);
    }
    NON_ASCII.lastIndex = end;
  }

  locate(text, findings);
  return findings;
}
