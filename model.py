"""산업연관표 분석 계산 모듈 (브라우저 Pyodide에서 실행)

- 대분류(33)·중분류(83)·소분류(165)·기본부문(380) 투입산출표를 모두 지원
- 분류마다 한 번 읽은 자료는 STATE에 보관해 다시 읽지 않음
- 주요 분석표(2020~2023, 대분류·13개 산업군)는 SUMMARY에 보관
- 함수의 반환값은 모두 JSON 문자열 (화면 쪽 JS에서 해석)
"""
import io
import json
import re

import numpy as np
import openpyxl

SUMMARY_CODE = re.compile(r"^9\d{3}$")  # 9로 시작하는 4자리 코드 = 합계·지표 행/열
STATE = {}  # level -> 해당 분류의 자료
CLASS = None  # 부문분류표
SUMMARY = None  # 주요 분석표

# 한국은행 보도자료의 13개 산업군 (대분류 코드 기준)
GROUP13 = [
    ("농림수산품", ["A"]),
    ("광산품", ["B"]),
    ("소비재제품", ["C01", "C02", "C03", "C13"]),
    ("기초소재제품", ["C04", "C05", "C06", "C07", "C08"]),
    ("조립가공제품", ["C09", "C10", "C11", "C12"]),
    ("제조임가공·산업용 장비 수리", ["C14"]),
    ("전력·가스·수도 및 폐기물", ["D", "E"]),
    ("건설", ["F"]),
    ("도소매 및 운송", ["G", "H"]),
    ("생산자서비스", ["J", "K", "L", "M", "N"]),
    ("사회서비스", ["O", "P", "Q"]),
    ("소비자서비스", ["I", "R", "S"]),
    ("기타", ["T"]),
]
GROUP_NAMES = [name for name, _ in GROUP13]
LARGE_TO_GROUP = {code: name for name, codes in GROUP13 for code in codes}

COEF_SHEETS = {"총투입계수(A)", "수입투입계수(Am)", "국산투입계수(Ad)", "생산유발계수", "수입유발계수", "부가가치유발계수"}
TRADE_SHEETS = {"A표_총거래표(생산자)", "A표_수입거래표(생산자)", "A표_국산거래표(생산자)"}
TOTAL_SHEET, IMPORT_SHEET, DOMESTIC_SHEET = "A표_총거래표(생산자)", "A표_수입거래표(생산자)", "A표_국산거래표(생산자)"
FD_SHEETS = {"최종수요 항목별 생산유발액": "production", "최종수요 항목별 부가가치유발액": "valueAdded",
             "최종수요 항목별 수입유발액": "imports"}
FD_ITEMS = ["9111", "9112", "9121", "9122", "9131", "9132", "9140"]
CONSUMPTION, INVESTMENT = ["9111", "9112"], ["9121", "9122", "9131", "9132"]
# 합계 성격의 코드(비중 계산의 '부분'이 아닌 것)
TOTAL_CODES = {"9090", "9190", "9290", "9310", "9329", "9390", "9590", "9690", "9790", "9819", "9811", "9812",
               "9801", "9802"}


def emit(x):
    return json.dumps(x, ensure_ascii=False, allow_nan=False)


def clean(text):
    """셀 안 줄바꿈·연속 공백을 한 칸으로 정리"""
    return " ".join(str(text).split()) if text is not None else ""


def num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        f = float(v)
        return f if np.isfinite(f) else None
    return None


def fnum(v):
    """None·문자 → 0.0"""
    x = num(v)
    return x if x is not None else 0.0


def ratio(a, b):
    return float(a / b) if b else None


# ---------------------------------------------------------------- 부문분류표
def load_classification(raw):
    """기본→소→중→대 분류 연결표를 읽어 모든 분류 코드의 상위 분류를 기록한다."""
    global CLASS
    wb = openpyxl.load_workbook(io.BytesIO(bytes(raw)), read_only=True, data_only=True)
    rows = list(wb[wb.sheetnames[0]].values)
    wb.close()
    to_large, large_names, up = {}, {}, {}
    cur = {2: None, 4: None, 6: None}
    for r in rows[3:]:
        if not r or r[0] is None:
            continue
        for k in (2, 4, 6):  # 상위 분류는 첫 행에만 적혀 있으므로 아래로 채움
            if r[k] is not None:
                cur[k] = str(r[k]).strip()
                if k == 6:
                    large_names[cur[6]] = clean(r[7])
        basic = str(r[0]).strip()
        if SUMMARY_CODE.match(basic):
            continue
        for code in (basic, cur[2], cur[4], cur[6]):
            to_large[code] = cur[6]
        # 각 코드의 '더 큰 분류' 코드 (현재 → 소 → 중 → 대)
        up[basic] = {"380": basic, "165": cur[2], "83": cur[4], "33": cur[6]}
        up.setdefault(cur[2], {"165": cur[2], "83": cur[4], "33": cur[6]})
        up.setdefault(cur[4], {"83": cur[4], "33": cur[6]})
        up.setdefault(cur[6], {"33": cur[6]})
    CLASS = {"to_large": to_large, "large_names": large_names, "up": up}
    return emit({"large": [{"code": c, "name": n, "group": LARGE_TO_GROUP.get(c, "기타")}
                           for c, n in large_names.items() if not SUMMARY_CODE.match(c)],
                 "up": up})


