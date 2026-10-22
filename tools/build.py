#!/usr/bin/env python3
"""Build the High Performance C++ revision site.

Inputs:   data/content/lecture-NN.json   notes, key terms, MCQs, MSQs and written questions per session
          data/coding/coding.json        coding problems (with tested solutions), LeetCode and other-platform links
Outputs:  data/site.js, data/lecture-NN.js, data/coding.js, lectures/*.html, coding/index.html, index.html

Run from the repo root:  python3 tools/build.py
Fails loudly on malformed content: bad answer indices, MSQs with fewer than 2 correct options, regexes that don't
compile, or a model answer / solution that doesn't pass its own checks.
"""
import glob
import hashlib
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXAM_DATE = "24 Oct"
JS_UNSAFE = re.compile(r"\(\?<[=!]|\(\?[a-z]+\)")
# Words that must never appear on the site (stored rot13-encoded so they don't appear in this file either)
BANNED = re.compile("|".join(__import__("codecs").decode(w, "rot13") for w in ["fpnyre"]), re.I)


def version(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:10]


def write_js(path, var, obj):
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"window.{var} = " + json.dumps(obj, ensure_ascii=False, indent=1) + ";\n")


def check_patterns(tag, checks, answer, problems):
    for c in checks:
        pats = c.get("patterns") or []
        if not pats:
            problems.append(f"{tag}: check '{c.get('label')}' has no patterns")
        for p in pats:
            if JS_UNSAFE.search(p):
                problems.append(f"{tag}: pattern not JS-safe: {p}")
            try:
                re.compile(p)
            except re.error as e:
                problems.append(f"{tag}: bad regex {p}: {e}")
        if pats and not any(re.search(p, answer, re.I) for p in pats):
            problems.append(f"{tag}: answer fails check '{c['label']}'")


def load_lectures(problems):
    lectures = []
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "content", "lecture-*.json"))):
        raw = open(path, encoding="utf-8").read()
        if BANNED.search(raw):
            problems.append(f"{os.path.basename(path)}: contains a banned word")
        d = json.loads(raw)
        n = d["num"]
        tag = f"session {n}"
        if not d.get("notes"):
            problems.append(f"{tag}: no notes")
        for i, q in enumerate(d["mcqs"], 1):
            q["id"] = f"L{n:02d}-m{i}"
            if len(q["options"]) < 2 or not 0 <= q["answer"] < len(q["options"]):
                problems.append(f"{tag} MCQ {i}: bad options/answer")
        d.setdefault("msqs", [])
        for i, q in enumerate(d["msqs"], 1):
            q["id"] = f"L{n:02d}-x{i}"
            a = q.get("answers") or []
            if len(a) < 2 or len(a) >= len(q["options"]) or len(set(a)) != len(a) or not all(0 <= x < len(q["options"]) for x in a):
                problems.append(f"{tag} MSQ {i}: answers must be 2..n-1 distinct valid indices, got {a}")
            q["answers"] = sorted(a)
        for i, q in enumerate(d["short"], 1):
            q["id"] = f"L{n:02d}-s{i}"
            check_patterns(f"{tag} short {i}", q["checks"], q["modelAnswer"], problems)
        lectures.append(d)
    return lectures


def load_coding(problems):
    path = os.path.join(ROOT, "data", "coding", "coding.json")
    if not os.path.exists(path):
        return None
    raw = open(path, encoding="utf-8").read()
    if BANNED.search(raw):
        problems.append("coding.json: contains a banned word")
    d = json.loads(raw)
    for p in d["problems"]:
        check_patterns(f"coding {p['id']}", p.get("checks", []), p["solution"], problems)
    d.setdefault("leetcode", [])
    d.setdefault("otherPlatforms", [])
    return d


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · High Performance C++ Revision</title>
<meta name="description" content="{desc}">
<link rel="stylesheet" href="{up}assets/style.css?v={v_css}">
</head>
<body data-page="{page}">
<header class="top"><div class="wrap">
  <a class="brand" href="{up}index.html">High Performance C++ <span>Revision</span></a>
  <div class="spacer"></div>
  <button class="theme-toggle" type="button">☾ Dark</button>
