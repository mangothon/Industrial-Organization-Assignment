'use strict';
/* =================================================================
   산업연관표 분석 웹앱 — 공통 부분
   상태·Worker 연결·불러오기·숫자 표기·차트 도우미·탭 전환
   계산은 worker.js → model.py(Python)에서, 화면 파일들은 표시만 담당
   ================================================================= */
const $ = (id) => document.getElementById(id);

const LEVELS = [
  { n: 33, label: '대분류', size: '0.6MB', file: './data/io-2023-33.xlsx' },
  { n: 83, label: '중분류', size: '1.2MB', file: './data/io-2023-83.xlsx' },
  { n: 165, label: '소분류', size: '3.1MB', file: './data/io-2023-165.xlsx' },
  { n: 380, label: '기본부문', size: '12MB', file: './data/io-2023-380.xlsx' },
];
const CLASS_FILE = './data/sector-classification.xlsx';
const SUMMARY_FILE = './data/io-2023-summary.xlsx';

const TAB_IDS = ['explorer', 'compare', 'structure', 'linkage', 'simulation'];
const TABS = {};   // 탭 id -> { render() } (각 화면 파일이 등록)

// 시트 설명: 무엇을 담고 있는지, 단위, 읽는 방향
const SHEETS = {
  'A표_총거래표(생산자)': { group: '거래표 (금액)', short: '총거래표', unit: '백만원', money: true, kind: 'trade',
    desc: '국산품과 수입품을 합친 상품별 거래 내역입니다. 산업연관표의 가장 기본이 되는 표입니다.',
    row: '이 상품이 어느 부문의 중간재로, 또 어떤 최종수요(소비·투자·수출)로 얼마나 팔렸는지 — 배분구조',
    col: '이 부문이 생산을 위해 어떤 상품을 얼마나 사들이고 부가가치를 얼마나 만들었는지 — 투입구조' },
  'A표_수입거래표(생산자)': { group: '거래표 (금액)', short: '수입거래표', unit: '백만원', money: true, kind: 'trade',
    desc: '수입품만 따로 모은 거래 내역입니다. 어떤 수입품이 어디에 쓰였는지 보여줍니다.',
    row: '이 수입 상품이 어느 부문의 중간재·최종수요로 쓰였는지',
    col: '이 부문이 생산에 투입한 수입 중간재의 구성' },
  'A표_국산거래표(생산자)': { group: '거래표 (금액)', short: '국산거래표', unit: '백만원', money: true, kind: 'trade',
    desc: '국내에서 생산된 상품만의 거래 내역입니다. 국산 투입계수와 생산유발계수의 바탕이 됩니다.',
    row: '이 국산 상품이 어느 부문의 중간재·최종수요로 쓰였는지',
    col: '이 부문이 생산에 투입한 국산 중간재의 구성' },
  '총투입계수(A)': { group: '투입계수 (비율)', short: '총투입계수 A', unit: '비율 · 단위 없음', money: false, kind: 'input',
    desc: '각 부문이 1원어치를 생산할 때 투입한 상품의 금액입니다(투입액 ÷ 총투입액). 국산과 수입을 합친 값입니다.',
    row: '이 상품이 각 부문의 생산 1원에 얼마씩 투입되는지',
    col: '이 부문 생산 1원의 투입 구성 — 중간투입률 + 부가가치율 = 1' },
  '수입투입계수(Am)': { group: '투입계수 (비율)', short: '수입투입계수 Am', unit: '비율 · 단위 없음', money: false, kind: 'input',
    desc: '수입 중간재만으로 계산한 투입계수입니다. 열합은 그 부문의 수입의존도입니다.',
    row: '이 수입 상품이 각 부문 생산 1원에 얼마씩 투입되는지',
    col: '이 부문 생산 1원에 들어간 수입 중간재의 구성' },
  '국산투입계수(Ad)': { group: '투입계수 (비율)', short: '국산투입계수 Ad', unit: '비율 · 단위 없음', money: false, kind: 'input',
    desc: '국산 중간재만으로 계산한 투입계수입니다. 생산유발계수 L = (I − Ad)⁻¹ 의 바탕이 됩니다.',
    row: '이 국산 상품이 각 부문 생산 1원에 얼마씩 투입되는지',
    col: '이 부문 생산 1원에 들어간 국산 중간재의 구성' },
  '생산유발계수': { group: '유발계수 (배)', short: '생산유발계수 L', unit: '배 · 단위 없음', money: false, kind: 'induce',
    desc: '열 상품의 최종수요가 1원 늘 때 행 부문에서 직·간접으로 늘어나는 생산액입니다. 맨 아래 행은 영향력계수, 맨 오른쪽 열은 감응도계수입니다.',
    row: '모든 상품의 최종수요가 1원씩 늘 때 이 부문이 받는 생산 파급 — 행합 → 감응도계수(전방연쇄)',
    col: '이 상품의 최종수요 1원이 각 부문에 일으키는 생산 파급 — 열합 → 영향력계수(후방연쇄)' },
  '수입유발계수': { group: '유발계수 (배)', short: '수입유발계수', unit: '배 · 단위 없음', money: false, kind: 'induce',
    desc: '열 상품의 최종수요가 1원 늘 때 행 상품의 수입이 직·간접으로 얼마나 늘어나는지 보여줍니다.',
    row: '각 상품 최종수요 1원이 이 상품의 수입을 얼마나 늘리는지',
    col: '이 상품의 최종수요 1원이 유발하는 수입의 상품별 구성 — 열합 = 수입유발계수' },
  '부가가치유발계수': { group: '유발계수 (배)', short: '부가가치유발계수', unit: '배 · 단위 없음', money: false, kind: 'induce',
    desc: '열 상품의 최종수요가 1원 늘 때 행 부문에서 생기는 부가가치입니다. 부가가치유발계수 열합 + 수입유발계수 열합 = 1 입니다.',
    row: '각 상품 최종수요 1원이 이 부문에서 만드는 부가가치',
    col: '이 상품의 최종수요 1원이 만드는 부가가치의 부문별 구성 — 열합 = 부가가치유발계수' },
  '최종수요 항목별 생산유발액': { group: '최종수요 항목별 유발액 (금액)', short: '생산유발액', unit: '백만원', money: true, kind: 'fd',
    desc: '2023년 실제 최종수요(소비·투자·수출 등)가 각 부문에서 유발한 생산액입니다. 맨 아래에 항목별 구성비(%)와 유발계수가 있습니다.',
    row: '이 부문의 생산이 어떤 최종수요 항목에 의해 유발되었는지',
    col: '이 최종수요 항목이 각 부문에서 유발한 생산액' },
  '최종수요 항목별 수입유발액': { group: '최종수요 항목별 유발액 (금액)', short: '수입유발액', unit: '백만원', money: true, kind: 'fd',
    desc: '2023년 실제 최종수요 항목별로 유발된 수입액입니다.',
    row: '이 상품의 수입이 어떤 최종수요 항목 때문에 생겼는지',
    col: '이 최종수요 항목이 유발한 상품별 수입액' },
  '최종수요 항목별 부가가치유발액': { group: '최종수요 항목별 유발액 (금액)', short: '부가가치유발액', unit: '백만원', money: true, kind: 'fd',
    desc: '2023년 실제 최종수요 항목별로 각 부문에서 유발된 부가가치입니다.',
    row: '이 부문의 부가가치가 어떤 최종수요 항목에서 나왔는지',
    col: '이 최종수요 항목이 각 부문에서 만든 부가가치' },
};
const SHEET_NAMES = Object.keys(SHEETS);

