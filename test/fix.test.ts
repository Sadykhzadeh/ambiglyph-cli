import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../src/engine/detect.js';
import { applyFixes } from '../src/engine/fix.js';

const fix = (text: string): string => applyFixes(text, detect(text));

test('every fixable finding is applied and marked', () => {
  const text = 'p\u0430ypal \u0406nvoice \uFF50\uFF41\uFF59 \uFB01le';
  const findings = detect(text);
  assert.equal(applyFixes(text, findings), 'paypal Invoice pay file');
  assert.ok(findings.every(f => f.fixed));
});

test('invisible characters are removed, tag runs whole', () => {
  assert.equal(fix('pay\u200Bpal a\u202Eb ok\u{E0068}\u{E0069}!'), 'paypal ab ok!');
});

test('a finding without a suggestion is left as it is', () => {
  const text = 'Gr\u03B5ece and p\u0430y';
  const findings = detect(text);
  assert.equal(applyFixes(text, findings), 'Gr\u03B5ece and pay');
  assert.deepEqual(findings.map(f => f.fixed), [undefined, true]);
});

test('only the flagged characters change', () => {
  assert.equal(fix('\uFEFFline one\r\np\u0430y\r\n\u0410 \u043E\r\n'), '\uFEFFline one\r\npay\r\n\u0410 \u043E\r\n');
  assert.equal(fix('\u043Fp\u0438\u0432\u0435\u0442, Az\u04D9rbaycan'), '\u043F\u0440\u0438\u0432\u0435\u0442, Az\u0259rbaycan');
});

test('the fixed text has nothing fixable left', () => {
  const text = 'x\u0430y \u{1D41A}b \u200B Gr\u03B5ece \u043Fp\u0438';
  const left = detect(fix(text));
  assert.deepEqual(left.map(f => f.text), ['Gr\u03B5ece']);
});

test('text with nothing to fix comes back unchanged', () => {
  const text = 'Gr\u03B5ece \u041F\u0440\u0438\u0432\u0435\u0442';
  assert.equal(fix(text), text);
});
