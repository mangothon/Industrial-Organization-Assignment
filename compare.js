'use strict';
/* =================================================================
   2. 원자료 비교 — 행과 열을 직접 골라 만드는 맞춤 비교표
   상태는 분류별·시트별로 기억한다 (S.cmp[분류][시트])
   ================================================================= */
(() => {
  const QUICK = {
    va: { label: '부가가치 항목', codes: ['9610', '9621', '9622', '9630', '9690'] },
    fd: { label: '최종수요 항목', codes: ['9111', '9112', '9121', '9122', '9131', '9132', '9140', '9190'] },
    total: { label: '합계 항목', codes: ['9090', '9190', '9290', '9310', '9329', '9390', '9590', '9790', '9819', '9811', '9812', '9801', '9802'] },
  };
  const BIG = 50;
  let sheet = SHEET_NAMES[0];
  let axes = null;        // 현재 시트의 행·열 항목 목록
  let marked = { rows: new Set(), cols: new Set() };   // 묶기용 표시

  const isMoney = () => !!SHEETS[sheet]?.money;
  const isSquare = () => !!cur().sheets.find((s) => s.name === sheet)?.square;
  function state() {
    const lv = (S.cmp[S.level] ||= {});
    return (lv[sheet] ||= { rows: [], cols: [], same: true, mode: 'value', rest: true });
  }
  const itemKey = (codes) => codes.join('+');
  const single = (code) => ({ key: code, members: [code] });

  async function render() {
    const level = S.level; const sh = sheet;
    axes = await cached('sheet_axes', { level: String(level), sheet: sh });
    if (level !== S.level || sh !== sheet) return;
    if (!isSquare()) state().same = false;
    renderToolbar();
    await renderTable();
  }

  // ---------------------------------------------------------------- 도구 막대
  function renderToolbar() {
    const st = state();
    const sel = el('select', { 'aria-label': '시트 선택', onchange: (e) => { sheet = e.target.value; marked = { rows: new Set(), cols: new Set() }; render(); } },
      SHEET_NAMES.filter((n) => cur().sheets.some((s) => s.name === n)).map((n) => option(n, SHEETS[n].short)));
    sel.value = sheet;
    const sameBox = el('label', { class: 'check', title: isSquare() ? '' : '이 시트는 행과 열의 항목이 달라 함께 고를 수 없습니다.' },
      el('input', { type: 'checkbox', checked: st.same, disabled: !isSquare(), onchange: (e) => { st.same = e.target.checked; renderToolbar(); } }), '행·열 같게');
    const restBox = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: st.rest, onchange: (e) => { st.rest = e.target.checked; renderTable(); } }), '나머지 합계 표시');
    const unit = isMoney() ? '단위: ' + (st.mode === 'value' ? (lastUnit || '억원·조원') : '%') : '단위: ' + (st.mode === 'value' ? '계수(단위 없음)' : '%');
    const marks = marked.rows.size + marked.cols.size;
    const groupTools = isMoney()
      ? el('div', { class: 'group-tools' },
        el('span', { class: 'note', text: marks ? `묶을 항목: 행 ${marked.rows.size}개 · 열 ${marked.cols.size}개` : '항목 이름 앞 □를 골라 묶을 수 있습니다' }),
        el('input', { id: 'cmp-group-name', class: 'small', placeholder: '묶음 이름', disabled: marks < 2 }),
        el('button', { type: 'button', class: 'ghost', text: '묶기', disabled: marks < 2, onclick: makeGroup }))
      : el('p', { class: 'note', text: '계수 표는 단순 합산이 성립하지 않아 묶을 수 없습니다.' });
    $('cmp-toolbar').replaceChildren(
      el('div', { class: 'cmp-row' },
        el('label', { class: 'inline' }, '시트', sel),
        sameBox,
        el('button', { type: 'button', class: 'ghost', text: '⇄ 행·열 바꾸기', onclick: swap }),
        segmented([['value', isMoney() ? '금액(원값)' : '원값'], ['colpct', '열 비중 %'], ['rowpct', '행 비중 %']], st.mode, (v) => { st.mode = v; renderToolbar(); renderTable(); }, '표시 방식'),
        restBox,
        el('button', { type: 'button', class: 'ghost', text: 'CSV 다운로드', onclick: downloadCsv, disabled: !st.rows.length || !st.cols.length }),
        el('span', { class: 'unit-badge cmp-unit', text: unit })),
      el('div', { class: 'cmp-row' }, groupTools));
  }

  function swap() {
    const st = state(); [st.rows, st.cols] = [st.cols, st.rows];
    marked = { rows: marked.cols, cols: marked.rows };
    renderToolbar(); renderTable();
  }

  function makeGroup() {
    const st = state();
    const name = ($('cmp-group-name')?.value || '').trim() || '사용자 묶음';
    const apply = (list, keys) => {
      const chosen = list.filter((it) => keys.has(it.key));
      if (chosen.length < 1) return list;
      const members = [...new Set(chosen.flatMap((it) => it.members))];
      const at = list.indexOf(chosen[0]);
      const rest = list.filter((it) => !keys.has(it.key));
      rest.splice(at, 0, { key: 'g:' + name + ':' + itemKey(members), label: name, members, group: true });
      return rest;
    };
    let rowKeys = new Set(marked.rows), colKeys = new Set(marked.cols);
    if (st.same) { const all = new Set([...rowKeys, ...colKeys]); rowKeys = all; colKeys = all; }
    if (rowKeys.size) st.rows = apply(st.rows, rowKeys);
    if (colKeys.size) st.cols = apply(st.cols, colKeys);
    marked = { rows: new Set(), cols: new Set() };
    renderToolbar(); renderTable();
  }

  // ---------------------------------------------------------------- 추가·삭제
  function addItems(axis, items) {
    const st = state();
    const push = (list, it, available) => {
      if (!it.members.every((c) => available.has(c))) return;
      if (!list.some((x) => x.key === it.key)) list.push(it);
    };
    const avail = (ax) => new Set(axes[ax].map((x) => x.code));
    const targets = st.same ? ['rows', 'cols'] : [axis];
    for (const ax of targets) for (const it of items) push(st[ax], it, avail(ax));
    renderToolbar(); renderTable();
  }
  function removeItem(axis, key) {
    const st = state();
    for (const ax of st.same ? ['rows', 'cols'] : [axis]) st[ax] = st[ax].filter((x) => x.key !== key);
    marked.rows.delete(key); marked.cols.delete(key);
    renderToolbar(); renderTable();
  }

  // ---------------------------------------------------------------- 선택 창
  function openPicker(axis, anchor) {
    closePicker();
    const list = axes[axis];
    const have = new Set(state()[axis].filter((x) => x.members.length === 1).map((x) => x.members[0]));
    const checked = new Set();
    const byLarge = cur().byCode;
    const level33 = S.level === 33;
    // 묶음: 대분류 단위(대분류 화면이면 13개 산업군)
    const groups = new Map();
    for (const it of list) {
      let g;
      if (it.summary || !byLarge[it.code]) g = '합계·지표 항목';
      else if (level33) g = byLarge[it.code].group;
      else { const s = byLarge[it.code]; g = `${s.large} ${s.largeName}`; }
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(it);
    }
    const search = el('input', { placeholder: '이름·코드 검색', 'aria-label': '항목 검색' });
    const listBox = el('div', { class: 'pick-list' });
    const count = el('span', { class: 'note' });
    const addBtn = el('button', { type: 'button', class: 'primary', text: '추가' });

    function visible() { const q = search.value.trim(); return list.filter((it) => match(it.code + ' ' + it.name, q)); }
    function drawList() {
      const q = search.value.trim();
      listBox.replaceChildren(...[...groups.entries()].map(([g, items]) => {
        const shown = items.filter((it) => match(it.code + ' ' + it.name, q));
        if (!shown.length) return null;
        const free = shown.filter((it) => !have.has(it.code));
        const all = free.length && free.every((it) => checked.has(it.code));
        const head = el('label', { class: 'pick-group' },
          el('input', { type: 'checkbox', checked: all, disabled: !free.length,
            onchange: (e) => { for (const it of free) e.target.checked ? checked.add(it.code) : checked.delete(it.code); drawList(); } }),
          el('b', { text: g }), el('small', { text: `${items.length}개` }));
        return el('div', { class: 'pick-block' }, head, ...shown.map((it) => {
          const s = byLarge[it.code];
          return el('label', { class: 'pick-item' + (have.has(it.code) ? ' have' : '') },
            el('input', { type: 'checkbox', checked: have.has(it.code) || checked.has(it.code), disabled: have.has(it.code),
              onchange: (e) => { e.target.checked ? checked.add(it.code) : checked.delete(it.code); drawList(); } }),
            el('span', { text: `${it.code} ${it.name}` }), s && !s.produced ? el('small', { text: '국내 생산 없음' }) : null,
            have.has(it.code) ? el('small', { text: '추가됨' }) : null);
        }));
      }).filter(Boolean));
      count.textContent = `${checked.size}개 선택`;
      addBtn.disabled = !checked.size;
      warnSize(state()[axis].length + checked.size);
    }
    search.oninput = drawList;
    const codesHere = new Set(list.map((x) => x.code));
    const quick = (key) => {
      const codes = QUICK[key].codes.filter((c) => codesHere.has(c) && !have.has(c));
      return el('button', { type: 'button', class: 'chip-btn', text: QUICK[key].label, disabled: !codes.length,
        title: codes.length ? '' : '이 시트에 해당 항목이 없습니다', onclick: () => { codes.forEach((c) => checked.add(c)); drawList(); } });
    };
    const groupBtn = el('button', { type: 'button', class: 'chip-btn', text: '13개 산업군', disabled: !isMoney(),
      title: isMoney() ? '13개 산업군 묶음을 추가합니다' : '계수 표는 단순 합산이 성립하지 않아 묶을 수 없습니다',
      onclick: () => {
        const items = GROUP13.map((g) => ({ key: 'grp:' + g, label: g, members: list.filter((it) => !it.summary && byLarge[it.code]?.group === g).map((it) => it.code), group: true }))
          .filter((it) => it.members.length);
        closePicker(); addItems(axis, items);
      } });
    addBtn.onclick = () => {
      const order = list.map((x) => x.code).filter((c) => checked.has(c));
      closePicker(); addItems(axis, order.map(single));
    };
    const panel = el('div', { class: 'popover', role: 'dialog', 'aria-label': (axis === 'rows' ? '행' : '열') + ' 추가' },
      el('div', { class: 'pop-head' }, el('b', { text: (axis === 'rows' ? '행' : '열') + ' 추가' + (state().same ? ' (행·열 같게)' : '') }),
        el('button', { type: 'button', class: 'ghost small-btn', text: '닫기', onclick: closePicker })),
      search,
      el('div', { class: 'pop-row' },
        el('button', { type: 'button', class: 'ghost small-btn', text: '전체 선택', onclick: () => { visible().forEach((it) => { if (!have.has(it.code)) checked.add(it.code); }); drawList(); } }),
        el('button', { type: 'button', class: 'ghost small-btn', text: '전체 해제', onclick: () => { checked.clear(); drawList(); } })),
      el('div', { class: 'pop-row quick' }, el('span', { class: 'note', text: '빠른 선택' }), groupBtn, quick('va'), quick('fd'), quick('total')),
      listBox,
      el('div', { class: 'pop-foot' }, count, addBtn));
    const backdrop = el('div', { class: 'pop-backdrop', onclick: closePicker });
    document.body.append(backdrop, panel);
    drawList(); search.focus();
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closePicker(); }
  function closePicker() {
    document.querySelectorAll('.popover, .pop-backdrop').forEach((n) => n.remove());
    document.removeEventListener('keydown', escClose);
    warnSize(Math.max(state().rows.length, state().cols.length));
  }
  function warnSize(n) {
    $('cmp-warn').replaceChildren(n > BIG ? el('p', { class: 'warn', text: `선택 항목이 ${n}개입니다. 표가 커서 느려질 수 있습니다.` }) : '');
  }

  // ---------------------------------------------------------------- 표
  let lastUnit = null, lastResult = null, tableSeq = 0;
  async function renderTable() {
    const st = state(); const body = $('cmp-body');
    warnSize(Math.max(st.rows.length, st.cols.length));
    if (!st.rows.length && !st.cols.length) { renderEmpty(); return; }
    const seq = ++tableSeq; const level = S.level; const sh = sheet;
    let r;
    try {
      r = await cached('compare', { level: String(level), sheet: sh, payload: { rows: st.rows, cols: st.cols, rest: st.rest } });
    } catch (e) { body.replaceChildren(emptyNote('계산 실패: ' + e.message)); return; }
    if (seq !== tableSeq || level !== S.level || sh !== sheet) return;
    lastResult = r;
    const disp = (i, j) => {
      const v = r.values[i][j];
      if (st.mode === 'colpct') return r.colDen[j] ? v / r.colDen[j] * 100 : null;
      if (st.mode === 'rowpct') return r.rowDen[i] ? v / r.rowDen[i] * 100 : null;
      return v;
    };
    const core = (it) => it.kind === 'sector' || it.kind === 'group';
    let maxAbs = 0, maxCore = 0;
    r.rows.forEach((ri, i) => r.cols.forEach((cj, j) => {
      const v = disp(i, j); if (v === null) return;
      maxAbs = Math.max(maxAbs, Math.abs(v));
      if (core(ri) && core(cj)) maxCore = Math.max(maxCore, Math.abs(v));
    }));
    let fmt;
    if (st.mode !== 'value') { fmt = (v) => (v === null ? '–' : nfFixed(1).format(v)); lastUnit = '%'; }
    else if (r.money) {
      lastUnit = maxAbs >= 1e6 ? '조원' : '억원';
      const div = UNITS[lastUnit]; const f = nfFixed(lastUnit === '조원' ? 2 : 0);
      fmt = (v) => f.format(v / div);
    } else { fmt = coef; lastUnit = null; }
    const unitText = st.mode !== 'value' ? '%' : r.money ? lastUnit : '계수(단위 없음)';
    document.querySelector('.cmp-unit') && (document.querySelector('.cmp-unit').textContent = '단위: ' + unitText);

    const headCell = (axis, it) => {
      const removable = it.kind !== 'rest' && it.kind !== 'appended';
      const markable = isMoney() && (it.kind === 'sector' || it.kind === 'group');
      const set = marked[axis];
      return el('div', { class: 'hcell' },
        markable ? el('input', { type: 'checkbox', checked: set.has(it.key), title: '묶을 항목으로 표시',
          onchange: (e) => { e.target.checked ? set.add(it.key) : set.delete(it.key); renderToolbar(); } }) : null,
        el('span', { class: 'hname', title: `${it.key.startsWith('g') ? '' : it.key + ' '}${it.label}${it.n > 1 ? ` (${it.n}개 합)` : ''}`,
          text: it.label + (it.kind === 'group' ? ` (${it.n})` : '') }),
        removable ? el('button', { type: 'button', class: 'x', 'aria-label': it.label + ' 삭제', text: '✕', onclick: () => removeItem(axis, it.key) }) : null);
    };
    const cls = (it) => (it.kind === 'rest' || it.kind === 'appended' ? 'gray' : it.kind === 'summary' ? 'sumitem' : '');
    const thead = el('thead', {}, el('tr', {},
      el('th', { class: 'corner', text: `${SHEETS[sh].short} · 행 \\ 열` }),
      r.cols.map((c) => el('th', { class: 'num ' + cls(c) }, headCell('cols', c))),
      el('th', { class: 'add-col' }, el('button', { type: 'button', class: 'add-btn', text: '+ 열 추가', onclick: (e) => openPicker('cols', e.target) }))));
    const tbody = el('tbody', {}, r.rows.map((ri, i) => el('tr', { class: cls(ri) },
      el('th', { class: 'rowhead ' + cls(ri) }, headCell('rows', ri)),
      r.cols.map((cj, j) => {
        const v = disp(i, j);
        const shade = core(ri) && core(cj) && maxCore > 0 && v !== null ? rampColor(Math.abs(v) / maxCore * 0.5) : null;
        const td = el('td', { class: 'num ' + cls(cj), style: shade ? { background: shade } : {}, text: fmt(v) });
        hoverTip(td, () => `<b>${esc(ri.label)} → ${esc(cj.label)}</b><br>${r.money ? money(r.values[i][j]) : coef(r.values[i][j])}`
          + `<br><span class="t-muted">열 비중</span> ${r.colDen[j] ? pct(r.values[i][j] / r.colDen[j] * 100) : '–'} · <span class="t-muted">행 비중</span> ${r.rowDen[i] ? pct(r.values[i][j] / r.rowDen[i] * 100) : '–'}`);
        return td;
      }),
      el('td', { class: 'add-col' }))),
    el('tr', { class: 'add-row' }, el('th', {}, el('button', { type: 'button', class: 'add-btn', text: '+ 행 추가', onclick: (e) => openPicker('rows', e.target) })),
      el('td', { colspan: r.cols.length + 1 })));
    const note = st.mode === 'value' ? null : el('p', { class: 'note', text: `${st.mode === 'colpct' ? '열' : '행'} 비중 % = 값 ÷ ${st.mode === 'colpct' ? '열' : '행'} 합계 × 100. 분모는 '나머지 합계'를 포함한 산업 전체에 선택한 구성 항목(부가가치·최종수요 등)을 더한 값입니다.` });
    body.replaceChildren(...[el('div', { class: 'scroll cmp-scroll' }, el('table', { class: 'data cmp-table' }, thead, tbody)), note,
      el('p', { class: 'note', text: '색이 진할수록 표 안에서 값이 큽니다(산업 칸만 칠함). 회색 행·열은 나머지 합계·합계 항목입니다.' })].filter(Boolean));
  }

  function renderEmpty() {
    const level = S.level;
    const ex = [['C07', 'C09', 'C12'], '1차 금속·컴퓨터전자·운송장비 비교'];
    const exampleBtn = el('button', { type: 'button', class: 'secondary inline-btn', text: '예시: ' + ex[1], onclick: () => {
      let items;
      if (level === 33) items = ex[0].map(single);
      else if (isMoney()) items = ex[0].map((lg) => ({ key: 'grp:' + lg, label: largeName(lg), members: codesForLarge([lg]), group: true }));
      else items = codesForLarge(ex[0]).map(single);
      state().same = isSquare();
      if (!isSquare()) {   // 최종수요 항목별 시트: 행 = 산업, 열 = 최종수요 항목
        state().rows = items; state().cols = axes.cols.filter((c) => c.code !== '9190').map((c) => single(c.code));
        renderToolbar(); renderTable(); return;
      }
      addItems('rows', items);
    } });
    const groupBtn = isMoney() && isSquare() ? el('button', { type: 'button', class: 'ghost inline-btn', text: '예시: 13개 산업군 거래 구조', onclick: () => {
      state().same = true;
      addItems('rows', GROUP13.map((g) => ({ key: 'grp:' + g, label: g, members: cur().sectors.filter((s) => s.group === g).map((s) => s.code), group: true })));
    } }) : null;
    $('cmp-body').replaceChildren(el('div', { class: 'empty small' },
      el('p', {}, '아직 고른 행·열이 없습니다. ', el('b', { text: '+ 행 추가' }), ' / ', el('b', { text: '+ 열 추가' }), '로 항목을 고르거나 예시로 시작하세요.'),
      el('div', { class: 'row-buttons center' }, exampleBtn, groupBtn,
        el('button', { type: 'button', class: 'ghost inline-btn', text: '+ 행 추가', onclick: (e) => openPicker('rows', e.target) }),
        el('button', { type: 'button', class: 'ghost inline-btn', text: '+ 열 추가', onclick: (e) => openPicker('cols', e.target) })),
      level !== 33 ? el('p', { class: 'note', text: '예시는 부문분류표로 찾은 이 분류의 대응 산업을 씁니다. 금액 시트에서는 대분류별 묶음으로, 계수 시트에서는 개별 산업으로 추가됩니다.' }) : null));
  }

  function downloadCsv() {
    const r = lastResult; const st = state(); if (!r) return;
    const val = (i, j) => (st.mode === 'colpct' ? (r.colDen[j] ? r.values[i][j] / r.colDen[j] * 100 : '')
      : st.mode === 'rowpct' ? (r.rowDen[i] ? r.values[i][j] / r.rowDen[i] * 100 : '') : r.values[i][j]);
    const unit = st.mode === 'value' ? (r.money ? '백만원' : '계수') : '%';
    const rows = [[`행\\열 (${unit})`, ...r.cols.map((c) => c.label)], ...r.rows.map((ri, i) => [ri.label, ...r.cols.map((_, j) => val(i, j))])];
    downloadRows(rows, `io-2023-${S.level}-비교-${SHEETS[sheet].short}.csv`);
  }

  TABS.compare = { render };
})();

/** CSV 저장 (공통) */
function csvCell(v) { let s = String(v); if (/^[=+@-]/.test(s) && typeof v !== 'number') s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }
function downloadRows(rows, filename) {
  const url = URL.createObjectURL(new Blob(['﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
