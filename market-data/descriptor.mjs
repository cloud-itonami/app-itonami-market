import { GATEWAY, PROVIDER, IDS, QUOTES_PATH, QUOTES_QUERY, HISTORY_QUERY, historyPath } from './market.mjs';
import { DISCLOSURES } from './disclosures.mjs';

const route = (path, query) => ({
  method: 'GET', path, 'query-params': Object.keys(query), 'query-values': query,
});
const operation = (capability, service, name, origin, routes, categories) => ({
  capability, service, operation: name, endpoint: { origin, routes },
  'data-categories': categories, consent: 'each-operation',
});

// The operations this app would use. Only those whose service has a confirmed disclosure are
// declared (disclosures.mjs); the others stay out of the descriptor and are refused.
export const candidates = Object.freeze({
  quotes: operation('market/quotes', 'coingecko', 'read-usd-quotes', PROVIDER,
    [route(QUOTES_PATH, QUOTES_QUERY)], ['public-market-asset-ids', 'network-address']),
  history: operation('market/history', 'coingecko', 'read-usd-price-history', PROVIDER,
    IDS.map((id) => route(historyPath(id), HISTORY_QUERY)), ['public-market-asset-id', 'network-address']),
  snapshot: operation('market/snapshot', 'yataverse', 'read-market-snapshot', GATEWAY,
    [{ method: 'GET', 'path-prefix': '/ipfs/', 'query-params': ['format'], 'query-values': { format: 'raw' } }],
    ['public-snapshot-cid', 'network-address']),
});

export function declared(disclosures = DISCLOSURES) {
  return Object.fromEntries(Object.entries(candidates).map(([name, op]) =>
    [name, disclosures[op.service] ? { ...op, disclosure: disclosures[op.service] } : null]));
}

export function buildDescriptor(disclosures = DISCLOSURES) {
  return {
    schema: 'kotoba.app.client-runtime.v1',
    target: 'browser',
    profile: 'restricted-wasm-v1',
    entry: 'index.html',
    'local-state': { adapter: 'memory', schema: 'itonami.market-snapshot.v1', version: 1 },
    workers: [],
    operations: Object.values(declared(disclosures)).filter(Boolean),
  };
}

export const descriptor = buildDescriptor();
export const capabilities = descriptor.operations.map(({ capability }) => capability);
export const undecidedServices = (disclosures = DISCLOSURES) =>
  [...new Set(Object.values(candidates).map(({ service }) => service))].filter((service) => !disclosures[service]);
