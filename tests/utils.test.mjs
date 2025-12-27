import assert from 'node:assert/strict';
import { test, escapeHtml, highlightText, formatTime } from './test-helpers.mjs';

await test('escapeHtml escapes special characters', () => {
  const input = '<div class="x">Tom & Jerry</div>\'"';
  const output = escapeHtml(input);
  assert.equal(output, '&lt;div class=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/div&gt;&#39;&quot;');
});

await test('highlightText highlights matches and escapes content', () => {
  const input = '<b>Foo</b> bar';
  const output = highlightText(input, 'foo');
  assert.equal(output, '&lt;b&gt;<span class="search-highlight">Foo</span>&lt;/b&gt; bar');
});

await test('formatTime handles edge cases', () => {
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(formatTime(-1), '0:00');
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(61), '1:01');
});
