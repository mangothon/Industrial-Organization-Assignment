'use strict';
/* =================================================================
   산업연관표 분석 웹앱 — 화면 동작
   계산은 worker.js → model.py(Python)에서, 이 파일은 화면 표시만 담당
   ================================================================= */
const $ = (id) => document.getElementById(id);

const LEVELS = [
  { n: 33, label: '대분류', size: '0.6MB', file: './data/io-2023-33.xlsx' },
  { n: 83, label: '중분류', size: '1.2MB', file: './data/io-2023-83.xlsx' },
  { n: 165, label: '소분류', size: '3.1MB', file: './data/io-2023-165.xlsx' },
  { n: 380, label: '기본부문', size: '12MB', file: './data/io-2023-380.xlsx' },
];
const CLASS_FILE = './data/sector-classification.xlsx';

// 시트 설명: 무엇을 담고 있는지, 단위, 읽는 방향
const SHEETS = {
  'A표_총거래표(생산자)': { group: '거래표 (금액)', short: '총거래표', unit: '백만원', money: true,
    desc: '국산품과 수입품을 합친 상품별 거래 내역입니다. 산업연관표의 가장 기본이 되는 표입니다.',
    row: '이 상품이 어느 부문의 중간재로, 또 어떤 최종수요(소비·투자·수출)로 얼마나 팔렸는지 — 배분구조',
    col: '이 부문이 생산을 위해 어떤 상품을 얼마나 사들이고 부가가치를 얼마나 만들었는지 — 투입구조',
    heat: '중간거래 금액 (부문 × 부문)' },
  'A표_수입거래표(생산자)': { group: '거래표 (금액)', short: '수입거래표', unit: '백만원', money: true,
    desc: '수입품만 따로 모은 거래 내역입니다. 어떤 수입품이 어디에 쓰였는지 보여줍니다.',
    row: '이 수입 상품이 어느 부문의 중간재·최종수요로 쓰였는지',
    col: '이 부문이 생산에 투입한 수입 중간재의 구성',
    heat: '수입 중간재 거래 금액' },
  'A표_국산거래표(생산자)': { group: '거래표 (금액)', short: '국산거래표', unit: '백만원', money: true,
    desc: '국내에서 생산된 상품만의 거래 내역입니다. 국산 투입계수와 생산유발계수의 바탕이 됩니다.',
    row: '이 국산 상품이 어느 부문의 중간재·최종수요로 쓰였는지',
    col: '이 부문이 생산에 투입한 국산 중간재의 구성',
    heat: '국산 중간재 거래 금액' },
  '총투입계수(A)': { group: '투입계수 (비율)', short: '총투입계수 A', unit: '비율 · 단위 없음', money: false,
    desc: '각 부문이 1원어치를 생산할 때 투입한 상품의 금액입니다(투입액 ÷ 총투입액). 국산과 수입을 합친 값입니다.',
    row: '이 상품이 각 부문의 생산 1원에 얼마씩 투입되는지',
    col: '이 부문 생산 1원의 투입 구성 — 중간투입률 + 부가가치율 = 1',
    heat: '총투입계수' },
  '수입투입계수(Am)': { group: '투입계수 (비율)', short: '수입투입계수 Am', unit: '비율 · 단위 없음', money: false,
    desc: '수입 중간재만으로 계산한 투입계수입니다. 열합은 그 부문의 수입의존도입니다.',
    row: '이 수입 상품이 각 부문 생산 1원에 얼마씩 투입되는지',
    col: '이 부문 생산 1원에 들어간 수입 중간재의 구성',
    heat: '수입투입계수' },
  '국산투입계수(Ad)': { group: '투입계수 (비율)', short: '국산투입계수 Ad', unit: '비율 · 단위 없음', money: false,
    desc: '국산 중간재만으로 계산한 투입계수입니다. 생산유발계수 L = (I − Ad)⁻¹ 의 바탕이 됩니다.',
    row: '이 국산 상품이 각 부문 생산 1원에 얼마씩 투입되는지',
    col: '이 부문 생산 1원에 들어간 국산 중간재의 구성',
    heat: '국산투입계수' },
  '생산유발계수': { group: '유발계수 (배)', short: '생산유발계수 L', unit: '배 · 단위 없음', money: false,
    desc: '열 상품의 최종수요가 1원 늘 때 행 부문에서 직·간접으로 늘어나는 생산액입니다. 맨 아래 행은 영향력계수, 맨 오른쪽 열은 감응도계수입니다.',
    row: '모든 상품의 최종수요가 1원씩 늘 때 이 부문이 받는 생산 파급 — 행합 → 감응도계수(전방연쇄)',
    col: '이 상품의 최종수요 1원이 각 부문에 일으키는 생산 파급 — 열합 → 영향력계수(후방연쇄)',
    heat: '생산유발계수' },
  '수입유발계수': { group: '유발계수 (배)', short: '수입유발계수', unit: '배 · 단위 없음', money: false,
    desc: '열 상품의 최종수요가 1원 늘 때 행 상품의 수입이 직·간접으로 얼마나 늘어나는지 보여줍니다.',
    row: '각 상품 최종수요 1원이 이 상품의 수입을 얼마나 늘리는지',
    col: '이 상품의 최종수요 1원이 유발하는 수입의 상품별 구성 — 열합 = 수입유발계수',
    heat: '수입유발계수' },
  '부가가치유발계수': { group: '유발계수 (배)', short: '부가가치유발계수', unit: '배 · 단위 없음', money: false,
    desc: '열 상품의 최종수요가 1원 늘 때 행 부문에서 생기는 부가가치입니다. 부가가치유발계수 열합 + 수입유발계수 열합 = 1 입니다.',
    row: '각 상품 최종수요 1원이 이 부문에서 만드는 부가가치',
    col: '이 상품의 최종수요 1원이 만드는 부가가치의 부문별 구성 — 열합 = 부가가치유발계수',
    heat: '부가가치유발계수' },
  '최종수요 항목별 생산유발액': { group: '최종수요 항목별 유발액 (금액)', short: '생산유발액', unit: '백만원', money: true,
    desc: '2023년 실제 최종수요(소비·투자·수출 등)가 각 부문에서 유발한 생산액입니다. 맨 아래에 항목별 구성비(%)와 유발계수가 있습니다.',
    row: '이 부문의 생산이 어떤 최종수요 항목에 의해 유발되었는지',
    col: '이 최종수요 항목이 각 부문에서 유발한 생산액' },
  '최종수요 항목별 수입유발액': { group: '최종수요 항목별 유발액 (금액)', short: '수입유발액', unit: '백만원', money: true,
    desc: '2023년 실제 최종수요 항목별로 유발된 수입액입니다.',
    row: '이 상품의 수입이 어떤 최종수요 항목 때문에 생겼는지',
    col: '이 최종수요 항목이 유발한 상품별 수입액' },
  '최종수요 항목별 부가가치유발액': { group: '최종수요 항목별 유발액 (금액)', short: '부가가치유발액', unit: '백만원', money: true,
    desc: '2023년 실제 최종수요 항목별로 각 부문에서 유발된 부가가치입니다.',
    row: '이 부문의 부가가치가 어떤 최종수요 항목에서 나왔는지',
    col: '이 최종수요 항목이 각 부문에서 만든 부가가치' },
};

