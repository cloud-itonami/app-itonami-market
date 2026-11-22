// restricted-wasm-v1 guest (KOTOBA-159). The host page mounts this document with
// mountRestrictedClientApp in an opaque-origin sandbox (iframe sandbox="allow-scripts",
// connect-src 'none'): no network, no storage, no downloads and no parent DOM. Each fetch is one
// kotoba.client.operation.v1 message on the host port (guest-port.js); the canonical broker on the
// host page checks it against the descriptor, asks the user and sends it. build.mjs inlines the
// modules into one script (guest-bundle.mjs); an operation that is not declared arrives as null.
import { sampleCID } from './sample-cid.mjs';
import operations from './operations.mjs';
import { createGuestPort } from './guest-port.js';
import { bindForm } from './guest-form.js';
import { linkAllowed } from './links.mjs';
import { ASSETS, DEMO_PROVIDER, GATEWAY, QUOTES_PATH, QUOTES_QUERY, HISTORY_QUERY, MAX_BYTES, RAW_CID, decodeSnapshot, encodeSnapshot, historyPath, readBoundedResponse, snapshotCID, snapshotFromQuotes, sourceURL, verifySnapshot, withHistory } from './market.mjs';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id, element]));
const { quotes, history, snapshot } = operations;
const port = createGuestPort();

const money = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'USD', maximumFractionDigits: 8 });
const usdWhole = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const quantity = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });
const chartNumber = new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumSignificantDigits: 4 });
const clock = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' });
const day = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const timeLabel = (instant) => `${clock.format(new Date(instant))} UTC`;
const now = () => new Date().toISOString();
const display = (formatter, value) => value === null ? '不明' : formatter.format(value);

let data = null;
let openedBlock = null;
let busy = false;

function element(tag, content) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  return node;
}
function sourceLink(url, label = '出典データ') {
  const node = element('a', label);
  node.href = url;
  node.rel = 'noreferrer';
  return node;
}
function controls() {
  ui.refresh.disabled = busy || !quotes;
  ui.file.disabled = busy;
  // The Yataverse recipient is not confirmed, so the snapshot read is not declared (null).
  for (const control of [ui.load, ui.example, ui.cid]) control.disabled = busy || !snapshot;
  // The sandbox cannot hand a file to the user until the runtime's save hand-off (KOTOBA-968, B3).
  ui.save.disabled = true;
  ui.history.disabled = busy || !history || !data || data.provider === DEMO_PROVIDER;
}

function renderQuotes() {
  const rows = data.assets.map((quote) => {
    const { name, symbol, color } = ASSETS[quote.id];
    const row = element('tr');
    const header = element('th');
    header.scope = 'row';
    const title = element('span');
    title.className = 'asset-title';
    const badge = element('span', symbol);
    badge.className = `asset-symbol ${color}`;
    title.append(badge, document.createTextNode(name));
    header.append(title);
    row.append(header,
      element('td', display(money, quote.price)), element('td', display(usdWhole, quote.marketCap)),
      element('td', display(usdWhole, quote.volume24h)), element('td', display(quantity, quote.supply)),
      element('td', timeLabel(quote.observedAt)));
    return row;
  });
  ui.quotes.replaceChildren(...rows);
  const synthetic = data.provider === DEMO_PROVIDER;
  ui['market-credit'].hidden = synthetic;
  ui['quote-context'].textContent = synthetic
    ? '動作確認用サンプル · 架空の数値 · USD'
    : `時価総額順 · USD · 取得 ${timeLabel(data.quoteFetchedAt)}`;
  if (!synthetic) ui['quote-context'].append(' · ', sourceLink(sourceURL(QUOTES_PATH, QUOTES_QUERY)));
}

function selectedHistory() {
  return data?.assets.find(({ id }) => id === ui.asset.value)?.history;
}

