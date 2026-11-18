import { GATEWAY, PROVIDER, IDS, QUOTES_PATH, QUOTES_QUERY, HISTORY_QUERY, historyPath } from './market.mjs';

const route = (path, query) => ({
  method: 'GET', path, 'query-params': Object.keys(query), 'query-values': query,
});
const operation = (capability, service, name, origin, routes, categories) => ({
  capability, service, operation: name, endpoint: { origin, routes },
  'data-categories': categories, consent: 'each-operation',
});

export const quotes = operation('market/quotes', 'coingecko', 'read-usd-quotes', PROVIDER,
  [route(QUOTES_PATH, QUOTES_QUERY)], ['public-market-asset-ids', 'network-address']);
export const history = operation('market/history', 'coingecko', 'read-usd-price-history', PROVIDER,
  IDS.map((id) => route(historyPath(id), HISTORY_QUERY)), ['public-market-asset-id', 'network-address']);
export const snapshot = operation('market/snapshot', 'yataverse', 'read-market-snapshot', GATEWAY,
  [{ method: 'GET', 'path-prefix': '/ipfs/', 'query-params': ['format'], 'query-values': { format: 'raw' } }],
  ['public-snapshot-cid', 'network-address']);

export const descriptor = {
  schema: 'kotoba.app.client-runtime.v1',
  target: 'browser',
  profile: 'trusted-page-v1',
  entry: 'index.html',
  'local-state': { adapter: 'memory', schema: 'itonami.market-snapshot.v1', version: 1 },
  workers: [],
  operations: [quotes, history, snapshot],
};
export const capabilities = descriptor.operations.map(({ capability }) => capability);
