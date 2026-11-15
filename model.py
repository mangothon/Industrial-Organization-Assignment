"""산업연관표 분석 계산 모듈 (브라우저 Pyodide에서 실행)

- 대분류(33)·중분류(83)·소분류(165)·기본부문(380) 투입산출표를 모두 지원
- 분류마다 한 번 읽은 자료는 STATE에 보관해 다시 읽지 않음
- 함수의 반환값은 모두 JSON 문자열 (app.js에서 해석)
"""
import io
import json
import re

import numpy as np
import openpyxl

SUMMARY_CODE = re.compile(r"^9\d{3}$")  # 9로 시작하는 4자리 코드 = 합계·지표 행/열
STATE = {}  # level -> 해당 분류의 자료
CLASS = None  # 부문분류표: 코드 -> 대분류 코드

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
LARGE_TO_GROUP = {code: name for name, codes in GROUP13 for code in codes}

COEF_SHEETS = {"총투입계수(A)", "수입투입계수(Am)", "국산투입계수(Ad)", "생산유발계수", "수입유발계수", "부가가치유발계수"}


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


# ---------------------------------------------------------------- 부문분류표
def load_classification(raw):
    """기본→소→중→대 분류 연결표를 읽어 '모든 분류의 코드 -> 대분류 코드' 사전을 만든다."""
    global CLASS
    wb = openpyxl.load_workbook(io.BytesIO(bytes(raw)), read_only=True, data_only=True)
    rows = list(wb[wb.sheetnames[0]].values)
    wb.close()
    to_large, large_names = {}, {}
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
    CLASS = {"to_large": to_large, "large_names": large_names}
    return emit({"large": [{"code": c, "name": n, "group": LARGE_TO_GROUP.get(c, "기타")}
                           for c, n in large_names.items() if not SUMMARY_CODE.match(c)]})


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

    def matrix(sheet):
        rows = book[sheet]
        ri = {str(r[0]).strip(): i for i, r in enumerate(rows) if r and r[0] is not None}
        ci = {str(c).strip(): i for i, c in enumerate(rows[4]) if c is not None}
        a = np.array([[rows[ri[c]][ci[k]] for k in codes] for c in codes], dtype=float)
        if not np.isfinite(a).all():
            raise ValueError(sheet + ": 숫자가 아니거나 비어 있는 셀이 있습니다.")
        return a

    L, M, V = matrix("생산유발계수"), matrix("수입유발계수"), matrix("부가가치유발계수")
    Ad, Am = matrix("국산투입계수(Ad)"), matrix("수입투입계수(Am)")

    def row_vector(sheet, row_code):
        rows = book[sheet]
        ci = {str(c).strip(): i for i, c in enumerate(rows[4]) if c is not None}
        r = next(r for r in rows if r and str(r[0]).strip() == row_code)
        return np.array([r[ci[c]] for c in codes], dtype=float)

    va_rate = row_vector("총투입계수(A)", "9690")  # 부가가치율
    output = row_vector("A표_총거래표(생산자)", "9790")  # 총투입(=총산출), 백만원

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
        hdr = {str(c).strip() for c in rows[4][2:] if c is not None}
        rws = {str(r[0]).strip() for r in rows[6:] if r and r[0] is not None}
        sheets.append({"name": s, "title": clean(rows[0][0]), "unit": clean(rows[3][0]) or None,
                       "square": all(c in hdr and c in rws for c in codes)})

    STATE[str(level)] = {"book": book, "codes": codes, "names": names, "index": {c: i for i, c in enumerate(codes)},
                         "sectors": sectors, "L": L, "M": M, "V": V, "output": output}
    return emit({"level": str(level), "sectors": sectors, "sheets": sheets, "residuals": residuals,
                 "totalOutput": float(output.sum()), "notProduced": int((~produced).sum())})


# ---------------------------------------------------------------- 원자료 탐색
def _axis_items(rows):
    """행 목록과 열 목록 (코드, 이름, 위치)"""
    row_items = [(str(r[0]).strip(), clean(r[1]), i) for i, r in enumerate(rows) if i >= 6 and r and r[0] is not None]
    col_items = [(str(rows[4][j]).strip(), clean(rows[5][j]) if j < len(rows[5]) else "", j)
                 for j in range(2, len(rows[4])) if rows[4][j] is not None]
    return row_items, col_items