# ---------------------------------------------------------------- 주요 분석표
def norm_name(text):
    """주요 분석표·투입산출표 이름 비교용: 공백·가운뎃점·쉼표·각주·'및' 제거"""
    s = clean(text).replace("\xa0", " ")
    s = re.sub(r"\d\)\s*$", "", s.strip())
    s = s.replace("및", "")
    return re.sub(r"[\s·․,]", "", s)


SUMMARY_SHEETS = {  # 지표 키 -> (시트 번호, 블록 번호, 값 종류: value|share)
    "outputAmount": (1, 0, "value"), "outputShare": (1, 0, "share"),
    "vaAmount": (2, 0, "value"), "vaShare": (2, 0, "share"),
    "intermediateRate": (3, 0, "value"), "localizationRate": (4, 0, "value"),
    "importDependence": (5, 0, "value"), "vaRate": (6, 0, "value"),
    "exportRate": (9, 0, "value"), "importRate": (10, 0, "value"),
    "employmentCoef": (18, 0, "value"), "wageCoef": (18, 1, "value"),
    "employmentInduce": (19, 0, "value"), "wageInduce": (20, 0, "value"),
}


def _parse_summary_sheet(rows):
    """연도 머리글을 찾아 블록별 {이름행: {연도: 값}} 을 만든다."""
    year_re = re.compile(r"^\s*(20\d\d)년")
    yi = next(i for i, r in enumerate(rows) if r and any(isinstance(c, str) and year_re.match(c) for c in r))
    yr = rows[yi]
    year_cols = [(j, int(year_re.match(c).group(1))) for j, c in enumerate(yr) if isinstance(c, str) and year_re.match(c)]
    blocks, cur = [], None
    for j, y in year_cols:
        if cur is None or y in cur:
            cur = {}
            blocks.append(cur)
        cur[y] = j
    sub = rows[yi + 1] if yi + 1 < len(rows) else ()
    entries = []
    for r in rows[yi + 1:]:
        if not r:
            continue
        name, level = None, None
        for k in (1, 2, 3):
            if k < len(r) and isinstance(r[k], str) and r[k].strip().replace("\xa0", ""):
                name, level = r[k], k
                break
        if name is None or clean(name).startswith("주"):
            continue
        vals = []
        for b in blocks:
            v = {y: num(r[j]) if j < len(r) else None for y, j in b.items()}
            s = {y: num(r[j + 1]) if j + 1 < len(r) and j + 1 < len(sub) and isinstance(sub[j + 1], str)
                 and "구성비" in sub[j + 1] else None for y, j in b.items()}
            vals.append({"value": v, "share": s})
        if all(x is None for b in vals for x in b["value"].values()):
            continue
        entries.append({"name": clean(name), "level": level, "footnote": bool(re.search(r"1\)\s*$", str(name))),
                        "blocks": vals})
    return entries


def load_summary(raw):
    """주요 분석표를 읽어 대분류·13개 산업군·전산업별 2020~2023 지표를 만든다."""
    global SUMMARY
    wb = openpyxl.load_workbook(io.BytesIO(bytes(raw)), read_only=True, data_only=True)
    sheets = {}
    for s in wb.sheetnames:
        m = re.match(r"^(\d+)\.", s)
        if m:
            sheets[int(m.group(1))] = list(wb[s].values)
    wb.close()
    large_names = CLASS["large_names"] if CLASS else {}
    large_by_norm = {norm_name(n): c for c, n in large_names.items() if not SUMMARY_CODE.match(c)}
    group_by_norm = {norm_name(g): g for g in GROUP_NAMES}
    years = [2020, 2021, 2022, 2023]
    out = {"years": years, "indicators": {}, "unmatched": []}
    parsed = {n: _parse_summary_sheet(sheets[n]) for n in {v[0] for v in SUMMARY_SHEETS.values()}}
    for key, (sheet, block, kind) in SUMMARY_SHEETS.items():
        large, group, total, foot = {}, {}, None, {}
        for e in parsed[sheet]:
            n = norm_name(e["name"])
            vals = e["blocks"][block][kind]
            series = [vals.get(y) for y in years]
            if n == "전산업":
                total = series
                continue
            matched = False
            if n in group_by_norm:
                group[group_by_norm[n]] = series
                matched = True
            if n in large_by_norm:
                large[large_by_norm[n]] = series
                foot[large_by_norm[n]] = e["footnote"]
                matched = True
            if not matched and e["level"] != 1 and n not in ("공산품", "서비스"):
                out["unmatched"].append(e["name"])
        out["indicators"][key] = {"large": large, "group": group, "total": total, "footnote": foot}
    SUMMARY = out
    return emit({"years": years, "indicators": out["indicators"], "unmatched": sorted(set(out["unmatched"]))})