// 보도자료 13개 산업군 (model.py GROUP13과 같은 순서)
const GROUP13 = ['농림수산품', '광산품', '소비재제품', '기초소재제품', '조립가공제품', '제조임가공·산업용 장비 수리',
  '전력·가스·수도 및 폐기물', '건설', '도소매 및 운송', '생산자서비스', '사회서비스', '소비자서비스', '기타'];
const GROUP_LARGE = {
  '농림수산품': ['A'], '광산품': ['B'], '소비재제품': ['C01', 'C02', 'C03', 'C13'], '기초소재제품': ['C04', 'C05', 'C06', 'C07', 'C08'],
  '조립가공제품': ['C09', 'C10', 'C11', 'C12'], '제조임가공·산업용 장비 수리': ['C14'], '전력·가스·수도 및 폐기물': ['D', 'E'],
  '건설': ['F'], '도소매 및 운송': ['G', 'H'], '생산자서비스': ['J', 'K', 'L', 'M', 'N'], '사회서비스': ['O', 'P', 'Q'],
  '소비자서비스': ['I', 'R', 'S'], '기타': ['T'],
};

// 범주색: 최대 4개, 순서 고정. 나머지는 회색.
const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const GRAY = '#b8bcc4';
const GRAY_2 = '#d5d8dd';
const RAMP = ['#e3eefb', '#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'];