def explore(level, sheet, axis, key):
    """axis='row'이면 선택한 행을 열 방향으로, axis='col'이면 선택한 열을 행 방향으로 펼친다."""
    st = STATE[str(level)]
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
        idx = st["index"].get(code)
        cells.append({"code": code, "name": name, "value": v if v is not None else (clean(val) or None),
                      "summary": bool(SUMMARY_CODE.match(code)),
                      "large": st["sectors"][idx]["large"] if idx is not None else None})
    return emit({"axis": axis, "selected": chosen[0], "name": chosen[1],
                 "choices": [{"code": c, "name": n, "summary": bool(SUMMARY_CODE.match(c))} for c, n, _ in choices],
                 "cells": cells})


def heatmap(level, sheet):
    """부문×부문 블록(중간거래 또는 계수 행렬)을 반환. 정방 블록이 없는 시트는 None."""
    st = STATE[str(level)]
    rows = st["book"][sheet]
    codes = st["codes"]
    ri = {str(r[0]).strip(): i for i, r in enumerate(rows) if r and r[0] is not None}
    ci = {str(c).strip(): i for i, c in enumerate(rows[4]) if c is not None}
    if not all(c in ri and c in ci for c in codes):
        return emit(None)
    a = np.array([[num(rows[ri[r]][ci[c]]) or 0.0 for c in codes] for r in codes], dtype=float)
    digits = 6 if sheet in COEF_SHEETS else 1
    return emit({"n": len(codes), "values": np.round(a, digits).ravel().tolist(),
                 "max": float(a.max()), "minPositive": float(a[a > 0].min()) if (a > 0).any() else 0.0})


# ---------------------------------------------------------------- 시뮬레이션
def simulate(level, payload):
    """국산품 최종수요 증가 f에 대한 생산(x=Lf)·수입(Mf)·부가가치(Vf) 유발효과"""
    st = STATE[str(level)]
    shocks = json.loads(payload)
    n = len(st["codes"])
    f = np.zeros(n)
    for s in shocks:
        a = float(s["amount"])
        if not np.isfinite(a) or a < 0:
            raise ValueError("수요 증가액은 0 이상의 유한한 수여야 합니다.")
        i = st["index"][s["code"]]
        if not st["sectors"][i]["produced"]:
            raise ValueError(st["sectors"][i]["name"] + "은(는) 국내 생산이 없어(전량 수입) 국산품 수요 증가를 줄 수 없습니다.")
        f[i] += a
    if not f.sum() > 0:
        raise ValueError("한 산업 이상에 양(+)의 수요 증가액을 입력하세요.")
    x, m, v = st["L"] @ f, st["M"] @ f, st["V"] @ f
    indirect = x - f

    rows = [{"code": s["code"], "name": s["name"], "large": s["large"], "group": s["group"],
             "production": float(x[i]), "direct": float(f[i]), "indirect": float(indirect[i]),
             "imports": float(m[i]), "valueAdded": float(v[i]),
             "share": float(x[i] / x.sum())}
            for i, s in enumerate(st["sectors"])]
    rows.sort(key=lambda r: r["production"], reverse=True)

    groups = {}
    for r in rows:
        g = groups.setdefault(r["group"], {"group": r["group"], "production": 0.0, "direct": 0.0, "indirect": 0.0,
                                           "imports": 0.0, "valueAdded": 0.0})
        for k in ("production", "direct", "indirect", "imports", "valueAdded"):
            g[k] += r[k]
    order = [name for name, _ in GROUP13]
    group_rows = sorted(groups.values(), key=lambda g: g["production"], reverse=True)

    return emit({"demand": float(f.sum()), "production": float(x.sum()), "direct": float(f.sum()),
                 "indirect": float(indirect.sum()), "imports": float(m.sum()), "valueAdded": float(v.sum()),
                 "multiplier": float(x.sum() / f.sum()), "groups": group_rows, "groupOrder": order, "rows": rows})
