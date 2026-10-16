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

test('a Latin word spelled mostly in Cyrillic is fixed back to Latin, never into Cyrillic', () => {
  // "facebook", "goo.gl" and "ebay", each with a Latin letter Cyrillic lacks.
  assert.equal(detect('f\u0430\u0441\u0435b\u043E\u043Ek')[0]?.suggestion, 'facebook');
  assert.equal(detect('g\u043E\u043E.gl')[0]?.suggestion, 'goo');
  assert.deepEqual(detect('\u0435b\u0430\u0443').map(f => [f.rule, f.suggestion]), [['mixed-script', 'ebay']]);
  // "apple" could be Cyrillic all through, so only a link settles it.
  const [apple] = detect('\u0430\u0440\u0440l\u0435');
  assert.deepEqual([apple.rule, apple.suggestion], ['mixed-script', undefined]);
  assert.equal(detect('https://\u0430\u0440\u0440l\u0435.com')[0]?.suggestion, 'apple');
  // Other scripts are not what such spoofs are made of: a Hebrew ordinal
  // ending on a date pattern letter.
  assert.deepEqual(detect('d\u05D8\u05DF'), []);
});

test('Cyrillic schwa in Azerbaijani becomes the Latin schwa, not the turned e', () => {
  assert.equal(detect('Az\u04D9rbaycan')[0].suggestion, 'Az\u0259rbaycan');
  assert.equal(detect('\u04D8li')[0].suggestion, '\u018Fli');
});

test('a word all in another script is reported where it is joined to Latin', () => {
  // "apple" and "paypal" spelled in Cyrillic, with a palochka for the l.
  const apple = '\u0430\u0440\u0440\u04CF\u0435';
  const [f, ...rest] = detect(`visit https://${apple}.com/login`);
  assert.equal(rest.length, 0);
  assert.deepEqual([f.rule, f.text, f.column, f.suggestion], ['mixed-script', apple, 15, 'apple']);
  assert.match(f.message, /^"\u0430\u0440\u0440\u04CF\u0435" is all Cyrillic, next to Latin: \u0430 U\+0430 \(Cyrillic\), /);
  assert.equal(detect('mail user@\u0440\u0430\u0443\u0440\u0430\u04CF.example')[0]?.suggestion, 'paypal');
  assert.equal(detect('\u0441\u043E\u0440\u0435.length')[0]?.suggestion, 'cope');
  assert.equal(detect('my_\u0410\u0420\u0420')[0]?.suggestion, 'APP');
});

test('a word all in another script is fine on its own or next to its own script', () => {
  // A Russian word next to English, ordinals such as "2-oe", a Russian
  // domain, a word with a letter that has no Latin twin, and single Greek
  // letters in "alpha-helix", "gamma-ray" and "rho_water", and the case
  // ending Serbian hyphenates to an acronym.
  for (const text of ['API-\u0458\u0435', 'Russian \u0441\u043E\u0440 means litter', '\u0412\u0430\u0441\u044F: 2-\u043E\u0435 \u043C\u0435\u0441\u0442\u043E', '\u0441\u0430\u0439\u0442.\u0440\u0444', '\u043A\u043E\u0442.com', '\u0441\u043E\u0440. And', '\u03B1-helix \u03B3-ray \u03C1_water']) {
    assert.deepEqual(detect(text), [], text);
  }
});

test('ordinary text in one script is left alone', () => {
  assert.deepEqual(detect('\u041F\u0440\u0438\u0432\u0435\u0442, \u043C\u0438\u0440! \u0410 \u043E \u0441 \u0443'), []);
  assert.deepEqual(detect('Az\u0259rbaycan dilind\u0259 \u0131 v\u0259 \u0259 h\u0259rfl\u0259ri'), []);
  assert.deepEqual(detect('\u65E5\u672C\u8A9E\u306E\u30C6\u30AD\u30B9\u30C8'), []);
  assert.deepEqual(detect('\u039A\u03B1\u03BB\u03B7\u03BC\u03AD\u03C1\u03B1'), []);
});