const SRC_IO = '자료: 선택한 분류 투입산출표(2023)';
const SRC_SUMMARY = '자료: 주요 분석표(대분류·13개 산업군, 2020~2023)';

// ---------------------------------------------------------------- 숫자 표기
const nf = (d) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const nfFixed = (d) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });
const UNITS = { '조원': 1e6, '억원': 100, '백만원': 1 };
function pickUnit(v) { const a = Math.abs(v); return a >= 1e6 ? '조원' : a >= 100 ? '억원' : '백만원'; }
function money(v, unit = pickUnit(v)) {               // v: 백만원
  if (v === null || v === undefined) return '–';
  const x = v / UNITS[unit];
  const d = unit === '조원' ? 2 : 1;
  return nf(Math.abs(x) >= 1000 ? 0 : d).format(x) + unit;
}
const raw = (v) => nf(1).format(v);
const coef = (v) => (v === null || v === undefined ? '–' : v === 0 ? '0' : Math.abs(v) >= 0.01 ? nf(4).format(v)
  : new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 3 }).format(v));
const pct = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : nfFixed(d).format(v) + '%');
const people = (v) => (v === null || v === undefined ? '–' : nf(v >= 100 ? 0 : 1).format(v) + '명');

// ---------------------------------------------------------------- 상태
const S = {
  level: 33,
  data: {},             // n -> {sectors, sheets, residuals, byCode, ...}
  cache: {},            // `${n}|${종류}|${인자}` -> worker 결과
  classification: null, // {large, up}
  summary: null,        // 주요 분석표 지표
  empCheck: null,       // 취업유발 검증 결과
  bootSent: false,
  ex: { sheet: 'A표_총거래표(생산자)', axis: 'row', key: '', res: null },
  cmp: {},              // n -> sheet -> 비교 상태
  basket: {},           // n -> [{code,name,amount}]
  result: {},           // n -> 시뮬레이션 결과
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
/** 같은 요청은 한 번만 계산하고 결과를 기억 */
function cached(type, payload) {
  const key = type + '|' + JSON.stringify(payload);
  if (!S.cache[key]) S.cache[key] = call(type, payload).catch((e) => { delete S.cache[key]; throw e; });
  return S.cache[key];
}
function cleanError(msg) {   // Python 오류 메시지에서 마지막 줄만
  const lines = String(msg).trim().split('\n').filter(Boolean);
  const last = lines[lines.length - 1] || msg;
  return last.replace(/^\w+Error: /, '');
}

// ---------------------------------------------------------------- DOM 도우미
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e[k] = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...children) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c) e.append(c);
  return e;
}
function option(value, text, extra = {}) { return el('option', { value, text, ...extra }); }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tip = $('tip');
function showTip(html, x, y) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(x + 14, innerWidth - r.width - 8)) + 'px';
  tip.style.top = Math.max(8, Math.min(y + 14, innerHeight - r.height - 8)) + 'px';
}
const hideTip = () => { tip.hidden = true; };
function hoverTip(node, html) {
  node.onmousemove = (ev) => showTip(typeof html === 'function' ? html() : html, ev.clientX, ev.clientY);
  node.onmouseleave = hideTip;
  return node;
}
const sourceNote = (text) => el('p', { class: 'source', text });
const match = (text, q) => !q || text.toLowerCase().includes(q.toLowerCase());