</div></header>
<main class="wrap">
{body}
  <p class="foot">Built from the course syllabus and the code written in class, for end-term revision. Your answers are saved only in this browser.</p>
</main>
{scripts}
<script src="{up}assets/app.js?v={v_js}"></script>
</body>
</html>
"""

LECTURE_BODY = """  <div class="crumbs"><a href="../index.html">All sessions</a> / <span id="l-num"></span></div>
  <h1 id="l-title"></h1>
  <p class="sub" id="l-sub"></p>
  <div class="score-line"><span id="score"></span><button class="btn" id="reset" type="button">Reset this session</button></div>
  <p class="sub" id="coding-links"></p>
  <nav class="section-nav" aria-label="Sections">
    <a class="btn" href="#sec-notes">📘 One-shot notes</a>
    <a class="btn" href="#sec-terms">Key terms</a>
    <a class="btn" href="#sec-mcq">MCQs</a>
    <a class="btn" href="#sec-msq">Multi-select (MSQ)</a>
    <a class="btn" href="#sec-short">Written answers</a>
  </nav>
  <h2 id="sec-notes">📘 One-shot notes</h2>
  <div class="toc" id="toc"></div>
  <div id="notes"></div>
  <h2 id="sec-terms">Key terms</h2>
  <div id="terms"></div>
  <h2 id="sec-mcq">MCQs: single correct answer</h2>
  <p class="sub">Pick one option: green if right, red if not, with an explanation either way.</p>
  <div id="mcqs"></div>
  <h2 id="sec-msq">Multi-select questions (MSQ)</h2>
  <p class="sub">More than one option can be correct. Select all that apply, then press Submit: it is right only if you pick exactly the correct set.</p>
  <div id="msqs"></div>
  <h2 id="sec-short">Written answers</h2>
  <p class="sub">Write your answer and press <b>Check answer</b>: it is green only when every key point is covered.</p>
  <div id="short"></div>
  <nav class="pager" id="pager" aria-label="Session navigation"></nav>
"""

CODING_BODY = """  <div class="crumbs"><a href="../index.html">All sessions</a> / Coding practice</div>
  <h1>Coding practice</h1>
  <p class="sub">The exam includes C++ coding questions in exactly this format (description, signature, constraints, example). Here is the course's Memory Pool problem plus similar low-latency C++ problems, each with hints, a key-idea checker and a solution that was compiled and tested with sanitizers. After those, similar problems on LeetCode and other platforms.</p>
  <div class="score-line"><span id="score"></span></div>
  <nav class="section-nav" aria-label="Sections">
    <a class="btn" href="#sec-problems">💻 Coding problems (12)</a>
    <a class="btn" href="#sec-leetcode">LeetCode links</a>
    <a class="btn" href="#sec-other">GfG / HackerRank / Codeforces</a>
  </nav>
  <h2 id="sec-problems">Exam-style coding problems</h2>
  <div class="toc" id="toc"></div>
  <div id="problems"></div>
  <h2 id="sec-leetcode">Similar problems on LeetCode</h2>
  <div id="leetcode"></div>
  <h2 id="sec-other">Similar problems on other platforms</h2>
  <div id="other"></div>
  <nav class="pager"><a class="btn" href="../index.html">← All sessions</a></nav>
