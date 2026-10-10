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

test('emoji and symbols are not words', () => {
  assert.deepEqual(detect('\u2139\uFE0F note \u2014 \u201Cquoted\u201D \u00A9 2026 \u00B5s'), []);
});
