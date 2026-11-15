'use strict';
/* =================================================================
   2. 원자료 비교 — 행과 열을 직접 골라 만드는 맞춤 비교표
   상태는 분류별·시트별로 기억한다 (S.cmp[분류][시트])
   한쪽 축만 고르면 다른 축은 '전체 산업'(개별 산업 전부)으로 표시한다.
   ================================================================= */
(() => {
  const QUICK = {
    va: { label: '부가가치 항목', codes: ['9610', '9621', '9622', '9630', '9690'] },
    fd: { label: '최종수요 항목', codes: ['9111', '9112', '9121', '9122', '9131', '9132', '9140', '9190'] },
    total: { label: '합계 항목', codes: ['9090', '9190', '9290', '9310', '9329', '9390', '9590', '9790', '9819', '9811', '9812', '9801', '9802'] },
  };
  const AXIS_LABEL = { rows: '행', cols: '열' };
  const BIG = 50;
  let sheet = SHEET_NAMES[0];
  let axes = null;        // 현재 시트의 행·열 항목 목록
  let marked = { rows: new Set(), cols: new Set() };   // 묶기용 표시

  const isMoney = () => !!SHEETS[sheet]?.money;
  const isSquare = () => !!cur().sheets.find((s) => s.name === sheet)?.square;
  function state() {
    const lv = (S.cmp[S.level] ||= {});
    return (lv[sheet] ||= { rows: [], cols: [], same: false, mode: 'value', rest: true });
  }
  const itemKey = (codes) => codes.join('+');
  const single = (code) => ({ key: code, members: [code] });
  const allSectors = (axis) => axes[axis].filter((it) => it.sector).map((it) => single(it.code));
  const other = (axis) => (axis === 'rows' ? 'cols' : 'rows');
  /** 화면에 쓰는 실제 목록: 한쪽만 비어 있으면 그 축은 전체 산업 */
  function effective(axis) {
    const st = state();
    if (!st[axis].length && st[other(axis)].length) return allSectors(axis);
    return st[axis];
  }
  const implicit = (axis) => !state()[axis].length && !!state()[other(axis)].length;

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
    const restBox = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: st.rest, onchange: (e) => { st.rest = e.target.checked; renderTable(); } }), '나머지 합계 표시');
    const unit = '단위: ' + (st.mode !== 'value' ? '%' : isMoney() ? (lastUnit || '억원·조원') : '계수(단위 없음)');
    const marks = marked.rows.size + marked.cols.size;
    const groupTools = isMoney()
      ? el('div', { class: 'group-tools' },
        el('span', { class: 'note', text: marks ? `묶을 항목: 행 ${marked.rows.size}개 · 열 ${marked.cols.size}개` : '표의 항목 이름 앞 □를 골라 묶을 수 있습니다' }),
        el('input', { id: 'cmp-group-name', class: 'small', placeholder: '묶음 이름', disabled: marks < 2 }),
        el('button', { type: 'button', class: 'ghost', text: '묶기', disabled: marks < 2, onclick: makeGroup }))
      : el('p', { class: 'note', text: '계수 표는 단순 합산이 성립하지 않아 묶을 수 없습니다.' });
    const hasTable = st.rows.length || st.cols.length;
    $('cmp-toolbar').replaceChildren(
      el('div', { class: 'cmp-row' },
        el('label', { class: 'inline' }, '시트', sel),
        el('button', { type: 'button', class: 'ghost', text: '⇄ 행·열 바꾸기', onclick: swap, disabled: !hasTable }),
        segmented([['value', isMoney() ? '금액(원값)' : '원값'], ['colpct', '열 비중 %'], ['rowpct', '행 비중 %']], st.mode, (v) => { st.mode = v; renderToolbar(); renderTable(); }, '표시 방식'),
        restBox,
        el('button', { type: 'button', class: 'ghost', text: 'CSV 다운로드', onclick: downloadCsv, disabled: !hasTable }),
        el('button', { type: 'button', class: 'secondary inline-btn', text: '행/열 수정', onclick: () => openEditor('rows') }),
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
      if (!chosen.length) return list;
      const members = [...new Set(chosen.flatMap((it) => it.members))];
      const at = list.indexOf(chosen[0]);
      const rest = list.filter((it) => !keys.has(it.key));
      rest.splice(at, 0, { key: 'g:' + name + ':' + itemKey(members), label: name, members, group: true });
      return rest;
    };
    for (const ax of ['rows', 'cols']) {
      if (marked[ax].size) st[ax] = apply(effective(ax), marked[ax]);
    }
    marked = { rows: new Set(), cols: new Set() };
    renderToolbar(); renderTable();
  }

  /** 표의 ✕: 그 축에서 바로 삭제 (전체 산업 표시 중이면 나머지를 직접 선택한 상태로 바뀜) */
  function removeItem(axis, key) {
    const st = state();
    for (const ax of st.same ? ['rows', 'cols'] : [axis]) st[ax] = effective(ax).filter((x) => x.key !== key);
    marked.rows.delete(key); marked.cols.delete(key);
    renderToolbar(); renderTable();
  }

  // ---------------------------------------------------------------- 행/열 수정 창
  function openEditor(startAxis) {
    closeEditor();
    const st = state();
    // 고친 내용은 [적용]을 누를 때 한 번에 반영
    const draft = { rows: effective('rows').map((x) => ({ ...x })), cols: effective('cols').map((x) => ({ ...x })), same: st.same && isSquare() };
    let axis = startAxis;
    const byCode = cur().byCode;
    const level33 = S.level === 33;

    const head = el('div', { class: 'pop-head' });
    const search = el('input', { placeholder: '이름·코드 검색', 'aria-label': '항목 검색' });
    const tools = el('div', { class: 'pop-row' });
    const quick = el('div', { class: 'pop-row quick' });
    const listBox = el('div', { class: 'pick-list' });
    const foot = el('div', { class: 'pop-foot' });

    const singles = (ax) => new Set(draft[ax].filter((x) => x.members.length === 1 && !x.group).map((x) => x.members[0]));
    const available = (ax) => new Set(axes[ax].map((x) => x.code));
    const targets = () => (draft.same ? ['rows', 'cols'] : [axis]);
    function setCode(code, on) {
      for (const ax of targets()) {
        if (!available(ax).has(code)) continue;
        const has = draft[ax].some((x) => x.key === code);
        if (on && !has) draft[ax].push(single(code));
        if (!on && has) draft[ax] = draft[ax].filter((x) => x.key !== code);
      }
    }
    function setItem(it, on) {
      for (const ax of targets()) {
        if (!it.members.every((c) => available(ax).has(c))) continue;
        const has = draft[ax].some((x) => x.key === it.key);
        if (on && !has) draft[ax].push({ ...it });
        if (!on && has) draft[ax] = draft[ax].filter((x) => x.key !== it.key);
      }
    }
    function syncSame() {   // 행·열 같게를 켜면 지금 보고 있는 축을 다른 축에 복사
      const o = other(axis); const av = available(o);
      draft[o] = draft[axis].filter((it) => it.members.every((c) => av.has(c))).map((x) => ({ ...x }));
    }

    function draw() {
      const list = axes[axis];
      const have = singles(axis);
      head.replaceChildren(
        el('b', { text: '행/열 수정' }),
        segmented([['rows', `행 수정 (${draft.rows.length})`], ['cols', `열 수정 (${draft.cols.length})`]], axis, (v) => { axis = v; search.value = ''; draw(); }, '수정할 축'),
        el('label', { class: 'check', title: isSquare() ? '켜면 행과 열을 똑같이 고칩니다' : '이 시트는 행과 열의 항목이 달라 함께 고칠 수 없습니다' },
          el('input', { type: 'checkbox', checked: draft.same, disabled: !isSquare(), onchange: (e) => { draft.same = e.target.checked; if (draft.same) syncSame(); draw(); } }), '행·열 같게'),
        el('button', { type: 'button', class: 'ghost small-btn', text: '닫기', onclick: closeEditor }));

      const q = search.value.trim();
      const visible = list.filter((it) => match(it.code + ' ' + it.name, q));
      tools.replaceChildren(
        el('button', { type: 'button', class: 'ghost small-btn', text: '전체 선택', onclick: () => { visible.forEach((it) => setCode(it.code, true)); draw(); } }),
        el('button', { type: 'button', class: 'ghost small-btn', text: '전체 해제', title: '목록에 보이는 개별 항목의 체크를 풉니다', onclick: () => { visible.forEach((it) => setCode(it.code, false)); draw(); } }),
        el('button', { type: 'button', class: 'ghost small-btn danger', text: `전체 삭제 (${AXIS_LABEL[axis]})`, title: `이 축에 추가된 ${AXIS_LABEL[axis]}을(를) 묶음까지 모두 지웁니다`,
          onclick: () => { for (const ax of targets()) draft[ax] = []; draw(); } }));

      const codesHere = new Set(list.map((x) => x.code));
      const quickBtn = (key) => {
        const codes = QUICK[key].codes.filter((c) => codesHere.has(c));
        return el('button', { type: 'button', class: 'chip-btn', text: QUICK[key].label, disabled: !codes.length,
          title: codes.length ? '' : '이 시트에 해당 항목이 없습니다', onclick: () => { codes.forEach((c) => setCode(c, true)); draw(); } });
      };
      quick.replaceChildren(el('span', { class: 'note', text: '빠른 선택' }),
        el('button', { type: 'button', class: 'chip-btn', text: '13개 산업군', disabled: !isMoney(),
          title: isMoney() ? '13개 산업군 묶음을 추가합니다' : '계수 표는 단순 합산이 성립하지 않아 묶을 수 없습니다',
          onclick: () => {
            GROUP13.forEach((g) => {
              const members = list.filter((it) => !it.summary && byCode[it.code]?.group === g).map((it) => it.code);
              if (members.length) setItem({ key: 'grp:' + g, label: g, members, group: true }, true);
            });
            draw();
          } }),
        quickBtn('va'), quickBtn('fd'), quickBtn('total'));

      // 묶음(사용자 묶음·13개 산업군)은 맨 위에 따로
      const groupsHere = draft[axis].filter((x) => x.group || x.members.length > 1).filter((x) => match(x.label || '', q));
      const blocks = [];
      if (groupsHere.length) {
        blocks.push(el('div', { class: 'pick-block' }, el('div', { class: 'pick-group' }, el('b', { text: '추가된 묶음' }), el('small', { text: `${groupsHere.length}개 · 체크를 풀면 삭제` })),
          ...groupsHere.map((g) => el('label', { class: 'pick-item' },
            el('input', { type: 'checkbox', checked: true, onchange: () => { setItem(g, false); draw(); } }),
            el('span', { text: g.label }), el('small', { text: `${g.members.length}개 합` })))));
      }
      const groups = new Map();
      for (const it of visible) {
        let g;
        if (it.summary || !byCode[it.code]) g = '합계·지표 항목';
        else if (level33) g = byCode[it.code].group;
        else { const s = byCode[it.code]; g = `${s.large} ${s.largeName}`; }
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(it);
      }
      for (const [g, items] of groups) {
        const all = items.every((it) => have.has(it.code));
        const some = items.some((it) => have.has(it.code));
        const box = el('input', { type: 'checkbox', checked: all, onchange: (e) => { items.forEach((it) => setCode(it.code, e.target.checked)); draw(); } });
        box.indeterminate = some && !all;
        blocks.push(el('div', { class: 'pick-block' },
          el('label', { class: 'pick-group' }, box, el('b', { text: g }), el('small', { text: `${items.filter((it) => have.has(it.code)).length}/${items.length}개` })),
          ...items.map((it) => {
            const s = byCode[it.code];
            return el('label', { class: 'pick-item' + (have.has(it.code) ? ' on' : '') },
              el('input', { type: 'checkbox', checked: have.has(it.code), onchange: (e) => { setCode(it.code, e.target.checked); draw(); } }),
              el('span', { text: `${it.code} ${it.name}` }), s && !s.produced ? el('small', { text: '국내 생산 없음' }) : null);
          })));
      }
      const top = listBox.scrollTop;
      listBox.replaceChildren(...(blocks.length ? blocks : [emptyNote('검색 결과가 없습니다.')]));
      listBox.scrollTop = top;

      const n = Math.max(draft.rows.length, draft.cols.length);
      const emptyAxis = !draft.rows.length !== !draft.cols.length
        ? `${AXIS_LABEL[draft.rows.length ? 'cols' : 'rows']}을 고르지 않으면 전체 산업이 표시됩니다.` : '';
      foot.replaceChildren(
        el('span', { class: 'note' }, `행 ${draft.rows.length}개 · 열 ${draft.cols.length}개`, emptyAxis ? el('br') : null, emptyAxis,
          n > BIG ? el('span', { class: 'warn-inline', text: ` · ${n}개가 넘어 표가 느려질 수 있습니다` }) : null),
        el('div', { class: 'row-buttons' },
          el('button', { type: 'button', class: 'ghost', text: '취소', onclick: closeEditor }),
          el('button', { type: 'button', class: 'primary', text: '적용', onclick: apply })));
    }

    function apply() {
      // 개별 산업 전부가 그대로 골라져 있으면 '전체 산업(자동)' 상태로 둔다 (두 축 모두 전체면 그대로 둠)
      const isAll = (ax) => {
        const all = allSectors(ax);
        const keys = new Set(draft[ax].map((x) => x.key));
        return draft[ax].length === all.length && all.every((a) => keys.has(a.key));
      };
      const rowsAll = isAll('rows'), colsAll = isAll('cols');
      st.rows = rowsAll && draft.cols.length && !colsAll ? [] : draft.rows;
      st.cols = colsAll && draft.rows.length && !rowsAll ? [] : draft.cols;
      st.same = draft.same;
      marked = { rows: new Set(), cols: new Set() };
      closeEditor(); renderToolbar(); renderTable();
    }

    search.oninput = draw;
    const panel = el('div', { class: 'popover editor', role: 'dialog', 'aria-label': '행/열 수정' }, head, search, tools, quick, listBox, foot);
    document.body.append(el('div', { class: 'pop-backdrop', onclick: closeEditor }), panel);
    draw(); search.focus();
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeEditor(); }
  function closeEditor() {
    document.querySelectorAll('.popover, .pop-backdrop').forEach((n) => n.remove());
    document.removeEventListener('keydown', escClose);
  }
  function warnSize(n) {
    $('cmp-warn').replaceChildren(n > BIG ? el('p', { class: 'warn', text: `표 항목이 ${n}개입니다. 표가 커서 느려질 수 있습니다.` }) : '');
  }

  // ---------------------------------------------------------------- 표
  let lastUnit = null, lastResult = null, tableSeq = 0;
  async function renderTable() {
    const st = state(); const body = $('cmp-body');
    if (!st.rows.length && !st.cols.length) { warnSize(0); renderEmpty(); return; }
    const rows = effective('rows'), cols = effective('cols');
    warnSize(Math.max(rows.length, cols.length));
    const seq = ++tableSeq; const level = S.level; const sh = sheet;
    let r;
    try {
      r = await cached('compare', { level: String(level), sheet: sh, payload: { rows, cols, rest: st.rest } });
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
    const badge = document.querySelector('.cmp-unit'); if (badge) badge.textContent = '단위: ' + unitText;

    const headCell = (axis, it) => {
      const removable = it.kind !== 'rest' && it.kind !== 'appended';
      const markable = isMoney() && (it.kind === 'sector' || it.kind === 'group');
      const set = marked[axis];
      return el('div', { class: 'hcell' },
        markable ? el('input', { type: 'checkbox', checked: set.has(it.key), title: '묶을 항목으로 표시',
          onchange: (e) => { e.target.checked ? set.add(it.key) : set.delete(it.key); renderToolbar(); } }) : null,
        el('span', { class: 'hname', title: `${it.kind === 'group' ? '' : it.key + ' '}${it.label}${it.n > 1 ? ` (${it.n}개 합)` : ''}`,
          text: it.label + (it.kind === 'group' ? ` (${it.n})` : '') }),
        removable ? el('button', { type: 'button', class: 'x', 'aria-label': it.label + ' 삭제', text: '✕', onclick: () => removeItem(axis, it.key) }) : null);
    };
    const cls = (it) => (it.kind === 'rest' || it.kind === 'appended' ? 'gray' : it.kind === 'summary' ? 'sumitem' : '');
    const editBtn = (axis, text) => el('button', { type: 'button', class: 'add-btn', text, onclick: () => openEditor(axis) });
    const thead = el('thead', {}, el('tr', {},
      el('th', { class: 'corner', text: `${SHEETS[sh].short} · 행 \\ 열` }),
      r.cols.map((c) => el('th', { class: 'num ' + cls(c) }, headCell('cols', c))),
      el('th', { class: 'add-col' }, editBtn('cols', '열 수정'))));
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
    el('tr', { class: 'add-row' }, el('th', {}, editBtn('rows', '행 수정')), el('td', { colspan: r.cols.length + 1 })));
    const notes = [];
    for (const ax of ['rows', 'cols']) if (implicit(ax)) notes.push(`${AXIS_LABEL[ax]}을 고르지 않아 전체 산업(${effective(ax).length}개)을 표시합니다. [행/열 수정]에서 바꿀 수 있습니다.`);
    if (st.mode !== 'value') notes.push(`${st.mode === 'colpct' ? '열' : '행'} 비중 % = 값 ÷ ${st.mode === 'colpct' ? '열' : '행'} 합계 × 100. 분모는 '나머지 합계'를 포함한 산업 전체에 선택한 구성 항목(부가가치·최종수요 등)을 더한 값입니다.`);
    notes.push('색이 진할수록 표 안에서 값이 큽니다(산업 칸만 칠함). 회색 행·열은 나머지 합계·합계 항목입니다.');
    body.replaceChildren(el('div', { class: 'scroll cmp-scroll' }, el('table', { class: 'data cmp-table' }, thead, tbody)),
      ...notes.map((t) => el('p', { class: 'note', text: t })));
  }

  function renderEmpty() {
    const level = S.level; const st = state();
    const ex = [['C07', 'C09', 'C12'], '1차 금속·컴퓨터전자·운송장비 비교'];
    const exampleBtn = el('button', { type: 'button', class: 'secondary inline-btn', text: '예시: ' + ex[1], onclick: () => {
      let items;
      if (level === 33) items = ex[0].map(single);
      else if (isMoney()) items = ex[0].map((lg) => ({ key: 'grp:' + lg, label: largeName(lg), members: codesForLarge([lg]), group: true }));
      else items = codesForLarge(ex[0]).map(single);
      st.rows = items;
      // 정방 시트는 열도 같은 산업, 최종수요 항목별 시트는 열 = 최종수요 항목
      st.cols = isSquare() ? items.map((x) => ({ ...x })) : axes.cols.filter((c) => c.code !== '9190').map((c) => single(c.code));
      renderToolbar(); renderTable();
    } });
    const groupBtn = isMoney() && isSquare() ? el('button', { type: 'button', class: 'ghost inline-btn', text: '예시: 13개 산업군 거래 구조', onclick: () => {
      const items = GROUP13.map((g) => ({ key: 'grp:' + g, label: g, members: cur().sectors.filter((s) => s.group === g).map((s) => s.code), group: true }))
        .filter((x) => x.members.length);
      st.rows = items; st.cols = items.map((x) => ({ ...x }));
      renderToolbar(); renderTable();
    } }) : null;
    $('cmp-body').replaceChildren(el('div', { class: 'empty small' },
      el('p', {}, '아직 고른 행·열이 없습니다. ', el('b', { text: '행/열 수정' }), '으로 항목을 고르거나 예시로 시작하세요. 한쪽만 고르면 다른 쪽에는 전체 산업이 표시됩니다.'),
      el('div', { class: 'row-buttons center' }, exampleBtn, groupBtn,
        el('button', { type: 'button', class: 'ghost inline-btn', text: '행/열 수정', onclick: () => openEditor('rows') })),
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