function drawChart() {
  const series = selectedHistory();
  if (!series) return;
  const canvas = ui.graph;
  const { width, height } = canvas.getBoundingClientRect();
  if (width < 120 || height < 80) return;
  const ratio = Math.min(devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  ctx.font = '12px system-ui';
  const prices = series.points.map(([, price]) => price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const labels = Array.from({ length: 5 }, (_, index) => chartNumber.format(low + (high - low) * (1 - index / 4)));
  const left = Math.max(...labels.map((label) => ctx.measureText(label).width)) + 12;
  const right = width - 8;
  const top = 14;
  const bottom = height - 25;
  const start = Date.parse(series.points[0][0]);
  const end = Date.parse(series.points.at(-1)[0]);
  const x = (time) => left + ((Date.parse(time) - start) / (end - start)) * (right - left);
  const y = (price) => bottom - (high === low ? .5 : (price - low) / (high - low)) * (bottom - top);
  ctx.fillStyle = '#4b6075';
  labels.forEach((label, index) => {
    if (high === low && index !== 2) return;
    const lineY = top + (bottom - top) * index / 4;
    ctx.strokeStyle = '#dce4ec';
    ctx.beginPath();
    ctx.moveTo(left, lineY);
    ctx.lineTo(right, lineY);
    ctx.stroke();
    ctx.fillText(label, 0, lineY + 4);
  });
  ctx.fillText(day.format(start), left, height - 5);
  const lastDay = day.format(end);
  ctx.fillText(lastDay, right - ctx.measureText(lastDay).width, height - 5);
  ctx.strokeStyle = '#076853';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x(series.points[0][0]), y(prices[0]));
  for (const [time, price] of series.points.slice(1)) ctx.lineTo(x(time), y(price));
  ctx.stroke();
}

function renderHistory() {
  const id = ui.asset.value;
  const series = selectedHistory();
  ui['history-data'].hidden = !series;
  ui['history-empty'].hidden = Boolean(series);
  ui['history-context'].textContent = `${ASSETS[id].name} · 過去 30 日 · USD`;
  ui['history-empty'].textContent = '市場データの取得後、銘柄の価格履歴を取得できます。';
  if (data) {
    ui['history-empty'].textContent = data.provider === DEMO_PROVIDER
      ? 'このサンプルには価格履歴がありません。' : 'この銘柄の価格履歴を取得できます。';
  }
  if (!series) return;
  if (data.provider === DEMO_PROVIDER) {
    ui['history-context'].append(' · 動作確認用サンプル');
  } else {
    ui['history-context'].append(` · 取得 ${timeLabel(series.fetchedAt)} · `, sourceLink(sourceURL(historyPath(id), HISTORY_QUERY)));
  }
  ui.points.replaceChildren(...series.points.toReversed().map(([time, price]) => {
    const row = element('tr');
    const header = element('th', timeLabel(time));
    header.scope = 'row';
    row.append(header, element('td', money.format(price)));
    return row;
  }));
  drawChart();
}

function show(next, block = null) {
  data = next;
  openedBlock = block;
  ui.digest.hidden = !block;
  ui.digest.textContent = block ? `${block.label} · ${block.cid}` : '';
  renderQuotes();
  renderHistory();
}
async function run(task) {
  if (busy) return;
  busy = true;
  controls();
  try {
    ui.status.textContent = await task();
  } catch (error) {
    const message = error.message === 'client operation was not approved' ? '取得を取り消しました。'
      : error.message === 'client operation is not eligible and supported' ? 'この送信は 設定 › 許可した送信 で取り消されています。'
        : `処理できませんでした。 ${error.message}`;
    ui.status.textContent = data ? `${message} 表示中のデータは前回取得分です。` : message;
  } finally {
    busy = false;
    controls();
  }
}
async function fetchBytes(operation, input) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 120_000);
  try {
    const response = await port.invoke(operation, { input }, { signal: abort.signal });
    return await readBoundedResponse(response);
  } finally {
    clearTimeout(timer);
  }
}
async function fetchJSON(operation, url) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await fetchBytes(operation, url)));
}
ui.refresh.addEventListener('click', () => run(async () => {
  const raw = await fetchJSON(quotes, sourceURL(QUOTES_PATH, QUOTES_QUERY));
  const next = snapshotFromQuotes(raw, now());
  // Retain history already retrieved in this view. Its source timestamp stays independent.
  if (data?.provider === next.provider) {
    for (const asset of next.assets) asset.history = data.assets.find(({ id }) => id === asset.id)?.history ?? null;
  }
  show(next);
  return 'CoinGecko から市場データを取得しました。';
}));
ui.asset.addEventListener('change', renderHistory);
ui.history.addEventListener('click', () => run(async () => {
  const id = ui.asset.value;
  const raw = await fetchJSON(history, sourceURL(historyPath(id), HISTORY_QUERY));
  show(withHistory(data, id, raw, now()));
  return `${ASSETS[id].name} の価格履歴を取得しました。`;
}));
function openCID(cid) {
  run(async () => {
    if (!RAW_CID.test(cid)) throw new Error('CIDv1 raw / sha2-256 の正規表記を入力してください。');
    const bytes = await fetchBytes(snapshot, `${GATEWAY}/ipfs/${cid}?format=raw`);
    show(await verifySnapshot(bytes, cid), { cid, bytes, label: 'Yataverse から取得・CID 検証済み' });
    return 'スナップショットを開きました。出典と日時はファイル内の記録です。';
  });
}
// The sandbox has no allow-forms (B5): the button and Enter call one handler (guest-form.js).
bindForm(ui['cid-form'], () => { if (snapshot) openCID(ui.cid.value.trim()); });
ui.example.addEventListener('click', () => {
  ui.cid.value = sampleCID;
  openCID(sampleCID);
});
ui.file.addEventListener('change', () => {
  const file = ui.file.files[0];
  ui.file.value = '';
  if (!file) return;
  run(async () => {
    if (file.size > MAX_BYTES) throw new Error('スナップショットは最大 256 KiB です。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const next = decodeSnapshot(bytes);
    const cid = await snapshotCID(bytes);
    show(next, { cid, bytes, label: 'ローカルファイルの CID' });
    return 'ファイルを開きました。出典と日時はファイル内の記録です。';
  });
});
// B3: there is no way to hand a file to the user from the sandbox yet (KOTOBA-968). The button
// stays disabled and says why; encodeSnapshot and the CID are kept for the save hand-off.
ui.save.title = '保存は、runtime の書き出しの口ができるまで使えません。';
void encodeSnapshot;

// The sandbox cannot open another page (a link would replace this document, and the host then
// closes the app). Declared fixed links show their address instead (links.mjs).
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!link || link.getAttribute('href').startsWith('#')) return;
  event.preventDefault();
  if (!linkAllowed(link.href)) { ui.status.textContent = 'このリンクの行き先は宣言されていません。'; return; }
  const address = document.createElement('code');
  address.textContent = link.href;
  ui['link-note'].replaceChildren('この画面からは外部のページを開けません。アドレス: ', address);
  ui['link-note'].hidden = false;
});

new ResizeObserver(drawChart).observe(ui.graph);
controls();
ui.status.textContent = 'アプリを準備しています。';
port.ready.then(() => {
  ui.status.textContent = snapshot ? '市場データの取得またはスナップショットの読み込みを選んでください。'
    : '市場データを CoinGecko から取得できます。Yataverse の送り先が確定していないため、CID でのスナップショットの取得は無効です。JSON ファイルは開けます。';
});
