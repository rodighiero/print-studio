import test from 'node:test';
import assert from 'node:assert/strict';
import { filmFileName } from '../assets/print/export.js';

const base = { sheet: [420, 594], dpi: 300 };

test('a one-color set is named by project and format only', () => {
  assert.equal(filmFileName({ ...base, inks: ['#000000'] }, { name: 'ink' }, 0), 'surprise-machines_A2.png');
});

test('several dot sizes add a dot-percentage tag', () => {
  const p = { ...base, inks: ['#000000'], fileTag: 'dot-150' };
  assert.equal(filmFileName(p, { name: 'ink' }, 0), 'surprise-machines_A2_dot-150.png');
});

test('spot films carry the ink count, ink number and color', () => {
  const p = { ...base, sheet: [297, 420], inks: ['#e4572e', '#1b4f9c', '#222222'] };
  assert.equal(filmFileName(p, { name: 'ink2', hex: '1b4f9c' }, 1), 'surprise-machines_A3_3inks_ink-2-1b4f9c.png');
});