def _emp_coef(kind="employment", year=2023):
    """대분류 코드 -> 취업(고용)계수 (명/10억원)"""
    if not SUMMARY:
        return None
    ind = SUMMARY["indicators"]["employmentCoef" if kind == "employment" else "wageCoef"]
    i = SUMMARY["years"].index(year)
    return {c: (v[i] or 0.0) for c, v in ind["large"].items()}


def verify_employment():
    """대분류 생산유발계수 L과 2023년 취업·고용계수로 계산한 e·L을 주요 분석표 19·20번 시트와 비교"""
    if not SUMMARY or "33" not in STATE:
        return emit(None)
    st = STATE["33"]
    res = {}
    for kind, key in (("employment", "employmentInduce"), ("wage", "wageInduce")):
        e = _emp_coef(kind)
        ev = np.array([e.get(c, 0.0) for c in st["codes"]])
        calc = ev @ st["L"]
        ind = SUMMARY["indicators"][key]
        foot = SUMMARY["indicators"]["employmentCoef"]["footnote"]
        diffs, excluded = [], []
        for j, c in enumerate(st["codes"]):
            pub = ind["large"].get(c)
            if pub is None or pub[3] is None:
                continue
            if foot.get(c):
                excluded.append({"code": c, "diff": float(abs(calc[j] - pub[3]))})
                continue
            diffs.append(float(abs(calc[j] - pub[3])))
        res[kind] = {"n": len(diffs), "maxDiff": max(diffs) if diffs else None,
                     "excluded": excluded, "ok": bool(diffs) and max(diffs) < 1e-6}
    return emit(res)


# ---------------------------------------------------------------- 초기화
def initialize(level, raw, expected_n):
    """투입산출표 Excel을 읽고 계수 간 관계를 검증한다."""
    wb = openpyxl.load_workbook(io.BytesIO(bytes(raw)), read_only=True, data_only=True)
    book = {s: list(wb[s].values) for s in wb.sheetnames}
    wb.close()

    base = book["국산투입계수(Ad)"]
    header = [str(c).strip() if c is not None else None for c in base[4]]
    row_codes = {str(r[0]).strip() for r in base[6:] if r and r[0] is not None}
    codes = [c for c in header[2:] if c and not SUMMARY_CODE.match(c) and c in row_codes]
    if len(codes) != int(expected_n) or len(set(codes)) != len(codes):
        raise ValueError(f"부문 수가 맞지 않습니다: {len(codes)}개 (기대값 {expected_n}개)")
    name_of = {str(r[0]).strip(): clean(r[1]) for r in base[6:] if r and r[0] is not None}
    names = [name_of[c] for c in codes]

    # 시트별 행·열 위치 색인
    index = {}
    for s, rows in book.items():
        ri = {str(r[0]).strip(): i for i, r in enumerate(rows) if i >= 6 and r and r[0] is not None}
        ci = {str(c).strip(): j for j, c in enumerate(rows[4]) if j >= 2 and c is not None}
        index[s] = (ri, ci)

    def block(sheet):
        rows = book[sheet]
        ri, ci = index[sheet]
        return np.array([[fnum(rows[ri[r]][ci[c]]) for c in codes] for r in codes], dtype=float)

    def matrix(sheet):
        rows = book[sheet]
        ri, ci = index[sheet]
        a = np.array([[rows[ri[c]][ci[k]] for k in codes] for c in codes], dtype=float)
        if not np.isfinite(a).all():
            raise ValueError(sheet + ": 숫자가 아니거나 비어 있는 셀이 있습니다.")
        return a

    L, M, V = matrix("생산유발계수"), matrix("수입유발계수"), matrix("부가가치유발계수")
    Ad, Am = matrix("국산투입계수(Ad)"), matrix("수입투입계수(Am)")

    def row_vector(sheet, row_code):
        rows = book[sheet]
        ri, ci = index[sheet]
        return np.array([fnum(rows[ri[row_code]][ci[c]]) for c in codes], dtype=float)

    va_rate = row_vector("총투입계수(A)", "9690")  # 부가가치율
    output = row_vector(TOTAL_SHEET, "9790")  # 총투입(=총산출), 백만원

    n = len(codes)
    produced = output > 0  # 국내 생산이 0인 부문(원유·LNG 등 전량 수입)은 '수입+부가가치=1' 검증에서 제외
    residuals = {
        "생산": float(np.max(np.abs((np.eye(n) - Ad) @ L - np.eye(n)))),
        "수입": float(np.max(np.abs(Am @ L - M))),
        "부가가치": float(np.max(np.abs(va_rate[:, None] * L - V))),
        "수입+부가가치=1": float(np.max(np.abs(M.sum(0) + V.sum(0) - 1)[produced])),
    }
    if max(residuals.values()) >= 1e-8:
        raise ValueError("계수 검증 실패: " + str(residuals))

    to_large = CLASS["to_large"] if CLASS else {}
    large_names = CLASS["large_names"] if CLASS else {}
    large = [to_large.get(c, c) for c in codes]
    sectors = [{"code": c, "name": nm, "large": lg, "largeName": large_names.get(lg, lg),
                "group": LARGE_TO_GROUP.get(lg, "기타"), "output": float(o), "produced": bool(o > 0)}
               for c, nm, lg, o in zip(codes, names, large, output)]

    sheets = []
    for s, rows in book.items():
        ri, ci = index[s]
        sheets.append({"name": s, "title": clean(rows[0][0]), "unit": clean(rows[3][0]) or None,
                       "square": all(c in ci and c in ri for c in codes)})

    STATE[str(level)] = {"book": book, "index": index, "codes": codes, "names": names,
                         "pos": {c: i for i, c in enumerate(codes)}, "sectors": sectors,
                         "L": L, "M": M, "V": V, "output": output, "block": block, "blocks": {}}
    return emit({"level": str(level), "sectors": sectors, "sheets": sheets, "residuals": residuals,
                 "totalOutput": float(output.sum()), "notProduced": int((~produced).sum())})


