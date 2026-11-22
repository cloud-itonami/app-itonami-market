// restricted-wasm-v1 build (KOTOBA-159): profile, declared operations and disclosures, pinned
// runtime, host policy, guest artifact, links, forms and 設定 › 許可した送信.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, RUNTIME_PINS } from './build.mjs';
import { buildDescriptor, candidates, undecidedServices } from './descriptor.mjs';
import { DISCLOSURES, FOREIGN_INFO_URL } from './disclosures.mjs';
import { FIXED_LINKS, LINK_ORIGINS, linkAllowed } from './links.mjs';
import { createAllowedSending, memoryStorage } from './allowed-sending.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cspHash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const out = await mkdtemp(join(tmpdir(), 'market-dist-'));
const built = await build({ out: new URL(`file://${out}/`) });
const runtime = await import(`file://${out}/kotoba-client-runtime.js`);
test.after(() => rm(out, { recursive: true, force: true }));

test('the vendored runtime is byte-identical to the pinned canonical files', async () => {
  for (const [file, expected] of Object.entries(RUNTIME_PINS)) assert.equal(sha256(await readFile(join(out, file))), expected, file);
  assert.equal(RUNTIME_PINS['kotoba-client-runtime.js'], '37e826338686eefbb2b9c7a731b73c53f7f5d6864158c0790edad60f25682d6d');
});

test('restricted-wasm-v1; CoinGecko declared with its disclosure; Yataverse not declared', () => {
  const d = built.descriptor;
  assert.equal(d.profile, 'restricted-wasm-v1');
  assert.deepEqual(d.operations.map((op) => [op.service, op.operation]), [['coingecko', 'read-usd-quotes'], ['coingecko', 'read-usd-price-history']]);
  assert.deepEqual(undecidedServices(), ['yataverse']);
  assert.equal(DISCLOSURES.yataverse, null);
  const caps = d.operations.map((op) => op.capability);
  assert.deepEqual(runtime.clientRuntimeProblems(d, caps, 'https://cloud-itonami.github.io'), []);
  assert.equal(runtime.clientRuntimeConnectSrc(d, caps), 'connect-src https://api.coingecko.com');
  for (const op of d.operations) {
    const { disclosure, ...rest } = op;
    assert.deepEqual(rest, candidates[op.operation === 'read-usd-quotes' ? 'quotes' : 'history'], 'unchanged apart from the disclosure');
    assert.deepEqual(runtime.clientDisclosureProblems(disclosure), []);
    assert.equal(disclosure.recipient, 'Gecko Labs Pte. Ltd.');
    assert.equal(disclosure.country, 'SG');
    assert.equal(disclosure['foreign-info-url'], 'https://disclosures.awai.network/network.awai.itonami.marketweb/foreign-info.html#sg');
  }
  assert.equal(FOREIGN_INFO_URL, 'https://disclosures.awai.network/network.awai.itonami.marketweb/foreign-info.html');
});

test('negative controls: incomplete disclosures are refused; a confirmed Yataverse would declare the snapshot (synthetic)', () => {
  const op = built.descriptor.operations[0];
  for (const field of ['recipient', 'country', 'data', 'purpose', 'frequency', 'withdrawal', 'foreign-info-url']) {
    const { [field]: _gone, ...disclosure } = op.disclosure;
    const problems = runtime.clientRuntimeProblems({ ...built.descriptor, operations: [{ ...op, disclosure }] }, [op.capability], 'https://cloud-itonami.github.io');
    assert.ok(problems.some((p) => p.error === 'invalid-disclosure'), field);
  }
  const synthetic = { ...DISCLOSURES.coingecko, recipient: 'Synthetic Test Recipient', country: 'JP' };
  delete synthetic['country-name']; delete synthetic['foreign-info-url'];
  const d = buildDescriptor({ ...DISCLOSURES, yataverse: synthetic });
  assert.deepEqual(d.operations.map((o) => o.service), ['coingecko', 'coingecko', 'yataverse']);
});