"""

PYQ_BODY = """  <div class="crumbs"><a href="../index.html">All sessions</a> / Previous year paper</div>
  <h1>Previous year paper: End Term (2027 batch)</h1>
  <p class="sub" id="pyq-format"></p>
  <div class="score-line"><span id="score"></span><button class="btn" id="reset" type="button">Reset this paper</button></div>
  <nav class="section-nav" aria-label="Sections">
    <a class="btn" href="#sec-pyq-mcq">Section 1: 25 MCQs</a>
    <a class="btn" href="#sec-pyq-coding">Section 2: Coding (any 2)</a>
    <a class="btn" href="#sec-pyq-diagram">Section 3: Diagram</a>
  </nav>
  <h2 id="sec-pyq-mcq">Section 1: MCQs</h2>
  <p class="sub">The official answers from the paper. Two questions are select-all (MSQ): press Submit after choosing.</p>
  <div id="pyq-mcqs"></div>
  <h2 id="sec-pyq-coding">Section 2: Coding (attempt any 2)</h2>
  <p class="sub">Questions exactly as in the paper, each with a full solution that was compiled and tested with sanitizers, plus an explanation of what the examiner checks. Try it yourself first, then open the solution.</p>
  <div id="pyq-coding"></div>
  <h2 id="sec-pyq-diagram">Section 3: Diagram</h2>
  <div id="pyq-diagram"></div>
  <nav class="pager"><a class="btn" href="../index.html">← All sessions</a></nav>
"""

INDEX_BODY = """  <h1>High Performance C++: End-term Revision</h1>
  <p class="sub">14 sessions, each with one-shot notes, key terms, MCQs, multi-select questions (MSQs) and written questions, plus exam-style C++ coding problems with tested solutions. The exam has MCQs, MSQs and coding questions. Progress is saved in this browser.</p>
  <div class="summary" id="summary"></div>
  <h2>Sessions</h2>
  <div class="grid" id="grid"></div>
  <h2>Previous year paper &amp; coding practice</h2>
  <div class="grid" id="quiz-grid"></div>
  <p class="sub" style="margin-top:10px">Jump to: <a href="coding/index.html#sec-problems">coding problems</a> · <a href="coding/index.html#sec-leetcode">LeetCode links</a> · <a href="coding/index.html#sec-other">GfG / HackerRank / Codeforces links</a></p>
  <p style="margin-top:20px"><button class="btn" id="reset-all" type="button">Reset all progress</button></p>