/** 버튼 묶음(segmented) — options: [[값, 글자]] */
function segmented(options, value, onChange, label) {
  const box = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label || '' });
  for (const [v, t] of options) {
    box.append(el('button', { type: 'button', 'aria-pressed': String(v === value), text: t,
      onclick: () => { if (v !== value) onChange(v); } }));
  }
  return box;
}
function legend(items) {   // items: [[색, 이름, (모양)]]
  return el('div', { class: 'legend' }, items.map(([c, t, shape]) =>
    el('span', {}, el('i', { class: shape || '', style: { background: c } }), t)));
}
function emptyNote(text) { return el('p', { class: 'empty-note', text }); }

/** 왼쪽 목록형 하위 화면 공통 컴포넌트 */
function sideNav(box, items, current, onSelect) {
  box.replaceChildren(...items.map((it) => (it.heading
    ? el('h4', { text: it.heading })
    : el('button', { type: 'button', 'aria-current': String(it.id === current), onclick: () => onSelect(it.id) },
      el('span', { text: it.label }), it.sub ? el('small', { text: it.sub }) : null))));
}

// ---------------------------------------------------------------- 차트 도우미 (HTML·SVG 직접 그리기)
/**
 * 가로 막대 순위
 * items: [{name, sub, segs:[{v,color,label}], value(표시값), tip, onClick}]
 * opts: {max, fmt, avg:{value,label}, nameWidth}
 */
function hbars(box, items, opts = {}) {
  const max = opts.max ?? Math.max(...items.map((x) => x.segs.reduce((a, s) => a + Math.max(s.v, 0), 0)), 1e-12);
  const rows = items.map((x) => {
    const row = el('div', { class: 'bar-row' + (x.onClick ? ' clickable' : '') + (x.highlight ? ' hl' : '') },
      el('div', { class: 'name', title: x.name }, x.name, x.sub ? el('small', { text: x.sub }) : null),
      el('div', { class: 'track' },
        x.segs.filter((s) => s.v > 0).map((s) => el('div', { class: 'seg', style: { width: (s.v / max * 100) + '%', background: s.color } })),
        opts.avg ? el('div', { class: 'avg-line', style: { left: (opts.avg.value / max * 100) + '%' } }) : null),
      el('div', { class: 'val', text: x.label ?? (opts.fmt ? opts.fmt(x.value) : String(x.value)) }));
    if (x.tip) hoverTip(row, x.tip);
    if (x.onClick) { row.onclick = x.onClick; row.tabIndex = 0; row.onkeydown = (e) => { if (e.key === 'Enter') x.onClick(); }; }
    return row;
  });
  const children = [];
  if (opts.avg) children.push(el('div', { class: 'avg-label' }, el('i'), opts.avg.label));
  children.push(...rows);
  box.replaceChildren(...children);
  box.classList.add('bars');
}

/**
 * 100% 누적 막대 한 줄
 * parts: [{label, value, color}] — 음수는 막대에서 빼고 주석으로 표시
 */
