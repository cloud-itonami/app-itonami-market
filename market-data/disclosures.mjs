// What the canonical consent dialog tells the user before each send (KOTOBA-159 finding 9). A
// service whose recipient is not confirmed stays `null`, and descriptor.mjs leaves its operations
// out of the descriptor (the broker has nothing to invoke, so nothing is sent).
//
// Legal 2026-11-22 (AWAI-3828, wt/itonami/k159-rw/disclosures-draft.md): Gecko Labs Pte. Ltd. (SG)
// for CoinGecko, declared on the record of the Internet Archive copies of its terms (Latest Version
// 12 August 2025) and privacy policy (31 July 2026); coingecko.com refused automated fetching (403).
// The yataverse.com operator is not confirmed yet (Itonami item 68).

export const WITHDRAWAL_PLACE = '設定 › 許可した送信';
// Disclosure pages live in one place, under an id per app (Decision 2026-11-22). This web-only app
// has no Tauri identifier; Itonami chose this id of the same reverse-domain form.
export const APP_ID = 'network.awai.itonami.marketweb';
export const DISCLOSURES_BASE = 'https://disclosures.awai.network/';
export const FOREIGN_INFO_URL = `${DISCLOSURES_BASE}${APP_ID}/foreign-info.html`;

const IP = '端末の IP アドレス';
const TIME = '送信の時刻';
const BROWSER = 'ブラウザの種類と版';
const common = { 'special-care': false, frequency: 'one-time', withdrawal: WITHDRAWAL_PLACE };

export const DISCLOSURES = Object.freeze({
  coingecko: Object.freeze({
    ...common, recipient: 'Gecko Labs Pte. Ltd.', country: 'SG', 'country-name': 'シンガポール',
    'foreign-info-url': FOREIGN_INFO_URL + '#sg',
    data: ['調べる銘柄の名前と通貨（固定）', IP, TIME, BROWSER],
    purpose: '暗号資産の米ドル建ての価格と、30 日の価格の推移を CoinGecko から取得するため',
  }),
  yataverse: null,
});

export const UNDECIDED = Object.freeze({
  yataverse: 'operator of the yataverse.com gateway (legal entity and country) not confirmed; the owner is confirming it (Itonami item 68)',
});