"""


def main():
    problems = []
    lectures = load_lectures(problems)
    coding = load_coding(problems)
    pyq = None
    pyq_path = os.path.join(ROOT, "data", "pyq", "pyq.json")
    if os.path.exists(pyq_path):
        raw = open(pyq_path, encoding="utf-8").read()
        if BANNED.search(raw):
            problems.append("pyq.json: contains a banned word")
        pyq = json.loads(raw)
        titles = {l["num"]: l["title"] for l in lectures}
        for q in pyq["mcqs"] + pyq["coding"] + [pyq["diagram"]]:
            q["id"] = f"PYQ-{q['n']}"
            sn = q.get("session")
            q["ref"] = f'<a href="../lectures/lecture-{sn:02d}.html">Session {sn}: {html.escape(titles.get(sn, ""))}</a>' if sn else ""
            if q.get("type") == "mcq" and not 0 <= q["answer"] < len(q["options"]):
                problems.append(f"PYQ {q['n']}: bad answer")
            if q.get("type") == "msq" and (len(q["answers"]) < 2 or not all(0 <= a < len(q["options"]) for a in q["answers"])):
                problems.append(f"PYQ {q['n']}: bad MSQ answers")
    if len(lectures) != 14:
        problems.append(f"expected 14 sessions, found {len(lectures)}")
    if problems:
        print("\n".join("PROBLEM: " + p for p in problems))
        if "--allow-missing" not in sys.argv:
            sys.exit(f"{len(problems)} problem(s)")

    os.makedirs(os.path.join(ROOT, "lectures"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "coding"), exist_ok=True)
    by_session = {}
    for p in (coding or {}).get("problems", []):
        for sn in p.get("sessions", []):
            by_session.setdefault(sn, []).append({"id": p["id"], "title": p["title"]})

    site = {
        "examDate": EXAM_DATE,
        "lectures": [{
            "num": l["num"], "title": l["title"], "subtitle": "", "file": f"lecture-{l['num']:02d}.html",
            "ids": [q["id"] for q in l["mcqs"]] + [q["id"] for q in l["msqs"]] + [q["id"] for q in l["short"]],
            "counts": {"quiz": 0, "mcq": len(l["mcqs"]), "msq": len(l["msqs"]), "short": len(l["short"])},
        } for l in lectures],
        "quizzes": [],
        "coding": ({"file": "coding/index.html", "ids": ["C-" + p["id"] for p in coding["problems"]],
                    "leetcode": len(coding["leetcode"]), "other": len(coding["otherPlatforms"])} if coding else None),
        "pyq": ({"file": "pyq/index.html", "ids": [q["id"] for q in pyq["mcqs"]]} if pyq else None),
    }
    write_js(os.path.join(ROOT, "data", "site.js"), "SITE", site)
    v = {"v_css": version(os.path.join(ROOT, "assets", "style.css")), "v_js": version(os.path.join(ROOT, "assets", "app.js")),
         "v_site": version(os.path.join(ROOT, "data", "site.js"))}

    for i, l in enumerate(lectures):
        n = l["num"]
        page = dict(l, quiz=[], coding=by_session.get(n, []))
        page["prev"] = {"num": lectures[i - 1]["num"], "file": f"lecture-{lectures[i - 1]['num']:02d}.html"} if i else None
        page["next"] = {"num": lectures[i + 1]["num"], "file": f"lecture-{lectures[i + 1]['num']:02d}.html"} if i + 1 < len(lectures) else None
        data = os.path.join(ROOT, "data", f"lecture-{n:02d}.js")
        write_js(data, "PAGE", page)
        scripts = f'<script src="../data/site.js?v={v["v_site"]}"></script>\n<script src="../data/lecture-{n:02d}.js?v={version(data)}"></script>'
        with open(os.path.join(ROOT, "lectures", f"lecture-{n:02d}.html"), "w", encoding="utf-8") as f:
            f.write(PAGE.format(title=html.escape(f"Session {n}: {l['title']}"), desc=html.escape(l["summary"][:150]),
                                up="../", page="lecture", body=LECTURE_BODY, scripts=scripts, **v))
    if coding:
        data = os.path.join(ROOT, "data", "coding.js")
        write_js(data, "PAGE", coding)
        scripts = f'<script src="../data/site.js?v={v["v_site"]}"></script>\n<script src="../data/coding.js?v={version(data)}"></script>'
        with open(os.path.join(ROOT, "coding", "index.html"), "w", encoding="utf-8") as f:
            f.write(PAGE.format(title="Coding practice", desc="Low-latency C++ coding problems with tested solutions, plus LeetCode and other links.",
                                up="../", page="coding", body=CODING_BODY, scripts=scripts, **v))
    if pyq:
        os.makedirs(os.path.join(ROOT, "pyq"), exist_ok=True)
        data = os.path.join(ROOT, "data", "pyq.js")
        write_js(data, "PAGE", pyq)
        scripts = f'<script src="../data/site.js?v={v["v_site"]}"></script>\n<script src="../data/pyq.js?v={version(data)}"></script>'
        with open(os.path.join(ROOT, "pyq", "index.html"), "w", encoding="utf-8") as f:
            f.write(PAGE.format(title="Previous year paper", desc="End Term 2027 paper: 25 MCQs with official answers, 4 coding questions, 1 diagram.",
                                up="../", page="pyq", body=PYQ_BODY, scripts=scripts, **v))
    with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8") as f:
        f.write(PAGE.format(title="Home", desc="End-term revision for High Performance C++: notes, MCQs, MSQs, written and coding practice.",
                            up="", page="index", body=INDEX_BODY, scripts=f'<script src="data/site.js?v={v["v_site"]}"></script>', **v))
    q = sum(len(l["mcqs"]) + len(l["msqs"]) + len(l["short"]) for l in lectures)
    print(f"built {len(lectures)} sessions: {sum(len(l['mcqs']) for l in lectures)} MCQs, {sum(len(l['msqs']) for l in lectures)} MSQs, "
          f"{sum(len(l['short']) for l in lectures)} written ({q} total); coding: {len(coding['problems']) if coding else 0} problems, "
          f"{len(coding['leetcode']) if coding else 0} LeetCode, {len(coding['otherPlatforms']) if coding else 0} other; problems: {len(problems)}")


if __name__ == "__main__":
    main()
