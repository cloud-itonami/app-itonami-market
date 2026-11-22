// The pages this app links to (KOTOBA-159 B4). Every link is a fixed URL: the CoinGecko credit, the
// CoinGecko source records (fixed paths and fixed query values, no user input or identifier), and
// the Market-android web app. Legal (2026-11-22): a link the user opens needs only this
// declaration, provided it carries no user input, the host shows where it goes before opening, and
// only a real click opens it. Until the canonical runtime has that host hand-off (KOTOBA-968), the
// sandboxed guest does not open links: it shows the address instead.
import { HISTORY_QUERY, IDS, QUOTES_PATH, QUOTES_QUERY, historyPath, sourceURL } from './market.mjs';

export const LINK_ORIGINS = Object.freeze(['https://www.coingecko.com', 'https://api.coingecko.com', 'https://cloud-itonami.github.io']);
export const MARKET_ANDROID_URL = 'https://cloud-itonami.github.io/app-itonami-market-android/';
export const CREDIT_URL = 'https://www.coingecko.com/en/api';
export const FIXED_LINKS = Object.freeze([CREDIT_URL, MARKET_ANDROID_URL, sourceURL(QUOTES_PATH, QUOTES_QUERY),
  ...IDS.map((id) => sourceURL(historyPath(id), HISTORY_QUERY))]);

export function linkAllowed(href) {
  let url;
  try { url = new URL(href); } catch { return false; }
  return url.protocol === 'https:' && LINK_ORIGINS.includes(url.origin) && FIXED_LINKS.includes(url.href);
}
