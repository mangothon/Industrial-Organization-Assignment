'use strict';
/* =================================================================
   1. 원자료 탐색 — 시트 설명, 가장 큰 연결, 산업 프로필, 행·열 펼쳐보기
   ================================================================= */
(() => {
  let shownLevel = null;

  function render() {
    renderSheetNav();
    const fresh = shownLevel !== S.level || !!S.ex.focusProfile;   // 다른 탭에서 품목을 골라 왔으면 필터를 비움
    shownLevel = S.level;
    loadSheet(fresh);
  }

  function renderSheetNav() {
    const groups = {};
    for (const s of cur().sheets) (groups[SHEETS[s.name]?.group || '기타'] ||= []).push(s);
    const items = Object.entries(groups).flatMap(([g, list]) => [{ heading: g },
      ...list.map((s) => ({ id: s.name, label: SHEETS[s.name]?.short || s.name }))]);
    sideNav($('sheet-nav'), items, S.ex.sheet, (id) => {
      S.ex.sheet = id; S.ex.axis = 'row'; renderSheetNav(); loadSheet(true, true);
    });
  }

  async function loadSheet(resetFilters, keepKey = true) {
    const sheet = S.ex.sheet; const meta = SHEETS[sheet] || {};
    const info = cur().sheets.find((s) => s.name === sheet);
    $('sheet-group').textContent = meta.group || '';
    $('sheet-title').textContent = info?.title || sheet;
    $('sheet-unit').textContent = '단위: ' + (meta.unit || info?.unit || '-');
    $('sheet-desc').textContent = meta.desc || '';
    $('sheet-row').textContent = meta.row || '';
    $('sheet-col').textContent = meta.col || '';
    document.querySelectorAll('[data-axis]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.axis === S.ex.axis)));
    if (resetFilters) { $('ex-search').value = ''; $('ex-filter').value = ''; $('ex-col-search').value = ''; }
    if (!keepKey) S.ex.key = '';   // 선택한 산업은 시트를 바꿔도 유지 (없으면 첫 항목)
    renderFilterOptions($('ex-filter'), true);
    const links = renderLinks(sheet);
    if (S.ex.focusProfile) await links;   // 위 카드 높이가 정해진 뒤 프로필로 이동
    await explore();
  }

  // ---------------------------------------------------------------- 가장 큰 연결
  async function renderLinks(sheet) {
    const card = $('links-card'); const info = cur().sheets.find((s) => s.name === sheet);
    card.hidden = !info?.square;
    if (!info?.square) return;
    const level = S.level;
    $('links-label').textContent = SHEETS[sheet]?.short || '';
    $('links').replaceChildren(emptyNote('계산 중…'));
    try {
      const links = await cached('top_links', { level: String(level), sheet });
      if (S.ex.sheet !== sheet || S.level !== level) return;
      const fmt = SHEETS[sheet].money ? money : coef;
      hbars($('links'), links.map((l) => ({
        name: `${l.fromName} → ${l.toName}`, sub: `${l.from}→${l.to}`, value: l.value,
        segs: [{ v: l.value, color: CAT[0] }],
        tip: `<span class="t-muted">공급(행)</span> <b>${esc(l.from)} ${esc(l.fromName)}</b><br><span class="t-muted">사용(열)</span> <b>${esc(l.to)} ${esc(l.toName)}</b><br>${fmt(l.value)}<br><span class="t-muted">누르면 공급 산업을 선택</span>`,
        onClick: () => selectSector(l.from),
      })), { fmt });
      $('links').classList.add('wide-names');
    } catch (e) { $('links').replaceChildren(emptyNote('계산 실패: ' + e.message)); }
  }

  function selectSector(code) {
    S.ex.axis = 'row'; S.ex.key = code;
    document.querySelectorAll('[data-axis]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.axis === 'row')));
    $('ex-search').value = ''; $('ex-filter').value = '';
    explore();
    scrollToCard($('profile-card'));
  }

  /** 카드 머리가 상단 고정 막대(분류 선택·진행 표시) 바로 아래에 오도록 이동 */
  function scrollToCard(card) {
    const bar = document.querySelector('.controlbar');
    const offset = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().height : 0;
    window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - offset - 12, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- 행·열 펼쳐보기
  let exploreSeq = 0;
  async function explore() {
    const seq = ++exploreSeq;
    try {
      const r = await call('explore', { level: String(S.level), sheet: S.ex.sheet, axis: S.ex.axis, key: S.ex.key });
      if (seq !== exploreSeq) return;
      S.ex.res = r; S.ex.key = r.selected;
      renderChoices(); renderCells(); renderProfile();
      if (S.ex.focusProfile) {
        S.ex.focusProfile = false;
        const key = r.selected;
        // 프로필 내용이 그려진 뒤(높이 확정) 이동
        cached('profile', { level: String(S.level), sheet: S.ex.sheet, code: key }).catch(() => {})
          .then(() => setTimeout(() => scrollToCard($('profile-card')), 50));
      }
    } catch (e) { $('ex-caption').textContent = '불러오기 실패: ' + e.message; }
  }

  function matchChoice(c, filter, q) {
    const s = cur().byCode[c.code];
    if (filter === '__sum' && !c.summary) return false;
    if (filter && filter !== '__sum' && (!s || s.large !== filter)) return false;
    return match(c.code + ' ' + c.name, q);
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
    let cells = r.cells.filter((c) => ($('ex-summary').checked || !c.summary) && match(c.code + ' ' + c.name, q));
    if ($('ex-sort').value === 'desc') cells = [...cells].sort((a, b) => (typeof b.value === 'number' ? b.value : -Infinity) - (typeof a.value === 'number' ? a.value : -Infinity));
    const scale = Math.max(...r.cells.filter((c) => !c.summary && typeof c.value === 'number').map((c) => Math.abs(c.value)), 1e-12);
    const dirText = S.ex.axis === 'row' ? '행' : '열';
    const sec = cur().byCode[r.selected];
    $('ex-caption').textContent = `${meta.short || S.ex.sheet} · ${dirText} ${r.selected} ${r.name}${sec && !sec.produced ? ' (국내 생산 없음)' : ''} — ${S.ex.axis === 'row' ? '가로로 펼친 값' : '세로로 펼친 값'} ${cells.length}개`;
    $('ex-rows').replaceChildren(...cells.map((c) => {
      const kind = cellKind(c.code); const isNum = typeof c.value === 'number';
      const bar = (!c.summary && isNum) ? el('div', { class: 'cell-bar' + (c.value < 0 ? ' neg' : ''), style: `width:${Math.min(100, Math.abs(c.value) / scale * 100)}%` }) : null;
      return el('tr', { class: c.summary ? 'summary' : '' },
        el('td', { text: c.code }), el('td', { text: c.name }),
        el('td', { class: 'num', text: fmtCell(c.value, kind), title: isNum ? raw(c.value) : '' }),
        el('td', {}, bar),
        el('td', { class: 'num muted', text: isNum ? (kind === 'money' ? raw(c.value) : String(+c.value.toPrecision(8))) : '' }));
    }));
  }

  $('ex-filter').onchange = renderChoices;
  $('ex-search').oninput = renderChoices;
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

  // ---------------------------------------------------------------- 산업 프로필
  let profileSeq = 0;
  async function renderProfile() {
    const box = $('profile'); const code = S.ex.res?.selected; const sheet = S.ex.sheet; const level = S.level;
    const s = cur().byCode[code];
    if (!s) {
      $('profile-label').textContent = ''; $('profile-sheet').textContent = '';
      box.replaceChildren(emptyNote('산업을 선택하면 프로필이 표시됩니다.'));
      return;
    }
    $('profile-label').textContent = `${s.code} ${s.name}`;
    $('profile-sheet').textContent = SHEETS[sheet]?.short || sheet;
    const seq = ++profileSeq;
    try {
      const p = await cached('profile', { level: String(level), sheet, code });
      if (seq !== profileSeq) return;
      box.replaceChildren(...(p.kind === 'trade' ? tradeProfile(p, sheet) : p.kind === 'coef' ? coefProfile(p, sheet) : fdProfile(p)));
    } catch (e) { box.replaceChildren(emptyNote('계산 실패: ' + e.message)); }
  }

  function metricChips(list, produced) {
    return el('div', { class: 'chips' }, list.map((m) => el('div', { class: 'chip' },
      el('span', { text: m.label }),
      el('b', { text: m.value === null || m.value === undefined ? (produced ? '–' : '국내 생산 없음')
        : m.kind === 'money' ? money(m.value) : m.kind === 'pct' ? pct(m.value) : coef(m.value) }))));
  }

  /** 두 가로 막대 그룹을 같은 눈금으로 */
  function twinBars(left, right, fmt, notes = {}) {
    const max = Math.max(...left.items.map((x) => x.value), ...right.items.map((x) => x.value), 1e-12);
    const block = (side) => {
      const box = el('div');
      if (side.items.length) {
        hbars(box, side.items.map((x) => ({ name: x.name, sub: x.code, value: x.value, segs: [{ v: x.value, color: side.color }],
          tip: `<b>${esc(x.code)} ${esc(x.name)}</b><br>${fmt(x.value)}`, onClick: () => selectSector(x.code) })), { max, fmt });
      } else box.append(emptyNote('해당 값이 없습니다.'));
      return el('div', { class: 'twin' }, el('h4', { text: side.title }), side.note ? el('p', { class: 'note', text: side.note }) : null, box);
    };
    return el('div', { class: 'twin-grid' }, block(left), block(right), notes.self ? el('p', { class: 'note span-2', text: notes.self }) : null);
  }

  function tradeProfile(p, sheet) {
    const out = [metricChips(p.metrics, p.produced)];
    if (p.input) {
      out.push(stack100([
        { label: '국산 중간재', value: p.input.parts[0].value, color: CAT[0] },
        { label: '수입 중간재', value: p.input.parts[1].value, color: CAT[1] },
        { label: '부가가치', value: p.input.parts[2].value, color: CAT[2] },
      ], { title: '투입구조', right: `분모: 총투입 ${money(p.input.total)}`, total: p.input.total, totalLabel: '총투입' }));
    } else if (sheet === TOTAL_SHEET_NAME && !p.produced) {
      out.push(emptyNote('투입구조: 국내 생산 없음'));
    }
    const a = p.allocation;
    if (a.total > 0) {
      out.push(stack100([
        { label: '중간수요', value: a.parts[0].value, color: CAT[0] },
        { label: '소비', value: a.parts[1].value, color: CAT[1] },
        { label: '투자', value: a.parts[2].value, color: CAT[2] },
        { label: '수출', value: a.parts[3].value, color: CAT[3] },
      ], { title: '배분구조', right: `분모: 총수요 ${money(a.total)}`, total: a.total, totalLabel: '총수요' }));
      out.push(el('p', { class: 'note', text: sheet === TOTAL_SHEET_NAME
        ? '총수요에는 수입품 공급분이 포함되어 총산출보다 큼 · 투자 = 민간·정부 고정자본형성 + 재고증감 + 귀중품 순취득'
        : '투자 = 민간·정부 고정자본형성 + 재고증감 + 귀중품 순취득' }));
    } else out.push(emptyNote('배분구조: 이 표에서 수요가 없습니다.'));
    const selfNote = p.self ? `자기 부문 거래 ${money(p.self)} 별도(막대에서 제외)` : '';
    out.push(twinBars(
      { title: '주요 구매처 — 이 부문이 사들인 상품 상위 5개 (열 방향)', items: p.suppliers, color: CAT[0] },
      { title: '주요 판매처 — 이 상품을 사 간 부문 상위 5개 (행 방향)', items: p.buyers, color: CAT[1] },
      money, { self: selfNote }));
    return out;
  }

  function coefProfile(p, sheet) {
    const out = [];
    const chips = [];
    if (p.induce) {
      chips.push({ label: '자기 부문(대각)', value: p.self, kind: 'coef' });
      chips.push({ label: '열합', value: p.colSum, kind: 'coef' });
      chips.push({ label: '행합', value: p.rowSum, kind: 'coef' });
      if (sheet === '생산유발계수') {
        chips.push({ label: '영향력계수', value: p.influence, kind: 'coef' });
        chips.push({ label: '감응도계수', value: p.sensitivity, kind: 'coef' });
      }
    } else {
      chips.push({ label: '열합 (중간투입률 의미)', value: p.produced ? p.colSum : null, kind: 'coef' });
      chips.push({ label: '행합', value: p.rowSum, kind: 'coef' });
    }
    out.push(metricChips(chips, p.produced));
    const titles = p.induce
      ? ['이 산업 수요 1원이 끌어올리는 산업 상위 8개 (열)', '이 산업을 끌어올리는 수요 상위 8개 (행)']
      : ['생산 1원당 투입 상위 8개 (열)', '이 상품을 많이 쓰는 산업 상위 8개 (행)'];
    out.push(twinBars({ title: titles[0], items: p.column, color: CAT[0] }, { title: titles[1], items: p.row, color: CAT[1] }, coef,
      { self: p.induce ? `자기 부문 값 ${coef(p.self)} 별도(막대에서 제외)` : '' }));
    return out;
  }

  function fdProfile(p) {
    const v = Object.fromEntries(p.fd.parts.map((x) => [x.key, x.value]));
    const out = [stack100([
      { label: '민간소비', value: v['9111'], color: CAT[0] },
      { label: '정부소비', value: v['9112'], color: CAT[1] },
      { label: '투자', value: v['9121'] + v['9122'] + v['9131'] + v['9132'], color: CAT[2] },
      { label: '수출', value: v['9140'], color: CAT[3] },
    ], { title: '최종수요 항목별 구성', right: `최종수요계 ${money(p.fd.total)}`, totalLabel: '합계' })];
    out.push(el('table', { class: 'mini-table' }, el('tbody', {}, p.fd.parts.map((x) =>
      el('tr', {}, el('td', { text: x.label }), el('td', { class: 'num', text: money(x.value) }),
        el('td', { class: 'num muted', text: p.fd.total ? pct(x.value / p.fd.total * 100) : '–' }))))));
    if (!p.fd.total) out.unshift(emptyNote(p.produced ? '값이 없습니다.' : '국내 생산 없음'));
    return out;
  }

  const TOTAL_SHEET_NAME = 'A표_총거래표(생산자)';
  TABS.explorer = { render };
})();
