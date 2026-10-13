import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../src/engine/detect.js';

// Lookalikes are written as escapes so that this file, like the rest of the
// repository, passes its own check.

test('pure ASCII has nothing to report', () => {
  assert.deepEqual(detect('const paypal = "https://paypal.com";\n'), []);
});

test('a Cyrillic letter inside a Latin word', () => {
  const [f, ...rest] = detect('visit p\u0430ypal.com');
  assert.equal(rest.length, 0);
  assert.equal(f.rule, 'mixed-script');
  assert.equal(f.text, 'p\u0430ypal');
  assert.deepEqual([f.line, f.column, f.index], [1, 8, 7]);
  assert.equal(f.suggestion, 'paypal');
  assert.deepEqual(f.suspects, [{ char: '\u0430', codePoint: 'U+0430', script: 'Cyrillic', index: 7, replacement: 'a' }]);
  assert.match(f.message, /mixes Latin with Cyrillic/);
});

test('the replacement keeps the case the prototype loses', () => {
  // UTS #39 maps both I and Cyrillic I to l; the fix must not.
  assert.equal(detect('\u0406nvoice')[0].suggestion, 'Invoice');
  assert.equal(detect('c\u043Epy')[0].suggestion, 'copy');
  assert.equal(detect('\u041E\u0420EN')[0].suggestion, 'OPEN');
});

test('a Latin letter inside a Cyrillic word becomes Cyrillic', () => {
  const [f] = detect('\u043Fp\u0438\u0432\u0435\u0442');
  assert.equal(f.rule, 'mixed-script');
  assert.equal(f.suspects[0].script, 'Latin');
  assert.equal(f.suggestion, '\u043F\u0440\u0438\u0432\u0435\u0442');
});

test('Cyrillic schwa in Azerbaijani becomes the Latin schwa, not the turned e', () => {
  assert.equal(detect('Az\u04D9rbaycan')[0].suggestion, 'Az\u0259rbaycan');
  assert.equal(detect('\u04D8li')[0].suggestion, '\u018Fli');
});

test('ordinary text in one script is left alone', () => {
  assert.deepEqual(detect('\u041F\u0440\u0438\u0432\u0435\u0442, \u043C\u0438\u0440! \u0410 \u043E \u0441 \u0443'), []);
  assert.deepEqual(detect('Az\u0259rbaycan dilind\u0259 \u0131 v\u0259 \u0259 h\u0259rfl\u0259ri'), []);
  assert.deepEqual(detect('\u65E5\u672C\u8A9E\u306E\u30C6\u30AD\u30B9\u30C8'), []);
  assert.deepEqual(detect('\u039A\u03B1\u03BB\u03B7\u03BC\u03AD\u03C1\u03B1'), []);
});

test('a script mix without a lookalike is not a homoglyph', () => {
  // Greek delta and mu next to Latin letters, as in physics notation.
  assert.deepEqual(detect('\u0394t = 5 \u03BCs'), []);
});

test('a lookalike with no sensible replacement is reported without one', () => {
  const [f] = detect('Gr\u03B5ece');
  assert.equal(f.rule, 'mixed-script');
  assert.equal(f.suggestion, undefined);
  assert.equal(f.suspects[0].replacement, undefined);
});

test('fullwidth, mathematical and ligature forms', () => {
  const [full] = detect('\uFF50\uFF41\uFF59');
  assert.equal(full.rule, 'confusable');
  assert.equal(full.suggestion, 'pay');
  assert.equal(detect('\u{1D429}\u{1D41A}\u{1D432}')[0].suggestion, 'pay');
  assert.equal(detect('\uFB01le')[0].suggestion, 'file');
  assert.equal(detect('Chapter \u2163')[0].suggestion, 'IV');
  assert.equal(detect('\uFF4Dore')[0].suggestion, 'more');
});

test('fullwidth forms are ordinary inside Chinese, Japanese and Korean words', () => {
  // "the first", "the year 2026", "ABC Inc.", "IT is", "the PC" in Korean.
  for (const word of ['\u7B2C\uFF11\u56DE', '\uFF12\uFF10\uFF12\uFF16\u5E74', '\uFF21\uFF22\uFF23\u682A\u5F0F\u4F1A\u793E', '\uFF29\uFF34\u306F', '\uFF30\uFF23\uB97C']) {
    assert.deepEqual(detect(word), [], word);
  }
  // On its own it is still a lookalike, and other lookalikes still count.
  assert.equal(detect('\uFF50\uFF41\uFF59 \u306F')[0].suggestion, 'pay');
  assert.equal(detect('p\u0430ypal\u793E')[0].rule, 'mixed-script');
  assert.equal(detect('\uFF41\uFB01\u793E')[0].text, '\uFF41\uFB01\u793E');
});

test('fullwidth forms set off from Chinese, Japanese or Korean by punctuation are ordinary too', () => {
  // "(1) Overview", "Overview (1)", "'ABC' is", "the 1st, 2nd and 3rd",
  // "1. Overview", and a Han character outside the BMP.
  for (const text of ['\uFF08\uFF11\uFF09\u6982\u8981', '\u6982\u8981\uFF08\uFF11\uFF09', '\u300C\uFF21\uFF22\uFF23\u300D\u306F', '\u7B2C\uFF11\u3001\uFF12\u3001\uFF13\u56DE', '\uFF11\uFF0E\u6982\u8981', '\u{20B9F}\uFF08\uFF11\uFF09']) {
    assert.deepEqual(detect(text), [], text);
  }
  // With no CJK text beyond the punctuation, it is still a lookalike.
  assert.equal(detect('\uFF08\uFF11\uFF09')[0]?.suggestion, '1');
  assert.equal(detect('\uFF08\uFF50\uFF41\uFF59\uFF09 \u306F')[0]?.suggestion, 'pay');
  assert.equal(detect(`\uFF50\uFF41\uFF59${'\uFF0C'.repeat(40)}\u306F`)[0]?.suggestion, 'pay');
});

