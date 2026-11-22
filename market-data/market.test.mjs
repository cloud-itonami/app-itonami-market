import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { capabilities, candidates, descriptor } from './descriptor.mjs';

const { quotes, history, snapshot } = candidates;
import {
  DEMO_PROVIDER, GATEWAY, MAX_BYTES, RAW_CID, PROVIDER, QUOTES_PATH, QUOTES_QUERY, HISTORY_QUERY, historyPath,
  encodeSnapshot, snapshotCID, snapshotFromQuotes, sourceURL, verifySnapshot, withHistory, readBoundedResponse,
} from './market.mjs';

const asOf = '2026-11-18T10:00:00.000Z';
const rows = ['bitcoin', 'ethereum', 'solana'].map((id, index) => ({
  id, last_updated: asOf, current_price: 5 + index, market_cap: 500 * index || null,
  circulating_supply: 100, total_volume: 33,
}));
const model = () => snapshotFromQuotes(rows, asOf);

test('normalizes known assets and preserves missing market cap behind measured values', () => {
  assert.deepEqual(model().assets.map(({ id, marketCap }) => [id, marketCap]),
    [['solana', 1000], ['ethereum', 500], ['bitcoin', null]]);
  const bad = structuredClone(rows);
  bad[0].last_updated = null;
  assert.throws(() => snapshotFromQuotes(bad, asOf), /観測時刻/);
});

test('keeps history tied to its asset and rejects invalid or duplicate points', () => {
  const prices = [[Date.parse(asOf) - 86_400_000, 4], [Date.parse(asOf), 5]];
  const data = withHistory(model(), 'bitcoin', { prices }, asOf);
  assert.equal(data.assets.find(({ id }) => id === 'bitcoin').history.points.length, 2);
  assert.equal(data.assets.find(({ id }) => id === 'ethereum').history, null);
  assert.throws(() => withHistory(model(), 'bitcoin', { prices: [prices[0], prices[0]] }, asOf), /日時/);
  assert.throws(() => withHistory(model(), 'bitcoin', { prices: [[null, 4], prices[1]] }, asOf), /時刻/);
});

test('verifies the Yataverse raw CID and rejects tampered bytes and noncanonical CID spelling', async () => {
  assert.equal(await snapshotCID(new Uint8Array()), 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku');
  const bytes = encodeSnapshot(model());
  const cid = await snapshotCID(bytes);
  assert.match(cid, RAW_CID);
  assert.deepEqual(await verifySnapshot(bytes, cid), model());
  await assert.rejects(() => verifySnapshot(bytes, cid.slice(0, -1) + 'b'), /CID/);
  bytes[0] ^= 1;
  await assert.rejects(() => verifySnapshot(bytes, cid), /CID/);
});

test('enforces response byte and status bounds', async () => {
  assert.equal((await readBoundedResponse(new Response(new Uint8Array(MAX_BYTES)))).length, MAX_BYTES);
  await assert.rejects(() => readBoundedResponse(new Response(new Uint8Array(MAX_BYTES + 1))), /256 KiB/);
  await assert.rejects(() => readBoundedResponse(new Response('', { status: 404 })), /404/);
});

test('the canonical runtime validates approved routes and derives the exact external CSP', async () => {
  const bytes = await readFile(new URL('dist/kotoba-client-runtime.js', import.meta.url));
  const { clientEndpointAllowsRequest, clientRuntimeConnectSrc } = await import(`data:text/javascript;base64,${bytes.toString('base64')}`);
  // Yataverse is not declared until its recipient is confirmed (disclosures.mjs).
  assert.equal(clientRuntimeConnectSrc(descriptor, capabilities), `connect-src ${PROVIDER}`);
  assert(clientEndpointAllowsRequest(quotes.endpoint, sourceURL(QUOTES_PATH, QUOTES_QUERY)));
  assert(!clientEndpointAllowsRequest(quotes.endpoint, sourceURL(QUOTES_PATH, { ...QUOTES_QUERY, vs_currency: 'eur' })));
  assert(!clientEndpointAllowsRequest(quotes.endpoint, sourceURL(QUOTES_PATH, QUOTES_QUERY), 'POST'));
  assert(clientEndpointAllowsRequest(history.endpoint, sourceURL(historyPath('bitcoin'), HISTORY_QUERY)));
  assert(!clientEndpointAllowsRequest(history.endpoint, sourceURL(historyPath('other'), HISTORY_QUERY)));
  assert(!clientEndpointAllowsRequest(snapshot.endpoint, `${GATEWAY}/ipfs/anything?format=car`));
  assert(!clientEndpointAllowsRequest(snapshot.endpoint, `${GATEWAY}/other?format=raw`));
});

test('public sample CID is computed from a synthetic snapshot with history for every asset', async () => {
  const sample = await readFile(new URL('sample-snapshot.json', import.meta.url));
  const sampleCID = await snapshotCID(sample);
  const { default: host } = await import('./dist/host-data.js');
  assert(host.guest.includes(JSON.stringify(sampleCID)), 'the guest carries the sample CID');
  const decoded = await verifySnapshot(sample, sampleCID);
  assert.equal(decoded.provider, DEMO_PROVIDER);
  assert(decoded.assets.every(({ history }) => history?.points.length === 30));
});
