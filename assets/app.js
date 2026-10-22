/* Network Architecture revision site: renders index, lecture and quiz pages from window.SITE / window.PAGE. */
(function () {
  "use strict";

  const KEY = "hpc-practice:answers";      // every answer, keyed by question id
  const THEME_KEY = "hpc-practice:theme";
  const LETTERS = ["A", "B", "C", "D", "E", "F"];

  // ---------- storage: survives closing the tab/browser; warns when the browser blocks it ----------
  function rawStore() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function loadAll() { try { return JSON.parse(rawStore()) || {}; } catch (e) { return {}; } }
  function saveAll(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); seen = rawStore(); return true; }
    catch (e) { showStorageWarning(); return false; }
  }
  let seen = rawStore();
  function storageWorks() {
    try { localStorage.setItem(KEY + ":t", "1"); const ok = localStorage.getItem(KEY + ":t") === "1"; localStorage.removeItem(KEY + ":t"); return ok; }
    catch (e) { return false; }
  }
  function showStorageWarning() {
    if (document.getElementById("storage-warning")) return;
    const main = document.querySelector("main"); if (!main) return;
    const w = el("div", { id: "storage-warning", class: "feedback bad", role: "alert" },
      "<span class=\"verdict\">Progress can't be saved in this browser window</span><p>This browser is blocking site storage " +
      "(for example a Private/Incognito window). Everything works, but answers are lost when the page closes. Use a normal window to keep progress.</p>");
    main.insertBefore(w, main.firstChild);
  }

  // ---------- helpers ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  // Escaped text with `code`, **bold** and *italic*. Text inside backticks is never formatted.
  function inline(s) {
    const codes = [];
    const text = esc(String(s || "").replace(/`([^`]+)`/g, (m, c) => "\u0000" + (codes.push(c) - 1) + "\u0000"))
      .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1<em>$2</em>");
    return text.replace(/\u0000(\d+)\u0000/g, (m, i) => "<code>" + esc(codes[+i]) + "</code>");
  }
  function el(tag, attrs, html) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) { if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    if (html != null) n.innerHTML = html;
    return n;
  }
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  // Markdown-lite for the notes: paragraphs, - / 1. lists, ### sub-headings, ``` code, | tables |, **bold**, `code`.
  function md(src) {
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    const out = []; let i = 0;
    const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    const cells = l => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        const buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        i++; out.push("<pre>" + esc(buf.join("\n")) + "</pre>"); continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      if (/^###\s+/.test(line)) { out.push("<h4>" + inline(line.replace(/^###\s+/, "")) + "</h4>"); i++; continue; }
      if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line); i += 2; const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push('<div class="table-wrap"><table><thead><tr>' + head.map(h => "<th>" + inline(h) + "</th>").join("") +
          "</tr></thead><tbody>" + rows.map(r => "<tr>" + r.map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>").join("") +
          "</tbody></table></div>");
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
        out.push("<ul>" + items.map(t => "<li>" + inline(t) + "</li>").join("") + "</ul>"); continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
        out.push("<ol>" + items.map(t => "<li>" + inline(t) + "</li>").join("") + "</ol>"); continue;
      }
      const para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*```/.test(lines[i]) && !/^###\s+/.test(lines[i]) &&
             !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^\s*\|/.test(lines[i])) para.push(lines[i++]);
      if (para.length) out.push("<p>" + inline(para.join(" ")) + "</p>"); else i++;
    }
    return out.join("\n").replace(/<strong>Beyond the lecture:<\/strong>/g, '<span class="beyond">Beyond the lecture</span>');
  }

  // ---------- theme ----------
  function initTheme() {
    const btn = document.querySelector(".theme-toggle");
    let saved = null; try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    if (!btn) return;
    const cur = () => document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const label = () => { btn.textContent = cur() === "dark" ? "☀ Light" : "☾ Dark"; };
    label();
    btn.addEventListener("click", () => {
      const next = cur() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      label();
    });
  }

  // ---------- progress ----------
  function stats(ids, all) {
    let answered = 0, correct = 0;
    ids.forEach(id => { const a = all[id]; if (a && a.done) { answered++; if (a.correct) correct++; } });
    return { answered, correct, total: ids.length };
  }

  // ---------- question renderers ----------
  // Question text: full Markdown when it contains a code block, inline formatting otherwise.
  function qhead(box, tag, text) {
    if (/```/.test(text)) {
      box.appendChild(el("h3", null, tag));
      box.appendChild(el("div", { class: "qtext" }, md(text)));
    } else box.appendChild(el("h3", null, `${tag}${inline(text)}`));
  }

  function renderMcq(q, all, onChange, extraTag) {
    const box = el("section", { class: "q", id: q.id });
    const tag = extraTag ? `<span class="tag">${extraTag}</span>` : "";
    qhead(box, tag, q.q);
    const opts = el("div", { class: "options", role: "group" });
    const fb = el("div", { "aria-live": "polite" });
    const retry = el("button", { class: "btn", type: "button", style: "margin-top:10px" }, "Try again");
    retry.hidden = true;
    const buttons = q.options.map((text, i) => {
      const b = el("button", { class: "option", type: "button" }, `<span class="letter">${LETTERS[i]}</span><span>${inline(text)}</span>`);
      b.addEventListener("click", () => choose(i, false));
      opts.appendChild(b); return b;
    });
    function choose(i, restoring) {
      const right = i === q.answer;
      buttons.forEach((b, j) => {
        b.disabled = true;
        b.classList.add(j === q.answer ? "correct" : (j === i ? "wrong" : "dim"));
      });
      fb.className = "feedback " + (right ? "ok" : "bad");
      fb.innerHTML = `<span class="verdict">${right ? "✓ Correct" : "✗ Wrong. Correct answer: " + LETTERS[q.answer] + ". " + inline(q.options[q.answer])}</span>` +
        (q.explanation ? `<p>${inline(q.explanation)}</p>` : "") +
        (q.distractors ? `<p class="note">${inline(q.distractors)}</p>` : "") +
        (q.keyNote ? `<p class="note"><b>Note on the official answer:</b> ${inline(q.keyNote)}</p>` : "") +
        (q.ref ? `<p class="note">Revise: ${q.ref}</p>` : "");
      retry.hidden = false;
      if (!restoring) { all[q.id] = { done: true, choice: i, correct: right }; saveAll(all); onChange(); }
    }
    retry.addEventListener("click", () => {
      delete all[q.id]; saveAll(all); onChange();
      buttons.forEach(b => { b.disabled = false; b.className = "option"; });
      fb.className = ""; fb.innerHTML = ""; retry.hidden = true; buttons[0].focus();
    });
    box.appendChild(opts); box.appendChild(fb); box.appendChild(retry);
    const s = all[q.id];
    if (s && s.done && typeof s.choice === "number") choose(s.choice, true);
    return box;
  }

  // Multiple-select question: right only when the chosen set equals the correct set exactly.
  function renderMsq(q, all, onChange, extraTag) {
    const box = el("section", { class: "q msq", id: q.id });
    const tag = extraTag ? `<span class="tag">${extraTag}</span>` : "";
    qhead(box, tag, q.q);
    box.appendChild(el("p", { class: "note msq-hint" }, "Select <b>all</b> correct options, then press Submit."));
    const opts = el("div", { class: "options", role: "group" });
    const fb = el("div", { "aria-live": "polite" });
    const actions = el("div", { class: "lab-actions" });
    const submit = el("button", { class: "btn primary", type: "button" }, "Submit");
    const retry = el("button", { class: "btn", type: "button" }, "Try again");
    retry.hidden = true; actions.append(submit, retry);
    const picked = new Set();
    const correctSet = new Set(q.answers);
    const buttons = q.options.map((text, i) => {
      const b = el("button", { class: "option", type: "button", "aria-pressed": "false" },
        `<span class="letter box">${LETTERS[i]}</span><span>${inline(text)}</span>`);
      b.addEventListener("click", () => {
        if (picked.has(i)) picked.delete(i); else picked.add(i);
        b.classList.toggle("selected", picked.has(i)); b.setAttribute("aria-pressed", String(picked.has(i)));
      });
      opts.appendChild(b); return b;
    });
    function finish(sel, restoring) {
      const chosen = new Set(sel);
      const right = chosen.size === correctSet.size && [...chosen].every(i => correctSet.has(i));
      buttons.forEach((b, j) => {
        b.disabled = true; b.classList.remove("selected");
        if (correctSet.has(j) && chosen.has(j)) b.classList.add("correct");
        else if (correctSet.has(j)) { b.classList.add("missed"); }
        else if (chosen.has(j)) b.classList.add("wrong");
        else b.classList.add("dim");
      });
      const letters = q.answers.map(i => LETTERS[i]).join(", ");
      fb.className = "feedback " + (right ? "ok" : "bad");
      fb.innerHTML = `<span class="verdict">${right ? "✓ Correct: you picked exactly the right options" : "✗ Not quite. Correct options: " + letters}</span>` +
        (right ? "" : `<p class="note">Green = correct pick · red = wrong pick · outlined = correct but you missed it.</p>`) +
        (q.explanation ? `<p>${inline(q.explanation)}</p>` : "");
      submit.hidden = true; retry.hidden = false;
      if (!restoring) { all[q.id] = { done: true, sel: [...chosen], correct: right }; saveAll(all); onChange(); }
    }
    submit.addEventListener("click", () => {
      if (!picked.size) { fb.className = "feedback bad"; fb.innerHTML = '<span class="verdict">Pick at least one option first.</span>'; return; }
      finish([...picked], false);
    });
    retry.addEventListener("click", () => {
      delete all[q.id]; saveAll(all); onChange(); picked.clear();
      buttons.forEach(b => { b.disabled = false; b.className = "option"; b.setAttribute("aria-pressed", "false"); });
      fb.className = ""; fb.innerHTML = ""; submit.hidden = false; retry.hidden = true;
    });
    box.append(opts, actions, fb);
    const s = all[q.id];
    if (s && s.done && Array.isArray(s.sel)) finish(s.sel, true);
    return box;
  }

  function renderShort(q, all, onChange) {
    const box = el("section", { class: "q lab", id: q.id });
    box.appendChild(el("h3", null, inline(q.q)));
    const ta = el("textarea", { "aria-label": "Your answer", spellcheck: "true", placeholder: "Write your answer here…" });
    const s = all[q.id];
    if (s && s.text) ta.value = s.text;
    box.appendChild(ta);
    const actions = el("div", { class: "lab-actions" });
    const check = el("button", { class: "btn primary", type: "button" }, "Check answer");
    const show = el("button", { class: "btn", type: "button" }, "Show model answer");
    const clear = el("button", { class: "btn", type: "button" }, "Clear");
    actions.append(check, show, clear); box.appendChild(actions);
    const fb = el("div", { "aria-live": "polite" }); box.appendChild(fb);
    ta.addEventListener("input", () => { all[q.id] = Object.assign({}, all[q.id], { text: ta.value }); saveAll(all); });
    function grade(restoring) {
      const text = ta.value;
      if (!text.trim()) { fb.className = "feedback bad"; fb.innerHTML = '<span class="verdict">✗ Nothing to check yet</span><p>Write your answer, then press <b>Check answer</b>.</p>'; return; }
      const res = (q.checks || []).map(c => ({ label: c.label, hit: c.patterns.some(p => { try { return new RegExp(p, "i").test(text); } catch (e) { return false; } }) }));
      const passed = res.length > 0 && res.every(r => r.hit);
      fb.className = "feedback " + (passed ? "ok" : "bad");
      fb.innerHTML = `<span class="verdict">${passed ? "✓ Right: every key point is covered" : `✗ Not complete yet: ${res.filter(r => r.hit).length}/${res.length} key points covered`}</span>` +
        `<ul class="checks">${res.map(r => `<li class="${r.hit ? "hit" : "miss"}"><span class="mark">${r.hit ? "✓" : "✗"}</span><span>${inline(r.label)}</span></li>`).join("")}</ul>` +
        (q.explanation ? `<p>${inline(q.explanation)}</p>` : "") +
        `<details class="model"${passed ? "" : " open"}><summary>Model answer</summary><pre>${esc(q.modelAnswer)}</pre></details>` +
        `<p class="note">The check looks for the key points an examiner expects; read the model answer to compare wording.</p>`;
      if (!restoring) { all[q.id] = { done: true, correct: passed, text }; saveAll(all); onChange(); }
    }
    check.addEventListener("click", () => grade(false));
    show.addEventListener("click", () => {
      fb.className = "feedback"; fb.innerHTML = `<details class="model" open><summary>Model answer</summary><pre>${esc(q.modelAnswer)}</pre></details>` +
        (q.explanation ? `<p>${inline(q.explanation)}</p>` : "");
    });
    clear.addEventListener("click", () => { ta.value = ""; fb.className = ""; fb.innerHTML = ""; delete all[q.id]; saveAll(all); onChange(); });
    if (s && s.text && s.done) grade(true);
    return box;
  }

  // ---------- index ----------
  function renderIndex() {
    const SITE = window.SITE, all = loadAll();
    const grid = document.getElementById("grid"); grid.innerHTML = "";
    let A = 0, C = 0, T = 0;
    SITE.lectures.forEach(l => {
      const st = stats(l.ids, all); A += st.answered; C += st.correct; T += st.total;
      const done = st.answered === st.total;
      grid.appendChild(el("a", { class: "card" + (done ? " done" : ""), href: "lectures/" + l.file },
        `<div class="num">Session ${l.num}${done ? ' <span class="badge">✓ Completed</span>' : ""}</div>
         <div class="title">${esc(l.title)}</div>
         ${l.subtitle ? `<div class="meta">${esc(l.subtitle)}</div>` : ""}
         <div class="meta">${l.counts.mcq} MCQs · ${l.counts.msq || 0} MSQs · ${l.counts.short} written${st.answered ? ` · <b>${st.correct}/${st.answered}</b> right` : ""}</div>
         <div class="bar" aria-hidden="true"><i style="width:${Math.round(st.answered / st.total * 100)}%"></i></div>`));
    });
    const qgrid = document.getElementById("quiz-grid"); qgrid.innerHTML = "";
    if (SITE.pyq) {
      const st = stats(SITE.pyq.ids, all);
      qgrid.appendChild(el("a", { class: "card" + (st.answered === st.total ? " done" : ""), href: SITE.pyq.file },
        `<div class="num">Previous year paper</div><div class="title">End Term 2027 (PYQ)</div>
         <div class="meta">${SITE.pyq.ids.length} MCQs/MSQs with official answers · 4 coding · 1 diagram${st.answered ? ` · <b>${st.correct}/${st.answered}</b> right` : ""}</div>
         <div class="bar" aria-hidden="true"><i style="width:${Math.round(st.answered / SITE.pyq.ids.length * 100)}%"></i></div>`));
    }
    if (SITE.coding) {
      const st = stats(SITE.coding.ids, all);
      qgrid.appendChild(el("a", { class: "card" + (st.answered && st.correct === st.total ? " done" : ""), href: SITE.coding.file },
        `<div class="num">Coding practice</div><div class="title">C++ problems + LeetCode</div>
         <div class="meta">${SITE.coding.ids.length} exam-style problems with hints and tested solutions · ${SITE.coding.leetcode} LeetCode + ${SITE.coding.other} GfG/HackerRank/Codeforces links${st.answered ? ` · <b>${st.correct}/${st.answered}</b> complete` : ""}</div>
         <div class="bar" aria-hidden="true"><i style="width:${Math.round(st.correct / SITE.coding.ids.length * 100)}%"></i></div>`));
    }
    SITE.quizzes.forEach(z => {
      const st = stats(z.ids, all);
      qgrid.appendChild(el("a", { class: "card" + (st.answered === st.total ? " done" : ""), href: "quizzes/" + z.file },
        `<div class="num">Class quiz</div><div class="title">${esc(z.title)}</div>
         <div class="meta">${z.ids.length} questions, original order${st.answered ? ` · <b>${st.correct}/${st.answered}</b> right` : ""}</div>
         <div class="bar" aria-hidden="true"><i style="width:${Math.round(st.answered / z.ids.length * 100)}%"></i></div>`));
    });
    document.getElementById("summary").innerHTML =
      `<div class="stat"><b>${A}/${T}</b><span>questions done</span></div>
       <div class="stat"><b>${A ? Math.round(C / A * 100) : 0}%</b><span>accuracy</span></div>
       <div class="stat"><b>${SITE.examDate}</b><span>end-term exam</span></div>`;
  }
  function initIndex() {
    renderIndex();
    window.addEventListener("pageshow", e => { if (e.persisted) renderIndex(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) renderIndex(); });
    window.addEventListener("storage", e => { if (!e.key || e.key === KEY) renderIndex(); });
    const reset = document.getElementById("reset-all");
    if (reset) reset.addEventListener("click", () => {
      if (!confirm("Clear all saved answers in this browser?")) return;
      try { localStorage.removeItem(KEY); } catch (e) {}
      renderIndex();
    });
  }

  // ---------- lecture page ----------
  function drawLecture() {
    const P = window.PAGE, all = loadAll();
    const msqs = P.msqs || [];
    const ids = P.quiz.map(q => q.id).concat(P.mcqs.map(q => q.id), msqs.map(q => q.id), P.short.map(q => q.id));
    const score = () => {
      const st = stats(ids, loadAll());
      document.getElementById("score").innerHTML = `<span class="pill">${st.answered}/${st.total} done · ${st.correct} right</span>`;
    };
    const onChange = () => score();
    const quizBox = document.getElementById("quiz");
    if (quizBox) { quizBox.innerHTML = ""; P.quiz.forEach(q => quizBox.appendChild(renderMcq(q, all, onChange, `Quiz ${q.quiz} · Q${q.qn}`))); }
    const mBox = document.getElementById("mcqs"); mBox.innerHTML = "";
    P.mcqs.forEach((q, i) => mBox.appendChild(renderMcq(q, all, onChange, `MCQ ${i + 1}`)));
    const xBox = document.getElementById("msqs");
    if (xBox) { xBox.innerHTML = ""; msqs.forEach((q, i) => xBox.appendChild(renderMsq(q, all, onChange, `MSQ ${i + 1}`))); }
    const sBox = document.getElementById("short"); sBox.innerHTML = "";
    P.short.forEach(q => sBox.appendChild(renderShort(q, all, onChange)));
    score();
  }
  function renderLecture() {
    const P = window.PAGE;
    document.getElementById("l-num").textContent = "Session " + P.num;
    document.getElementById("l-title").textContent = P.title;
    document.getElementById("l-sub").innerHTML = (P.subtitle ? `<b>${esc(P.subtitle)}</b> · ` : "") + inline(P.summary);
    const toc = document.getElementById("toc"), notes = document.getElementById("notes");
    toc.innerHTML = "<b>Notes:</b> " + P.notes.map(n => `<a href="#n-${slugify(n.heading)}">${esc(n.heading)}</a>`).join(" · ");
    notes.innerHTML = P.notes.map(n => `<section class="note-sec" id="n-${slugify(n.heading)}"><h3>${inline(n.heading)}</h3>${md(n.body)}</section>`).join("");
    document.getElementById("terms").innerHTML = '<dl class="terms">' +
      P.keyTerms.map(t => `<div><dt>${inline(t.term)}</dt><dd>${inline(t.def)}</dd></div>`).join("") + "</dl>";
    const cl = document.getElementById("coding-links");
    if (cl) cl.innerHTML = (P.coding && P.coding.length)
      ? "<b>Coding practice for this session:</b> " + P.coding.map(c => `<a href="../coding/index.html#C-${c.id}">${esc(c.title)}</a>`).join(" · ")
      : "";
    if (cl && !cl.innerHTML) cl.hidden = true;
    drawLecture();
    watch(drawLecture);
    document.getElementById("reset").addEventListener("click", () => {
      if (!confirm("Clear your answers for this lecture?")) return;
      const all = loadAll();
      P.quiz.concat(P.mcqs, P.msqs || [], P.short).forEach(q => delete all[q.id]);
      saveAll(all); drawLecture();
    });
    pager(P);
  }

  // ---------- quiz page (original quiz order) ----------
  function drawQuiz() {
    const P = window.PAGE, all = loadAll();
    const ids = P.questions.map(q => q.id);
    const score = () => { const st = stats(ids, loadAll()); document.getElementById("score").innerHTML = `<span class="pill">${st.answered}/${st.total} done · ${st.correct} right</span>`; };
    const box = document.getElementById("questions"); box.innerHTML = "";
    P.questions.forEach(q => box.appendChild(renderMcq(q, all, score, `Q${q.qn} · Lecture ${q.lecture}`)));
    score();
  }
  function renderQuiz() {
    const P = window.PAGE;
    document.getElementById("l-title").textContent = P.title;
    drawQuiz();
    watch(drawQuiz);
    document.getElementById("reset").addEventListener("click", () => {
      if (!confirm("Clear your answers for this quiz?")) return;
      const all = loadAll(); P.questions.forEach(q => delete all[q.id]); saveAll(all); drawQuiz();
    });
  }

  // ---------- coding practice ----------
  function renderProblem(p, all, onChange) {
    const id = "C-" + p.id;
    const box = el("section", { class: "q lab problem", id: id });
    const meta = [p.origin === "course" ? "Course problem" : "Practice", p.difficulty]
      .concat(p.sessions && p.sessions.length ? ["Sessions " + p.sessions.join(", ")] : []).join(" · ");
    box.appendChild(el("h3", null, `<span class="tag">${esc(meta)}</span>${esc(p.title)}`));
    if (p.topics && p.topics.length) box.appendChild(el("p", { class: "note" }, p.topics.map(t => `<code>${esc(t)}</code>`).join(" ")));
    box.appendChild(el("div", { class: "statement" }, md(p.statement)));
    if (p.signature) {
      box.appendChild(el("h4", null, "Starter code (fill in the TODOs below)"));
      box.appendChild(el("pre", null, esc(p.signature)));
    }
    const hintBox = el("div", { class: "hints" });
    let shown = 0;
    const hintBtn = el("button", { class: "btn", type: "button" }, `Show hint (0/${(p.hints || []).length})`);
    hintBtn.addEventListener("click", () => {
      if (shown >= p.hints.length) return;
      hintBox.appendChild(el("p", { class: "hint" }, `<b>Hint ${shown + 1}:</b> ${inline(p.hints[shown])}`));
      shown++; hintBtn.textContent = `Show hint (${shown}/${p.hints.length})`;
      if (shown >= p.hints.length) hintBtn.disabled = true;
    });
    const ta = el("textarea", { class: "code", "aria-label": "Your solution for " + p.title, spellcheck: "false",
      placeholder: "Write your C++ solution here…" });
    const s = all[id];
    ta.value = s && s.text ? s.text : (p.signature || "");
    const actions = el("div", { class: "lab-actions" });
    const check = el("button", { class: "btn primary", type: "button" }, "Check my code");
    const sol = el("button", { class: "btn", type: "button" }, "Show solution");
    const reset = el("button", { class: "btn", type: "button" }, "Reset to skeleton");
    actions.append(check, hintBtn, sol, reset);
    box.append(ta, actions, hintBox);
    const fb = el("div", { "aria-live": "polite" }); box.appendChild(fb);
    ta.addEventListener("input", () => { all[id] = Object.assign({}, all[id], { text: ta.value }); saveAll(all); });
    ta.addEventListener("keydown", e => {   // Tab inserts spaces instead of leaving the editor
      if (e.key !== "Tab" || e.shiftKey) return;
      e.preventDefault(); const st = ta.selectionStart;
      ta.value = ta.value.slice(0, st) + "    " + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = st + 4;
      ta.dispatchEvent(new Event("input"));
    });
    const solutionHtml = () =>
      `<details class="model" open><summary>Solution</summary><pre>${esc(p.solution)}</pre></details>` +
      (p.explanation ? `<div class="explain">${md(p.explanation)}</div>` : "") +
      (p.tests ? `<details class="model"><summary>Tests (compile with <code>clang++ -std=c++20</code>)</summary><pre>${esc(p.tests)}</pre></details>` : "") +
      (p.followUps && p.followUps.length ? `<p class="note"><b>Follow-ups:</b></p><ul class="note">${p.followUps.map(f => `<li>${inline(f)}</li>`).join("")}</ul>` : "");
    function grade(restoring) {
      const text = ta.value;
      if (!text.trim() || text.trim() === (p.signature || "").trim()) {
        fb.className = "feedback bad";
        fb.innerHTML = '<span class="verdict">✗ Nothing to check yet</span><p>Fill in the skeleton, then press <b>Check my code</b>.</p>';
        return;
      }
      const res = (p.checks || []).map(c => ({ label: c.label, hit: c.patterns.some(q => { try { return new RegExp(q, "i").test(text); } catch (e) { return false; } }) }));
      const passed = res.length > 0 && res.every(r => r.hit);
      fb.className = "feedback " + (passed ? "ok" : "bad");
      fb.innerHTML = `<span class="verdict">${passed ? "✓ Every key idea is in your code" : `✗ ${res.filter(r => r.hit).length}/${res.length} key ideas found`}</span>` +
        `<ul class="checks">${res.map(r => `<li class="${r.hit ? "hit" : "miss"}"><span class="mark">${r.hit ? "✓" : "✗"}</span><span>${inline(r.label)}</span></li>`).join("")}</ul>` +
        `<p class="note">This checks for the key ideas, not whether it compiles: compile it with the tests below to be sure.</p>` +
        (passed ? "" : solutionHtml());
      if (!restoring) { all[id] = { done: true, correct: passed, text }; saveAll(all); onChange(); }
    }
    check.addEventListener("click", () => grade(false));
    sol.addEventListener("click", () => { fb.className = "feedback"; fb.innerHTML = solutionHtml(); });
    reset.addEventListener("click", () => { ta.value = p.signature || ""; fb.className = ""; fb.innerHTML = ""; delete all[id]; saveAll(all); onChange(); });
    if (s && s.done && s.text) grade(true);
    return box;
  }

  function drawCoding() {
    const P = window.PAGE, all = loadAll();
    const ids = P.problems.map(p => "C-" + p.id);
    const score = () => { const st = stats(ids, loadAll()); document.getElementById("score").innerHTML = `<span class="pill">${st.answered}/${st.total} attempted · ${st.correct} complete</span>`; };
    const box = document.getElementById("problems"); box.innerHTML = "";
    P.problems.forEach(p => box.appendChild(renderProblem(p, all, score)));
    score();
  }
  function renderCoding() {
    const P = window.PAGE;
    document.getElementById("toc").innerHTML = "<b>Problems:</b> " + P.problems.map(p => `<a href="#C-${p.id}">${esc(p.title)}</a>`).join(" · ");
    drawCoding();
    watch(drawCoding);
    const lc = document.getElementById("leetcode");
    const groups = {};
    P.leetcode.forEach(q => { (groups[q.topic] = groups[q.topic] || []).push(q); });
    lc.innerHTML = Object.keys(groups).map(t =>
      `<h3>${esc(t)}</h3><div class="table-wrap"><table><thead><tr><th>#</th><th>Problem</th><th>Level</th><th>Why it helps</th></tr></thead><tbody>` +
      groups[t].map(q => `<tr><td>${q.num}</td><td><a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.title)}</a>${q.premium ? ' <span class="tag">Premium</span>' : ""}</td><td>${esc(q.difficulty)}</td><td>${inline(q.why)}</td></tr>`).join("") +
      "</tbody></table></div>").join("");
    const other = document.getElementById("other");
    if (other) other.innerHTML = (P.otherPlatforms || []).length ? '<div class="table-wrap"><table><thead><tr><th>Platform</th><th>Problem</th><th>Topic</th><th>Why it helps</th></tr></thead><tbody>' +
      P.otherPlatforms.map(q => `<tr><td>${esc(q.platform)}</td><td><a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.title)}</a></td><td>${esc(q.topic || "")}</td><td>${inline(q.why)}</td></tr>`).join("") +
      "</tbody></table></div>" : '<p class="sub">Coming soon.</p>';
  }

  // ---------- previous year paper ----------
  function renderSolved(q, label) {
    const box = el("section", { class: "q lab problem", id: "P-" + q.n });
    box.appendChild(el("h3", null, `<span class="tag">${esc(label)}</span>${esc(q.title)}`));
    box.appendChild(el("div", { class: "statement" }, md(q.statement)));
    if (q.starter) box.appendChild(el("details", { class: "model" }, `<summary>Starter code / signature (as given in the paper)</summary><pre>${esc(q.starter)}</pre>`));
    if (q.solution) box.appendChild(el("details", { class: "model solution" },
      `<summary>✅ Solution (compiled and tested)</summary><pre>${esc(q.solution)}</pre><div class="explain">${md(q.explanation || "")}</div>` +
      (q.tests ? `<details class="model"><summary>Tests used</summary><pre>${esc(q.tests)}</pre></details>` : "")));
    if (q.answer) box.appendChild(el("details", { class: "model solution" }, `<summary>✅ Model answer</summary><div class="explain">${md(q.answer)}</div>`));
    if (q.ref) box.appendChild(el("p", { class: "note" }, "Revise: " + q.ref));
    return box;
  }
  function drawPyq() {
    const P = window.PAGE, all = loadAll();
    const ids = P.mcqs.map(q => q.id);
    const score = () => { const st = stats(ids, loadAll()); document.getElementById("score").innerHTML = `<span class="pill">${st.answered}/${st.total} answered · ${st.correct} right</span>`; };
    const box = document.getElementById("pyq-mcqs"); box.innerHTML = "";
    P.mcqs.forEach(q => box.appendChild(q.type === "msq" ? renderMsq(q, all, score, `Q${q.n} · select all`) : renderMcq(q, all, score, `Q${q.n}`)));
    const cbox = document.getElementById("pyq-coding"); cbox.innerHTML = "";
    P.coding.forEach(q => cbox.appendChild(renderSolved(q, `Q${q.n} · Coding`)));
    const dbox = document.getElementById("pyq-diagram"); dbox.innerHTML = "";
    dbox.appendChild(renderSolved(P.diagram, `Q${P.diagram.n} · Diagram`));
    score();
  }
  function renderPyq() {
    document.getElementById("pyq-format").textContent = window.PAGE.format;
    drawPyq(); watch(drawPyq);
    document.getElementById("reset").addEventListener("click", () => {
      if (!confirm("Clear your answers for this paper?")) return;
      const all = loadAll(); Object.keys(all).filter(k => /^PYQ-|^P-/.test(k)).forEach(k => delete all[k]); saveAll(all); drawPyq();
    });
  }

  // Redraw when answers changed elsewhere: back/forward cache, tab switch, another tab.
  function watch(draw) {
    const refresh = () => { const now = rawStore(); if (now !== seen) { seen = now; draw(); } };
    window.addEventListener("pageshow", e => { if (e.persisted) refresh(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    window.addEventListener("storage", e => { if (e.key === KEY) refresh(); });
  }

  function pager(P) {
    const box = document.getElementById("pager"); if (!box) return;
    box.innerHTML = (P.prev ? `<a class="btn" href="${P.prev.file}">← Session ${P.prev.num}</a>` : "<span></span>") +
      (P.next ? `<a class="btn primary" href="${P.next.file}">Session ${P.next.num} →</a>` : `<a class="btn" href="../coding/index.html">Coding practice →</a>`);
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    if (!storageWorks()) showStorageWarning();
    const page = document.body.dataset.page;
    if (page === "index") initIndex();
    if (page === "lecture") renderLecture();
    if (page === "quiz") renderQuiz();
    if (page === "coding") renderCoding();
    if (page === "pyq") renderPyq();
  });
})();