test('a word ends at punctuation and underscores', () => {
  const [f, ...rest] = detect('user_n\u0430me');
  assert.equal(rest.length, 0);
  assert.equal(f.text, 'n\u0430me');
  assert.equal(f.column, 7);
});

test('several words on a line, in order', () => {
  const found = detect('p\u0430y and r\u0435fund');
  assert.deepEqual(found.map(f => [f.text, f.column]), [['p\u0430y', 2], ['r\u0435fund', 10]]);
});

test('findings of every rule come out in text order', () => {
  const found = detect('p\u0430y \u200B r\u0435fund \u{E0068}\u{E0069} \uFF41');
  assert.deepEqual(found.map(f => [f.rule, f.column]), [
    ['mixed-script', 2], ['invisible', 5], ['mixed-script', 8], ['invisible', 14], ['confusable', 19],
  ]);
});

test('lines and columns, with CRLF and astral characters', () => {
  const [a, b] = detect('ok\r\nx\u0430y\n\u{1D41A}\u{1D41B} z\u0435d');
  assert.deepEqual([a.line, a.column], [2, 2]);
  assert.deepEqual([b.line, b.column], [3, 1]);
  assert.equal(detect('\u{1D41A}\u{1D41B} z\u0435d')[1].column, 7);
});

test('invisible and bidi characters', () => {
  const [zw] = detect('pay\u200Bpal');
  assert.equal(zw.rule, 'invisible');
  assert.deepEqual([zw.column, zw.text, zw.suggestion], [4, 'ZERO WIDTH SPACE', '']);
  const [rlo] = detect('let ok = a \u202E && b');
  assert.match(rlo.message, /U\+202E RIGHT-TO-LEFT OVERRIDE can reorder/);
  assert.equal(detect('a\u3164b')[0].text, 'HANGUL FILLER');
});

test('joiners are reported next to Latin, Greek and Cyrillic, not where scripts need them', () => {
  const [zwj] = detect('pay\u200Dpal');
  assert.deepEqual([zwj.rule, zwj.column, zwj.text, zwj.suggestion], ['invisible', 4, 'ZERO WIDTH JOINER', '']);
  assert.equal(detect('Auf\u200Clage')[0].text, 'ZERO WIDTH NON-JOINER');
  assert.equal(detect('\u200Dpay \u0430\u200D')[1].column, 7);
  // Persian, Devanagari and an emoji family.
  assert.deepEqual(detect('\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645'), []);
  assert.deepEqual(detect('\u0915\u094D\u200D\u0937'), []);
  assert.deepEqual(detect('\u{1F468}\u200D\u{1F469}\u200D\u{1F467} \u200D'), []);
});

test('a byte order mark is only reported away from the start', () => {
  assert.deepEqual(detect('\uFEFFhello'), []);
  assert.equal(detect('hel\uFEFFlo')[0].column, 4);
});

test('tag characters are decoded, except inside a flag', () => {
  const [f] = detect('ok\u{E0068}\u{E0069}');
  assert.equal(f.message, '2 invisible tag characters spelling "hi"');
  const england = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
  assert.deepEqual(detect(`flag ${england} here`), []);
});

test('variation selectors after the first in a run are reported', () => {
  // Bytes hidden a selector apiece after a letter, the way data is smuggled
  // inside an emoji or a word.
  const [f, ...rest] = detect('ok\uFE00\uFE01\u{E0100}\u{E0158} ok');
  assert.equal(rest.length, 0);
  assert.deepEqual([f.rule, f.column, f.text, f.suggestion], ['invisible', 4, 'VARIATION SELECTORS', '']);
  assert.equal(f.suspects[0].char, '\uFE01\u{E0100}\u{E0158}');
  assert.equal(f.message, '3 variation selectors after another one, which nothing displays');
  assert.equal(detect('a\uFE00\uFE01')[0].message, '1 variation selector after another one, which nothing displays');
  // One after a character is how emoji, keycaps and Han variants are written,
  // and the same one twice over carries nothing.
  assert.deepEqual(detect('\u2764\uFE0F 1\uFE0F\u20E3 \u845B\u{E0100}\u98FE \u{1F441}\uFE0F\u200D\u{1F5E8}\uFE0F \u{1F6E0}\uFE0F\uFE0F'), []);
  // A selector does not hide a homoglyph by splitting its word.
  assert.equal(detect('p\u0430\uFE0Fypal')[0].rule, 'mixed-script');
});

test('emoji and symbols are not words', () => {
  assert.deepEqual(detect('\u2139\uFE0F note \u2014 \u201Cquoted\u201D \u00A9 2026 \u00B5s'), []);
});

test('a lone surrogate does not hide the character after it', () => {
  const [f, ...rest] = detect('\uD800\uFF41');
  assert.equal(rest.length, 0);
  assert.deepEqual([f.rule, f.index, f.suggestion], ['confusable', 1, 'a']);
});