// ---------------------------------------------------------------- 숫자 표기
const nf = (d) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const UNITS = { '조원': 1e6, '억원': 100, '백만원': 1 };
function pickUnit(v) { const a = Math.abs(v); return a >= 1e6 ? '조원' : a >= 100 ? '억원' : '백만원'; }
function money(v, unit = pickUnit(v)) {               // v: 백만원
  const x = v / UNITS[unit];
  const d = unit === '조원' ? 2 : 1;
  return nf(Math.abs(x) >= 1000 ? 0 : d).format(x) + unit;
}
const raw = (v) => nf(1).format(v);
const coef = (v) => (v === 0 ? '0' : Math.abs(v) >= 0.01 ? nf(4).format(v)
  : new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 3 }).format(v));
const pct = (v) => nf(1).format(v) + '%';

// ---------------------------------------------------------------- 상태
const S = {
  level: 33,
  data: {},             // n -> {sectors, sheets, residuals, ...}
  heat: {},             // `${n}|${sheet}` -> heatmap
  classificationSent: false,
  ex: { sheet: 'A표_총거래표(생산자)', axis: 'row', key: '', res: null },
  basket: {},           // n -> [{code,name,amount}]
  result: null, sortKey: 'production',
};
const cur = () => S.data[S.level];
const levelInfo = (n = S.level) => LEVELS.find((l) => l.n === n);

