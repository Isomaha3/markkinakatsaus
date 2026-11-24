// Ajo: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { finishWeekly } from './weekly.mjs';

test('kesken olevan viikon tuleva perjantai pudotetaan (24.11.2026 tilanne)', () => {
  const hist = { d: ['2026-11-13', '2026-11-20', '2026-11-27', '2026-11-30'], v: [7561.67, 6910.39, 7237.17, 7200] };
  const r = finishWeekly(hist, '2026-11-24', 7190.31);
  assert.deepEqual(r.d, ['2026-11-13', '2026-11-20', '2026-11-24']);
  assert.deepEqual(r.v, [7561.67, 6910.39, 7190.31]);
});

test('perjantaina viikon piste korvataan päivän luvulla', () => {
  const r = finishWeekly({ d: ['2026-11-20', '2026-11-27'], v: [1, 2] }, '2026-11-27', 3);
  assert.deepEqual(r, { d: ['2026-11-20', '2026-11-27'], v: [1, 3] });
});

test('tulos on aina aikajärjestyksessä ja päättyy viimeisimpään päivään', () => {
  const r = finishWeekly({ d: ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27'], v: [1, 2, 3, 4] }, '2026-11-23', 9);
  assert.ok(r.d.every((x, i) => !i || x > r.d[i - 1]));
  assert.equal(r.d.at(-1), '2026-11-23');
  assert.equal(r.v.at(-1), 9);
});

test('tyhjä tai puuttuva sarja', () => {
  assert.deepEqual(finishWeekly(null, '2026-11-24', 5), { d: ['2026-11-24'], v: [5] });
  assert.deepEqual(finishWeekly({ d: [], v: [] }, '2026-11-24', 5), { d: ['2026-11-24'], v: [5] });
});