test('the host page admits exactly the guest preamble, script and style by hash, and runs no inline script', async () => {
  const index = await readFile(join(out, 'index.html'), 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(index)[1];
  assert.equal(csp, built.csp);
  for (const text of [built.preamble, built.script]) assert.ok(csp.includes(cspHash(text)));
  assert.ok(csp.includes(`style-src 'self' ${cspHash(built.style)}`));
  assert.ok(csp.endsWith('connect-src https://api.coingecko.com'));
  for (const tag of index.matchAll(/<script\b[^>]*>/gi)) assert.match(tag[0], /src=/);
});

test('the guest is one self-contained document, pinned and verified by the canonical runtime', async () => {
  const { default: host } = await import(`file://${out}/host-data.js`);
  const release = JSON.parse(await readFile(join(out, 'release.json'), 'utf8'));
  assert.match(host.artifact.revision, /^[0-9a-f]{40}$/);
  assert.deepEqual(release.guest, host.artifact);
  assert.equal((await runtime.verifyClientArtifact(new TextEncoder().encode(host.guest), host.artifact)).verified, true);
  await assert.rejects(runtime.verifyClientArtifact(new TextEncoder().encode(host.guest.replace('営', '宮')), host.artifact), /digest mismatch/);
  const scripts = [...host.guest.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0][2], built.script);
  assert.ok(!/<link\b|<script\b[^>]*\bsrc=/i.test(host.guest));
  assert.ok(built.script.includes('"snapshot":null'), 'the snapshot read arrives as null');
  const file = join(out, 'guest-check.mjs');
  await writeFile(file, built.script);
  execFileSync(process.execPath, ['--check', file]);
});

test('links: fixed URLs on declared origins only; the guest never opens a page itself', async () => {
  assert.deepEqual(LINK_ORIGINS, ['https://www.coingecko.com', 'https://api.coingecko.com', 'https://cloud-itonami.github.io']);
  for (const url of FIXED_LINKS) assert.ok(linkAllowed(url), url);
  const html = await readFile(new URL('guest.html', import.meta.url), 'utf8');
  for (const [, href] of html.matchAll(/href="([^"#][^"]*)"/g)) assert.ok(linkAllowed(href), href);
  assert.ok(!html.includes('network-awai.github.io'), 'the old Pages URL is gone');
  for (const refused of ['https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=me', 'https://www.coingecko.com/en/api?ref=x',
    'https://example.com/', 'http://www.coingecko.com/en/api']) assert.equal(linkAllowed(refused), false, refused);
  const guest = await readFile(new URL('guest.mjs', import.meta.url), 'utf8');
  for (const [, rhs] of guest.matchAll(/\.href = ([^;]+);/g)) assert.match(rhs, /^url$/, rhs);
  assert.match(guest, /function sourceLink\(url[^)]*\)[\s\S]*?node\.href = url;/);
  for (const [, arg] of guest.matchAll(/sourceLink\(([^)]*\))\)/g)) assert.match(arg, /^sourceURL\(/, arg);
  assert.ok(!/window\.open|location\.(assign|replace|href\s*=)|\.download\s*=|createObjectURL/.test(guest), 'no navigation and no download from the guest');
});

test('forms use the shared helper, not the submit event; the shared copy is byte-identical', async () => {
  const guest = await readFile(new URL('guest.mjs', import.meta.url), 'utf8');
  assert.match(guest, /bindForm\(ui\['cid-form'\]/);
  assert.ok(!/addEventListener\('submit'/.test(guest));
  assert.equal(sha256(await readFile(new URL('guest-form.js', import.meta.url))), 'a50e711aecd9d9ad65c29d51796c0ea44295dcf749d2789d09d934fe5878595c');
});

test('設定 › 許可した送信: a withdrawn service is not eligible; restore brings it back', () => {
  const storage = memoryStorage();
  const allowed = createAllowedSending(storage);
  const ops = built.descriptor.operations;
  allowed.withdraw('coingecko');
  assert.deepEqual(allowed.eligible(ops), []);
  assert.equal(createAllowedSending(storage).isWithdrawn('coingecko'), true);
  allowed.restore('coingecko');
  assert.deepEqual(allowed.eligible(ops), ops);
});