// ---------------------------------------------------------------- Worker 연결
let worker = null, nextId = 0;
const pending = new Map();
function startWorker() {
  worker = new Worker('./worker.js');
  worker.onmessage = ({ data: d }) => {
    if (d.type === 'status') { setStep(d.step, d.text); return; }
    const p = pending.get(d.id); if (!p) return;
    pending.delete(d.id);
    d.ok ? p.resolve(d.result) : p.reject(Error(cleanError(d.error)));
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(Error(e.message || 'Worker 실행 오류')); pending.clear(); };
}
function call(type, payload, transfer = []) {
  if (!worker) startWorker();
  return new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload }, transfer);
  });
}
function cleanError(msg) {   // Python 오류 메시지에서 마지막 줄만
  const lines = String(msg).trim().split('\n').filter(Boolean);
  const last = lines[lines.length - 1] || msg;
  return last.replace(/^\w+Error: /, '');
}

// ---------------------------------------------------------------- 공통 요소
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c);
  return e;
}
function option(value, text, extra = {}) { return el('option', { value, text, ...extra }); }
const tip = $('tip');
function showTip(html, x, y) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(x + 14, innerWidth - r.width - 8) + 'px';
  tip.style.top = Math.min(y + 14, innerHeight - r.height - 8) + 'px';
}
const hideTip = () => { tip.hidden = true; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- 로딩 단계 표시
function setStep(n, text, isError = false) {
  document.querySelectorAll('#steps li').forEach((li) => {
    const k = +li.dataset.step;
    li.className = k < n ? 'done' : k === n ? (n === 4 ? 'done' : 'active') : '';
  });
  if (text) { $('status').textContent = text; }
  $('status').classList.toggle('error', isError);
  const fill = $('progress-fill');
  if (n === 2 || n === 3) { fill.classList.add('indeterminate'); fill.style.width = ''; }
  else fill.classList.remove('indeterminate');
  if (n === 4) fill.style.width = '100%';
  if (n === 0) fill.style.width = '0';
}

async function fetchBuffer(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw Error(`${url} 내려받기 실패 (HTTP ${res.status})`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.length; onProgress(got / total);
  }
  const out = new Uint8Array(got); let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out.buffer;
}

// ---------------------------------------------------------------- 분류 선택·불러오기
function renderLevels() {
  $('levels').replaceChildren(...LEVELS.map((l) => el('button', {
    type: 'button', role: 'radio', 'aria-checked': String(l.n === S.level), class: S.data[l.n] ? 'loaded' : '',
    onclick: () => selectLevel(l.n),
  }, el('span', { text: l.label }), el('small', { text: `${l.n}개 부문 · ${l.size}` }))));
  const info = levelInfo(); const done = !!S.data[S.level];
  $('load').textContent = done ? `${info.label} 불러옴` : `${info.label} 불러오기`;
  $('load').disabled = done || loading;
}

function selectLevel(n) {
  S.level = n; S.result = null;
  renderLevels(); renderAll();
  if (S.data[n]) {
    const d = S.data[n];
    setStep(4, `${levelInfo().label} 사용 중 · ${d.sectors.length}개 부문 · ${d.sheets.length}개 시트 · 계수 검증 통과`);
  } else if (!loading) {
    setStep(0, `${levelInfo().label}(${n}개 부문)을 쓰려면 불러오기 버튼을 누르세요.`);
  }
}

let loading = false;
async function loadLevel() {
  const info = levelInfo(); const n = info.n;
  loading = true; renderLevels();
  try {
    setStep(1, `${info.label} Excel 내려받는 중… (${info.size})`);
    const fill = $('progress-fill'); fill.style.width = '0';
    const buffer = await fetchBuffer(info.file, (r) => { fill.style.width = (r * 100).toFixed(0) + '%'; });
    const payload = { level: String(n), n, buffer }; const transfer = [buffer];
    if (!S.classificationSent) {
      payload.classification = await fetchBuffer(CLASS_FILE, () => {});
      transfer.push(payload.classification);
    }
    const res = await call('load', payload, transfer);
    S.classificationSent = true;
    S.data[n] = res;
    res.byCode = Object.fromEntries(res.sectors.map((s) => [s.code, s]));
    S.basket[n] = S.basket[n] || [];
    if (S.level === n) {
      setStep(4, `${info.label} 준비 완료 · ${res.sectors.length}개 부문 · ${res.sheets.length}개 시트 · 계수 검증 통과`);
    }
  } catch (e) {
    setStep(0, `불러오기 실패: ${e.message} — 새로고침 후 다시 시도하세요.`, true);
  } finally {
    loading = false; renderLevels(); renderAll();
  }
}
$('load').onclick = loadLevel;

// ---------------------------------------------------------------- 검증 결과
function renderValidation() {
  const d = cur(); const box = $('validation-box');
  if (!d) { box.hidden = true; return; }
  box.hidden = false;
  const r = d.residuals;
  const items = [
    ['생산', '(I − Ad) · L = I', '생산유발계수표가 국산투입계수로 만든 역행렬과 같은가'],
    ['수입', 'Am · L = 수입유발계수', '수입유발계수표가 수입투입계수 × 생산유발계수와 같은가'],
    ['부가가치', 'v̂ · L = 부가가치유발계수', '부가가치유발계수표가 부가가치율 × 생산유발계수와 같은가'],
    ['수입+부가가치=1', '각 열: 수입유발 + 부가가치유발 = 1',
      '국산품 최종수요 1원은 결국 수입 또는 국내 부가가치로 모두 나뉘는가' + (d.notProduced ? ` (국내 생산이 없는 ${d.notProduced}개 부문 제외)` : '')],
  ];
  $('validation-summary').textContent = `${levelInfo().label} 원자료의 계수표 4가지 관계를 직접 계산해 확인했습니다 (허용 오차 1e-8).`;
  $('validation').replaceChildren(el('table', { class: 'check-table' }, el('tbody', {}, items.map(([k, f, why]) =>
    el('tr', {}, el('td', { text: '✓' }), el('td', {}, el('b', { text: f }), el('br'), el('span', { class: 'note', text: why })),
      el('td', { class: 'num' }, el('code', { text: '최대 오차 ' + r[k].toExponential(1) })))))));
}

// ---------------------------------------------------------------- 탭
function showTab() {
  const id = (location.hash || '#explorer').slice(1);
  const tab = ['explorer', 'simulation'].includes(id) ? id : 'explorer';
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== tab; });
  document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.tab === tab)));
}
addEventListener('hashchange', showTab);

