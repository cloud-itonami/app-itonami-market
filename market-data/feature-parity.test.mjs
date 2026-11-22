// The disabled-features list must match the code, so the deploy gate cannot pass while a feature
// is still off, and cannot keep blocking once it is back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { disabledFeatures } from './check-feature-parity.mjs';
import { undecidedServices } from './descriptor.mjs';

const guest = await readFile(new URL('guest.mjs', import.meta.url), 'utf8');
const ids = (await disabledFeatures()).map((f) => f.id);

test('CID open is listed exactly while the Yataverse read is undeclared', () => {
  assert.equal(ids.includes('cid-open'), undecidedServices().includes('yataverse'));
});

test('JSON save is listed exactly while the guest keeps the save button disabled', () => {
  assert.equal(ids.includes('json-save'), /ui\.save\.disabled = true;/.test(guest));
});

test('no unknown entries', () => {
  for (const id of ids) assert.ok(['json-save', 'cid-open'].includes(id), id);
});