function stack100(parts, opts = {}) {
  const pos = parts.filter((p) => p.value > 0);
  const posSum = pos.reduce((a, p) => a + p.value, 0);
  const total = opts.total ?? posSum;
  const base = Math.max(total, posSum);   // 음수 항목이 있으면 양수 합이 분모보다 클 수 있음 → 막대 폭은 넘치지 않게
  const fmt = opts.fmt || money;
  const bar = el('div', { class: 'stack100' + (opts.thin ? ' thin' : '') },
    pos.map((p) => {
      const share = total ? p.value / total * 100 : 0;
      const seg = el('div', { class: 'seg', style: { width: (base ? p.value / base * 100 : 0) + '%', background: p.color } },
        share >= (opts.labelMin ?? 9) ? el('span', { text: (opts.inside ? opts.inside(p) + ' ' : '') + pct(share, 1) }) : null);
      if (p.light) seg.classList.add('light');
      hoverTip(seg, () => `<b>${esc(p.label)}</b><br>${fmt(p.value)} · ${pct(share, 1)}${opts.totalLabel ? `<br><span class="t-muted">${esc(opts.totalLabel)} 대비</span>` : ''}`);
      return seg;
    }));
  const neg = parts.filter((p) => p.value < 0);
  return el('div', { class: 'stack-wrap' },
    opts.title ? el('div', { class: 'stack-title' }, el('b', { text: opts.title }), opts.right ? el('span', { text: opts.right }) : null) : null,
    bar,
    opts.legend === false ? null : legend(pos.map((p) => [p.color, `${p.label} ${pct(total ? p.value / total * 100 : 0)}`])),
    neg.length ? el('p', { class: 'note', text: neg.map((p) => `${p.label} ${fmt(p.value)}(음수)는 막대에서 제외`).join(' · ') }) : null);
}