function renderAll() {
  const ready = !!cur();
  document.querySelectorAll('[data-empty]').forEach((e) => { e.hidden = ready; });
  document.querySelectorAll('[data-ready]').forEach((e) => { e.hidden = !ready; });
  renderValidation();
  if (!ready) return;
  renderSheetNav(); loadSheet(false);
  renderSimInputs(); renderBasket(); renderResult();
}

/* =================================================================
   1. 원자료 탐색
   ================================================================= */
function renderSheetNav() {
  const groups = {};
  for (const s of cur().sheets) (groups[SHEETS[s.name]?.group || '기타'] ||= []).push(s);
  $('sheet-nav').replaceChildren(...Object.entries(groups).flatMap(([g, list]) => [
    el('h4', { text: g }),
    ...list.map((s) => el('button', { type: 'button', 'aria-current': String(s.name === S.ex.sheet), text: SHEETS[s.name]?.short || s.name,
      onclick: () => { S.ex.sheet = s.name; S.ex.key = ''; S.ex.axis = 'row'; renderSheetNav(); loadSheet(true); } })),
  ]));
}

async function loadSheet(resetKey) {
  const sheet = S.ex.sheet; const meta = SHEETS[sheet] || {};
  const info = cur().sheets.find((s) => s.name === sheet);
  $('sheet-group').textContent = meta.group || '';
  $('sheet-title').textContent = info?.title || sheet;
  $('sheet-unit').textContent = '단위: ' + (meta.unit || info?.unit || '-');
  $('sheet-desc').textContent = meta.desc || '';
  $('sheet-row').textContent = meta.row || '';
  $('sheet-col').textContent = meta.col || '';
  document.querySelectorAll('[data-axis]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.axis === S.ex.axis)));
  if (resetKey) { $('ex-search').value = ''; $('ex-filter').value = ''; $('ex-col-search').value = ''; }
  renderFilterOptions($('ex-filter'), true);
  $('heat-card').hidden = !info?.square;
  if (info?.square) drawHeat(sheet);
  await explore();
}

let exploreSeq = 0;
async function explore() {
  const seq = ++exploreSeq;
  try {
    const r = await call('explore', { level: String(S.level), sheet: S.ex.sheet, axis: S.ex.axis, key: S.ex.key });
    if (seq !== exploreSeq) return;
    S.ex.res = r; S.ex.key = r.selected;
    renderChoices(); renderCells(); highlightHeat();
  } catch (e) { $('ex-caption').textContent = '불러오기 실패: ' + e.message; }
}

function renderFilterOptions(select, withSummary) {
  const keep = select.value; const d = cur();
  const larges = [...new Map(d.sectors.map((s) => [s.large, s.largeName])).entries()];
  select.replaceChildren(option('', '전체'), ...(withSummary ? [option('__sum', '합계·지표 항목만')] : []),
    ...larges.map(([c, n]) => option(c, `${c} ${n}`)));
  select.value = [...select.options].some((o) => o.value === keep) ? keep : '';
}

function matchChoice(c, filter, q) {
  const s = cur().byCode[c.code];
  if (filter === '__sum' && !c.summary) return false;
  if (filter && filter !== '__sum' && (!s || s.large !== filter)) return false;
  return !q || (c.code + ' ' + c.name).toLowerCase().includes(q.toLowerCase());
}

function renderChoices() {
  const r = S.ex.res; const f = $('ex-filter').value; const q = $('ex-search').value.trim();
  const list = r.choices.filter((c) => matchChoice(c, f, q));
  $('ex-choice').replaceChildren(...list.map((c) => option(c.code, `${c.code}  ${c.name}${c.summary ? '  (합계·지표)' : ''}`)));
  if (list.some((c) => c.code === r.selected)) $('ex-choice').value = r.selected;
}

function cellKind(code) {                         // 값의 성격 → 표기 방식
  const codes = [code, S.ex.res.selected];
  if (codes.includes('9812')) return 'pct';
  if (codes.includes('9811') || codes.includes('9801') || codes.includes('9802')) return 'coef';
  return SHEETS[S.ex.sheet]?.money ? 'money' : 'coef';
}
function fmtCell(v, kind) {
  if (v === null) return '–';
  if (typeof v !== 'number') return v;
  return kind === 'money' ? money(v) : kind === 'pct' ? pct(v) : coef(v);
}

function renderCells() {
  const r = S.ex.res; const meta = SHEETS[S.ex.sheet] || {};
  const q = $('ex-col-search').value.trim().toLowerCase();
  let cells = r.cells.filter((c) => ($('ex-summary').checked || !c.summary) && (!q || (c.code + ' ' + c.name).toLowerCase().includes(q)));
  if ($('ex-sort').value === 'desc') cells = [...cells].sort((a, b) => (typeof b.value === 'number' ? b.value : -Infinity) - (typeof a.value === 'number' ? a.value : -Infinity));
  const scale = Math.max(...r.cells.filter((c) => !c.summary && typeof c.value === 'number').map((c) => Math.abs(c.value)), 1e-12);
  const dirText = S.ex.axis === 'row' ? '행' : '열';
  $('ex-caption').textContent = `${meta.short || S.ex.sheet} · ${dirText} ${r.selected} ${r.name} — ${S.ex.axis === 'row' ? '가로로 펼친 값' : '세로로 펼친 값'} ${cells.length}개`;
  $('ex-rows').replaceChildren(...cells.map((c) => {
    const kind = cellKind(c.code); const num = typeof c.value === 'number';
    const bar = (!c.summary && num) ? el('div', { class: 'cell-bar' + (c.value < 0 ? ' neg' : ''), style: `width:${Math.min(100, Math.abs(c.value) / scale * 100)}%` }) : null;
    return el('tr', { class: c.summary ? 'summary' : '' },
      el('td', { text: c.code }), el('td', { text: c.name }),
      el('td', { class: 'num', text: fmtCell(c.value, kind), title: num ? raw(c.value) : '' }),
      el('td', {}, bar),
      el('td', { class: 'num muted', text: num ? (kind === 'money' ? raw(c.value) : String(+c.value.toPrecision(8))) : '' }));
  }));
}

$('ex-filter').onchange = () => { renderChoices(); };
$('ex-search').oninput = () => { renderChoices(); };
$('ex-choice').onchange = () => { S.ex.key = $('ex-choice').value; explore(); };
$('ex-summary').onchange = renderCells;
$('ex-sort').onchange = renderCells;
$('ex-col-search').oninput = renderCells;
document.querySelectorAll('[data-axis]').forEach((b) => {
  b.onclick = () => {
    if (S.ex.axis === b.dataset.axis) return;
    S.ex.axis = b.dataset.axis;   // 같은 코드를 행↔열로 바로 전환
    document.querySelectorAll('[data-axis]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('ex-search').value = ''; $('ex-filter').value = ''; explore();
  };
});

// ---------------------------------------------------------------- 히트맵
const RAMP = ['#e3eefb', '#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'];
const rampRGB = RAMP.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
function rampColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (rampRGB.length - 1); const i = Math.min(Math.floor(x), rampRGB.length - 2); const f = x - i;
  return rampRGB[i].map((c, k) => Math.round(c + (rampRGB[i + 1][k] - c) * f));
}
let heatImage = null, heatState = null;

async function drawHeat(sheet) {
  const key = S.level + '|' + sheet; const canvas = $('heat');
  $('heat-label').textContent = SHEETS[sheet]?.heat || '';
  try {
    const h = S.heat[key] || (S.heat[key] = await call('heatmap', { level: String(S.level), sheet }));
    if (S.ex.sheet !== sheet) return;
    const n = h.n; const lo = Math.max(h.minPositive, h.max / 1e4); const span = Math.log10(h.max / lo) || 1;
    const img = new ImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = h.values[i]; const p = i * 4;
      const c = v > 0 ? rampColor(Math.log10(Math.max(v, lo) / lo) / span) : [247, 247, 245];
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
    }
    const off = document.createElement('canvas'); off.width = n; off.height = n; off.getContext('2d').putImageData(img, 0, 0);
    heatImage = off; heatState = { n, sheet, h, level: S.level };
    const fmt = SHEETS[sheet]?.money ? money : coef;
    $('heat-max').textContent = fmt(h.max); $('heat-min').textContent = fmt(lo) + ' 이하';
    highlightHeat();
  } catch (e) { $('heat-label').textContent = '그리기 실패: ' + e.message; }
}