test('letters Unicode keeps out of identifiers for being little used are ordinary', () => {
  // Cherokee, Inuktitut syllabics, Tifinagh, N'Ko, Lisu, Coptic, "hello" in
  // decomposed Korean, "10" in Punjabi digits and "what" in Yiddish.
  for (const text of ['\u13E3\u13B3\u13A9 \u13A6\u13EC\u13C2\u13AF\u13CD\u13D7', '\u1472\u14C7\u1455', '\u2D5C\u2D30\u2D4E\u2D30\u2D63\u2D49\u2D56\u2D5C', '\u07D3\u07DF\u07CF', '\uA4E1\uA4F2\uA4E2\uA4F4', '\u2C80\u2C97\u2C97\u2C81', '\u110B\u1161\u11AB\u1102\u1167\u11BC', '\u0A67\u0A66', '\u05F0\u05D0\u05B8\u05E1']) {
    assert.deepEqual(detect(text), [], text);
  }
  // Their lookalikes still pass for Latin in a Latin word or a link.
  assert.deepEqual(detect('\u13AAmerica').map(f => [f.rule, f.suggestion]), [['mixed-script', 'America']]);
  assert.deepEqual(detect('\uA4D0ank.com').map(f => [f.rule, f.suggestion]), [['mixed-script', 'Bank']]);
  assert.deepEqual(detect('\uA4DA\uA4F3\uA4E0.com').map(f => [f.rule, f.suggestion]), [['mixed-script', 'CON']]);
  // The obsolete letters of Cyrillic are no twin for a Latin d in Russian.
  assert.deepEqual(detect('d\u0432\u0438\u0436\u0435\u043D\u0438\u0435'), []);
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
  // What they stand for, not what they look like: the long s passes for an f,
  // and the prototype of a capital I, which these have no lowercase to tell
  // apart from, is a small L.
  assert.equal(detect('Wa\u017F\u017Fer')[0].suggestion, 'Wasser');
  assert.equal(detect('\uFB05op')[0].suggestion, 'stop');
  assert.equal(detect('\u{1D408}nvoice')[0].suggestion, 'Invoice');
  assert.equal(detect('\u2110D')[0].suggestion, 'ID');
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

test('Latin letters inside Chinese words are ordinary', () => {
  // "T-shirt", "karaoke hall", "Y chromosome", "type O blood": a majority of
  // Han does not turn their T, O and Y into the Han characters like them.
  for (const word of ['T\u6064\u886B', '\u5361\u62C9OK\u5385', 'Y\u67D3\u8272\u4F53', 'O\u578B\u8840']) {
    assert.deepEqual(detect(word), [], word);
  }
  // A Han character inside a Latin word still passes for a Latin letter.
  assert.equal(detect('\u4E05est')[0]?.suggestion, 'Test');
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

test('zero width spaces between Thai, Lao, Khmer and Burmese words are ordinary', () => {
  // Thai, Lao, Khmer with a doubled one and a quote after it, Burmese, and
  // the vowel separator in Mongolian "khara".
  for (const text of ['\u0E20\u0E32\u0E29\u0E32\u200B\u0E44\u0E17\u0E22', '\u0E9E\u0EB2\u0EAA\u0EB2\u200B\u0EA5\u0EB2\u0EA7', '"\u1797\u17B6\u179F\u17B6\u200B\u200B\u1781\u17D2\u1798\u17C2\u179A\u200B"', '\u1019\u103C\u1014\u103A\u200B\u1019\u102C', '\u182C\u1820\u1837\u180E\u1820']) {
    assert.deepEqual(detect(text), [], text);
  }
  // Elsewhere they are still invisible noise.
  assert.deepEqual(detect('\u0E44\u0E17\u0E22 pay\u200Bpal x\u180Ey').map(f => [f.text, f.column]), [['ZERO WIDTH SPACE', 8], ['MONGOLIAN VOWEL SEPARATOR', 14]]);
});

test('marks and controls that show nothing are reported between two letters', () => {
  const inside = ['\u200E', '\u200F', '\u061C', '\u034F', '\u17B4', '\u180B', '\u206A', '\u{1D173}', '\u{1BCA0}', '\uFE0E', '\u{E0100}'];
  for (const c of inside) {
    const found = detect(`pay${c}pal`);
    assert.deepEqual(found.map(f => [f.rule, f.column, f.suggestion]), [['invisible', 4, '']], c);
  }
  assert.equal(detect('pay\u200Fpal')[0].message, 'U+200F RIGHT-TO-LEFT MARK is invisible');
  assert.equal(detect('pay\uFE0E\uFE0Epal')[0].message, '2 variation selectors inside a word, which nothing displays');
  // At the edge of a word, where right-to-left text and emoji need them, and
  // between a letter and a combining mark.
  assert.deepEqual(detect('\u05E9\u05DC\u05D5\u05DD Hello\u200F! \u0628\u061C1 \u2764\uFE0F u\u034F\u0308'), []);
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