# ---------------------------------------------------------------- 공통 도우미
def _st(level):
    return STATE[str(level)]


def _block(st, sheet):
    """부문×부문 블록 (캐시)"""
    if sheet not in st["blocks"]:
        st["blocks"][sheet] = st["block"](sheet)
    return st["blocks"][sheet]


def _cell(st, sheet, r, c):
    ri, ci = st["index"][sheet]
    if r not in ri or c not in ci:
        return None
    row = st["book"][sheet][ri[r]]
    return num(row[ci[c]]) if ci[c] < len(row) else None


def _col_vec(st, sheet, col):
    """부문별(행) 값: 시트의 한 열"""
    return np.array([fnum(_cell(st, sheet, c, col)) for c in st["codes"]])


def _row_vec(st, sheet, row):
    """부문별(열) 값: 시트의 한 행"""
    return np.array([fnum(_cell(st, sheet, row, c)) for c in st["codes"]])


def _item(st, i, value):
    s = st["sectors"][i]
    return {"code": s["code"], "name": s["name"], "value": float(value)}


def _top(st, vec, k, exclude=None):
    order = [i for i in np.argsort(-vec) if i != exclude and vec[i] > 0][:k]
    return [_item(st, i, vec[i]) for i in order]


# ---------------------------------------------------------------- 원자료 탐색
def _axis_items(rows):
    """행 목록과 열 목록 (코드, 이름, 위치)"""
    row_items = [(str(r[0]).strip(), clean(r[1]), i) for i, r in enumerate(rows) if i >= 6 and r and r[0] is not None]
    col_items = [(str(rows[4][j]).strip(), clean(rows[5][j]) if j < len(rows[5]) else "", j)
                 for j in range(2, len(rows[4])) if rows[4][j] is not None]
    return row_items, col_items


def explore(level, sheet, axis, key):
    """axis='row'이면 선택한 행을 열 방향으로, axis='col'이면 선택한 열을 행 방향으로 펼친다."""
    st = _st(level)
    rows = st["book"][sheet]
    row_items, col_items = _axis_items(rows)
    choices, others = (row_items, col_items) if axis == "row" else (col_items, row_items)
    chosen = next((c for c in choices if c[0] == key), choices[0])
    cells = []
    for code, name, pos in others:
        if axis == "row":
            r = rows[chosen[2]]
            val = r[pos] if pos < len(r) else None
        else:
            r = rows[pos]
            val = r[chosen[2]] if chosen[2] < len(r) else None
        v = num(val)
        idx = st["pos"].get(code)
        cells.append({"code": code, "name": name, "value": v if v is not None else (clean(val) or None),
                      "summary": bool(SUMMARY_CODE.match(code)),
                      "large": st["sectors"][idx]["large"] if idx is not None else None})
    return emit({"axis": axis, "selected": chosen[0], "name": chosen[1],
                 "choices": [{"code": c, "name": n, "summary": bool(SUMMARY_CODE.match(c))} for c, n, _ in choices],
                 "cells": cells})


