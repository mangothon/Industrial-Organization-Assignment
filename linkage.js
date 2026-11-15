'use strict';
/* =================================================================
   4. 산업연관효과 — 유발계수 순위, 영향력·감응도 4분면, 최종수요 항목별 유발, 고용유발
   ================================================================= */
(() => {
  const VIEWS = [
    { id: 'rank', label: '유발계수 순위', sub: '생산·부가가치·수입' },
    { id: 'quad', label: '영향력·감응도 4분면', sub: '전방·후방 연쇄' },
    { id: 'fd', label: '최종수요 항목별 유발', sub: '소비·투자·수출' },
    { id: 'jobs', label: '고용유발', sub: '주요 분석표' },
  ];
  const FD_LABEL = { '9111': '민간소비', '9112': '정부소비', '9121': '민간고정자본형성', '9122': '정부고정자본형성',
    '9131': '재고증감', '9132': '귀중품 순취득', '9140': '수출', '9190': '최종수요계' };
  const UI = { view: 'rank', rankInd: 'production', rankView: 'group', sizeByOutput: false, search: '', fdSector: '',
    jobKind: 'employment', jobYear: 2023, jobView: 'large' };

  async function render() {
    sideNav($('lk-nav'), VIEWS, UI.view, (id) => { UI.view = id; render(); });
    const main = $('lk-main'); const level = S.level;
    let d;
    try { d = await cached('linkage', { level: String(level) }); } catch (e) { main.replaceChildren(emptyNote('계산 실패: ' + e.message)); return; }
    if (level !== S.level) return;
    const view = { rank: rankView, quad: quadView, fd: fdView, jobs: jobsView }[UI.view];
    main.replaceChildren(...view(d));
  }
  const card = (title, sub, ...body) => el('article', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', {}, title, sub ? el('small', { text: sub }) : null)), ...body);
  const lv = () => levelInfo().label;

  // ---------------------------------------------------------------- ① 유발계수 순위
  function rankView(d) {
    const groupView = UI.rankView === 'group';
    const base = groupView ? d.groups.map((g) => ({ ...g, name: g.group })) : d.sectors.filter((s) => s.produced).map((s) => ({ ...s, sub: s.code }));
    const tools = el('div', { class: 'card-tools' },
      segmented([['production', '생산유발계수'], ['vam', '부가가치·수입 유발계수']], UI.rankInd, (v) => { UI.rankInd = v; render(); }, '지표'),
      segmented([['group', '13개 산업군(산출액 가중 평균)'], ['all', `${lv()} 전체 상위·하위 15개`]], UI.rankView, (v) => { UI.rankView = v; render(); }, '보기'));
    const split = (list) => (groupView || list.length <= 30 ? [list] : [list.slice(0, 15), list.slice(-15)]);
    const excluded = d.sectors.filter((s) => !s.produced).length;
    const exNote = excluded && !groupView ? ` 국내 생산이 없는 ${excluded}개 부문은 제외했습니다.` : '';
    if (UI.rankInd === 'production') {
      const list = [...base].sort((a, b) => b.lSum - a.lSum);
      const avg = d.avg.lSum;
      const max = Math.max(...list.map((x) => x.lSum)) * 1.02;
      const parts = split(list);
      const blocks = parts.flatMap((p, i) => {
        const box = el('div');
        hbars(box, p.map((x) => ({ name: x.name, sub: x.sub, label: coef(x.lSum),
          segs: [{ v: x.lDiag, color: CAT[0] }, { v: x.lSum - x.lDiag, color: CAT[1] }],
          tip: `<b>${esc(x.name)}</b><br>생산유발계수(열합) ${coef(x.lSum)}<br><span class="t-muted">자기 부문</span> ${coef(x.lDiag)} · <span class="t-muted">다른 부문으로 파급</span> ${coef(x.lSum - x.lDiag)}` })),
        { max, avg: { value: avg, label: `전산업 평균 ${coef(avg)} (부문 단순 평균)` } });
        return parts.length > 1 ? [el('h4', { class: 'sub-h', text: i ? '하위 15개' : '상위 15개' }), box] : [box];
      });
      return [card('생산유발계수 순위', `${lv()} · 열합 = 그 산업 최종수요 1원이 경제 전체에 일으키는 생산`, tools,
        legend([[CAT[0], '자기 부문(대각)'], [CAT[1], '다른 부문으로 파급(열합 − 대각)']]),
        el('p', { class: 'note', text: (groupView ? '산업군 값은 소속 산업의 열합을 총산출로 가중 평균한 것입니다.' : '') + exNote }),
        ...blocks, sourceNote(SRC_IO))];
    }
    const list = [...base].sort((a, b) => b.vSum - a.vSum);
    const parts = split(list);
    const blocks = parts.flatMap((p, i) => {
      const box = el('div');
      hbars(box, p.map((x) => ({ name: x.name, sub: x.sub, label: `${pct(x.vSum * 100)} / ${pct(x.mSum * 100)}`,
        segs: [{ v: x.vSum, color: CAT[0] }, { v: x.mSum, color: CAT[1] }],
        tip: `<b>${esc(x.name)}</b><br><span class="t-muted">부가가치유발계수</span> ${coef(x.vSum)}<br><span class="t-muted">수입유발계수</span> ${coef(x.mSum)}<br>합 ${coef(x.vSum + x.mSum)}` })), { max: 1 });
      return parts.length > 1 ? [el('h4', { class: 'sub-h', text: i ? '하위 15개' : '상위 15개' }), box] : [box];
    });
    return [card('부가가치·수입 유발계수', `${lv()} · 국산품 수요 1원 = 부가가치 + 수입`, tools,
      legend([[CAT[0], '부가가치유발계수(열합)'], [CAT[1], '수입유발계수(열합)']]),
      el('p', { class: 'note', text: '두 값의 합은 1입니다. 부가가치 몫이 큰 순서로 정렬했습니다. 오른쪽 숫자 = 부가가치 몫 / 수입 몫.' + exNote }),
      ...blocks, sourceNote(SRC_IO))];
  }

  // ---------------------------------------------------------------- ② 영향력·감응도 4분면
  function quadView(d) {
    const list = d.sectors.filter((s) => s.produced);
    const W = 760, H = 480, m = { l: 56, r: 20, t: 16, b: 46 };
    const xs = list.map((s) => s.influence), ys = list.map((s) => s.sensitivity);
    const xlo = Math.min(...xs, 1) - 0.05, xhi = Math.max(...xs, 1) + 0.05;
    const ylo = Math.max(0, Math.min(...ys, 1) - 0.1), yhi = Math.max(...ys, 1) + 0.1;
    const X = (v) => m.l + (v - xlo) / (xhi - xlo) * (W - m.l - m.r);
    const Y = (v) => m.t + (yhi - v) / (yhi - ylo) * (H - m.t - m.b);
    const maxOut = Math.max(...list.map((s) => s.output));
    const q = UI.search.trim();
    const hit = (s) => q && match(s.code + ' ' + s.name, q);
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': '영향력계수와 감응도계수 산점도' });
    for (const t of niceTicks(xlo, xhi, 6)) {
      g.append(svg('line', { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, class: 'grid' }));
      g.append(svg('text', { x: X(t), y: H - m.b + 16, 'text-anchor': 'middle', class: 'axis', text: nf(2).format(t) }));
    }
    for (const t of niceTicks(ylo, yhi, 6)) {
      g.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: 'grid' }));
      g.append(svg('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end', class: 'axis', text: nf(2).format(t) }));
    }
    g.append(svg('line', { x1: X(1), x2: X(1), y1: m.t, y2: H - m.b, class: 'ref' }));
    g.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(1), y2: Y(1), class: 'ref' }));
    g.append(svg('text', { x: (m.l + W - m.r) / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-title', text: '영향력계수 (후방연쇄) →' }));
    g.append(svg('text', { x: 14, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', class: 'axis-title', transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})`, text: '감응도계수 (전방연쇄) →' }));
    const corner = [['핵심 연관산업', W - m.r - 6, m.t + 14, 'end'], ['중간재·기반형', m.l + 6, m.t + 14, 'start'],
      ['최종재형', W - m.r - 6, H - m.b - 8, 'end'], ['독립형', m.l + 6, H - m.b - 8, 'start']];
    for (const [t, x, y, a] of corner) g.append(svg('text', { x, y, 'text-anchor': a, class: 'quad-label', text: t }));
    const sorted = [...list].sort((a, b) => (hit(a) - hit(b)) || (b.output - a.output));
    for (const s of sorted) {
      const r = UI.sizeByOutput ? 3 + Math.sqrt(s.output / maxOut) * 16 : 5;
      const h = hit(s);
      const c = svg('circle', { cx: X(s.influence), cy: Y(s.sensitivity), r: h ? Math.max(r, 6) : r,
        fill: h ? CAT[1] : CAT[0], 'fill-opacity': h ? 0.95 : 0.55, stroke: '#fff', 'stroke-width': 1 });
      hoverTip(c, `<b>${esc(s.code)} ${esc(s.name)}</b><br>영향력계수 ${coef(s.influence)}<br>감응도계수 ${coef(s.sensitivity)}<br>총산출 ${money(s.output)}`);
      g.append(c);
      const right = X(s.influence) > W * 0.75;
      if (h) g.append(svg('text', { x: X(s.influence) + (right ? -8 : 8), y: Y(s.sensitivity) - 8, 'text-anchor': right ? 'end' : 'start', class: 'point-label', text: s.name }));
    }
    const quads = [
      ['핵심 연관산업', '둘 다 ≥ 1', '다른 산업에서 많이 사들이고(후방) 다른 산업에도 많이 공급하는(전방) 산업입니다. 경기 파급의 중심입니다.', (s) => s.influence >= 1 && s.sensitivity >= 1],
      ['최종재형(후방연쇄 강함)', '영향력만 ≥ 1', '수요가 늘면 원료·부품을 많이 사들여 다른 산업 생산을 크게 끌어올리지만, 다른 산업의 수요에는 덜 민감합니다.', (s) => s.influence >= 1 && s.sensitivity < 1],
      ['중간재·기반형(전방연쇄 강함)', '감응도만 ≥ 1', '여러 산업의 중간재로 쓰여 경제 전체 수요가 늘 때 생산이 크게 늘어나는 산업입니다.', (s) => s.influence < 1 && s.sensitivity >= 1],
      ['독립형', '둘 다 < 1', '다른 산업과의 거래 연결이 상대적으로 약한 산업입니다.', (s) => s.influence < 1 && s.sensitivity < 1],
    ];
    const search = el('input', { class: 'small', placeholder: '산업 검색 → 주황 강조', value: UI.search,
      oninput: (e) => { UI.search = e.target.value; clearTimeout(quadView.t); quadView.t = setTimeout(() => { render().then(() => { const i = document.querySelector('#lk-main input.small'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 250); } });
    return [card('영향력·감응도 4분면', `${lv()} · 생산유발계수 9801 행·9802 열`,
      el('div', { class: 'card-tools' }, search,
        el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: UI.sizeByOutput, onchange: (e) => { UI.sizeByOutput = e.target.checked; render(); } }), '점 크기 = 총산출')),
      el('div', { class: 'chart-box' }, g),
      el('p', { class: 'note', text: `x = 영향력계수(열합 ÷ 열합 평균), y = 감응도계수(행합 ÷ 행합 평균). 기준선 1 = 전산업 평균.${d.sectors.length - list.length ? ` 국내 생산이 없는 ${d.sectors.length - list.length}개 부문은 제외했습니다.` : ''}` }),
      el('div', { class: 'quad-grid' }, quads.map(([t, cond, why, f]) => {
        const items = list.filter(f).sort((a, b) => (b.influence + b.sensitivity) - (a.influence + a.sensitivity));
        return el('div', { class: 'quad' }, el('h4', {}, t, el('small', { text: ` ${cond} · ${items.length}개` })),
          el('p', { class: 'note', text: why }),
          el('p', { class: 'quad-list', text: items.length ? items.map((s) => s.name).join(', ') : '없음' }));
      })),
      sourceNote(SRC_IO))];
  }

  // ---------------------------------------------------------------- ③ 최종수요 항목별 유발
  function fdView(d) {
    const items = d.items.filter((x) => x.production !== null);
    const max = Math.max(...items.flatMap((x) => [x.production, x.valueAdded, x.imports]));
    const grouped = el('div', { class: 'grouped' }, items.map((x) => el('div', { class: 'grp' + (x.code === '9190' ? ' total' : '') },
      el('div', { class: 'grp-name', text: FD_LABEL[x.code] || x.name }),
      el('div', { class: 'grp-bars' }, [['production', '생산', CAT[0]], ['valueAdded', '부가가치', CAT[1]], ['imports', '수입', CAT[2]]].map(([k, l, c]) =>
        hoverTip(el('div', { class: 'gb' }, el('div', { class: 'gb-bar', style: { width: (Math.max(x[k], 0) / max * 100) + '%', background: c } }),
          el('span', { text: coef(x[k]) })), `<b>${esc(FD_LABEL[x.code] || x.name)}</b><br>${l}유발계수 ${coef(x[k])}<br><span class="t-muted">항목 최종수요</span> ${money(x.amount)}`))))));
    // 산업 하나의 생산유발액 구성
    const prod = d.sectors.filter((s) => s.produced && s.fdTotal > 0);
    if (!prod.some((s) => s.code === UI.fdSector)) UI.fdSector = [...prod].sort((a, b) => b.output - a.output)[0]?.code || '';
    const sel = el('select', { onchange: (e) => { UI.fdSector = e.target.value; render(); } }, prod.map((s) => option(s.code, `${s.code} ${s.name}`)));
    sel.value = UI.fdSector;
    const s = prod.find((x) => x.code === UI.fdSector);
    const fdv = s ? Object.fromEntries(['9111', '9112', '9121', '9122', '9131', '9132', '9140'].map((c, i) => [c, s.fd[i]])) : null;
    const comp = s ? stack100([
      { label: '민간소비', value: fdv['9111'], color: CAT[0] },
      { label: '정부소비', value: fdv['9112'], color: CAT[1] },
      { label: '투자', value: fdv['9121'] + fdv['9122'] + fdv['9131'] + fdv['9132'], color: CAT[2] },
      { label: '수출', value: fdv['9140'], color: CAT[3] },
    ], { title: `${s.name} 생산유발액의 최종수요 항목별 구성`, right: `합계 ${money(s.fdTotal)}`, totalLabel: '합계' }) : emptyNote('산업이 없습니다.');
    const dep = prod.map((x) => ({ name: x.name, sub: x.code, value: x.fd[6] / x.fdTotal * 100 })).sort((a, b) => b.value - a.value).slice(0, 15);
    const depBox = el('div');
    hbars(depBox, dep.map((x) => ({ ...x, segs: [{ v: x.value, color: CAT[0] }], label: pct(x.value),
      tip: `<b>${esc(x.name)}</b><br>수출 의존도 ${pct(x.value)}` })), { max: 100 });
    return [
      card('최종수요 항목별 유발계수', `${lv()} · 항목별 최종수요 1원당 유발액`,
        legend([[CAT[0], '생산유발계수'], [CAT[1], '부가가치유발계수'], [CAT[2], '수입유발계수']]),
        grouped,
        el('p', { class: 'note', text: '최종수요 항목별 유발액 시트의 9811(유발계수) 행 = 항목별 유발액 ÷ 항목별 최종수요액입니다. 수입유발에는 수입 최종재 구매도 포함되므로, 부가가치·수입 유발계수의 합이 항목에 따라 1과 다를 수 있습니다.' }),
        sourceNote(SRC_IO)),
      card('산업별 생산유발의 원천', '어떤 최종수요가 이 산업의 생산을 만들었나',
        el('div', { class: 'card-tools' }, el('label', { class: 'inline' }, '산업', sel)), comp,
        el('p', { class: 'note', text: '투자 = 민간·정부 고정자본형성 + 재고증감 + 귀중품 순취득' }),
        sourceNote(SRC_IO)),
      card('수출 의존도 상위 15개 산업', '생산유발액 중 수출이 유발한 몫',
        el('p', { class: 'note', text: '수출 의존도 = 최종수요 항목별 생산유발액 시트의 수출(9140) 열 ÷ 최종수요계(9190) 열' }),
        depBox, sourceNote(SRC_IO)),
    ];
  }

  // ---------------------------------------------------------------- ④ 고용유발
  function jobsView() {
    const sm = S.summary;
    if (!sm) return [card('고용유발', '', emptyNote('주요 분석표를 불러오지 못했습니다.'))];
    const emp = UI.jobKind === 'employment';
    const direct = sm.indicators[emp ? 'employmentCoef' : 'wageCoef'];
    const induce = sm.indicators[emp ? 'employmentInduce' : 'wageInduce'];
    const yi = sm.years.indexOf(UI.jobYear);
    const keys = UI.jobView === 'large' ? Object.keys(induce.large) : GROUP13.filter((g) => induce.group[g]);
    const src = UI.jobView === 'large' ? 'large' : 'group';
    const rows = keys.map((k) => ({ key: k, name: src === 'large' ? largeName(k) : k, foot: src === 'large' && direct.footnote[k],
      d: direct[src][k]?.[yi], i: induce[src][k]?.[yi] }))
      .filter((r) => r.d !== null && r.d !== undefined && r.i !== null && r.i !== undefined && (r.d > 0 || r.i > 0))
      .sort((a, b) => b.i - a.i);
    const max = Math.max(...rows.map((r) => Math.max(r.d, r.i))) * 1.05;
    const list = el('div', { class: 'dumbbells' }, rows.map((r) => {
      const a = r.d / max * 100, b = r.i / max * 100;
      return hoverTip(el('div', { class: 'db-row' },
        el('div', { class: 'name', title: r.name }, r.name, r.foot ? el('small', { text: '1)' }) : null),
        el('div', { class: 'db-track' },
          el('div', { class: 'db-line', style: { left: Math.min(a, b) + '%', width: Math.abs(b - a) + '%' } }),
          el('i', { class: 'db-dot', style: { left: a + '%', background: CAT[0] } }),
          el('i', { class: 'db-dot', style: { left: b + '%', background: CAT[1] } })),
        el('div', { class: 'val', text: `${nf(1).format(r.d)} → ${nf(1).format(r.i)}` })),
      `<b>${esc(r.name)}</b><br>직접(${emp ? '취업' : '고용'}계수) ${nf(2).format(r.d)}명/10억원<br>파급 포함(${emp ? '취업' : '고용'}유발계수) ${nf(2).format(r.i)}명/10억원<br><span class="t-muted">다른 산업에서 생기는 일자리</span> ${nf(2).format(r.i - r.d)}명`);
    }));
    const yearSel = el('select', { onchange: (e) => { UI.jobYear = +e.target.value; render(); } }, sm.years.map((y) => option(y, y + '년')));
    yearSel.value = UI.jobYear;
    return [card('고용유발', `${emp ? '취업(전체 취업자)' : '고용(임금근로자)'} · ${UI.jobYear}년 · 명/10억원`,
      el('div', { class: 'card-tools' },
        segmented([['employment', '취업(전체 취업자)'], ['wage', '고용(임금근로자)']], UI.jobKind, (v) => { UI.jobKind = v; render(); }, '종류'),
        el('label', { class: 'inline' }, '연도', yearSel),
        segmented([['large', '대분류 33개'], ['group', '13개 산업군']], UI.jobView, (v) => { UI.jobView = v; render(); }, '보기')),
      legend([[CAT[0], `직접(${emp ? '취업' : '고용'}계수)`, 'round'], [CAT[1], `파급 포함(${emp ? '취업' : '고용'}유발계수)`, 'round']]),
      el('p', { class: 'note', text: '선이 길수록 다른 산업에서 생기는 일자리가 많습니다. 산출액 10억원을 생산할 때(직접) 또는 그 산업 최종수요가 10억원 늘 때(파급 포함) 필요한 사람 수입니다.' }),
      list,
      el('p', { class: 'note', text: '"1)"이 붙은 항목은 주요 분석표에서 통합표(1·7·13부문) 기준으로 작성된 값입니다. 유발계수 순으로 정렬했습니다.' }),
      sourceNote(SRC_SUMMARY))];
  }

  TABS.linkage = { render };
})();
