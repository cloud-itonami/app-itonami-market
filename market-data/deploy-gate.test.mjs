// The deploy gate (Decision 2026-11-22). Negative control: even when DNS is up and every disclosure
// page answers 200, the deploy stays blocked while a feature from before the move is still off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deployAllowed, disabledFeatures, disclosurePages } from './deploy-gate.mjs';
import { undecidedServices } from './descriptor.mjs';

const ok200 = async () => new Response('', { status: 200 });
const down = async () => { throw new Error('fetch failed'); };
const guest = await readFile(new URL('guest.mjs', import.meta.url), 'utf8');

test('negative control: disclosure pages answer 200, a feature is still off -> blocked', async () => {
  assert.ok((await disabledFeatures()).length > 0);
  const result = await deployAllowed({ fetchImpl: ok200 });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.every((r) => r.startsWith('feature still off:')), 'only the feature gate blocks');
});

test('disclosure pages down -> blocked, whatever the features', async () => {
  assert.equal((await deployAllowed({ fetchImpl: down, features: [] })).ok, false);
});

test('positive control: pages answer 200 and no feature is off -> allowed', async () => {
  assert.deepEqual(await deployAllowed({ fetchImpl: ok200, features: [] }), { ok: true, reasons: [] });
  assert.deepEqual(disclosurePages(), ['https://disclosures.awai.network/network.awai.itonami.marketweb/foreign-info.html']);
});

test('the list matches the code', async () => {
  const ids = (await disabledFeatures()).map((f) => f.id);
  assert.equal(ids.includes('cid-open'), undecidedServices().includes('yataverse'));
  assert.equal(ids.includes('json-save'), /ui\.save\.disabled = true;/.test(guest));
  for (const id of ids) assert.ok(['json-save', 'cid-open'].includes(id), id);
});

test('CI runs the deploy gate before the Pages upload', async () => {
  const wf = await readFile(new URL('../.github/workflows/market-data-pages.yml', import.meta.url), 'utf8');
  const gate = wf.indexOf('node market-data/deploy-gate.mjs');
  assert.ok(gate > 0 && gate < wf.indexOf('upload-pages-artifact'));
});