function highlightHeat() {
  const canvas = $('heat'); if (!heatImage || !heatState || heatState.sheet !== S.ex.sheet || heatState.level !== S.level) return;
  const size = 560; canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(heatImage, 0, 0, size, size);
  const idx = cur().sectors.findIndex((s) => s.code === S.ex.res?.selected);
  if (idx < 0) return;
  const cell = size / heatState.n;
  ctx.strokeStyle = '#eb6834'; ctx.lineWidth = 2;
  if (S.ex.axis === 'row') ctx.strokeRect(0, idx * cell, size, Math.max(cell, 2));
  else ctx.strokeRect(idx * cell, 0, Math.max(cell, 2), size);
}

function heatCellAt(ev) {
  if (!heatState) return null;
  const r = $('heat').getBoundingClientRect(); const n = heatState.n;
  const j = Math.floor((ev.clientX - r.left) / r.width * n); const i = Math.floor((ev.clientY - r.top) / r.height * n);
  return i >= 0 && j >= 0 && i < n && j < n ? { i, j } : null;
}
$('heat').onmousemove = (ev) => {
  const c = heatCellAt(ev); if (!c) return hideTip();
  const s = cur().sectors; const v = heatState.h.values[c.i * heatState.n + c.j];
  const fmt = SHEETS[heatState.sheet]?.money ? money : coef;
  showTip(`<span class="t-muted">행</span> <b>${esc(s[c.i].code)} ${esc(s[c.i].name)}</b><br><span class="t-muted">열</span> <b>${esc(s[c.j].code)} ${esc(s[c.j].name)}</b><br>${fmt(v)}`, ev.clientX, ev.clientY);
};
$('heat').onmouseleave = hideTip;
$('heat').onclick = (ev) => {
  const c = heatCellAt(ev); if (!c) return;
  S.ex.axis = 'row'; S.ex.key = cur().sectors[c.i].code;
  document.querySelectorAll('[data-axis]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.axis === 'row')));
  $('ex-search').value = ''; $('ex-filter').value = ''; explore();
};

/* =================================================================
   2. 파급효과 시뮬레이터
   ================================================================= */
function renderSimInputs() {
  renderFilterOptions($('sim-filter'), false);
  renderSectorList(); updateConvert();
}
function renderSectorList() {
  const f = $('sim-filter').value; const q = $('sim-search').value.trim().toLowerCase(); const keep = $('sim-sector').value;
  const list = cur().sectors.filter((s) => (!f || s.large === f) && (!q || (s.code + ' ' + s.name).toLowerCase().includes(q)));
  $('sim-sector').replaceChildren(...list.map((s) => option(s.code, `${s.code}  ${s.name}${s.produced ? '' : '  (국내 생산 없음)'}`, { disabled: !s.produced })));
  if (list.some((s) => s.code === keep)) $('sim-sector').value = keep;
}
function amountMillion() { return Number($('sim-amount').value) * Number($('sim-unit').value); }
function updateConvert() {
  const v = amountMillion();
  $('sim-convert').textContent = Number.isFinite(v) && v > 0 ? `= ${raw(v)}백만원 (${money(v, '억원')})` : '양(+)의 금액을 입력하세요.';
}
$('sim-filter').onchange = renderSectorList;
$('sim-search').oninput = renderSectorList;
$('sim-amount').oninput = updateConvert;
$('sim-unit').onchange = updateConvert;

function basket() { return S.basket[S.level] || (S.basket[S.level] = []); }
$('sim-add').onclick = () => {
  const s = cur().byCode[$('sim-sector').value]; const amount = amountMillion();
  if (!s) { $('sim-status').textContent = '산업을 먼저 선택하세요.'; return; }
  if (!s.produced) { $('sim-status').textContent = `${s.name}은(는) 국내 생산이 없어 선택할 수 없습니다.`; return; }
  if (!Number.isFinite(amount) || amount <= 0) { $('sim-status').textContent = '양(+)의 증가액을 입력하세요.'; return; }
  const b = basket(); const same = b.find((x) => x.code === s.code);
  if (same) same.amount += amount; else b.push({ code: s.code, name: s.name, amount });
  S.result = null; renderBasket(); renderResult();
};
$('sim-clear').onclick = () => { S.basket[S.level] = []; S.result = null; renderBasket(); renderResult(); };

function renderBasket() {
  const b = basket();
  $('basket').replaceChildren(...b.map((s, i) => el('li', {},
    el('div', {}, el('b', { text: s.name }), el('small', { text: `${s.code} · ${money(s.amount)}` })),
    el('button', { type: 'button', text: '삭제', onclick: () => { b.splice(i, 1); S.result = null; renderBasket(); renderResult(); } }))));
  $('sim-run').disabled = !b.length;
  const total = b.reduce((a, s) => a + s.amount, 0);
  $('sim-status').textContent = b.length ? `${b.length}개 산업, 합계 ${money(total)} — 계산 버튼을 누르세요.` : '';
}

$('sim-run').onclick = async () => {
  const snapshot = basket().map((s) => ({ code: s.code, amount: s.amount }));
  $('sim-run').disabled = true; $('sim-status').textContent = '계산 중…';
  try {
    const r = await call('simulate', { level: String(S.level), shocks: snapshot });
    S.result = r; S.sortKey = 'production';
    renderResult(); $('sim-status').textContent = '계산 완료 — 오른쪽 결과는 현재 시나리오 기준입니다.';
  } catch (e) { S.result = null; renderResult(); $('sim-status').textContent = '계산 실패: ' + e.message; }
  finally { $('sim-run').disabled = !basket().length; }
};

function kpi(label, value, sub, hero) {
  return el('div', { class: 'kpi' + (hero ? ' hero' : '') }, el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: value }), sub ? el('div', { class: 'sub' }, ...sub) : null);
}