def top_links(level, sheet, k=15):
    """부문×부문 블록에서 대각 원소를 뺀 가장 큰 값 k개 (공급 산업 → 사용 산업)"""
    st = _st(level)
    info = st["index"][sheet]
    if not all(c in info[0] and c in info[1] for c in st["codes"]):
        return emit(None)
    a = _block(st, sheet).copy()
    np.fill_diagonal(a, -np.inf)
    flat = np.argsort(-a, axis=None)[:k]
    n = len(st["codes"])
    out = []
    for f in flat:
        i, j = divmod(int(f), n)
        if not np.isfinite(a[i, j]) or a[i, j] <= 0:
            continue
        out.append({"from": st["codes"][i], "fromName": st["names"][i], "to": st["codes"][j],
                    "toName": st["names"][j], "value": float(a[i, j])})
    return emit(out)


def profile(level, sheet, code):
    """선택한 산업의 프로필 (시트 종류에 따라 내용이 다름)"""
    st = _st(level)
    i = st["pos"].get(code)
    if i is None:
        return emit(None)
    s = st["sectors"][i]
    out = {"code": code, "name": s["name"], "produced": s["produced"], "sheet": sheet}
    if sheet in TRADE_SHEETS:
        a = _block(st, sheet)
        tot = lambda r, c: fnum(_cell(st, TOTAL_SHEET, r, c))
        here = lambda c: fnum(_cell(st, sheet, code, c))
        out["kind"] = "trade"
        x = tot("9790", code)
        alloc_total = here("9290")
        out["allocation"] = {"total": alloc_total, "parts": [
            {"key": "intermediate", "label": "중간수요", "value": here("9090")},
            {"key": "consumption", "label": "소비", "value": sum(here(c) for c in CONSUMPTION)},
            {"key": "investment", "label": "투자", "value": sum(here(c) for c in INVESTMENT)},
            {"key": "export", "label": "수출", "value": here("9140")}]}
        if sheet == TOTAL_SHEET:
            dom = fnum(_cell(st, DOMESTIC_SHEET, "9590", code))
            imp = fnum(_cell(st, IMPORT_SHEET, "9590", code))
            va = tot("9690", code)
            out["metrics"] = [
                {"label": "총산출", "kind": "money", "value": x},
                {"label": "수출률", "kind": "pct", "value": None if not s["produced"] else 100 * tot(code, "9140") / tot(code, "9310")},
                {"label": "중간투입률", "kind": "pct", "value": None if not x else 100 * tot("9590", code) / x},
                {"label": "수입의존도", "kind": "pct", "value": None if not x else 100 * imp / x},
                {"label": "부가가치율", "kind": "pct", "value": None if not x else 100 * va / x},
            ]
            out["input"] = {"total": x, "parts": [
                {"key": "domestic", "label": "국산 중간재", "value": dom},
                {"key": "imported", "label": "수입 중간재", "value": imp},
                {"key": "va", "label": "부가가치", "value": va}]} if x else None
        else:
            inter = fnum(_cell(st, sheet, "9590", code))
            label = "수입" if sheet == IMPORT_SHEET else "국산"
            out["metrics"] = [
                {"label": f"{label} 총수요", "kind": "money", "value": alloc_total},
                {"label": f"{label} 중간재 투입", "kind": "money", "value": inter},
                {"label": "수출 비중(총수요 대비)", "kind": "pct", "value": 100 * here("9140") / alloc_total if alloc_total else None},
            ]
            out["input"] = None
        out["buyers"] = _top(st, a[i, :], 5, exclude=i)      # 행 방향: 이 상품을 사 간 부문
        out["suppliers"] = _top(st, a[:, i], 5, exclude=i)   # 열 방향: 이 부문이 사들인 상품
        out["self"] = float(a[i, i])
    elif sheet in COEF_SHEETS:
        a = _block(st, sheet)
        out["kind"] = "coef"
        out["induce"] = sheet in ("생산유발계수", "수입유발계수", "부가가치유발계수")
        out["column"] = _top(st, a[:, i], 8, exclude=i if out["induce"] else None)
        out["row"] = _top(st, a[i, :], 8, exclude=i if out["induce"] else None)
        out["self"] = float(a[i, i])
        out["colSum"] = float(a[:, i].sum())
        out["rowSum"] = float(a[i, :].sum())
        if sheet == "생산유발계수":
            out["influence"] = _cell(st, sheet, "9801", code)
            out["sensitivity"] = _cell(st, sheet, code, "9802")
    elif sheet in FD_SHEETS:
        rows = st["book"][sheet]
        names = {c: clean(rows[5][j]) for c, j in st["index"][sheet][1].items()}
        parts = [{"key": c, "label": names.get(c, c), "value": fnum(_cell(st, sheet, code, c))} for c in FD_ITEMS]
        out["kind"] = "fd"
        out["fd"] = {"total": fnum(_cell(st, sheet, code, "9190")), "parts": parts}
    return emit(out)


