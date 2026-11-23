// Ajo: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { usMonthlyAverage } from './yields.mjs';

const daily = {
  d: ['2025-11-24', '2025-11-25', '2025-12-01', '2025-12-02', '2025-12-31', '2026-01-02', '2026-01-05'],
  v: [4.0, 4.2, 4.1, 4.3, null, 4.4, 4.6],
};
const weekly = {
  d: ['2025-09-19', '2025-10-03', '2025-10-10', '2025-10-31', '2025-11-07', '2025-11-28', '2025-12-05', '2026-01-09'],
  v: [3.9, 4.0, 4.1, 4.2, 4.5, 4.5, 9.9, 9.9],
};

test('kesken oleva kuukausi jätetään pois', () => {
  const r = usMonthlyAverage(daily, weekly, '2026-01');
  assert.ok(!r.d.includes('2026-01-01'));
});

test('osittain alkava ensimmäinen kuukausi jätetään pois', () => {
  const r = usMonthlyAverage(daily, weekly, '2026-02');
  assert.ok(!r.d.includes('2025-09-01'), 'viikkodata alkaa 19.9.');
});

test('päivädatan kattamat kuukaudet lasketaan päivädatasta, muut viikkodatasta', () => {
  const r = usMonthlyAverage(daily, weekly, '2026-02');
  assert.deepEqual(r.d, ['2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01']);
  // loka: viikkodata (4.0, 4.1, 4.2); marras: päivädata alkaa 24.11. → viikkodata (4.5, 4.5);
  // joulu: päivädata (4.1, 4.3, null ohitetaan); tammi: päivädata (4.4, 4.6)
  assert.deepEqual(r.v, [4.1, 4.5, 4.2, 4.5]);
});

test('ilman dataa palautetaan null', () => {
  assert.equal(usMonthlyAverage(undefined, undefined, '2026-01'), null);
  assert.equal(usMonthlyAverage({ d: [], v: [] }, { d: [], v: [] }, '2026-01'), null);
});

test('pelkkä viikkodata riittää, jos päivädata puuttuu', () => {
  const r = usMonthlyAverage(null, weekly, '2025-12');
  assert.deepEqual(r.d, ['2025-10-01', '2025-11-01']);
});

test('vuodenvaihde: kesken joulukuun alkava data aloittaa tammikuusta', () => {
  const r = usMonthlyAverage({ d: ['2025-12-15', '2026-01-02', '2026-02-02'], v: [1, 2, 3] }, null, '2026-02');
  assert.deepEqual(r.d, ['2026-01-01']);
});
