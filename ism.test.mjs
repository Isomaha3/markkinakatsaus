// Ajo: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIsmTitle } from './ism.mjs';

test('teollisuuden PMI-tiedotteen otsikko jäsennetään', () => {
  assert.deepEqual(parseIsmTitle('Manufacturing PMI® at 55.5%; October 2026 ISM® Manufacturing PMI® Report'),
    { month: '2026-10', value: 55.5 });
});

test('registers-muoto ja ilman ®-merkkiä', () => {
  assert.deepEqual(parseIsmTitle('Manufacturing PMI registers 48.7%; January 2026 ISM Manufacturing PMI Report'),
    { month: '2026-01', value: 48.7 });
});

test('palvelualan ja muut tiedotteet ohitetaan', () => {
  assert.equal(parseIsmTitle('Services PMI® at 52.4%; October 2026 ISM® Services PMI® Report'), null);
  assert.equal(parseIsmTitle('Manufacturing PMI® at 55.5%; ISM® Semiannual Economic Forecast December 2026'), null);
  assert.equal(parseIsmTitle('ISM® Hospital PMI® at 57.1%; October 2026 Manufacturing'), null);
});

test('epäuskottava arvo tai puuttuva kuukausi hylätään', () => {
  assert.equal(parseIsmTitle('Manufacturing PMI® at 5.5%; October 2026 ISM® Manufacturing PMI® Report'), null);
  assert.equal(parseIsmTitle('Manufacturing PMI® at 55.5%; ISM® Manufacturing PMI® Report'), null);
});