# ---------------------------------------------------------------- 원자료 비교
def sheet_axes(level, sheet):
    """시트의 행 항목·열 항목 목록"""
    st = _st(level)
    row_items, col_items = _axis_items(st["book"][sheet])
    pack = lambda items: [{"code": c, "name": n, "summary": bool(SUMMARY_CODE.match(c)), "sector": c in st["pos"]}
                          for c, n, _ in items]
    return emit({"rows": pack(row_items), "cols": pack(col_items)})


def compare(level, sheet, payload):
    """맞춤 비교표: 선택한 행·열(묶음 포함)의 값, '나머지 합계', 비중 분모"""
    st = _st(level)
    p = json.loads(payload)
    rows = st["book"][sheet]
    ri, ci = st["index"][sheet]
    row_items, col_items = _axis_items(rows)
    sec_rows = [c for c, _, _ in row_items if c in st["pos"]]
    sec_cols = [c for c, _, _ in col_items if c in st["pos"]]
    rest = bool(p.get("rest"))
    money = sheet not in COEF_SHEETS

    # 시트 전체를 숫자 행렬로 한 번만 만들어 둔다 (행·열 합계를 numpy로 빠르게)
    full = st.setdefault("full", {})
    if sheet not in full:
        rc, cc = list(ri), list(ci)
        mat = np.array([[fnum(rows[ri[r]][ci[c]]) if ci[c] < len(rows[ri[r]]) else 0.0 for c in cc] for r in rc])
        full[sheet] = (mat, {r: i for i, r in enumerate(rc)}, {c: j for j, c in enumerate(cc)})
    mat, rpos, cpos = full[sheet]

    def total(rs, cs):
        a = [rpos[r] for r in rs if r in rpos]
        b = [cpos[c] for c in cs if c in cpos]
        return float(mat[np.ix_(a, b)].sum()) if a and b else 0.0

    def expand(items, all_sec, axis_codes, add_va):
        """항목 → [(키, 구성 코드 목록, 종류)]"""
        out, chosen = [], set()
        for it in items:
            members = [m for m in it["members"] if m in axis_codes]
            if not members:
                continue
            kind = "group" if len(it["members"]) > 1 or it.get("group") else ("sector" if members[0] in st["pos"] else "summary")
            out.append({"key": it["key"], "label": it.get("label"), "members": members, "kind": kind})
            chosen.update(m for m in members if m in st["pos"])
        if rest and all_sec:  # 산업이 없는 축(최종수요 항목 열 등)에는 '나머지'를 두지 않음
            others = [c for c in all_sec if c not in chosen]
            if others:  # 산업을 모두 고른 경우에는 나머지가 없음
                out.append({"key": "__rest", "label": "나머지 산업 합계", "members": others, "kind": "rest"})
            if add_va:
                for code in ("9690", "9790"):
                    if code in axis_codes and not any(o["members"] == [code] for o in out):
                        out.append({"key": code, "label": None, "members": [code], "kind": "appended"})
        return out

    R = expand(p["rows"], sec_rows, ri, money and sheet in TRADE_SHEETS)
    C = expand(p["cols"], sec_cols, ci, False)
    if C and C[-1]["kind"] == "rest":
        C[-1]["label"] = "나머지 합계"
    values = [[total(rr["members"], cc["members"]) for cc in C] for rr in R]

    def is_part(it, has_va_parts):
        if it["kind"] in ("sector", "group", "rest"):
            return False
        code = it["members"][0]
        if code in TOTAL_CODES:
            return code == "9690" and it["kind"] == "appended" and not has_va_parts
        return True

    def denominators(axis_items_list, all_sec, other):
        """다른 축의 각 항목에 대한 분모 = 산업 전체 + 선택한 구성 항목"""
        va_parts = any(it["members"][0] in ("9610", "9621", "9622", "9630") for it in axis_items_list if it["kind"] == "summary")
        extra = [it for it in axis_items_list if is_part(it, va_parts)]
        return extra, va_parts

    extra_r, _ = denominators(R, sec_rows, C)
    extra_c, _ = denominators(C, sec_cols, R)
    parts_r = sec_rows + [e["members"][0] for e in extra_r]
    parts_c = sec_cols + [e["members"][0] for e in extra_c]
    col_den = [total(parts_r, cc["members"]) for cc in C]
    row_den = [total(rr["members"], parts_c) for rr in R]
    names_r = {c: n for c, n, _ in row_items}
    names_c = {c: n for c, n, _ in col_items}
    for it in R:
        it["label"] = it["label"] or names_r.get(it["members"][0], it["key"])
        it["n"] = len(it["members"])
    for it in C:
        it["label"] = it["label"] or names_c.get(it["members"][0], it["key"])
        it["n"] = len(it["members"])
    strip = lambda items: [{k: v for k, v in it.items() if k != "members"} for it in items]
    return emit({"rows": strip(R), "cols": strip(C), "values": values, "colDen": col_den, "rowDen": row_den,
                 "money": money})