function renderResult() {
  const r = S.result;
  $('results').hidden = !r; $('sim-empty').hidden = !!r;
  if (!r) return;
  const share = (x) => pct(x / r.demand * 100);
  $('kpis').replaceChildren(
    kpi('수요 증가액', money(r.demand), [`${basket().length}개 산업 합계`]),
    kpi('생산유발액', money(r.production), ['생산유발 승수 ', el('b', { text: nf(3).format(r.multiplier) + '배' })], true),
    kpi('부가가치유발액', money(r.valueAdded), ['수요 증가액의 ', el('b', { text: share(r.valueAdded) })]),
    kpi('수입유발액', money(r.imports), ['수요 증가액의 ', el('b', { text: share(r.imports) })]),
  );
  $('identity').replaceChildren(el('span', { class: 'badge good', text: '✓ 확인' }),
    `부가가치유발 ${share(r.valueAdded)} + 수입유발 ${share(r.imports)} = ${share(r.valueAdded + r.imports)} — 국산품 수요 1원은 결국 국내 부가가치나 수입으로 모두 나뉩니다.`);

  // 직접 vs 간접
  const dp = r.direct / r.production * 100;
  $('split').replaceChildren(
    el('div', { class: 'split-bar' }, el('div', { class: 'seg direct', style: `width:${dp}%` }), el('div', { class: 'seg indirect', style: `width:${100 - dp}%` })),
    el('div', { class: 'split-labels' },
      el('div', {}, el('i', { class: 'seg direct' }), el('b', { text: '직접효과 ' }), `${money(r.direct)} (${pct(dp)})`),
      el('div', { class: 'r' }, el('i', { class: 'seg indirect' }), el('b', { text: '간접효과 ' }), `${money(r.indirect)} (${pct(100 - dp)})`)));

  document.querySelectorAll('[data-legend]').forEach((l) => l.replaceChildren(
    el('span', {}, el('i', { class: 'direct' }), '직접효과'), el('span', {}, el('i', { class: 'indirect' }), '간접효과')));
  stackedBars($('group-bars'), r.groups.map((g) => ({ name: g.group, ...g })));
  stackedBars($('top-bars'), r.rows.slice(0, 15).map((x) => ({ ...x, name: x.name, sub: x.code })));
  renderResultTable();
}

