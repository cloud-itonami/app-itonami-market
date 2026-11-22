// Deploy gate (Decision 2026-11-22): Market is not deployed while a feature that worked before the
// restricted-wasm-v1 move is still off. disabled-features.json lists them; this exits non-zero while
// the list is not empty. When a feature works again, remove its entry (test/feature-parity tests
// that the list matches the code).
import { readFile } from 'node:fs/promises';

export async function disabledFeatures() {
  const data = JSON.parse(await readFile(new URL('disabled-features.json', import.meta.url), 'utf8'));
  if (data.schema !== 'itonami.disabled-features.v1' || !Array.isArray(data.features)) throw new Error('disabled-features.json: unexpected shape');
  for (const f of data.features) if (typeof f.id !== 'string' || typeof f.label !== 'string' || typeof f.reason !== 'string') throw new Error('disabled-features.json: each feature needs id, label and reason');
  return data.features;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const features = await disabledFeatures();
  if (features.length) {
    console.error('Features that worked before the move are still off; do not deploy:\n' + features.map((f) => `- ${f.id}: ${f.label} (${f.reason})`).join('\n'));
    process.exitCode = 1;
  } else console.log('No feature is off; the feature-parity gate passes.');
}
