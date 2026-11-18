export const MAX_BYTES = 256 * 1024;
export const ASSETS = Object.freeze({
  bitcoin: Object.freeze({ name: 'Bitcoin', symbol: 'BTC', color: 'amber' }),
  ethereum: Object.freeze({ name: 'Ethereum', symbol: 'ETH', color: 'blue' }),
  solana: Object.freeze({ name: 'Solana', symbol: 'SOL', color: 'violet' }),
});
export const IDS = Object.keys(ASSETS);
export const PROVIDER = 'https://api.coingecko.com';
export const GATEWAY = 'https://yataverse.com';
export const QUOTES_PATH = '/api/v3/coins/markets';
export const QUOTES_QUERY = { vs_currency: 'usd', ids: IDS.join(',') };
export const HISTORY_QUERY = { vs_currency: 'usd', days: '30', interval: 'daily' };
export const historyPath = (id) => `/api/v3/coins/${id}/market_chart`;
export const sourceURL = (path, query) => `${PROVIDER}${path}?${new URLSearchParams(query)}`;

const SCHEMA = 'itonami.market-snapshot.v1';
const value = (number) => number === null || (Number.isFinite(number) && number >= 0);
const iso = (time) => typeof time === 'string' && Number.isFinite(Date.parse(time))
  && new Date(time).toISOString() === time;
function sourceTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('出典の観測時刻が正しくありません。');
  }
  return new Date(value).toISOString();
}

export function validateSnapshot({ schema, currency, provider, quoteFetchedAt, assets }) {
  if (schema !== SCHEMA || currency !== 'USD' || provider !== 'CoinGecko'
      || !iso(quoteFetchedAt) || !Array.isArray(assets) || assets.length !== IDS.length) {
    throw new Error('市場スナップショットの形式に対応していません。');
  }
  const seen = new Set();
  const rows = assets.map(({ id, observedAt, price, supply, marketCap, volume24h, history }) => {
    if (!Object.hasOwn(ASSETS, id) || seen.has(id) || !iso(observedAt)
        || ![price, supply, marketCap, volume24h].every(value)) {
      throw new Error('銘柄または市場指標の形式が正しくありません。');
    }
    seen.add(id);
    if (history === null) return { id, observedAt, price, supply, marketCap, volume24h, history };
    if (!history || !iso(history.fetchedAt) || !Array.isArray(history.points)
        || history.points.length < 2 || history.points.length > 40) {
      throw new Error('価格履歴の形式が正しくありません。');
    }
    let previous = '';
    const points = history.points.map((point) => {
      if (!Array.isArray(point) || point.length !== 2 || !iso(point[0])
          || point[0] <= previous || point[0] > history.fetchedAt
          || point[1] === null || !value(point[1])) {
        throw new Error('価格履歴の日時または価格が正しくありません。');
      }
      previous = point[0];
      return [point[0], point[1]];
    });
    return { id, observedAt, price, supply, marketCap, volume24h, history: { fetchedAt: history.fetchedAt, points } };
  });
  rows.sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1) || IDS.indexOf(a.id) - IDS.indexOf(b.id));
  return { schema, currency, provider, quoteFetchedAt, assets: rows };
}

export function snapshotFromQuotes(rows, fetchedAt) {
  if (!Array.isArray(rows)) throw new Error('市場データの応答形式が正しくありません。');
  const assets = rows.map((row) => ({
    id: row.id,
    observedAt: sourceTime(row.last_updated),
    price: row.current_price,
    supply: row.circulating_supply,
    marketCap: row.market_cap,
    volume24h: row.total_volume,
    history: null,
  }));
  return validateSnapshot({ schema: SCHEMA, currency: 'USD', provider: 'CoinGecko', quoteFetchedAt: fetchedAt, assets });
}

export function withHistory(snapshot, id, response, fetchedAt) {
  if (!Object.hasOwn(ASSETS, id) || !Array.isArray(response.prices)) {
    throw new Error('価格履歴の応答形式が正しくありません。');
  }
  const points = response.prices.map((point) => {
    if (!Array.isArray(point) || point.length !== 2 || !Number.isSafeInteger(point[0]) || point[0] <= 0) {
      throw new Error('出典の価格履歴の時刻が正しくありません。');
    }
    return [new Date(point[0]).toISOString(), point[1]];
  });
  const assets = snapshot.assets.map((row) => row.id === id ? { ...row, history: { fetchedAt, points } } : row);
  return validateSnapshot({ ...snapshot, assets });
}

export function decodeSnapshot(bytes) {
  if (bytes.byteLength > MAX_BYTES) throw new Error('スナップショットは最大 256 KiB です。');
  return validateSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

export function encodeSnapshot(snapshot) {
  return new TextEncoder().encode(JSON.stringify(validateSnapshot(snapshot)) + '\n');
}

// Multibase base32 CIDv1 carrying raw bytes and a sha2-256 multihash.
export const RAW_CID = /^bafkrei[a-h][a-z2-7]{50}[aeimquy4]$/;
export async function snapshotCID(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let buffer = 0;
  let output = 'b';
  for (const byte of [0x01, 0x55, 0x12, 0x20, ...digest]) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

export async function verifySnapshot(bytes, expectedCID) {
  if (!RAW_CID.test(expectedCID) || bytes.byteLength > MAX_BYTES || await snapshotCID(bytes) !== expectedCID) {
    throw new Error('受信データが指定の CID と一致しません。');
  }
  return decodeSnapshot(bytes);
}

export async function readBoundedResponse(response) {
  if (!response.ok || !response.body) throw new Error(`データを取得できませんでした (HTTP ${response.status})。`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error('応答は最大 256 KiB です。');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