# ---------------------------------------------------------------- 경제구조
def structure(level):
    """선택한 분류의 2023년 투입산출표로 경제구조 지표 계산"""
    st = _st(level)
    T, MT, DT = TOTAL_SHEET, IMPORT_SHEET, DOMESTIC_SHEET
    X = _row_vec(st, T, "9790")
    inter = _row_vec(st, T, "9590")
    va = _row_vec(st, T, "9690")
    imp_inter = _row_vec(st, MT, "9590")
    dom_inter = _row_vec(st, DT, "9590")
    export = _col_vec(st, T, "9140")
    out_col = _col_vec(st, T, "9310")
    inter_dem = _col_vec(st, T, "9090")
    tot_dem = _col_vec(st, T, "9290")
    imports = _col_vec(st, T, "9329")
    supply = _col_vec(st, T, "9390")
    fd = {c: _col_vec(st, T, c) for c in FD_ITEMS + ["9190"]}

    tot = lambda v: float(v.sum())
    kpi = {
        "output": tot(X), "valueAdded": tot(va),
        "intermediateRate": 100 * tot(inter) / tot(X), "vaRate": 100 * tot(va) / tot(X),
        "importDependence": 100 * tot(imp_inter) / tot(X), "localizationRate": 100 * tot(dom_inter) / tot(inter),
        "exportRate": 100 * tot(export) / tot(out_col), "importRate": 100 * tot(imports) / tot(supply),
    }
    fd_total = tot(fd["9190"])
    final = {"consumption": 100 * sum(tot(fd[c]) for c in CONSUMPTION) / fd_total,
             "investment": 100 * sum(tot(fd[c]) for c in INVESTMENT) / fd_total,
             "export": 100 * tot(fd["9140"]) / fd_total, "total": fd_total}

    sectors = []
    for i, s in enumerate(st["sectors"]):
        sectors.append({"code": s["code"], "name": s["name"], "group": s["group"], "produced": s["produced"],
                        "output": float(X[i]), "va": float(va[i]), "inter": float(inter[i]),
                        "impInter": float(imp_inter[i]), "domInter": float(dom_inter[i]),
                        "export": float(export[i]), "outCol": float(out_col[i]), "interDemand": float(inter_dem[i]),
                        "totalDemand": float(tot_dem[i])})
    groups = []
    for g in GROUP_NAMES:
        idx = [i for i, s in enumerate(st["sectors"]) if s["group"] == g]
        if not idx:
            continue
        sm = lambda v: float(v[idx].sum())
        groups.append({"group": g, "output": sm(X), "va": sm(va), "inter": sm(inter), "impInter": sm(imp_inter),
                       "domInter": sm(dom_inter), "export": sm(export), "outCol": sm(out_col),
                       "interDemand": sm(inter_dem), "totalDemand": sm(tot_dem)})
    return emit({"kpi": kpi, "final": final, "sectors": sectors, "groups": groups,
                 "totals": {"output": tot(X), "va": tot(va), "inter": tot(inter), "impInter": tot(imp_inter),
                            "domInter": tot(dom_inter), "export": tot(export), "outCol": tot(out_col),
                            "interDemand": tot(inter_dem), "totalDemand": tot(tot_dem)}})


