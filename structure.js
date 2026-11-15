'use strict';
/* =================================================================
   3. 경제구조 — 핵심 지표, 산업구조, 투입구조, 배분구조, 2020~2023 변화
   ①~④는 선택한 분류의 2023년 투입산출표, ⑤는 주요 분석표로 계산
   ================================================================= */
(() => {
  const VIEWS = [
    { id: 'kpiParent', label: '핵심 지표', sub: '전산업·품목별', parentOf: ['kpi', 'kpiItems'] },
    { id: 'kpi', label: '전산업', child: true },
    { id: 'kpiItems', label: '품목별', child: true },
    { id: 'industry', label: '산업구조', sub: '총산출·부가가치 구성' },
    { id: 'input', label: '투입구조', sub: '중간투입률·부가가치율 등' },
    { id: 'alloc', label: '배분구조', sub: '최종수요·수출률·중간수요율' },
    { id: 'trend', label: '2020~2023 변화', sub: '주요 분석표' },
  ];
  // 한국은행 보도자료 공표치 (2023년)
  const PUBLISHED = { intermediateRate: 58.8, vaRate: 41.2, importDependence: 13.6, localizationRate: 77.0,
    exportRate: 17.3, importRate: 14.9, output: 5786.7 };
  const PUB_FINAL = { consumption: 48.0, investment: 22.6, export: 29.4 };
  const INPUT_IND = {
    intermediateRate: { label: '중간투입률', num: 'inter', den: 'output', def: '중간투입계(9590) ÷ 총투입계(9790)' },
    vaRate: { label: '부가가치율', num: 'va', den: 'output', def: '부가가치계(9690) ÷ 총투입계(9790)' },
    importDependence: { label: '수입의존도', num: 'impInter', den: 'output', def: '수입거래표 중간투입계(9590) ÷ 총거래표 총투입계(9790)' },
    localizationRate: { label: '국산화율', num: 'domInter', den: 'inter', def: '국산거래표 중간투입계(9590) ÷ 총거래표 중간투입계(9590)' },
  };
  const ALLOC_IND = {
    exportRate: { label: '수출률', num: 'export', den: 'outCol', def: '수출(9140) ÷ 총산출(9310)' },
    interDemand: { label: '중간수요율', num: 'interDemand', den: 'totalDemand', def: '중간수요계(9090) ÷ 총수요계(9290). 재고가 줄어(재고증감 음수) 최종수요가 작아지면 100%를 넘을 수 있습니다' },
  };
  const TREND = {
    outputShare: { label: '총산출 구성', unit: '%' }, vaShare: { label: '부가가치 구성', unit: '%' },
    intermediateRate: { label: '중간투입률', unit: '%' }, localizationRate: { label: '국산화율', unit: '%' },
    importDependence: { label: '수입의존도', unit: '%' }, vaRate: { label: '부가가치율', unit: '%' },
    exportRate: { label: '수출률', unit: '%' }, importRate: { label: '수입률', unit: '%' },
  };
  /** 모든 비율 지표의 정의 (전산업 카드·순위·품목별 표가 함께 씀) */
  const RATES = {
    intermediateRate: { label: '중간투입률', num: 'inter', den: 'output', def: '중간투입계(9590) ÷ 총투입계(9790)' },
    vaRate: { label: '부가가치율', num: 'va', den: 'output', def: '부가가치계(9690) ÷ 총투입계(9790)' },
    importDependence: { label: '수입의존도', num: 'impInter', den: 'output', def: '수입거래표 중간투입계(9590) ÷ 총거래표 총투입계(9790)' },
    localizationRate: { label: '국산화율', num: 'domInter', den: 'inter', def: '국산거래표 중간투입계(9590) ÷ 총거래표 중간투입계(9590)' },
    exportRate: { label: '수출률', num: 'export', den: 'outCol', def: '수출(9140) ÷ 총산출(9310)' },
    importRate: { label: '수입률', num: 'imports', den: 'supply', def: '수입계(9329) ÷ 총공급계(9390)' },
    interDemand: { label: '중간수요율', num: 'interDemand', den: 'totalDemand', def: '중간수요계(9090) ÷ 총수요계(9290)' },
  };
  /** 금액을 합산한 객체(품목·산업군·전산업)에서 비율(%) 계산. 분모가 0이면 null */
  const rate = (obj, ind) => (obj[ind.den] ? obj[ind.num] / obj[ind.den] * 100 : null);

  const UI = { view: 'kpi', inputInd: 'intermediateRate', inputView: 'group', allocView: 'group', trendInd: 'outputShare',
    trendPick: ['조립가공제품', '생산자서비스'],
    items: { view: 'all', sort: null, dir: -1, q: '', large: '' } };

  async function render() {
    sideNav($('st-nav'), VIEWS, UI.view, (id) => { UI.view = id === 'kpiParent' ? 'kpi' : id; render(); });
    const main = $('st-main'); const level = S.level;
    let d;
    try { d = await cached('structure', { level: String(level) }); } catch (e) { main.replaceChildren(emptyNote('계산 실패: ' + e.message)); return; }
    if (level !== S.level) return;
    const view = { kpi: kpiView, kpiItems: itemsView, industry: industryView, input: inputView, alloc: allocView, trend: trendView }[UI.view];
    main.replaceChildren(...view(d));
    if (UI.view === 'kpiItems') drawItems();
  }
  const card = (title, sub, ...body) => el('article', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', {}, title, sub ? el('small', { text: sub }) : null)), ...body);
  const check = (ok, text) => (ok ? el('span', { class: 'badge good', text: '✓ ' + text }) : el('span', { class: 'badge warn', text: '공표치와 차이' }));

  // ---------------------------------------------------------------- ① 핵심 지표
  function kpiView(d) {
    const k = d.kpi; const lv = levelInfo().label;
    const vaPub = S.summary?.indicators?.vaAmount?.total?.[3];
    const items = [
      ['전산업 총산출', nfFixed(1).format(k.output / 1e6) + '조원', '총투입계(9790) 합계', Math.abs(k.output / 1e6 - PUBLISHED.output) <= 0.1, `공표 ${nf(1).format(PUBLISHED.output)}조원`],
      ['부가가치', nfFixed(1).format(k.valueAdded / 1e6) + '조원', '부가가치계(9690) 합계', vaPub ? Math.abs(k.valueAdded / 1e6 - vaPub) <= 0.1 : null, vaPub ? `주요 분석표 ${nf(2).format(vaPub)}조원` : ''],
      ['중간투입률', pct(k.intermediateRate), INPUT_IND.intermediateRate.def, near(k.intermediateRate, PUBLISHED.intermediateRate), `공표 ${PUBLISHED.intermediateRate}%`],
      ['부가가치율', pct(k.vaRate), INPUT_IND.vaRate.def, near(k.vaRate, PUBLISHED.vaRate), `공표 ${PUBLISHED.vaRate}%`],
      ['수입의존도', pct(k.importDependence), INPUT_IND.importDependence.def, near(k.importDependence, PUBLISHED.importDependence), `공표 ${PUBLISHED.importDependence}%`],
      ['국산화율', pct(k.localizationRate), INPUT_IND.localizationRate.def, near(k.localizationRate, PUBLISHED.localizationRate), `공표 ${PUBLISHED.localizationRate.toFixed(1)}%`],
      ['수출률', pct(k.exportRate), '수출(9140) ÷ 총산출(9310)', near(k.exportRate, PUBLISHED.exportRate), `공표 ${PUBLISHED.exportRate}%`],
      ['수입률', pct(k.importRate), '수입계(9329) ÷ 총공급계(9390)', near(k.importRate, PUBLISHED.importRate), `공표 ${PUBLISHED.importRate}%`],
    ];
    return [card('핵심 지표', `${lv} 투입산출표 · 2023년`,
      el('div', { class: 'kpi-grid' }, items.map(([label, value, def, ok, pub]) => el('div', { class: 'kpi' },
        el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }),
        el('div', { class: 'sub', text: def }),
        ok === null ? null : el('div', { class: 'sub' }, check(ok, ok && label === '부가가치' ? '주요 분석표와 일치' : '한국은행 공표치와 일치'), ' ', el('small', { class: 'muted', text: pub }))))),
      el('p', { class: 'note', text: '공표치와의 차이가 0.1%p(총산출·부가가치는 0.1조원) 이내이면 ✓를 붙입니다. 어느 분류로 계산해도 전산업 합계는 같습니다.' }),
      sourceNote(SRC_IO))];
  }
  const near = (a, b) => Math.abs(a - b) <= 0.1 + 1e-9;

  // ---------------------------------------------------------------- ①-2 품목별 핵심 지표
  const ITEM_RATES = ['intermediateRate', 'vaRate', 'importDependence', 'localizationRate', 'exportRate', 'importRate', 'interDemand'];
  const itemCache = new Map();   // `${분류}|${보기}` -> {rows, total}
  /** 분류를 불러온 뒤 한 번만 계산하고 기억 */
  function itemRows(d, view) {
    const key = S.level + '|' + view;
    if (itemCache.has(key)) return itemCache.get(key);
    const pack = (o, extra) => ({ ...extra, output: o.output, va: o.va,
      rates: Object.fromEntries(ITEM_RATES.map((k) => [k, rate(o, RATES[k])])) });
    const rows = view === 'all'
      ? d.sectors.map((s) => pack(s, { code: s.code, name: s.name, produced: s.produced, large: cur().byCode[s.code]?.large,
        search: (s.code + ' ' + s.name).toLowerCase() }))
      : d.groups.map((g) => pack(g, { code: '', name: g.group, produced: g.output > 0, search: g.group.toLowerCase() }));
    const out = { rows, total: pack(d.totals, { code: '', name: '전산업', produced: true }) };
    itemCache.set(key, out);
    return out;
  }

  let itemsData = null;
  function itemsView(d) {
    const st = UI.items;
    itemsData = d;
    const largeSel = el('select', { 'aria-label': '대분류 필터', onchange: (e) => { st.large = e.target.value; drawItems(); } });
    renderFilterOptions(largeSel, false);
    largeSel.value = st.large;
    if (largeSel.value !== st.large) st.large = '';
    const search = el('input', { class: 'small', placeholder: '품목 검색', value: st.q, 'aria-label': '품목 검색',
      oninput: (e) => { st.q = e.target.value; drawItems(); } });
    return [el('article', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '품목별 핵심 지표', el('small', { text: `${levelInfo().label} · 2023년` })),
        sourceNote(SRC_IO)),
      el('div', { class: 'card-tools' },
        segmented([['all', `${levelInfo().label} 전체 품목`], ['group', '13개 산업군']], st.view, (v) => { st.view = v; st.sort = null; render(); }, '보기'),
        search,
        st.view === 'all' ? el('label', { class: 'inline' }, '대분류', largeSel) : null,
        el('button', { type: 'button', class: 'ghost', text: 'CSV 다운로드', onclick: itemsCsv })),
      el('p', { class: 'note', text: '▲▼는 전산업 평균 대비 높고 낮음을 뜻합니다. 품목을 누르면 산업 프로필로 이동합니다.' }),
      el('div', { id: 'items-box' }),
      el('p', { class: 'note', text: (st.view === 'group' ? '13개 산업군은 산업군 안의 금액을 먼저 합산한 뒤 비율을 계산합니다. ' : '')
        + '국내 생산이 없는 품목은 총산출이 분모인 지표를 "–"로 표시합니다. 정의: '
        + ITEM_RATES.map((k) => `${RATES[k].label} = ${RATES[k].def}`).join(' · ') }))];
  }

  function itemColumns() {
    return [
      { key: 'output', label: '총산출', money: true }, { key: 'va', label: '부가가치', money: true },
      ...ITEM_RATES.map((k) => ({ key: k, label: RATES[k].label, rate: true })),
    ];
  }
  const cellValue = (r, c) => (c.rate ? r.rates[c.key] : r[c.key]);

  function drawItems() {
    const box = $('items-box'); if (!box || !itemsData) return;
    const st = UI.items;
    const { rows, total } = itemRows(itemsData, st.view);
    const q = st.q.trim().toLowerCase();
    let list = rows.filter((r) => (!q || r.search.includes(q)) && (st.view !== 'all' || !st.large || r.large === st.large));
    if (st.sort) {
      const col = itemColumns().find((c) => c.key === st.sort);
      list = [...list].sort((a, b) => {
        const x = cellValue(a, col), y = cellValue(b, col);
        if (x === null) return 1; if (y === null) return -1;   // 값 없음은 항상 맨 아래
        return (x - y) * st.dir;   // dir -1 = 내림차순
      });
    }
    const cols = itemColumns();
    const unit = pickUnit(Math.max(total.output, ...rows.map((r) => r.output)));
    const mfmt = (v) => nfFixed(unit === '조원' ? 2 : 0).format(v / UNITS[unit]);
    const head = el('tr', {}, el('th', { class: 'first' }, st.view === 'all' ? '코드 · 품목' : '산업군'),
      cols.map((c) => el('th', { class: 'num sort' + (st.sort === c.key ? ' active' : ''), title: '누르면 정렬',
        onclick: () => { if (st.sort === c.key) st.dir = -st.dir; else { st.sort = c.key; st.dir = -1; } drawItems(); } },
      c.label + (c.money ? ` (${unit})` : ' (%)'), el('span', { class: 'sort-mark', text: st.sort === c.key ? (st.dir < 0 ? ' ↓' : ' ↑') : ' ↕' }))));
    // 행 요소는 한 번만 만들고 정렬·검색 때는 순서만 바꾼다 (기본부문 380개도 즉시 반응)
    const row = (r, isTotal) => {
      const k = r._trKey = unit + '|' + st.view;
      if (r._tr && r._trFor === k) return r._tr;
      r._tr = buildRow(r, isTotal); r._trFor = k;
      return r._tr;
    };
    const buildRow = (r, isTotal) => {
      const first = el('th', { class: 'first' },
        r.code ? el('span', { class: 'code', text: r.code }) : null,
        !isTotal && st.view === 'all'
          ? el('button', { type: 'button', class: 'link', text: r.name, title: '원자료 탐색의 산업 프로필로 이동', onclick: () => openProfile(r.code) })
          : el('span', { text: r.name }),
        r.produced ? null : el('small', { class: 'np', text: '국내 생산 없음' }));
      return el('tr', { class: isTotal ? 'total-row' : '' }, first, cols.map((c) => {
        const v = cellValue(r, c);
        if (v === null || v === undefined) return el('td', { class: 'num muted', text: '–' });
        if (c.money) return el('td', { class: 'num', text: mfmt(v) });
        const t = total.rates[c.key];
        const diff = v - t;
        const mark = isTotal || Math.abs(diff) < 0.05 ? '' : diff > 0 ? '▲' : '▼';
        const td = el('td', { class: 'num' }, nfFixed(1).format(v), mark ? el('span', { class: 'cmp-mark', text: ' ' + mark }) : null);
        if (!isTotal) hoverTip(td, `<b>${esc(r.name)}</b> ${esc(c.label)} ${pct(v)}<br>전산업 ${pct(t)} 대비 ${diff >= 0 ? '+' : ''}${nfFixed(1).format(diff)}%p`);
        return td;
      }));
    };
    const table = el('table', { class: 'data items-table' }, el('thead', {}, head, row(total, true)),
      el('tbody', {}, list.length ? list.map((r) => row(r, false)) : el('tr', {}, el('td', { colspan: cols.length + 1, class: 'muted', text: '검색 결과가 없습니다.' }))));
    box.replaceChildren(el('div', { class: 'scroll items-scroll' }, table),
      el('p', { class: 'note', text: `${list.length}개 표시 · 금액 단위 ${unit}, 비율 단위 %` }));
    // 전산업 행을 머리글 바로 아래에 고정
    const h = head.getBoundingClientRect().height;
    table.querySelectorAll('tr.total-row > *').forEach((c) => { c.style.top = h + 'px'; });
  }

  function openProfile(code) {
    S.ex.sheet = 'A표_총거래표(생산자)'; S.ex.axis = 'row'; S.ex.key = code; S.ex.focusProfile = true;
    location.hash = '#explorer';
  }

  function itemsCsv() {
    const st = UI.items; const { rows, total } = itemRows(itemsData, st.view);
    const cols = itemColumns();
    const q = st.q.trim().toLowerCase();
    const list = rows.filter((r) => (!q || r.search.includes(q)) && (st.view !== 'all' || !st.large || r.large === st.large));
    const out = [[st.view === 'all' ? '코드' : '구분', st.view === 'all' ? '품목' : '산업군', '국내생산', ...cols.map((c) => c.label + (c.money ? '_백만원' : '_%'))],
      ...[total, ...list].map((r) => [r.code, r.name, r.produced ? '있음' : '없음', ...cols.map((c) => { const v = cellValue(r, c); return v === null ? '' : v; })])];
    downloadRows(out, `io-2023-${S.level}-품목별-핵심지표${st.view === 'group' ? '-산업군' : ''}.csv`);
  }

  // ---------------------------------------------------------------- ② 산업구조
  function groupColors(groups) {
    const top = [...groups].sort((a, b) => b.output - a.output).slice(0, 4).map((g) => g.group);
    let alt = 0;
    return Object.fromEntries(GROUP13.map((g) => [g, top.includes(g) ? CAT[top.indexOf(g)] : (alt++ % 2 ? GRAY_2 : GRAY)]));
  }
  function industryView(d) {
    const colors = groupColors(d.groups);
    const parts = (key) => GROUP13.map((g) => {
      const x = d.groups.find((y) => y.group === g);
      return { label: g, value: x ? x[key] : 0, color: colors[g], light: !CAT.includes(colors[g]) };
    });
    const tot = d.totals;
    const rows = GROUP13.map((g) => d.groups.find((y) => y.group === g)).filter(Boolean);
    return [card('산업구조', '13개 산업군 · 2023년',
      el('p', { class: 'note', text: '총산출이 큰 4개 산업군만 색으로, 나머지는 회색으로 표시합니다. 두 막대에서 같은 산업군은 같은 위치·같은 색입니다. 막대에 마우스를 올리면 산업군 이름과 값이 나옵니다.' }),
      stack100(parts('output'), { title: '총산출 구성', right: `전산업 ${money(tot.output, '조원')}`, total: tot.output, legend: false, labelMin: 6 }),
      stack100(parts('va'), { title: '부가가치 구성', right: `전산업 ${money(tot.va, '조원')}`, total: tot.va, legend: false, labelMin: 6 }),
      legend(GROUP13.map((g) => [colors[g], g])),
      el('div', { class: 'scroll short' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { text: '산업군' }), el('th', { class: 'num', text: '총산출' }), el('th', { class: 'num', text: '구성비' }),
          el('th', { class: 'num', text: '부가가치' }), el('th', { class: 'num', text: '구성비' }), el('th', { class: 'num', text: '부가가치율' }))),
        el('tbody', {}, rows.map((g) => el('tr', {}, el('td', {}, el('i', { class: 'dot', style: { background: colors[g.group] } }), g.group),
          el('td', { class: 'num', text: money(g.output, '조원') }), el('td', { class: 'num', text: pct(g.output / tot.output * 100) }),
          el('td', { class: 'num', text: money(g.va, '조원') }), el('td', { class: 'num', text: pct(g.va / tot.va * 100) }),
          el('td', { class: 'num', text: pct(g.va / g.output * 100) })))),
        el('tfoot', {}, el('tr', {}, el('td', { text: '전산업' }), el('td', { class: 'num', text: money(tot.output, '조원') }), el('td', { class: 'num', text: '100.0%' }),
          el('td', { class: 'num', text: money(tot.va, '조원') }), el('td', { class: 'num', text: '100.0%' }), el('td', { class: 'num', text: pct(tot.va / tot.output * 100) }))))),
      sourceNote(SRC_IO))];
  }

  // ---------------------------------------------------------------- ③·④ 순위 공통
  function rateRanking(d, ind, view, onView) {
    const avg = rate(d.totals, ind);
    let list;
    if (view === 'group') {
      list = d.groups.filter((g) => g[ind.den] > 0).map((g) => ({ name: g.group, value: rate(g, ind) }));
    } else {
      list = d.sectors.filter((s) => s.produced && s[ind.den] > 0).map((s) => ({ name: s.name, sub: s.code, value: rate(s, ind) }));
    }
    list.sort((a, b) => b.value - a.value);
    const max = Math.max(...list.map((x) => x.value), avg) * 1.02;
    const mk = (items) => {
      const box = el('div');
      hbars(box, items.map((x) => ({ ...x, segs: [{ v: x.value, color: CAT[0] }], label: pct(x.value),
        tip: `<b>${esc(x.name)}</b>${x.sub ? ' ' + esc(x.sub) : ''}<br>${ind.label} ${pct(x.value)}<br><span class="t-muted">전산업 평균</span> ${pct(avg)}` })),
      { max, avg: { value: avg, label: `전산업 평균 ${pct(avg)}` } });
      return box;
    };
    const excluded = d.sectors.filter((s) => !s.produced).length;
    const blocks = view === 'group' || list.length <= 30 ? [mk(list)]
      : [el('h4', { class: 'sub-h', text: `상위 15개` }), mk(list.slice(0, 15)), el('h4', { class: 'sub-h', text: `하위 15개` }), mk(list.slice(-15))];
    return [
      el('div', { class: 'card-tools' }, segmented([['group', '13개 산업군'], ['all', `${levelInfo().label} 전체 상위·하위 15개`]], view, onView, '보기')),
      el('p', { class: 'note', text: `정의: ${ind.def}` + (view === 'group' ? ' — 산업군은 금액을 합산한 뒤 비율을 계산합니다.' : '') + (excluded && view !== 'group' ? ` 국내 생산이 없는 ${excluded}개 부문은 제외했습니다.` : '') }),
      ...blocks];
  }

  function inputView(d) {
    const ind = INPUT_IND[UI.inputInd];
    return [card('투입구조', `${ind.label} · 2023년`,
      el('div', { class: 'card-tools' }, segmented(Object.entries(INPUT_IND).map(([k, v]) => [k, v.label]), UI.inputInd, (v) => { UI.inputInd = v; render(); }, '지표')),
      ...rateRanking(d, ind, UI.inputView, (v) => { UI.inputView = v; render(); }),
      sourceNote(SRC_IO))];
  }

  function allocView(d) {
    const f = d.final;
    const fdCard = card('최종수요 구성', '소비·투자·수출 · 2023년',
      stack100([
        { label: '소비', value: f.consumption, color: CAT[0] },
        { label: '투자', value: f.investment, color: CAT[1] },
        { label: '수출', value: f.export, color: CAT[2] },
      ], { title: '최종수요계 대비 구성비', right: `최종수요계 ${money(f.total, '조원')}`, total: 100, fmt: (v) => pct(v) }),
      el('div', { class: 'chips' }, [['소비', 'consumption'], ['투자', 'investment'], ['수출', 'export']].map(([l, k]) => el('div', { class: 'chip' },
        el('span', { text: `${l} (공표 ${PUB_FINAL[k].toFixed(1)}%)` }), el('b', { text: pct(f[k]) }), ' ', check(near(f[k], PUB_FINAL[k]), '일치')))),
      el('p', { class: 'note', text: '소비 = 민간소비 + 정부소비, 투자 = 민간·정부 고정자본형성 + 재고증감 + 귀중품 순취득' }),
      sourceNote(SRC_IO));
    return [fdCard, ...Object.entries(ALLOC_IND).map(([key, ind]) => card(`산업별 ${ind.label}`, '2023년',
      ...rateRanking(d, ind, UI.allocView, (v) => { UI.allocView = v; render(); }), sourceNote(SRC_IO)))];
  }

  // ---------------------------------------------------------------- ⑤ 2020~2023 변화
  function trendView() {
    const sm = S.summary;
    if (!sm) return [card('2020~2023 변화', '', emptyNote('주요 분석표를 불러오지 못했습니다.'))];
    const ind = sm.indicators[UI.trendInd]; const years = sm.years;
    const picks = UI.trendPick.filter((g) => ind.group[g]);
    const series = [
      ...GROUP13.filter((g) => ind.group[g] && !picks.includes(g)).map((g) => ({ name: g, values: ind.group[g], color: GRAY, width: 1.5, dim: true })),
      ...picks.map((g, i) => ({ name: g, values: ind.group[g], color: CAT[i], width: 2.5 })),
      { name: '전산업', values: ind.total, color: '#111418', width: 3.5 },
    ];
    const isShare = UI.trendInd.endsWith('Share');
    const shownSeries = isShare ? series.filter((s) => s.name !== '전산업') : series;
    const picker = el('div', { class: 'pick-chips' }, GROUP13.filter((g) => ind.group[g]).map((g) => {
      const on = picks.includes(g); const full = !on && picks.length >= 4;
      return el('label', { class: 'pick-chip' + (on ? ' on' : ''), title: full ? '최대 4개까지 고를 수 있습니다' : '' },
        el('input', { type: 'checkbox', checked: on, disabled: full, onchange: () => {
          UI.trendPick = on ? UI.trendPick.filter((x) => x !== g) : [...UI.trendPick, g]; render();
        } }),
        on ? el('i', { style: { background: CAT[picks.indexOf(g)] } }) : null, g);
    }));
    const fmt = (v) => (v === null || v === undefined ? '–' : nfFixed(isShare || UI.trendInd === 'importRate' ? 2 : 1).format(v) + '%');
    const rows = [...GROUP13.filter((g) => ind.group[g]).map((g) => [g, ind.group[g]]), ['전산업', ind.total]];
    return [card('2020~2023 변화', TREND[UI.trendInd].label,
      el('div', { class: 'card-tools' }, el('label', { class: 'inline' }, '지표', (() => {
        const s = el('select', { onchange: (e) => { UI.trendInd = e.target.value; render(); } }, Object.entries(TREND).map(([k, v]) => option(k, v.label)));
        s.value = UI.trendInd; return s;
      })())),
      el('p', { class: 'note', text: '산업군을 최대 4개까지 골라 색으로 강조합니다. ' + (isShare ? '구성비 지표는 전산업이 항상 100%라 선에서 뺐습니다.' : '굵은 검정 선은 전산업입니다.') }),
      picker,
      legend([...(isShare ? [] : [['#111418', '전산업']]), ...picks.map((g, i) => [CAT[i], g]), [GRAY, '나머지 산업군']]),
      lineChart(shownSeries, years, { fmt, label: TREND[UI.trendInd].label + ' 추이' }),
      el('p', { class: 'note', text: '단위: %' }),
      el('div', { class: 'scroll short' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, el('th', { text: '산업군' }), years.map((y) => el('th', { class: 'num', text: y + '년' })), el('th', { class: 'num', text: '2023−2022 (%p)' }))),
        el('tbody', {}, rows.map(([g, v]) => el('tr', { class: g === '전산업' ? 'summary-row' : '' }, el('td', { text: g }),
          v.map((x) => el('td', { class: 'num', text: fmt(x) })),
          el('td', { class: 'num ' + (v[3] - v[2] > 0 ? 'up' : v[3] - v[2] < 0 ? 'down' : ''), text: v[3] === null || v[2] === null ? '–' : (v[3] - v[2] > 0 ? '+' : '') + nfFixed(2).format(v[3] - v[2]) })))))),
      sourceNote(SRC_SUMMARY))];
  }

  TABS.structure = { render };
})();