/** 꺾은선(연도별) — series: [{name, values:[], color, width, dim}] */
function lineChart(series, years, opts = {}) {
  const W = 760, H = 300, m = { l: 52, r: 34, t: 14, b: 30 };
  const all = series.flatMap((s) => s.values).filter((v) => v !== null && Number.isFinite(v));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08; lo = Math.max(opts.floor ?? -Infinity, lo - pad); hi += pad;
  const x = (i) => m.l + i * (W - m.l - m.r) / (years.length - 1);
  const y = (v) => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
  const ticks = niceTicks(lo, hi, 5);
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': opts.label || '연도별 추이' });
  for (const t of ticks) {
    g.append(svg('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: 'grid' }));
    g.append(svg('text', { x: m.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis', text: nf(2).format(t) }));
  }
  years.forEach((yr, i) => g.append(svg('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'axis', text: yr + '년' })));
  const ordered = [...series.filter((s) => s.dim), ...series.filter((s) => !s.dim)];
  for (const s of ordered) {
    const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean);
    const path = svg('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: s.color, 'stroke-width': s.width || 2,
      'stroke-linejoin': 'round', opacity: s.dim ? 0.55 : 1 });
    g.append(path);
    for (const [i, v] of s.values.entries()) {
      if (v === null) continue;
      const c = svg('circle', { cx: x(i), cy: y(v), r: s.dim ? 2.5 : 4, fill: s.color, stroke: '#fff', 'stroke-width': 1.5 });
      hoverTip(c, `<b>${esc(s.name)}</b><br>${years[i]}년 ${opts.fmt ? opts.fmt(v) : v}`);
      g.append(c);
    }
    if (!s.dim) {
      const last = pts[pts.length - 1];
      if (last) g.append(svg('text', { x: last[0] - 4, y: last[1] - 8, 'text-anchor': 'end', class: 'line-label', fill: s.color, text: s.name }));
    }
  }
  return el('div', { class: 'chart-box' }, g);
}
function niceTicks(lo, hi, n) {
  const span = hi - lo; const step0 = span / n; const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= n) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
/** 값 크기 → 순차 파랑 배경 (0~1) */
function rampColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1); const i = Math.min(Math.floor(x), RAMP.length - 2); const f = x - i;
  const a = [1, 3, 5].map((k) => parseInt(RAMP[i].slice(k, k + 2), 16)); const b = [1, 3, 5].map((k) => parseInt(RAMP[i + 1].slice(k, k + 2), 16));
  return `rgb(${a.map((c, k) => Math.round(c + (b[k] - c) * f)).join(',')})`;
}

// ---------------------------------------------------------------- 산업 찾기 도우미
function sectorName(code, n = S.level) { return S.data[n]?.byCode[code]?.name || code; }
function largeOf(code) { const u = S.classification?.up?.[code]; return u ? u['33'] : code; }
function groupOfLarge(code) { return GROUP13.find((g) => GROUP_LARGE[g].includes(code)) || '기타'; }
/** 대분류 코드 목록 → 현재 분류의 대응 코드 */
function codesForLarge(larges, n = S.level) {
  return (S.data[n]?.sectors || []).filter((s) => larges.includes(s.large)).map((s) => s.code);
}
function largeName(code) { return S.classification?.large.find((l) => l.code === code)?.name || code; }

function renderFilterOptions(select, withSummary) {
  const keep = select.value; const d = cur();
  const larges = [...new Map(d.sectors.map((s) => [s.large, s.largeName])).entries()];
  select.replaceChildren(option('', '전체'), ...(withSummary ? [option('__sum', '합계·지표 항목만')] : []),
    ...larges.map(([c, n]) => option(c, `${c} ${n}`)));
  select.value = [...select.options].some((o) => o.value === keep) ? keep : '';
}

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

async function fetchBuffer(url, onProgress = () => {}) {
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
let loading = false;
function renderLevels() {
  $('levels').replaceChildren(...LEVELS.map((l) => el('button', {
    type: 'button', role: 'radio', 'aria-checked': String(l.n === S.level), class: S.data[l.n] ? 'loaded' : '',
    onclick: () => selectLevel(l.n),
  }, el('span', { text: l.label }), el('small', { text: `${l.n}개 부문 · ${l.size}` }))));
  const info = levelInfo(); const done = !!S.data[S.level];
  $('load').textContent = done ? `${info.label} 불러옴` : `${info.label} 불러오기`;
  $('load').disabled = done || loading;
}

function readyText(n) {
  const d = S.data[n];
  return `${levelInfo(n).label} 사용 중 · ${d.sectors.length}개 부문 · ${d.sheets.length}개 시트 · 계수 검증 통과` + (S.summary ? ' · 주요 분석표 포함' : '');
}

function selectLevel(n) {
  S.level = n;
  renderLevels(); renderAll();
  if (S.data[n]) setStep(4, readyText(n));
  else if (!loading) setStep(0, `${levelInfo().label}(${n}개 부문)을 쓰려면 불러오기 버튼을 누르세요.`);
}

/** 분류 하나를 불러온다. 처음에는 부문분류표·주요 분석표도 함께 내려받는다. */
let loadChain = Promise.resolve();
function loadLevel(n = S.level) {
  loadChain = loadChain.then(() => (S.data[n] ? null : doLoad(n)));
  return loadChain;
}
async function doLoad(n) {
  const info = levelInfo(n);
  loading = true; renderLevels();
  try {
    const first = !S.bootSent;
    setStep(1, `${info.label} Excel 내려받는 중… (${info.size})` + (first ? ' + 부문분류표·주요 분석표' : ''));
    const fill = $('progress-fill'); fill.style.width = '0';
    const buffer = await fetchBuffer(info.file, (r) => { fill.style.width = (r * 100).toFixed(0) + '%'; });
    const payload = { level: String(n), n, buffer }; const transfer = [buffer];
    if (first) {
      payload.classification = await fetchBuffer(CLASS_FILE);
      payload.summary = await fetchBuffer(SUMMARY_FILE);
      transfer.push(payload.classification, payload.summary);
    }
    const res = await call('load', payload, transfer);
    S.bootSent = true;
    if (res.classification) S.classification = res.classification;
    if (res.summary) S.summary = res.summary;
    if (res.empCheck) S.empCheck = res.empCheck;
    const d = res.data;
    d.byCode = Object.fromEntries(d.sectors.map((s) => [s.code, s]));
    S.data[n] = d;
    S.basket[n] = S.basket[n] || [];
    setStep(4, (S.level === n ? '' : `${info.label} 불러옴 · `) + readyText(S.level in S.data ? S.level : n));
  } catch (e) {
    setStep(0, `불러오기 실패: ${e.message} — 새로고침 후 다시 시도하세요.`, true);
    throw e;
  } finally {
    loading = false; renderLevels(); renderAll();
  }
}
$('load').onclick = () => loadLevel(S.level).catch(() => {});

// ---------------------------------------------------------------- 검증 결과
function renderValidation() {
  const d = cur(); const box = $('validation-box');
  if (!d) { box.hidden = true; return; }
  box.hidden = false;
  const r = d.residuals;
  const items = [
    ['(I − Ad) · L = I', '생산유발계수표가 국산투입계수로 만든 역행렬과 같은가', '최대 오차 ' + r['생산'].toExponential(1)],
    ['Am · L = 수입유발계수', '수입유발계수표가 수입투입계수 × 생산유발계수와 같은가', '최대 오차 ' + r['수입'].toExponential(1)],
    ['v̂ · L = 부가가치유발계수', '부가가치유발계수표가 부가가치율 × 생산유발계수와 같은가', '최대 오차 ' + r['부가가치'].toExponential(1)],
    ['각 열: 수입유발 + 부가가치유발 = 1',
      '국산품 최종수요 1원은 결국 수입 또는 국내 부가가치로 모두 나뉘는가' + (d.notProduced ? ` (국내 생산이 없는 ${d.notProduced}개 부문 제외)` : ''),
      '최대 오차 ' + r['수입+부가가치=1'].toExponential(1)],
  ];
  const ec = S.empCheck;
  if (ec) {
    for (const [k, label] of [['employment', '취업'], ['wage', '고용']]) {
      const c = ec[k];
      items.push([`대분류 ${label}계수 e · L = ${label}유발계수 (2023)`,
        `주요 분석표의 ${label}유발계수와 대분류 생산유발계수로 직접 계산한 값이 같은가 — 각주 "1)"이 붙은 ${c.excluded.map((x) => x.code).join('·')} ${c.excluded.length}개는 통합표 기준이라 비교에서 제외`,
        `${c.n}개 대분류 최대 오차 ${c.maxDiff.toExponential(1)}`, c.ok]);
    }
  }
  $('validation-summary').textContent = `${levelInfo().label} 원자료의 계수표 관계를 직접 계산해 확인했습니다 (허용 오차 1e-8${ec ? ', 취업유발 1e-6' : ''}).`;
  $('validation').replaceChildren(el('table', { class: 'check-table' }, el('tbody', {}, items.map(([f, why, err, ok = true]) =>
    el('tr', {}, el('td', { text: ok ? '✓' : '✗', class: ok ? '' : 'bad' }), el('td', {}, el('b', { text: f }), el('br'), el('span', { class: 'note', text: why })),
      el('td', { class: 'num' }, el('code', { text: err })))))));
  if (!ec && S.summary) {
    $('validation').append(el('p', { class: 'note', text: '취업유발 검증은 대분류를 불러오면 함께 표시됩니다.' }));
  }
}

// ---------------------------------------------------------------- 탭
function currentTab() {
  const id = (location.hash || '#explorer').slice(1);
  return TAB_IDS.includes(id) ? id : 'explorer';
}
function showTab() {
  const tab = currentTab();
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== tab; });
  document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.tab === tab)));
  hideTip();
  if (cur()) TABS[tab]?.render();
}
addEventListener('hashchange', showTab);

function renderAll() {
  const ready = !!cur();
  document.querySelectorAll('[data-empty]').forEach((e) => { e.hidden = ready; });
  document.querySelectorAll('[data-ready]').forEach((e) => { e.hidden = !ready; });
  renderValidation();
  if (!ready) return;
  TABS[currentTab()]?.render();
}

/** 화면 파일들이 모두 등록된 뒤 main.js에서 호출 */
function startApp() { renderLevels(); showTab(); renderAll(); }