# ---------------------------------------------------------------- 산업연관효과
def linkage(level):
    """유발계수 순위, 영향력·감응도, 최종수요 항목별 유발 자료"""
    st = _st(level)
    L, M, V, X = st["L"], st["M"], st["V"], st["output"]
    infl = _row_vec(st, "생산유발계수", "9801")
    sens = _col_vec(st, "생산유발계수", "9802")
    P = "최종수요 항목별 생산유발액"
    fdp = {c: _col_vec(st, P, c) for c in FD_ITEMS + ["9190"]}
    sectors = []
    for i, s in enumerate(st["sectors"]):
        sectors.append({"code": s["code"], "name": s["name"], "group": s["group"], "produced": s["produced"],
                        "output": float(X[i]), "lSum": float(L[:, i].sum()), "lDiag": float(L[i, i]),
                        "vSum": float(V[:, i].sum()), "mSum": float(M[:, i].sum()),
                        "influence": float(infl[i]), "sensitivity": float(sens[i]),
                        "fd": [float(fdp[c][i]) for c in FD_ITEMS], "fdTotal": float(fdp["9190"][i])})
    groups = []
    for g in GROUP_NAMES:
        idx = [i for i, s in enumerate(st["sectors"]) if s["group"] == g and s["produced"]]
        if not idx:
            continue
        w = X[idx] / X[idx].sum()
        groups.append({"group": g, "output": float(X[idx].sum()),
                       "lSum": float(w @ L[:, idx].sum(0)), "lDiag": float(w @ np.diag(L)[idx]),
                       "vSum": float(w @ V[:, idx].sum(0)), "mSum": float(w @ M[:, idx].sum(0))})
    items = []
    names = {c: clean(st["book"][P][5][j]) for c, j in st["index"][P][1].items()}
    for c in FD_ITEMS + ["9190"]:
        items.append({"code": c, "name": names.get(c, c),
                      "production": _cell(st, P, "9811", c),
                      "valueAdded": _cell(st, "최종수요 항목별 부가가치유발액", "9811", c),
                      "imports": _cell(st, "최종수요 항목별 수입유발액", "9811", c),
                      "amount": _cell(st, P, "9819", c)})
    produced = X > 0
    avg = {"lSum": float(L[:, produced].sum(0).mean())}
    return emit({"sectors": sectors, "groups": groups, "items": items, "avg": avg})


def employment_view():
    """고용유발 화면용: 대분류·13개 산업군의 취업(고용)계수와 유발계수 2020~2023"""
    if not SUMMARY:
        return emit(None)
    ind = SUMMARY["indicators"]
    keys = ["employmentCoef", "wageCoef", "employmentInduce", "wageInduce"]
    return emit({"years": SUMMARY["years"], **{k: ind[k] for k in keys}})


# ---------------------------------------------------------------- 시뮬레이션
def simulate(level, payload):
    """국산품 최종수요 증가 f에 대한 생산(x=Lf)·수입(Mf)·부가가치(Vf)·취업자 유발효과"""
    st = _st(level)
    shocks = json.loads(payload)
    n = len(st["codes"])
    f = np.zeros(n)
    for s in shocks:
        a = float(s["amount"])
        if not np.isfinite(a) or a < 0:
            raise ValueError("수요 증가액은 0 이상의 유한한 수여야 합니다.")
        i = st["pos"][s["code"]]
        if not st["sectors"][i]["produced"]:
            raise ValueError(st["sectors"][i]["name"] + "은(는) 국내 생산이 없어(전량 수입) 국산품 수요 증가를 줄 수 없습니다.")
        f[i] += a
    if not f.sum() > 0:
        raise ValueError("한 산업 이상에 양(+)의 수요 증가액을 입력하세요.")
    x, m, v = st["L"] @ f, st["M"] @ f, st["V"] @ f
    indirect = x - f
    e_emp, e_wage = _emp_coef("employment"), _emp_coef("wage")
    has_emp = e_emp is not None
    emp = np.array([x[i] * e_emp.get(s["large"], 0.0) / 1000 for i, s in enumerate(st["sectors"])]) if has_emp else np.zeros(n)
    wage = np.array([x[i] * e_wage.get(s["large"], 0.0) / 1000 for i, s in enumerate(st["sectors"])]) if has_emp else np.zeros(n)

    rows = [{"code": s["code"], "name": s["name"], "large": s["large"], "group": s["group"],
             "production": float(x[i]), "direct": float(f[i]), "indirect": float(indirect[i]),
             "imports": float(m[i]), "valueAdded": float(v[i]), "employment": float(emp[i]), "wage": float(wage[i]),
             "share": float(x[i] / x.sum())}
            for i, s in enumerate(st["sectors"])]
    rows.sort(key=lambda r: r["production"], reverse=True)

    groups = {}
    for r in rows:
        g = groups.setdefault(r["group"], {"group": r["group"], "production": 0.0, "direct": 0.0, "indirect": 0.0,
                                           "imports": 0.0, "valueAdded": 0.0, "employment": 0.0, "wage": 0.0})
        for k in ("production", "direct", "indirect", "imports", "valueAdded", "employment", "wage"):
            g[k] += r[k]
    group_rows = sorted(groups.values(), key=lambda g: g["production"], reverse=True)

    return emit({"demand": float(f.sum()), "production": float(x.sum()), "direct": float(f.sum()),
                 "indirect": float(indirect.sum()), "imports": float(m.sum()), "valueAdded": float(v.sum()),
                 "employment": float(emp.sum()) if has_emp else None, "wage": float(wage.sum()) if has_emp else None,
                 "approx": str(level) != "33",
                 "multiplier": float(x.sum() / f.sum()), "groups": group_rows, "groupOrder": GROUP_NAMES, "rows": rows})
