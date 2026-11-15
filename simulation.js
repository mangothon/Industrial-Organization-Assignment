'use strict';
/* =================================================================
   5. 파급효과 시뮬레이터 — 생산·부가가치·수입·취업자 유발, 분류 수준별 비교
   시나리오와 결과는 분류마다 따로 기억한다 (S.basket[n], S.result[n])
   ================================================================= */
(() => {
  const UI = { sortKey: 'production', groupMode: 'production', levelCmp: {} };
  let shownLevel = null;

  function render() {
    if (shownLevel !== S.level) { $('sim-search').value = ''; shownLevel = S.level; }
    renderFilterOptions($('sim-filter'), false);
    renderSectorList(); updateConvert(); renderBasket(); renderResult();
  }

  function renderSectorList() {
    const f = $('sim-filter').value; const q = $('sim-search').value.trim(); const keep = $('sim-sector').value;
    const list = cur().sectors.filter((s) => (!f || s.large === f) && match(s.code + ' ' + s.name, q));
    $('sim-sector').replaceChildren(...list.map((s) => option(s.code, `${s.code}  ${s.name}${s.produced ? '' : '  (국내 생산 없음)'}`, { disabled: !s.produced })));
    if (list.some((s) => s.code === keep)) $('sim-sector').value = keep;
  }
  const amountMillion = () => Number($('sim-amount').value) * Number($('sim-unit').value);
  function updateConvert() {
    const v = amountMillion();
    $('sim-convert').textContent = Number.isFinite(v) && v > 0 ? `= ${raw(v)}백만원 (${money(v, '억원')})` : '양(+)의 금액을 입력하세요.';
  }
  $('sim-filter').onchange = renderSectorList;
  $('sim-search').oninput = renderSectorList;
  $('sim-amount').oninput = updateConvert;
  $('sim-unit').onchange = updateConvert;

  const basket = () => S.basket[S.level] || (S.basket[S.level] = []);
  const invalidate = () => { delete S.result[S.level]; delete UI.levelCmp[S.level]; };
  $('sim-add').onclick = () => {
    const s = cur().byCode[$('sim-sector').value]; const amount = amountMillion();
    if (!s) { $('sim-status').textContent = '산업을 먼저 선택하세요.'; return; }
    if (!s.produced) { $('sim-status').textContent = `${s.name}은(는) 국내 생산이 없어 선택할 수 없습니다.`; return; }
    if (!Number.isFinite(amount) || amount <= 0) { $('sim-status').textContent = '양(+)의 증가액을 입력하세요.'; return; }
    const b = basket(); const same = b.find((x) => x.code === s.code);
    if (same) same.amount += amount; else b.push({ code: s.code, name: s.name, amount });
    invalidate(); renderBasket(); renderResult();
  };
  $('sim-clear').onclick = () => { S.basket[S.level] = []; invalidate(); renderBasket(); renderResult(); };

  function renderBasket() {
    const b = basket();
    $('basket').replaceChildren(...b.map((s, i) => el('li', {},
      el('div', {}, el('b', { text: s.name }), el('small', { text: `${s.code} · ${money(s.amount)}` })),
      el('button', { type: 'button', text: '삭제', onclick: () => { b.splice(i, 1); invalidate(); renderBasket(); renderResult(); } }))));
    $('sim-run').disabled = !b.length;
    const total = b.reduce((a, s) => a + s.amount, 0);
    $('sim-status').textContent = b.length ? `${b.length}개 산업, 합계 ${money(total)}` + (S.result[S.level] ? ' — 오른쪽 결과는 현재 시나리오 기준입니다.' : ' — 계산 버튼을 누르세요.') : '';
  }

  $('sim-run').onclick = async () => {
    const level = S.level;
    const snapshot = basket().map((s) => ({ code: s.code, amount: s.amount }));
    $('sim-run').disabled = true; $('sim-status').textContent = '계산 중…';
    try {
      const r = await call('simulate', { level: String(level), payload: snapshot });
      S.result[level] = r; delete UI.levelCmp[level]; UI.sortKey = 'production';
      if (level === S.level) { renderResult(); $('sim-status').textContent = '계산 완료 — 오른쪽 결과는 현재 시나리오 기준입니다.'; }
    } catch (e) { delete S.result[level]; renderResult(); $('sim-status').textContent = '계산 실패: ' + e.message; }
    finally { $('sim-run').disabled = !basket().length; }
  };

  function kpi(label, value, sub, hero) {
    return el('div', { class: 'kpi' + (hero ? ' hero' : '') }, el('div', { class: 'label', text: label }),
      el('div', { class: 'value', text: value }), sub ? el('div', { class: 'sub' }, ...sub) : null);
  }

  function renderResult() {
    const r = S.result[S.level];
    $('results').hidden = !r; $('sim-empty').hidden = !!r;
    if (!r) return;
    const share = (x) => pct(x / r.demand * 100);
    const empCard = r.employment === null
      ? kpi('취업유발', '–', ['주요 분석표 없음'])
      : kpi('취업유발', people(r.employment), [el('small', { text: `임금근로자 ${people(r.wage)}` }),
        r.approx ? el('span', { class: 'approx', text: '대분류 취업계수 적용 근사치' }) : null]);
    $('kpis').replaceChildren(
      kpi('수요 증가액', money(r.demand), [`${basket().length}개 산업 합계`]),
      kpi('생산유발액', money(r.production), ['생산유발 승수 ', el('b', { text: nfFixed(3).format(r.multiplier) + '배' })], true),
      kpi('부가가치유발액', money(r.valueAdded), ['수요 증가액의 ', el('b', { text: share(r.valueAdded) })]),
      kpi('수입유발액', money(r.imports), ['수요 증가액의 ', el('b', { text: share(r.imports) })]),
      empCard,
    );
    $('identity').replaceChildren(el('span', { class: 'badge good', text: '✓ 확인' }),
      `부가가치유발 ${share(r.valueAdded)} + 수입유발 ${share(r.imports)} = ${share(r.valueAdded + r.imports)} — 국산품 수요 1원은 결국 국내 부가가치나 수입으로 모두 나뉩니다.`);

    const dp = r.direct / r.production * 100;
    $('split').replaceChildren(
      el('div', { class: 'split-bar' }, el('div', { class: 'seg direct', style: `width:${dp}%` }), el('div', { class: 'seg indirect', style: `width:${100 - dp}%` })),
      el('div', { class: 'split-labels' },
        el('div', {}, el('i', { class: 'seg direct' }), el('b', { text: '직접효과 ' }), `${money(r.direct)} (${pct(dp)})`),
        el('div', { class: 'r' }, el('i', { class: 'seg indirect' }), el('b', { text: '간접효과 ' }), `${money(r.indirect)} (${pct(100 - dp)})`)));

    const deLegend = [[CAT[0], '직접효과'], [CAT[1], '간접효과']];
    $('top-legend').replaceChildren(legend(deLegend));
    renderGroups(r);
    stacked($('top-bars'), r.rows.slice(0, 15).map((x) => ({ ...x, sub: x.code })));
    renderResultTable();
    renderLevelCard();
  }

  function renderGroups(r) {
    const hasEmp = r.employment !== null;
    if (!hasEmp) UI.groupMode = 'production';
    $('group-mode').replaceChildren(hasEmp ? segmented([['production', '생산'], ['employment', '취업자']], UI.groupMode,
      (v) => { UI.groupMode = v; renderGroups(r); }, '보기') : '');
    if (UI.groupMode === 'production') {
      $('group-legend').replaceChildren(legend([[CAT[0], '직접효과'], [CAT[1], '간접효과']]));
      stacked($('group-bars'), r.groups.map((g) => ({ name: g.group, ...g })));
      $('group-source').textContent = SRC_IO;
    } else {
      $('group-legend').replaceChildren(legend([[CAT[0], '취업유발 (명)']]));
      const list = [...r.groups].sort((a, b) => b.employment - a.employment);
      hbars($('group-bars'), list.map((g) => ({ name: g.group, value: g.employment, label: people(g.employment), segs: [{ v: g.employment, color: CAT[0] }],
        tip: `<b>${esc(g.group)}</b><br>취업유발 ${people(g.employment)}<br><span class="t-muted">임금근로자</span> ${people(g.wage)}<br><span class="t-muted">생산유발</span> ${money(g.production)}` })));
      $('group-source').textContent = SRC_IO + ' · 취업계수: ' + SRC_SUMMARY.replace('자료: ', '') + (r.approx ? ' · 대분류 취업계수 적용 근사치' : '');
    }
  }

  function stacked(box, items) {
    hbars(box, items.map((x) => ({ name: x.name, sub: x.sub, label: money(x.production),
      segs: [{ v: x.direct, color: CAT[0] }, { v: Math.max(x.indirect, 0), color: CAT[1] }],
      tip: `<b>${esc(x.name)}</b><br>생산유발 ${money(x.production)}<br><span class="t-muted">직접</span> ${money(x.direct)} · <span class="t-muted">간접</span> ${money(x.indirect)}<br><span class="t-muted">부가가치</span> ${money(x.valueAdded)} · <span class="t-muted">수입</span> ${money(x.imports)}${x.employment !== undefined ? `<br><span class="t-muted">취업자</span> ${people(x.employment)}` : ''}` })));
  }

  function renderResultTable() {
    const r = S.result[S.level]; const q = $('res-search').value.trim();
    const unit = pickUnit(Math.max(...r.rows.map((x) => x.production)));
    const rows = [...r.rows].sort((a, b) => b[UI.sortKey] - a[UI.sortKey]).filter((x) => match(x.code + ' ' + x.name + ' ' + x.group, q));
    $('res-caption').textContent = `${levelInfo().label} ${r.rows.length}개 산업 전체 결과 · 단위 ${unit}(취업자는 명) · 머리글을 누르면 정렬`;
    const fmt = (v) => nf(unit === '조원' ? 3 : 1).format(v / UNITS[unit]);
    $('res-rows').replaceChildren(...rows.map((x, i) => el('tr', {},
      el('td', { class: 'num', text: String(i + 1) }), el('td', { text: x.code }), el('td', { text: x.name }), el('td', { class: 'muted', text: x.group }),
      el('td', { class: 'num', text: fmt(x.production) }), el('td', { class: 'num', text: fmt(x.direct) }), el('td', { class: 'num', text: fmt(x.indirect) }),
      el('td', { class: 'num', text: fmt(x.valueAdded) }), el('td', { class: 'num', text: fmt(x.imports) }),
      el('td', { class: 'num', text: r.employment === null ? '–' : nf(1).format(x.employment) }), el('td', { class: 'num', text: pct(x.share * 100) }))));
    document.querySelectorAll('table.sortable th[data-sort]').forEach((th) => th.classList.toggle('active', th.dataset.sort === UI.sortKey));
  }
  document.querySelectorAll('table.sortable th[data-sort]').forEach((th) => {
    th.onclick = () => { UI.sortKey = th.dataset.sort; renderResultTable(); };
  });
  $('res-search').oninput = () => S.result[S.level] && renderResultTable();

  $('download').onclick = () => {
    const r = S.result[S.level]; if (!r) return;
    const rows = [['산업코드', '산업명', '산업군', '생산유발액_백만원', '직접효과_백만원', '간접효과_백만원', '부가가치유발액_백만원', '수입유발액_백만원', '취업유발_명', '고용유발_명'],
      ...r.rows.map((x) => [x.code, x.name, x.group, x.production, x.direct, x.indirect, x.valueAdded, x.imports, x.employment, x.wage])];
    downloadRows(rows, `io-2023-${S.level}-파급효과.csv`);
  };

  // ---------------------------------------------------------------- 분류 수준별 비교
  function targets(n) { return [n, ...LEVELS.map((l) => l.n).filter((x) => x < n).sort((a, b) => b - a)]; }

  /** 현재 시나리오를 더 큰 분류 t로 옮긴다 (같은 대응 산업은 합산) */
  function convert(t) {
    const up = S.classification?.up || {};
    const out = new Map();
    for (const s of basket()) {
      const code = t === S.level ? s.code : up[s.code]?.[String(t)];
      if (!code) throw Error(`${s.code}의 ${levelInfo(t).label} 대응 산업을 찾을 수 없습니다.`);
      out.set(code, (out.get(code) || 0) + s.amount);
    }
    return [...out.entries()].map(([code, amount]) => ({ code, amount }));
  }

  function renderLevelCard() {
    const box = $('level-body'); const n = S.level;
    const ts = targets(n);
    const hint = el('p', { class: 'note', text: '4단계를 모두 비교하려면 기본부문에서 시나리오를 만드세요.' });
    if (ts.length < 2) { box.replaceChildren(emptyNote('대분류는 가장 큰 분류라 비교할 상위 분류가 없습니다.'), hint); return; }
    const res = UI.levelCmp[n];
    const missing = ts.filter((t) => !S.data[t]);
    const btn = el('button', { type: 'button', class: 'primary', text: UI.busy ? '비교 중… (상단 진행 표시 참고)' : res ? '다시 비교' : '분류 수준별 비교',
      disabled: !!UI.busy, onclick: () => runLevelCompare(btn) });
    const head = el('div', { class: 'card-tools' }, btn,
      el('span', { class: 'note', text: `비교 대상: ${ts.map((t) => levelInfo(t).label).join(' → ')}` + (missing.length ? ` · 아직 불러오지 않은 ${missing.map((t) => levelInfo(t).label).join('·')}는 자동으로 불러옵니다.` : '') }));
    if (!res) { box.replaceChildren(head, hint); return; }
    if (res.error) { box.replaceChildren(head, emptyNote('비교 실패: ' + res.error), hint); return; }
    const maxM = Math.max(...res.map((x) => x.r.multiplier));
    const bars = el('div');
    hbars(bars, res.map((x) => ({ name: levelInfo(x.t).label, sub: `${x.t}개 부문`, value: x.r.multiplier, label: nfFixed(3).format(x.r.multiplier) + '배',
      segs: [{ v: x.r.multiplier, color: x.t === n ? CAT[0] : GRAY }],
      tip: `<b>${levelInfo(x.t).label}</b><br>생산유발 승수 ${nfFixed(3).format(x.r.multiplier)}배<br>생산유발 ${money(x.r.production)}` })), { max: maxM * 1.05 });
    const table = el('div', { class: 'scroll short' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, ['분류', '대응 산업', '생산유발액', '승수', '부가가치', '수입', '취업자'].map((h, i) => el('th', { class: i > 1 ? 'num' : '', text: h })))),
      el('tbody', {}, res.map((x) => el('tr', { class: x.t === n ? 'selected' : '' },
        el('td', { text: levelInfo(x.t).label + (x.t === n ? ' (현재)' : '') }),
        el('td', { class: 'wrap-cell', text: x.shocks.map((s) => `${s.code} ${sectorName(s.code, x.t)} ${money(s.amount)}`).join(', ') }),
        el('td', { class: 'num', text: money(x.r.production) }), el('td', { class: 'num', text: nfFixed(3).format(x.r.multiplier) }),
        el('td', { class: 'num', text: money(x.r.valueAdded) }), el('td', { class: 'num', text: money(x.r.imports) }),
        el('td', { class: 'num', text: people(x.r.employment) }))))));
    box.replaceChildren(...[head, el('h4', { class: 'sub-h', text: '분류별 생산유발 승수' }), bars, table,
      el('p', { class: 'note', text: '큰 분류일수록 여러 산업의 평균 투입구조를 쓰므로 결과가 달라집니다(집계 편의). 예: 대분류 운송장비에는 승용차뿐 아니라 선박·항공기도 포함됩니다.' }),
      n !== 380 ? hint : null].filter(Boolean));
  }

  async function runLevelCompare(btn) {
    const n = S.level; UI.busy = true; btn.disabled = true;
    const ts = targets(n);
    try {
      const shocksBy = Object.fromEntries(ts.map((t) => [t, convert(t)]));   // 시작 시점의 시나리오로 고정
      for (const t of ts) if (!S.data[t]) { btn.textContent = `${levelInfo(t).label} 불러오는 중…`; await loadLevel(t); }
      const out = [];
      for (const t of ts) {
        btn.textContent = `${levelInfo(t).label} 계산 중…`;
        out.push({ t, shocks: shocksBy[t], r: await call('simulate', { level: String(t), payload: shocksBy[t] }) });
      }
      UI.levelCmp[n] = out;
    } catch (e) { UI.levelCmp[n] = { error: e.message }; }
    UI.busy = false;
    if (S.level === n && S.result[n]) renderLevelCard();
  }

  TABS.simulation = { render };
})();