function stackedBars(box, items) {
  const max = Math.max(...items.map((x) => x.production), 1e-9);
  box.replaceChildren(...items.map((x) => {
    const row = el('div', { class: 'bar-row' },
      el('div', { class: 'name', title: x.name }, x.name, x.sub ? el('small', { text: x.sub }) : null),
      el('div', { class: 'track' },
        x.direct > 0 ? el('div', { class: 'seg direct', style: `width:${x.direct / max * 100}%` }) : null,
        el('div', { class: 'seg indirect', style: `width:${Math.max(x.indirect, 0) / max * 100}%` })),
      el('div', { class: 'val', text: money(x.production) }));
    row.onmousemove = (ev) => showTip(`<b>${esc(x.name)}</b><br>생산유발 ${money(x.production)}<br><span class="t-muted">직접</span> ${money(x.direct)} · <span class="t-muted">간접</span> ${money(x.indirect)}<br><span class="t-muted">부가가치</span> ${money(x.valueAdded)} · <span class="t-muted">수입</span> ${money(x.imports)}`, ev.clientX, ev.clientY);
    row.onmouseleave = hideTip;
    return row;
  }));
}

function renderResultTable() {
  const r = S.result; const q = $('res-search').value.trim().toLowerCase();
  const unit = pickUnit(Math.max(...r.rows.map((x) => x.production)));
  const rows = [...r.rows].sort((a, b) => b[S.sortKey] - a[S.sortKey])
    .filter((x) => !q || (x.code + ' ' + x.name + ' ' + x.group).toLowerCase().includes(q));
  const lv = levelInfo();
  $('res-caption').textContent = `${lv.label} ${r.rows.length}개 산업 전체 결과 · 단위 ${unit} · 머리글을 누르면 정렬`;
  const fmt = (v) => nf(unit === '조원' ? 3 : 1).format(v / UNITS[unit]);
  $('res-rows').replaceChildren(...rows.map((x, i) => el('tr', {},
    el('td', { class: 'num', text: String(i + 1) }), el('td', { text: x.code }), el('td', { text: x.name }), el('td', { class: 'muted', text: x.group }),
    el('td', { class: 'num', text: fmt(x.production) }), el('td', { class: 'num', text: fmt(x.direct) }), el('td', { class: 'num', text: fmt(x.indirect) }),
    el('td', { class: 'num', text: fmt(x.valueAdded) }), el('td', { class: 'num', text: fmt(x.imports) }), el('td', { class: 'num', text: pct(x.share * 100) }))));
  document.querySelectorAll('table.sortable th[data-sort]').forEach((th) => th.classList.toggle('active', th.dataset.sort === S.sortKey));
}
document.querySelectorAll('table.sortable th[data-sort]').forEach((th) => {
  th.onclick = () => { S.sortKey = th.dataset.sort; renderResultTable(); };
});
$('res-search').oninput = () => S.result && renderResultTable();

function csvCell(v) { let s = String(v); if (/^[=+@-]/.test(s) && typeof v !== 'number') s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }
$('download').onclick = () => {
  const r = S.result; if (!r) return;
  const rows = [['산업코드', '산업명', '산업군', '생산유발액_백만원', '직접효과_백만원', '간접효과_백만원', '부가가치유발액_백만원', '수입유발액_백만원'],
    ...r.rows.map((x) => [x.code, x.name, x.group, x.production, x.direct, x.indirect, x.valueAdded, x.imports])];
  const url = URL.createObjectURL(new Blob(['﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: `io-2023-${S.level}-파급효과.csv` }); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---------------------------------------------------------------- 시작
renderLevels(); showTab(); renderAll();
