"""data/ 以下の問題・用語データを検証・統合し，docs/data.js と図版画像を生成する。

使い方: python tools/build.py [--pdf-dir DIR]
  --pdf-dir を指定すると，問題に img 指定がある場合に IPA の問題 PDF から図版を切り出す
  （既に docs/img に画像があれば再生成しない。--force で再生成）。
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATS = {
    "cpu": "コンピュータ構成要素",
    "sys": "システム構成要素",
    "ui": "ユーザーインタフェース",
    "db": "データベース",
    "nw": "ネットワーク",
    "sec": "セキュリティ",
    "dev": "システム開発技術",
    "mgmt": "ソフトウェア開発管理技術",
    "pm": "プロジェクトマネジメント",
    "svc": "サービスマネジメント",
    "strat": "システム戦略",
    "plan": "システム企画",
    "biz": "経営戦略・企業と法務",
    "base": "基礎理論・その他",
}
SYL = {
    "Ⅰ": "契約・合意", "Ⅱ": "企画", "Ⅲ": "要件定義",
    "Ⅳ": "開発", "Ⅴ": "運用・保守", "Ⅵ": "関連知識",
}
KANA = ["ア", "イ", "ウ", "エ"]
LINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")


def crop(pdf_dir, exam_id, n, k, spec, force):
    import pymupdf
    from PIL import Image, ImageOps

    out = os.path.join(ROOT, "docs", "img", f"{exam_id}_{n:02d}_{k}.png")
    if os.path.exists(out) and not force:
        return os.path.relpath(out, os.path.join(ROOT, "docs"))
    pdfs = glob.glob(os.path.join(pdf_dir, f"{exam_id}*_qs.pdf"))
    if not pdfs:
        raise SystemExit(f"PDF not found for {exam_id} in {pdf_dir}")
    page = pymupdf.open(pdfs[0])[spec["p"] - 1]
    pix = page.get_pixmap(matrix=pymupdf.Matrix(2.5, 2.5), colorspace=pymupdf.csGRAY)
    img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    w, h = img.size
    x0 = spec.get("x0", 0.08)
    x1 = spec.get("x1", 0.95)
    img = img.crop((int(w * x0), int(h * spec["y0"]), int(w * x1), int(h * spec["y1"])))
    # 余白を詰める
    inv = ImageOps.invert(img).point(lambda v: 255 if v > 40 else 0)
    bbox = inv.getbbox()
    if bbox:
        pad = 12
        img = img.crop((max(bbox[0] - pad, 0), max(bbox[1] - pad, 0),
                        min(bbox[2] + pad, img.width), min(bbox[3] + pad, img.height)))
    img = img.point(lambda v: 255 if v > 225 else v)
    img = img.quantize(16)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)
    return os.path.relpath(out, os.path.join(ROOT, "docs"))


def _norm(s):
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"[\s，、。．・“”\"'（）()〔〕「」:：／/＝=＋+−\-]", "", s)


def find_repeats(questions):
    """問題文と選択肢が酷似する問題を“再出題”としてグループ化し，rep に他年度の id を入れる。"""
    from difflib import SequenceMatcher

    keys = [(_norm(q["q"]), _norm("".join(q["ch"]))) for q in questions]
    parent = list(range(len(questions)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(questions)):
        for j in range(i + 1, len(questions)):
            if questions[i]["exam"] == questions[j]["exam"]:
                continue
            qi, ci = keys[i]
            qj, cj = keys[j]
            if abs(len(ci) - len(cj)) > max(len(ci), len(cj)) * 0.3:
                continue
            sc = SequenceMatcher(None, ci, cj, autojunk=False).ratio()
            if sc < 0.8:
                continue
            sq = SequenceMatcher(None, qi, qj, autojunk=False).ratio()
            if sq >= 0.6:
                parent[find(i)] = find(j)
    groups = {}
    for i in range(len(questions)):
        groups.setdefault(find(i), []).append(i)
    for members in groups.values():
        if len(members) > 1:
            ids = [questions[m]["id"] for m in members]
            for m in members:
                questions[m]["rep"] = [x for x in ids if x != questions[m]["id"]]
    # 再出題グループ内で解説が簡素な問題は，最も詳しい解説を流用する（選択肢の並びが同じ場合のみ）
    for members in groups.values():
        if len(members) < 2:
            continue
        best = max(members, key=lambda m: len(questions[m]["exp"]) + sum(len(c) for c in questions[m]["cx"]))
        b = questions[best]
        for m in members:
            q = questions[m]
            if m == best or q["ans"] != b["ans"]:
                continue
            same_order = all(SequenceMatcher(None, _norm(x), _norm(y)).ratio() > 0.7 for x, y in zip(q["ch"], b["ch"]))
            if not same_order:
                continue
            if len(q["exp"]) < len(b["exp"]) * 0.6:
                q["exp"] = b["exp"]
                q["terms"] = list(dict.fromkeys(q["terms"] + b["terms"]))
            q["cx"] = [x if len(x) >= len(y) * 0.6 else y for x, y in zip(q["cx"], b["cx"])]
            if len(q.get("point", "")) < len(b.get("point", "")) * 0.6:
                q["point"] = b["point"]
    n = sum(1 for q in questions if q.get("rep"))
    print(f"repeated questions: {n} ({sum(1 for g in groups.values() if len(g) > 1)} groups)")


REF_CATS = {
    "コンピュータ構成要素": "cpu", "システム構成要素": "sys", "データベース": "db", "ネットワーク": "nw",
    "セキュリティ": "sec", "システム開発技術": "dev", "ソフトウェア開発管理技術": "mgmt",
    "システム戦略": "strat", "システム企画": "plan",
}


def parse_reference():
    """code_artifact.md（分野別の年度別出題数・小分類別出題実績）を読み込む。"""
    path = os.path.join(ROOT, "code_artifact.md")
    if not os.path.exists(path):
        return None
    ref = {"years": [], "cats": {}, "subs": {}}
    cat = None
    mode = None
    for line in open(path, encoding="utf-8"):
        m = re.match(r"##\s*[\d.]+：(.+)", line.strip())
        if m:
            cat = REF_CATS.get(m.group(1).strip())
            continue
        if "年度別出題数" in line:
            mode = "year"
        elif "小分類別出題実績" in line:
            mode = "sub"
        cells = [c.strip().strip("*") for c in line.strip().strip("|").split("|")]
        if not cat or len(cells) < 2 or set(cells[0]) <= set(":- "):
            continue
        if mode == "year" and cells[0] == "年度":
            ref["years"] = cells[1:]
        elif mode == "year" and cells[0] == "出題数":
            ref["cats"][cat] = [int(c) for c in cells[1:]]
        elif mode == "sub" and cells[0] != "小分類":
            ref["subs"].setdefault(cat, []).append([cells[0], int(cells[1])])
    return ref


def stamp_version():
    """index.html の静的ファイル参照にハッシュを付け，スマホのキャッシュで古い版が残らないようにする。"""
    import hashlib
    docs = os.path.join(ROOT, "docs")
    h = hashlib.sha1()
    for name in ("app.js", "data.js", "style.css"):
        h.update(open(os.path.join(docs, name), "rb").read())
    ver = h.hexdigest()[:8]
    path = os.path.join(docs, "index.html")
    html = open(path, encoding="utf-8").read()
    html = re.sub(r'(href="style\.css|src="app\.js|src="data\.js)(\?v=[^"]*)?"', lambda m: f'{m.group(1)}?v={ver}"', html)
    open(path, "w", encoding="utf-8").write(html)
    sw = os.path.join(docs, "sw.js")
    js = open(sw, encoding="utf-8").read()
    open(sw, "w", encoding="utf-8").write(re.sub(r'const CACHE = "[^"]*"', f'const CACHE = "sa-am2-{ver}"', js))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    answers = json.load(open(os.path.join(ROOT, "data", "answers.json"), encoding="utf-8"))
    exams, questions, terms = [], [], {}
    errors, warnings = [], []
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "exams", "*.json"))):
        ex = json.load(open(path, encoding="utf-8"))
        eid = ex["id"]
        key = answers[eid]
        nums = [q["n"] for q in ex["questions"]]
        if nums != list(range(1, 26)):
            errors.append(f"{eid}: question numbers {nums}")
        exams.append({"id": eid, "label": ex["label"], "short": ex["short"]})
        for q in ex["questions"]:
            qid = f"{eid}-{q['n']:02d}"
            if q["cat"] not in CATS:
                errors.append(f"{qid}: bad cat {q['cat']}")
            if q.get("syl") and q["syl"] not in SYL:
                errors.append(f"{qid}: bad syl {q['syl']}")
            if len(q["ch"]) != 4 or len(q.get("cx", [""] * 4)) != 4:
                errors.append(f"{qid}: choices must be 4")
            ans = key[q["n"] - 1]
            if ans not in KANA:
                warnings.append(f"{qid}: answer is '{ans}' (全員正解等)")
            item = {
                "id": qid, "exam": eid, "n": q["n"], "cat": q["cat"], "sub": q.get("sub", ""),
                "syl": q.get("syl", ""), "q": q["q"], "ch": q["ch"], "cx": q.get("cx", []),
                "ans": KANA.index(ans) if ans in KANA else -1, "exp": q["exp"],
                "terms": q.get("terms", []), "point": q.get("point", ""),
            }
            if q.get("same"):
                item["same"] = q["same"]
            if q.get("img"):
                if args.pdf_dir:
                    item["img"] = [crop(args.pdf_dir, eid, q["n"], k, s, args.force)
                                   for k, s in enumerate(q["img"])]
                else:
                    item["img"] = [f"img/{eid}_{q['n']:02d}_{k}.png" for k in range(len(q["img"]))]
                    for p in item["img"]:
                        if not os.path.exists(os.path.join(ROOT, "docs", p)):
                            errors.append(f"{qid}: missing image {p} (run with --pdf-dir)")
            if q.get("chImg"):
                item["chImg"] = True
            questions.append(item)
        for name, t in ex.get("terms", {}).items():
            if name in terms:
                # 後から出てきた定義は関連語だけ追加する
                known = {r[0] for r in terms[name]["rel"]}
                terms[name]["rel"] += [r for r in t.get("rel", []) if r[0] not in known]
                continue
            terms[name] = {"cat": t["cat"], "def": t["def"], "rel": t.get("rel", []), "src": eid}
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "terms", "*.json"))):
        for name, t in json.load(open(path, encoding="utf-8")).items():
            if name in terms:
                known = {r[0] for r in terms[name]["rel"]}
                terms[name]["rel"] += [r for r in t.get("rel", []) if r[0] not in known]
                continue
            terms[name] = {"cat": t["cat"], "def": t["def"], "rel": t.get("rel", []), "src": "extra"}

    find_repeats(questions)

    # 用語→問題の逆引き，未定義の参照チェック
    undefined = {}
    for q in questions:
        refs = set(q["terms"])
        for text in [q["exp"], *q["cx"]]:
            refs |= {m.group(1) for m in LINK.finditer(text)}
        q["terms"] = sorted(refs, key=lambda r: q["terms"].index(r) if r in q["terms"] else 99)
        for r in refs:
            if r in terms:
                terms[r].setdefault("qs", []).append(q["id"])
            else:
                undefined.setdefault(r, []).append(q["id"])
    rel_undefined = {}
    for name, t in terms.items():
        for r in t["rel"]:
            if r[0] not in terms:
                rel_undefined.setdefault(r[0], []).append(name)
        if t["cat"] not in CATS:
            errors.append(f"term {name}: bad cat {t['cat']}")

    data = {"cats": CATS, "syl": SYL, "exams": exams, "questions": questions, "terms": terms, "ref": parse_reference()}
    with open(os.path.join(ROOT, "docs", "data.js"), "w", encoding="utf-8") as f:
        f.write("window.DATA=")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    stamp_version()

    print(f"exams={len(exams)} questions={len(questions)} terms={len(terms)}")
    for w in warnings:
        print("WARN", w)
    if undefined:
        print(f"undefined terms referenced by questions ({len(undefined)}):")
        for k, v in sorted(undefined.items()):
            print("  ", k, v[:3])
    if rel_undefined:
        print(f"related terms without definition: {len(rel_undefined)}")
        print("  ", " / ".join(sorted(rel_undefined)))
    for e in errors:
        print("ERROR", e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
