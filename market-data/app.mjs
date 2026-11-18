import { createClientConsentHost, createClientOperationBroker } from './kotoba-client-runtime.js';
import { descriptor, capabilities, quotes, history, snapshot } from './descriptor.mjs';
import {
  ASSETS, GATEWAY, QUOTES_PATH, QUOTES_QUERY, HISTORY_QUERY, MAX_BYTES, RAW_CID,
  decodeSnapshot, encodeSnapshot, historyPath, readBoundedResponse, snapshotCID, snapshotFromQuotes,
  sourceURL, verifySnapshot, withHistory,
} from './market.mjs';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id, element]));
const hostSupportedOperations = descriptor.operations.map(({ capability, service, operation }) => [capability, service, operation]);
const broker = createClientOperationBroker({
  runtime: descriptor,
  requestedCapabilities: capabilities,
  hostSupportedOperations,
  // Eligibility ceiling in the shared API. Each invocation still requires a trusted, fresh choice.
  approvedOperations: descriptor.operations,
  consentHost: createClientConsentHost(),
});

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
  for (const control of [ui.refresh, ui.load, ui.file]) control.disabled = busy;
  for (const control of [ui.history, ui.save]) control.disabled = busy || !data;
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
  ui['quote-context'].replaceChildren(
    document.createTextNode(`時価総額順 · USD · 取得 ${timeLabel(data.quoteFetchedAt)} · `),
    sourceLink(sourceURL(QUOTES_PATH, QUOTES_QUERY)),
  );
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
  ui['history-empty'].textContent = data ? 'この銘柄の価格履歴を取得できます。' : '市場データの取得後、銘柄の価格履歴を取得できます。';
  if (!series) return;
  ui['history-context'].append(
    document.createTextNode(` · 取得 ${timeLabel(series.fetchedAt)} · `),
    sourceLink(sourceURL(historyPath(id), HISTORY_QUERY)),
  );
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
  ui.status.textContent = '処理中…';
  try {
    ui.status.textContent = await task();
  } catch (error) {
    const message = error.message === 'client operation was not approved'
      ? '取得を取り消しました。'
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
    const response = await broker.invoke(operation, { input }, { signal: abort.signal });
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
  for (const asset of next.assets) asset.history = data?.assets.find(({ id }) => id === asset.id)?.history ?? null;
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
ui['cid-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    const cid = ui.cid.value.trim();
    if (!RAW_CID.test(cid)) throw new Error('CIDv1 raw / sha2-256 の正規表記を入力してください。');
    const bytes = await fetchBytes(snapshot, `${GATEWAY}/ipfs/${cid}?format=raw`);
    show(await verifySnapshot(bytes, cid), { cid, bytes, label: 'Yataverse から取得・CID 検証済み' });
    return 'スナップショットを開きました。出典と日時はファイル内の記録です。';
  });
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
ui.save.addEventListener('click', () => run(async () => {
  const bytes = openedBlock?.bytes ?? encodeSnapshot(data);
  const cid = openedBlock?.cid ?? await snapshotCID(bytes);
  const href = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const link = element('a');
  link.href = href;
  link.download = `market-${cid}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  ui.digest.textContent = `保存対象の CID · ${cid}`;
  ui.digest.hidden = false;
  return 'スナップショットのダウンロードを開始しました。';
}));
new ResizeObserver(drawChart).observe(ui.graph);
controls();
ui.status.textContent = '市場データの取得またはスナップショットの読み込みを選んでください。';
