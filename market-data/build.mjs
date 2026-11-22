// Static build for restricted-wasm-v1 (KOTOBA-159). dist/index.html is the trusted host page
// (host.html, host.mjs) with the canonical runtime. The app itself is one self-contained guest
// document (guest.html with its modules inlined by guest-bundle.mjs and style.css inline), pinned
// by SHA-256 and the source commit in dist/host-data.js. The host verifies it with
// verifyClientArtifact and mounts it with mountRestrictedClientApp in an opaque-origin sandbox. The
// page policy admits exactly the runtime's guest preamble, the guest script and the guest style, by
// hash. The canonical runtime is fetched at a pinned commit and refused unless its SHA-256 matches.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { bundleModules, readModules } from './guest-bundle.mjs';

export const RUNTIME_REVISION = 'e58ae70b4bdc818b3feec767f7ac9908cd6e7a2c';
export const RUNTIME_SOURCE = `https://raw.githubusercontent.com/kotoba-lang/kotoba/${RUNTIME_REVISION}/lib/kotoba.wasmWebcomponent/src/`;
export const RUNTIME_PINS = Object.freeze({
  'kotoba-client-runtime.js': '37e826338686eefbb2b9c7a731b73c53f7f5d6864158c0790edad60f25682d6d',
  'kotoba-client-consent.css': 'c76ed61a1a59cc1d84f9ec19afd9f49562df6c28a4c6078ccfb7dec8f34240bb',
});
const GUEST_MODULES = ['guest.mjs', 'market.mjs', 'links.mjs', 'guest-port.js', 'guest-form.js'];
const HOST_FILES = ['host.mjs', 'host.css', 'allowed-sending.mjs'];

const here = new URL('./', import.meta.url);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cspHash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const read = (file) => readFile(new URL(file, here), 'utf8');

function sourceState(env) {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: here, encoding: 'utf8' }).trim() !== '';
    return { commit, dirty };
  } catch {
    return { commit: env.ITONAMI_SOURCE_COMMIT ?? null, dirty: env.ITONAMI_SOURCE_DIRTY === 'true' };
  }
}

async function fetchRuntime() {
  const files = {};
  for (const [file, expected] of Object.entries(RUNTIME_PINS)) {
    const response = await fetch(RUNTIME_SOURCE + file, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Cannot retrieve canonical Kotoba runtime: ${file} (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha256(bytes) !== expected) throw new Error(`Canonical Kotoba digest mismatch: ${file}`);
    files[file] = bytes;
  }
  return files;
}

export async function build({ env = process.env, out = new URL('./dist/', import.meta.url) } = {}) {
  const files = await fetchRuntime();
  const runtimeText = new TextDecoder().decode(files['kotoba-client-runtime.js']);
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(files['kotoba-client-runtime.js']).toString('base64')}`);
  const preamble = /^const GUEST_PREAMBLE = '<script>([^'\\]*)<\/script>';$/m.exec(runtimeText)?.[1];
  if (!preamble) throw new Error('the canonical runtime has no GUEST_PREAMBLE this build can hash');

  const { decodeSnapshot, snapshotCID, DEMO_PROVIDER } = await import('./market.mjs');
  const sampleBytes = await readFile(new URL('sample-snapshot.json', import.meta.url));
  if (decodeSnapshot(sampleBytes).provider !== DEMO_PROVIDER) throw new Error('Public test snapshot must be synthetic');
  const { descriptor, capabilities, declared } = await import('./descriptor.mjs');
  const { FOREIGN_INFO_URL } = await import('./disclosures.mjs');
  const problems = runtime.clientRuntimeProblems(descriptor, capabilities, 'https://cloud-itonami.github.io');
  if (problems.length) throw new Error(`invalid descriptor: ${JSON.stringify(problems)}`);
  const connectSrc = runtime.clientRuntimeConnectSrc(descriptor, capabilities);

  const state = sourceState(env);
  if (!state.commit || !/^[0-9a-f]{40}$/.test(state.commit)) throw new Error('restricted-wasm-v1 pins the guest to its source commit: build from a git checkout or set ITONAMI_SOURCE_COMMIT');

  const modules = await readModules(new URL('.', here).pathname, GUEST_MODULES);
  modules['sample-cid.mjs'] = `export const sampleCID = ${JSON.stringify(await snapshotCID(sampleBytes))};\n`;
  const selectors = Object.fromEntries(Object.entries(declared()).map(([name, op]) =>
    [name, op ? { capability: op.capability, service: op.service, operation: op.operation } : null]));
  modules['operations.mjs'] = `export default ${JSON.stringify(selectors)};\n`;
  const script = bundleModules(modules, 'guest.mjs');
  const style = await read('style.css');
  if (/<\/style/i.test(style)) throw new Error('style.css contains </style');
  const template = await read('guest.html');
  for (const marker of ['{{STYLE}}', '{{SCRIPT}}']) if (template.split(marker).length !== 2) throw new Error(`guest.html must contain ${marker} once`);
  const guest = template.replace('{{STYLE}}', () => style).replace('{{SCRIPT}}', () => script);
  if (guest.length > 8388608) throw new Error('the guest exceeds the 8 MiB mount budget');
  const guestBytes = new TextEncoder().encode(guest);
  const artifact = { revision: state.commit, sha256: sha256(guestBytes), 'max-bytes': guestBytes.byteLength };

  const csp = `default-src 'none'; script-src 'self' ${cspHash(preamble)} ${cspHash(script)}; style-src 'self' ${cspHash(style)}; base-uri 'none'; form-action 'none'; ${connectSrc}`;
  const host = await read('host.html');
  if (host.split('@CSP@').length !== 2) throw new Error('host.html has no CSP build marker');
  files['index.html'] = host.replace('@CSP@', () => csp);
  for (const file of HOST_FILES) files[file] = await read(file);
  files['host-data.js'] = `export default ${JSON.stringify({ descriptor, artifact, guest, foreignInfo: FOREIGN_INFO_URL }, null, 1)};\n`;
  files['descriptor.json'] = JSON.stringify(descriptor, null, 2) + '\n';
  const digests = Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, sha256(bytes)]));
  const { LINK_ORIGINS } = await import('./links.mjs');
  files['release.json'] = JSON.stringify({
    schema: 'awai.app.artifact.v1', id: 'itonami-market-data', version: '0.1.0', profile: descriptor.profile,
    canonicalRuntime: { revision: RUNTIME_REVISION, source: RUNTIME_SOURCE, files: RUNTIME_PINS }, links: LINK_ORIGINS,
    guest: artifact, source_commit: state.commit, dirty: state.dirty, files: digests,
  }, null, 2) + '\n';
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await Promise.all(Object.entries(files).map(([file, bytes]) => writeFile(new URL(file, out), bytes)));
  return { out, files, descriptor, artifact, csp, guest, script, style, preamble };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { out, artifact } = await build();
  console.log(`Static artifact: ${out.pathname} (guest ${artifact['max-bytes']} bytes)`);
}
