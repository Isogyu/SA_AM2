/* SA 午前Ⅱ 対策アプリ */
"use strict";

const D = window.DATA;
const KANA = ["ア", "イ", "ウ", "エ"];
const EXAM_N = 25, EXAM_MIN = 40, PASS = 0.6;
const DAY = 86400000;
const INTERVALS = [0, 1, 3, 7, 16, 35]; // SRS: box → 次回までの日数
const STORE_KEY = "sa_am2_v1";

const Q = {}; D.questions.forEach(q => (Q[q.id] = q));
const EXAM = {}; D.exams.forEach((e, i) => (EXAM[e.id] = Object.assign({ idx: i }, e)));
const EXAM_IDS = D.exams.map(e => e.id);
const RECENT5 = EXAM_IDS.slice(-5);
const CAT_IDS = Object.keys(D.cats).filter(c => D.questions.some(q => q.cat === c));

// 用語の逆引き（他の用語から参照されている関係）
const REL_IN = {};
for (const [name, t] of Object.entries(D.terms)) {
  for (const [to, why] of t.rel) (REL_IN[to] = REL_IN[to] || []).push([name, why]);
}
// 用語の出題回数（その用語を参照する問題の数）
const TERM_FREQ = {};
for (const [name, t] of Object.entries(D.terms)) TERM_FREQ[name] = (t.qs || []).length;

// 分野ごとの本番の並び順（平均問題番号）と直近5回の出題数
const CAT_ORDER = {}, CAT_QUOTA = {};
CAT_IDS.forEach(c => {
  const qs = D.questions.filter(q => q.cat === c);
  CAT_ORDER[c] = qs.reduce((s, q) => s + q.n, 0) / qs.length;
  CAT_QUOTA[c] = D.questions.filter(q => q.cat === c && RECENT5.includes(q.exam)).length / RECENT5.length;
});
// 出題分析資料（code_artifact.md）があれば，模試の分野構成はその直近5回平均に合わせる
const REF = D.ref && D.ref.cats && Object.keys(D.ref.cats).length ? D.ref : null;
const QUOTA_SRC = REF ? `出題分析資料の直近5回（${REF.years.slice(0, 5).join("・")}）の平均` : "直近5回の平均";
if (REF) CAT_IDS.forEach(c => { const v = REF.cats[c]; CAT_QUOTA[c] = v ? v.slice(0, 5).reduce((a, b) => a + b, 0) / 5 : 0; });

/* ---------- storage ---------- */
function blank() { return { v: 1, q: {}, mocks: [], days: {}, bm: {}, tk: {}, examDate: "", settings: { n: 10 } }; }
let S = (() => {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.v === 1) return Object.assign(blank(), s); } catch (e) {}
  return blank();
})();
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast("保存できませんでした（ブラウザの設定を確認）"); } }
const today = () => new Date().toISOString().slice(0, 10);

function record(id, correct, choice) {
  const st = S.q[id] || (S.q[id] = { a: 0, c: 0, box: 0, due: 0, h: [] });
  st.a++; if (correct) st.c++;
  st.h.push(correct ? 1 : 0); if (st.h.length > 10) st.h.shift();
  st.last = Date.now(); st.lc = choice;
  st.box = correct ? Math.min(st.box + 1, INTERVALS.length - 1) : 1;
  st.due = Date.now() + (correct ? INTERVALS[st.box] * DAY : 0);
  const d = today(); S.days[d] = S.days[d] || { a: 0, c: 0 }; S.days[d].a++; if (correct) S.days[d].c++;
  save();
}
const stat = id => S.q[id];
const lastWrong = id => { const s = stat(id); return s && s.h.length && s.h[s.h.length - 1] === 0; };
const mastered = id => { const s = stat(id); return s && s.h.length >= 2 && s.h.slice(-2).every(x => x) ; };

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const src = q => `${EXAM[q.exam].label} 問${q.n}`;
const srcShort = q => `${EXAM[q.exam].short}-${q.n}`;
function rich(s) {
  return String(s)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, t, l) => `<a class="t" data-t="${esc(t)}">${esc(l || t)}</a>`)
    .replace(/\n/g, "<br>")
    .replace(/(<br>)+(<table)/g, "$2").replace(/(<\/table>)(<br>)+/g, "$1");
}
function toast(msg) {
  const el = document.createElement("div"); el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 1800);
}
function weighted(items, w) {
  const tot = items.reduce((s, x) => s + w(x), 0); let r = Math.random() * tot;
  for (const x of items) { r -= w(x); if (r <= 0) return x; } return items[items.length - 1];
}
// 出題価値：再出題された問題ほど，また新しい年度ほど重要
const importance = q => 1 + (q.rep ? q.rep.length * 1.2 : 0) + EXAM[q.exam].idx / EXAM_IDS.length;
function accOf(ids) { let a = 0, c = 0; ids.forEach(id => { const s = stat(id); if (s) { a += s.a; c += s.c; } }); return { a, c }; }
function catAcc(c) { return accOf(D.questions.filter(q => q.cat === c).map(q => q.id)); }
// 合格予測：各問題の正答確率を推定し，本番の分野構成で加重
function predict() {
  const answered = D.questions.filter(q => stat(q.id));
  if (answered.length < 15) return null;
  let tot = 0;
  CAT_IDS.forEach(c => {
    const qs = D.questions.filter(q => q.cat === c);
    const ps = qs.map(q => { const s = stat(q.id); if (!s) return null; const h = s.h.slice(-3); return (h.reduce((x, y) => x + y, 0) + 0.5) / (h.length + 1); });
    const known = ps.filter(p => p !== null);
    const avg = known.length ? known.reduce((x, y) => x + y, 0) / known.length : 0.4;
    // 未回答の問題は分野平均より少し低めに見積もる
    const p = qs.reduce((s, q, i) => s + (ps[i] === null ? avg * 0.85 : ps[i]), 0) / qs.length;
    tot += p * CAT_QUOTA[c];
  });
  const quota = CAT_IDS.reduce((s, c) => s + CAT_QUOTA[c], 0);
  return tot / quota;
}

/* ---------- router ---------- */
let current = null; // {tab, render, back}
const stack = [];
function setTab(tab) { document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab)); }
function show(viewFn, opts = {}) {
  if (opts.push && current) stack.push(current);
  if (!opts.push) stack.length = 0;
  current = { fn: viewFn, tab: opts.tab || (current && current.tab) };
  $("#back").hidden = !stack.length;
  $("#hdr-right").textContent = ""; $("#hdr-right").className = "";
  document.body.classList.remove("exam");
  stopTimer();
  setTab(current.tab);
  viewFn($("#view"));
  window.scrollTo(0, 0);
}
function goBack() { if (!stack.length) return; current = stack.pop(); $("#back").hidden = !stack.length; stopTimer(); document.body.classList.remove("exam"); $("#hdr-right").textContent = ""; setTab(current.tab); current.fn($("#view")); window.scrollTo(0, 0); }
$("#back").onclick = () => {
  if (document.body.classList.contains("exam") && !confirm("模擬試験を中断しますか？（結果は保存されません）")) return;
  goBack();
};
document.querySelectorAll("#tabs button").forEach(b => (b.onclick = () => show(TABS[b.dataset.tab], { tab: b.dataset.tab })));
const setTitle = t => ($("#title").textContent = t);

/* ---------- term sheet ---------- */
const sheetHist = [];
function openTerm(name, push = true) {
  const t = D.terms[name];
  if (!t) { toast(`「${name}」は用語集に未登録です`); return; }
  if (push) sheetHist.push(name);
  $("#sheet").hidden = false; document.body.style.overflow = "hidden";
  $("#sheet-title").textContent = name;
  $("#sheet-back").style.visibility = sheetHist.length > 1 ? "visible" : "hidden";
  const outs = t.rel.filter(r => D.terms[r[0]]);
  const ins = (REL_IN[name] || []).filter(r => !outs.some(o => o[0] === r[0]));
  const qs = (t.qs || []).map(id => Q[id]).sort((a, b) => EXAM[b.exam].idx - EXAM[a.exam].idx);
  const el = $("#sheet-content");
  el.innerHTML = `
    <p class="row"><span class="pill">${esc(D.cats[t.cat])}</span>${qs.length ? `<span class="pill rep">過去問 ${qs.length} 問で登場</span>` : ""}</p>
    <div class="def">${rich(esc(t.def))}</div>
    ${outs.length + ins.length ? `<h3>つながりマップ</h3>${mapSvg(name, outs, ins)}
    <h3>関連用語とのつながり</h3>
    <ul class="list rel">${outs.map(([n, w]) => `<li><div class="main"><a class="tlink" data-t="${esc(n)}">${esc(n)}</a><div class="small muted">→ ${esc(w)}</div></div></li>`).join("")}
    ${ins.map(([n, w]) => `<li><div class="main"><a class="tlink" data-t="${esc(n)}">${esc(n)}</a><div class="small muted">← ${esc(n)}から見て：${esc(w)}</div></div></li>`).join("")}</ul>` : ""}
    ${qs.length ? `<h3>この用語が出た過去問</h3>
    <button class="btn pri center" id="term-practice">この用語の問題を ${qs.length} 問解く</button>
    <ul class="list">${qs.map(q => `<li data-q="${q.id}"><div class="main"><div class="small muted">${esc(src(q))}${q.rep ? ' <span class="pill rep">再出題</span>' : ""}</div><div class="desc">${esc(strip(q.q))}</div></div>${resultIcon(q.id)}</li>`).join("")}</ul>` : ""}
  `;
  el.querySelectorAll("[data-t]").forEach(a => (a.onclick = () => openTerm(a.dataset.t)));
  el.querySelectorAll("li[data-q]").forEach(li => (li.onclick = () => { closeSheet(); startDrill([li.dataset.q], `用語：${name}`); }));
  const bp = $("#term-practice"); if (bp) bp.onclick = () => { closeSheet(); startDrill(shuffle(qs.map(q => q.id)), `用語：${name}`); };
  $(".sheet-body").scrollTop = 0;
}
function closeSheet() { $("#sheet").hidden = true; sheetHist.length = 0; document.body.style.overflow = ""; }
$("#sheet-close").onclick = closeSheet; $(".sheet-bg").onclick = closeSheet;
$("#sheet-back").onclick = () => { sheetHist.pop(); openTerm(sheetHist[sheetHist.length - 1], false); };
document.addEventListener("click", e => { const a = e.target.closest("a.t"); if (a) { e.preventDefault(); openTerm(a.dataset.t); } });
const strip = s => String(s).replace(/<[^>]+>/g, "").replace(/\n/g, " ");
const resultIcon = id => { const s = stat(id); if (!s) return '<span class="pill">未</span>'; return mastered(id) ? '<span class="pill ok">◎</span>' : lastWrong(id) ? '<span class="pill ng">✕</span>' : '<span class="pill ok">○</span>'; };

function mapSvg(name, outs, ins) {
  const nodes = [...outs.map(r => r[0]), ...ins.map(r => r[0])].slice(0, 12);
  const W = 340, H = nodes.length > 6 ? 300 : 240, cx = W / 2, cy = H / 2, R = Math.min(cx, cy) - 28;
  const box = (x, y, label, cls) => {
    const w = Math.min(Math.max(label.length * 11 + 12, 40), 120), lbl = label.length > 10 ? label.slice(0, 10) + "…" : label;
    return `<g class="node ${cls}" data-t="${esc(label)}"><rect x="${x - w / 2}" y="${y - 12}" width="${w}" height="24" rx="12"/><text x="${x}" y="${y + 4}" text-anchor="middle">${esc(lbl)}</text></g>`;
  };
  let lines = "", g = "";
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2, x = cx + (cx - 62) * Math.cos(a), y = cy + R * Math.sin(a);
    lines += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`; g += box(x, y, n, "");
  });
  return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)}の関連用語">${lines}${g}${box(cx, cy, name, "center")}</svg>`;
}

/* ---------- lightbox ---------- */
document.addEventListener("click", e => { const im = e.target.closest("img.qimg"); if (im) { $("#lightbox img").src = im.src; $("#lightbox").hidden = false; } });
$("#lightbox").onclick = () => ($("#lightbox").hidden = true);

/* ---------- question rendering ---------- */
function qBody(q) {
  return `<div class="qtext">${rich(q.q)}</div>${(q.img || []).map(s => `<img class="qimg" src="${s}" alt="問題の図" loading="lazy">`).join("")}`;
}
function choiceHtml(q, i, cls = "", showCx = false) {
  const label = q.chImg ? "" : rich(q.ch[i]);
  return `<button class="choice ${cls}" data-i="${i}"><span class="k">${KANA[i]}</span><span>${label}${showCx && q.cx[i] ? `<span class="cx">${rich(q.cx[i])}</span>` : ""}</span></button>`;
}
function explainHtml(q, picked) {
  const ok = picked === q.ans;
  const reps = (q.rep || []).map(id => Q[id]).sort((a, b) => EXAM[a.exam].idx - EXAM[b.exam].idx);
  return `
    <div class="verdict ${ok ? "ok" : "ng"}">${picked === -2 ? "スキップ" : ok ? "◯ 正解" : "✕ 不正解"}　<span class="small muted">正解は ${KANA[q.ans]}</span></div>
    <div class="choices ${q.chImg ? "img" : ""}">${q.ch.map((_, i) => choiceHtml(q, i, i === q.ans ? "ok" : i === picked ? "ng" : "", true)).join("")}</div>
    ${q.point ? `<div class="point">${rich(esc(q.point))}</div>` : ""}
    <div class="card exp"><b>解説</b><div>${rich(q.exp)}</div>
    ${q.terms.length ? `<div class="tchips">${q.terms.map(t => (D.terms[t] ? `<a class="tchip t" data-t="${esc(t)}">${esc(t)}</a>` : "")).join("")}</div>` : ""}
    </div>
    <p class="small muted">出典：IPA ${esc(src(q))}／${esc(D.cats[q.cat])}・${esc(q.sub)}${q.syl ? `／シラバス ${q.syl} ${esc(D.syl[q.syl])}に関すること` : ""}</p>
    ${reps.length ? `<p class="small"><span class="pill rep">再出題</span>同じ問題が ${reps.map(r => esc(EXAM[r.exam].short + "-" + r.n)).join("，")} にも出題されています。</p>` : ""}
  `;
}

/* ---------- drill (一問一答) ---------- */
function startDrill(ids, label) {
  if (!ids.length) { toast("対象の問題がありません"); return; }
  const st = { ids, i: 0, res: [], label };
  show(el => drillView(el, st), { push: true });
}
function drillView(el, st) {
  if (st.i >= st.ids.length) return drillResult(el, st);
  const q = Q[st.ids[st.i]], answered = st.res[st.i] !== undefined;
  setTitle(st.label);
  $("#hdr-right").textContent = `${st.i + 1}/${st.ids.length}`;
  el.innerHTML = `
    <div class="card">
      <div class="qhead"><span>${esc(src(q))}</span><span>${q.rep ? '<span class="pill rep">再出題</span>' : ""}${bmBtn(q.id)}</span></div>
      ${qBody(q)}
      <div id="ans">${answered ? explainHtml(q, st.res[st.i]) : `<div class="choices ${q.chImg ? "img" : ""}">${q.ch.map((_, i) => choiceHtml(q, i)).join("")}</div>`}</div>
    </div>
    <div class="navbar">${answered ? `<button class="btn pri center" id="next">${st.i + 1 < st.ids.length ? "次の問題へ" : "結果を見る"}</button>` : `<button class="btn center" id="skip">わからない（解説を見る）</button>`}</div>`;
  el.querySelectorAll("#ans .choice").forEach(b => (b.onclick = () => { if (answered) return; const i = +b.dataset.i; st.res[st.i] = i; record(q.id, i === q.ans, i); drillView(el, st); }));
  bindBm(el);
  const nx = $("#next"); if (nx) nx.onclick = () => { st.i++; drillView(el, st); };
  const sk = $("#skip"); if (sk) sk.onclick = () => { st.res[st.i] = -2; record(q.id, false, -1); drillView(el, st); };
  if (answered) window.scrollTo({ top: $("#ans").offsetTop - 70, behavior: "smooth" });
}
function drillResult(el, st) {
  const ok = st.res.filter((r, i) => r === Q[st.ids[i]].ans).length;
  $("#hdr-right").textContent = "";
  el.innerHTML = `
    <div class="card" style="text-align:center"><div class="muted">${esc(st.label)}</div><div style="font-size:40px;font-weight:700">${ok} / ${st.ids.length}</div><div>正答率 ${pct(ok, st.ids.length)}%</div></div>
    <ul class="list card">${st.ids.map((id, i) => `<li data-i="${i}"><div class="main"><div class="small muted">${esc(src(Q[id]))}</div><div class="desc">${esc(strip(Q[id].q))}</div></div>${st.res[i] === Q[id].ans ? '<span class="pill ok">○</span>' : '<span class="pill ng">✕</span>'}</li>`).join("")}</ul>
    <button class="btn pri center" id="retry-wrong" ${ok === st.ids.length ? "disabled" : ""}>間違えた ${st.ids.length - ok} 問をもう一度</button>
    <button class="btn center" id="done">演習メニューへ</button>`;
  el.querySelectorAll("li[data-i]").forEach(li => (li.onclick = () => { st.i = +li.dataset.i; st.review = true; drillView(el, st); }));
  $("#retry-wrong").onclick = () => startDrill(st.ids.filter((id, i) => st.res[i] !== Q[id].ans), "間違えた問題");
  $("#done").onclick = () => show(TABS.practice, { tab: "practice" });
}
const bmBtn = id => `<button class="btn-inline btn ${S.bm[id] ? "flag-on" : ""}" data-bm="${id}" style="padding:2px 8px;margin:0 0 0 6px">${S.bm[id] ? "★" : "☆"}</button>`;
function bindBm(el) { el.querySelectorAll("[data-bm]").forEach(b => (b.onclick = () => { const id = b.dataset.bm; if (S.bm[id]) delete S.bm[id]; else S.bm[id] = 1; save(); b.textContent = S.bm[id] ? "★" : "☆"; b.classList.toggle("flag-on", !!S.bm[id]); })); }

/* ---------- question sets ---------- */
function dueIds() { return D.questions.filter(q => { const s = stat(q.id); return s && s.due <= Date.now() && (lastWrong(q.id) || !mastered(q.id)); }).map(q => q.id); }
function wrongIds() { return D.questions.filter(q => lastWrong(q.id)).map(q => q.id); }
function weakCats() {
  return CAT_IDS.map(c => { const a = catAcc(c); return { c, rate: a.a ? a.c / a.a : null, a: a.a }; })
    .filter(x => x.rate !== null && x.a >= 3).sort((x, y) => x.rate - y.rate);
}
function recommendSet(n) {
  const picked = new Set();
  // 1) 復習期限が来た問題（間違えたものを優先）
  shuffle(dueIds()).sort((a, b) => (lastWrong(b) ? 1 : 0) - (lastWrong(a) ? 1 : 0)).slice(0, Math.ceil(n * 0.5)).forEach(id => picked.add(id));
  // 2) 未回答の重要問題（再出題・新しい年度）
  const fresh = D.questions.filter(q => !stat(q.id) && !picked.has(q.id));
  const weak = new Set(weakCats().slice(0, 3).map(x => x.c));
  while (picked.size < n && fresh.length) {
    const q = weighted(fresh, x => importance(x) * (weak.has(x.cat) ? 1.6 : 1));
    picked.add(q.id); fresh.splice(fresh.indexOf(q), 1);
  }
  // 3) それでも足りなければ未習得の問題
  const rest = shuffle(D.questions.filter(q => !mastered(q.id) && !picked.has(q.id)));
  while (picked.size < n && rest.length) picked.add(rest.pop().id);
  return shuffle([...picked]);
}
function mockSet() {
  // 直近5回の分野構成に合わせて25問を構成（最大剰余法）
  const raw = CAT_IDS.map(c => ({ c, v: CAT_QUOTA[c] }));
  const sum = raw.reduce((s, x) => s + x.v, 0);
  raw.forEach(x => { x.v = (x.v / sum) * EXAM_N; x.n = Math.floor(x.v); });
  let left = EXAM_N - raw.reduce((s, x) => s + x.n, 0);
  raw.sort((a, b) => (b.v - b.n) - (a.v - a.n)).forEach(x => { if (left > 0) { x.n++; left--; } });
  const out = [];
  raw.forEach(({ c, n }) => {
    const pool = D.questions.filter(q => q.cat === c);
    // 同じ問題の再出題グループからは1問だけ
    const used = new Set();
    for (let k = 0; k < n && pool.length; k++) {
      const cand = pool.filter(q => !used.has(q.id));
      if (!cand.length) break;
      const q = weighted(cand, x => importance(x) * (mastered(x.id) ? 0.5 : 1));
      out.push(q); used.add(q.id); (q.rep || []).forEach(r => used.add(r));
    }
  });
  return out.sort((a, b) => CAT_ORDER[a.cat] - CAT_ORDER[b.cat]).map(q => q.id);
}

/* ---------- mock exam (本番形式) ---------- */
let timer = null;
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
function startMock() {
  const st = { ids: mockSet(), ans: Array(EXAM_N).fill(-1), flag: Array(EXAM_N).fill(false), i: 0, start: Date.now(), end: Date.now() + EXAM_MIN * 60000 };
  show(el => mockView(el, st), { push: true });
}
function mockView(el, st) {
  document.body.classList.add("exam");
  setTitle("模擬試験（午前Ⅱ）");
  const tick = () => {
    const ms = st.end - Date.now();
    if (ms <= 0) { stopTimer(); toast("試験時間終了"); return finishMock(el, st); }
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    $("#hdr-right").textContent = `⏱ ${m}:${String(s).padStart(2, "0")}`;
    $("#hdr-right").className = ms < 5 * 60000 ? "warn" : "";
  };
  if (!timer) timer = setInterval(tick, 1000); tick();
  if (st.i === -1) return mockPalette(el, st);
  const q = Q[st.ids[st.i]];
  el.innerHTML = `
    <div class="card">
      <div class="qhead"><b style="color:var(--fg)">問${st.i + 1}</b><span>${st.ans.filter(a => a >= 0).length}/${EXAM_N} 解答済み</span></div>
      ${qBody(q)}
      <div class="choices ${q.chImg ? "img" : ""}">${q.ch.map((_, i) => choiceHtml(q, i, st.ans[st.i] === i ? "sel" : "")).join("")}</div>
    </div>
    <div class="navbar">
      <button class="btn center" id="prev" ${st.i === 0 ? "disabled" : ""}>‹ 前</button>
      <button class="btn center ${st.flag[st.i] ? "flag-on" : ""}" id="flag">⚑ 見直し</button>
      <button class="btn center" id="list">一覧</button>
      <button class="btn pri center" id="nxt">${st.i === EXAM_N - 1 ? "一覧" : "次 ›"}</button>
    </div>`;
  el.querySelectorAll(".choice").forEach(b => (b.onclick = () => { const i = +b.dataset.i; st.ans[st.i] = st.ans[st.i] === i ? -1 : i; el.querySelectorAll(".choice").forEach(x => x.classList.toggle("sel", +x.dataset.i === st.ans[st.i])); el.querySelector(".qhead span").textContent = `${st.ans.filter(a => a >= 0).length}/${EXAM_N} 解答済み`; }));
  $("#prev").onclick = () => { st.i--; mockView(el, st); window.scrollTo(0, 0); };
  $("#nxt").onclick = () => { st.i = st.i === EXAM_N - 1 ? -1 : st.i + 1; mockView(el, st); window.scrollTo(0, 0); };
  $("#list").onclick = () => { st.i = -1; mockView(el, st); window.scrollTo(0, 0); };
  $("#flag").onclick = () => { st.flag[st.i] = !st.flag[st.i]; $("#flag").classList.toggle("flag-on", st.flag[st.i]); };
}
function mockPalette(el, st) {
  const done = st.ans.filter(a => a >= 0).length;
  el.innerHTML = `
    <div class="card"><b>解答状況</b> ${done}/${EXAM_N}　<span class="small muted">⚑ 見直し ${st.flag.filter(x => x).length} 問</span>
      <div class="palette" style="margin-top:10px">${st.ids.map((_, i) => `<button data-i="${i}" class="${st.ans[i] >= 0 ? "ans" : ""} ${st.flag[i] ? "flag" : ""}">${i + 1}${st.ans[i] >= 0 ? `<br><small>${KANA[st.ans[i]]}</small>` : "<br><small>－</small>"}</button>`).join("")}</div>
    </div>
    <p class="small muted">本番（科目A-2）は 25 問・40 分・各 4 点で，60 点（15 問）以上が基準点です。未解答は不正解になります。</p>
    <button class="btn pri center" id="submit">採点する</button>`;
  el.querySelectorAll(".palette button").forEach(b => (b.onclick = () => { st.i = +b.dataset.i; mockView(el, st); }));
  $("#submit").onclick = () => { if (done < EXAM_N && !confirm(`未解答が ${EXAM_N - done} 問あります。採点しますか？`)) return; finishMock(el, st); };
}
function finishMock(el, st) {
  stopTimer(); document.body.classList.remove("exam");
  const ok = st.ids.map((id, i) => st.ans[i] === Q[id].ans);
  st.ids.forEach((id, i) => record(id, ok[i], st.ans[i]));
  const score = ok.filter(x => x).length * 4, byCat = {};
  st.ids.forEach((id, i) => { const c = Q[id].cat; byCat[c] = byCat[c] || [0, 0]; byCat[c][1]++; if (ok[i]) byCat[c][0]++; });
  S.mocks.push({ d: Date.now(), score, sec: Math.round((Math.min(Date.now(), st.end) - st.start) / 1000), ids: st.ids, ans: st.ans, byCat });
  save();
  $("#hdr-right").textContent = "";
  const res = { ids: st.ids, res: st.ans, label: "模擬試験の見直し" };
  el.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="muted">模擬試験 結果</div>
      <div style="font-size:44px;font-weight:700;color:${score >= 60 ? "var(--ok)" : "var(--ng)"}">${score} 点</div>
      <div>${ok.filter(x => x).length}/${EXAM_N} 問正解　${score >= 60 ? "基準点クリア 🎉" : `基準点まであと ${Math.ceil((60 - score) / 4)} 問`}</div>
      <div class="small muted">所要時間 ${Math.floor(S.mocks[S.mocks.length - 1].sec / 60)} 分</div>
    </div>
    <div class="card"><b>分野別</b>${Object.entries(byCat).sort((a, b) => CAT_ORDER[a[0]] - CAT_ORDER[b[0]]).map(([c, [a, n]]) => barHtml(D.cats[c], a / n, `${a}/${n}`)).join("")}</div>
    <div class="card"><b>問題ごとの結果</b>（タップで解説）<div class="palette" style="margin-top:10px">${st.ids.map((id, i) => `<button data-i="${i}" class="${ok[i] ? "ok" : "ng"}">${i + 1}<br><small>${st.ans[i] >= 0 ? KANA[st.ans[i]] : "－"}→${KANA[Q[id].ans]}</small></button>`).join("")}</div></div>
    <button class="btn pri center" id="retry" ${ok.every(x => x) ? "disabled" : ""}>間違えた ${ok.filter(x => !x).length} 問を解き直す</button>
    <button class="btn center" id="home">ホームへ</button>`;
  el.querySelectorAll(".palette button").forEach(b => (b.onclick = () => { res.i = +b.dataset.i; show(e2 => drillView(e2, res), { push: true }); }));
  $("#retry").onclick = () => startDrill(st.ids.filter((id, i) => !ok[i]), "模試の間違い直し");
  $("#home").onclick = () => show(TABS.home, { tab: "home" });
}
function barHtml(label, rate, val, cls) {
  const c = cls || (rate >= 0.75 ? "ok" : rate >= 0.6 ? "" : rate >= 0.4 ? "warn" : "ng");
  return `<div class="bar"><span class="lbl">${esc(label)}</span><span class="track"><span class="fill ${c}" style="width:${Math.round(rate * 100)}%;display:block"></span></span><span class="val">${val}</span></div>`;
}

/* ---------- views ---------- */
const TABS = {};
TABS.home = el => {
  setTitle("SA 午前Ⅱ 対策");
  const answered = Object.keys(S.q).length, mast = D.questions.filter(q => mastered(q.id)).length;
  const due = dueIds().length, p = predict();
  const last = S.mocks[S.mocks.length - 1];
  let days = "";
  if (S.examDate) { const d = Math.ceil((new Date(S.examDate) - new Date(today())) / DAY); if (d >= 0) days = `試験まであと <b>${d}</b> 日`; }
  const streak = (() => { let n = 0; for (let d = new Date(); S.days[d.toISOString().slice(0, 10)]; d = new Date(d - DAY)) n++; return n; })();
  const todayCnt = (S.days[today()] || { a: 0 }).a;
  el.innerHTML = `
    ${days ? `<p class="card" style="text-align:center;margin-top:0">${days}</p>` : ""}
    <div class="kpi">
      <div><b>${p === null ? "—" : Math.round(p * 100)}</b><span>予測得点</span></div>
      <div><b>${mast}</b><span>習得 / 400問</span></div>
      <div><b>${todayCnt}</b><span>今日の解答${streak > 1 ? `（${streak}日連続）` : ""}</span></div>
    </div>
    ${p !== null ? `<p class="small muted" style="margin:6px 2px">予測得点は回答履歴と本番の分野構成から推定（基準点 60）。${p >= 0.75 ? "合格圏です。模試で仕上げましょう。" : p >= 0.6 ? "基準点付近です。弱点分野と復習を優先しましょう。" : "まずは毎日の“おすすめ演習”で全体を一巡しましょう。"}</p>` : `<p class="small muted" style="margin:6px 2px">15 問以上解くと予測得点を表示します。</p>`}
    <button class="btn pri" id="rec"><b>おすすめ演習（${S.settings.n}問）</b><span class="sub">復習期限の問題＋未回答の頻出問題＋弱点分野を自動で組み合わせ</span></button>
    <div class="grid2">
      <button class="btn" id="mock"><b>本番形式の模擬試験</b><span class="sub">25問・40分</span></button>
      <button class="btn" id="due" ${due ? "" : "disabled"}><b>今日の復習</b><span class="sub">${due} 問</span></button>
    </div>
    ${last ? `<div class="card small">前回の模試：<b>${last.score} 点</b>（${new Date(last.d).toLocaleDateString("ja-JP")}）　${S.mocks.length} 回受験</div>` : ""}
    <div class="card small">
      <b>この試験の特徴（過去問 16 回分の分析）</b>
      <ul style="margin:6px 0 0;padding-left:1.2em">
        <li>25 問中 <b>約 4 割</b>が過去問の再出題（直近 3 回で 10 問前後）。<b>過去問の完全習得が最短ルート</b>。</li>
        <li>出題の約半分が<b>システム開発技術</b>（要件定義・設計・テスト）。次いでセキュリティ，システム企画。</li>
        <li>基準点は 60 点（15/25 問）。全問 4 択・各 4 点。</li>
      </ul>
      <button class="btn-inline btn" id="go-trend">出題傾向を見る</button>
    </div>
    <div class="card">
      <label class="small muted">試験日（カウントダウン表示）</label>
      <input type="date" id="exam-date" value="${esc(S.examDate)}">
    </div>`;
  $("#rec").onclick = () => startDrill(recommendSet(S.settings.n), "おすすめ演習");
  $("#mock").onclick = () => { if (confirm("本番形式（25問・40分）の模擬試験を開始します。途中で解説は表示されません。")) startMock(); };
  $("#due").onclick = () => startDrill(shuffle(dueIds()), "今日の復習");
  $("#go-trend").onclick = () => show(TABS.trend, { tab: "trend" });
  $("#exam-date").onchange = e => { S.examDate = e.target.value; save(); TABS.home(el); };
};

TABS.practice = el => {
  setTitle("演習");
  const unanswered = D.questions.filter(q => !stat(q.id)).length;
  const wrong = wrongIds().length, bm = Object.keys(S.bm).length, due = dueIds().length;
  const repIds = D.questions.filter(q => q.rep).map(q => q.id);
  const repUnmastered = repIds.filter(id => !mastered(id)).length;
  const weak = weakCats().slice(0, 3);
  el.innerHTML = `
    <div class="card">
      <label class="small muted">1回の問題数</label>
      <div class="seg" id="nsel">${[5, 10, 20, 30].map(n => `<button data-n="${n}" class="${S.settings.n === n ? "on" : ""}">${n}問</button>`).join("")}</div>
    </div>
    <button class="btn pri" data-go="rec"><b>おすすめ演習</b><span class="sub">迷ったらこれ。復習＋頻出＋弱点を自動配分</span></button>
    <button class="btn" data-go="due" ${due ? "" : "disabled"}><b>復習期限の問題</b><span class="sub">${due} 問（間隔反復：1→3→7→16→35日）</span></button>
    <button class="btn" data-go="wrong" ${wrong ? "" : "disabled"}><b>前回間違えた問題</b><span class="sub">${wrong} 問</span></button>
    <button class="btn" data-go="rep"><b>再出題された頻出問題</b><span class="sub">${repIds.length} 問中 未習得 ${repUnmastered} 問（同じ問題が複数回出題）</span></button>
    <button class="btn" data-go="new" ${unanswered ? "" : "disabled"}><b>未回答の問題</b><span class="sub">${unanswered} 問（重要度の高い順）</span></button>
    <button class="btn" data-go="weak" ${weak.length ? "" : "disabled"}><b>弱点分野の集中演習</b><span class="sub">${weak.length ? weak.map(x => `${D.cats[x.c]} ${Math.round(x.rate * 100)}%`).join("／") : "3問以上解くと判定します"}</span></button>
    <button class="btn" data-go="bm" ${bm ? "" : "disabled"}><b>☆ ブックマーク</b><span class="sub">${bm} 問</span></button>
    <button class="btn" data-go="mock"><b>本番形式の模擬試験</b><span class="sub">本番の分野構成で25問・40分。見直しフラグ・一覧付き</span></button>`;
  el.querySelectorAll("#nsel button").forEach(b => (b.onclick = () => { S.settings.n = +b.dataset.n; save(); TABS.practice(el); }));
  const n = () => S.settings.n;
  const go = {
    rec: () => startDrill(recommendSet(n()), "おすすめ演習"),
    due: () => startDrill(shuffle(dueIds()).slice(0, n()), "復習"),
    wrong: () => startDrill(shuffle(wrongIds()).slice(0, n()), "前回間違えた問題"),
    rep: () => { const pool = D.questions.filter(q => q.rep && !mastered(q.id)); const ids = []; const p = pool.slice(); while (ids.length < n() && p.length) { const q = weighted(p, importance); ids.push(q.id); p.splice(p.indexOf(q), 1); } startDrill(ids.length ? ids : shuffle(repIds).slice(0, n()), "頻出問題"); },
    new: () => { const p = D.questions.filter(q => !stat(q.id)); const ids = []; while (ids.length < n() && p.length) { const q = weighted(p, importance); ids.push(q.id); p.splice(p.indexOf(q), 1); } startDrill(ids, "未回答の問題"); },
    weak: () => { const cs = new Set(weak.map(x => x.c)); const p = D.questions.filter(q => cs.has(q.cat) && !mastered(q.id)); startDrill(shuffle(p.map(q => q.id)).slice(0, n()), "弱点分野"); },
    bm: () => startDrill(shuffle(Object.keys(S.bm)).slice(0, n()), "ブックマーク"),
    mock: () => { if (confirm("本番形式（25問・40分）の模擬試験を開始します。途中で解説は表示されません。")) startMock(); },
  };
  el.querySelectorAll("[data-go]").forEach(b => (b.onclick = go[b.dataset.go]));
};

let termState = { q: "", cat: "", sort: "freq" };
TABS.terms = el => {
  setTitle("用語集");
  const render = () => {
    const kw = termState.q.trim().toLowerCase();
    let names = Object.keys(D.terms).filter(n => (!termState.cat || D.terms[n].cat === termState.cat) && (!kw || n.toLowerCase().includes(kw) || D.terms[n].def.toLowerCase().includes(kw)));
    if (termState.sort === "freq") names.sort((a, b) => TERM_FREQ[b] - TERM_FREQ[a] || a.localeCompare(b, "ja"));
    else names.sort((a, b) => a.localeCompare(b, "ja"));
    if (kw) names.sort((a, b) => (b.toLowerCase().includes(kw) ? 1 : 0) - (a.toLowerCase().includes(kw) ? 1 : 0));
    $("#tlist").innerHTML = names.length ? names.map(n => `<li data-t="${esc(n)}"><div class="main"><div class="ttl">${esc(n)} ${TERM_FREQ[n] ? `<span class="pill rep">${TERM_FREQ[n]}問</span>` : ""}${S.tk[n] === 1 ? '<span class="pill ok">覚えた</span>' : ""}</div><div class="desc">${esc(D.terms[n].def)}</div></div></li>`).join("") : `<li class="empty">見つかりません</li>`;
    $("#tcount").textContent = `${names.length} 語`;
    el.querySelectorAll("#tlist li[data-t]").forEach(li => (li.onclick = () => openTerm(li.dataset.t)));
  };
  el.innerHTML = `
    <input type="search" id="tq" placeholder="用語・説明文を検索" value="${esc(termState.q)}">
    <div class="row" style="margin-top:8px;flex-wrap:nowrap">
      <select id="tcat" class="grow" style="width:auto"><option value="">全分野</option>${CAT_IDS.concat(Object.keys(D.cats).filter(c => !CAT_IDS.includes(c) && Object.values(D.terms).some(t => t.cat === c))).map(c => `<option value="${c}" ${termState.cat === c ? "selected" : ""}>${esc(D.cats[c])}</option>`).join("")}</select>
      <select id="tsort" style="width:auto"><option value="freq" ${termState.sort === "freq" ? "selected" : ""}>出題頻度順</option><option value="name" ${termState.sort === "name" ? "selected" : ""}>五十音順</option></select>
    </div>
    <button class="btn" id="flash"><b>用語フラッシュカード</b><span class="sub">出題頻度の高い用語から。タップで説明を表示</span></button>
    <p class="small muted" id="tcount"></p>
    <ul class="list card" id="tlist"></ul>`;
  $("#tq").oninput = e => { termState.q = e.target.value; render(); };
  $("#tcat").onchange = e => { termState.cat = e.target.value; render(); };
  $("#tsort").onchange = e => { termState.sort = e.target.value; render(); };
  $("#flash").onclick = () => startFlash();
  render();
};
function startFlash() {
  const names = Object.keys(D.terms).filter(n => (!termState.cat || D.terms[n].cat === termState.cat) && S.tk[n] !== 1)
    .sort((a, b) => TERM_FREQ[b] - TERM_FREQ[a] + (Math.random() - 0.5) * 2);
  const st = { names: names.slice(0, 30), i: 0, open: false };
  if (!st.names.length) { toast("全て“覚えた”になっています"); return; }
  show(el => flashView(el, st), { push: true });
}
function flashView(el, st) {
  setTitle("フラッシュカード");
  if (st.i >= st.names.length) { el.innerHTML = `<div class="card empty">おつかれさまでした（${st.names.length} 語）</div><button class="btn center" id="again">もう一度</button>`; $("#again").onclick = () => { goBack(); startFlash(); }; return; }
  const n = st.names[st.i], t = D.terms[n];
  $("#hdr-right").textContent = `${st.i + 1}/${st.names.length}`;
  el.innerHTML = `
    <div class="card flash" id="fc"><div class="small muted">${esc(D.cats[t.cat])}${TERM_FREQ[n] ? `・過去問 ${TERM_FREQ[n]} 問` : ""}</div><div class="front">${esc(n)}</div>
    ${st.open ? `<div class="back">${rich(esc(t.def))}${t.rel.length ? `<div class="tchips">${t.rel.map(r => `<a class="tchip t" data-t="${esc(r[0])}">${esc(r[0])}</a>`).join("")}</div>` : ""}</div>` : `<div class="small muted" style="margin-top:12px">タップして説明を表示</div>`}</div>
    ${st.open ? `<div class="grid2"><button class="btn center" id="ng">まだ</button><button class="btn pri center" id="ok">覚えた</button></div><button class="btn center" id="detail">関連・過去問を見る</button>` : ""}`;
  $("#fc").onclick = e => { if (e.target.closest("a")) return; st.open = true; flashView(el, st); };
  if (st.open) {
    $("#ok").onclick = () => { S.tk[n] = 1; save(); st.i++; st.open = false; flashView(el, st); };
    $("#ng").onclick = () => { S.tk[n] = 0; save(); st.names.push(n); st.i++; st.open = false; flashView(el, st); };
    $("#detail").onclick = () => openTerm(n);
  }
}

TABS.trend = el => {
  setTitle("出題傾向");
  const rows = CAT_IDS.slice().sort((a, b) => CAT_ORDER[a] - CAT_ORDER[b]).map(c => {
    const qs = D.questions.filter(q => q.cat === c);
    return { c, all: qs.length, r5: CAT_QUOTA[c], acc: catAcc(c), rep: qs.filter(q => q.rep).length };
  });
  const repByExam = EXAM_IDS.map(e => ({ e, n: D.questions.filter(q => q.exam === e && (q.rep || []).some(r => r < q.id)).length }));
  const subs = {}; D.questions.forEach(q => { const k = q.cat + "|" + q.sub; subs[k] = (subs[k] || 0) + 1; });
  const topSubs = Object.entries(subs).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const groups = []; const seen = new Set();
  D.questions.filter(q => q.rep).forEach(q => { if (seen.has(q.id)) return; const g = [q.id, ...q.rep]; g.forEach(x => seen.add(x)); groups.push(g); });
  groups.sort((a, b) => b.length - a.length || Math.max(...b.map(id => EXAM[Q[id].exam].idx)) - Math.max(...a.map(id => EXAM[Q[id].exam].idx)));
  const sylCnt = {}; D.questions.forEach(q => { if (q.syl) sylCnt[q.syl] = (sylCnt[q.syl] || 0) + 1; });
  el.innerHTML = `
    <div class="card small">IPA が公開する平成21年度〜令和7年度（令和2年度は中止）の <b>16 回・400 問</b>を分析。分類は試験要綱の出題分野（午前Ⅱ）に準拠，シラバスは SA 試験シラバス Ver.5.2 の大項目に対応付けています。</div>
    <h2>分野別の出題数</h2>
    <div class="card scroll-x"><table class="tbl"><tr><th>分野</th><th>収録問題</th><th>本番の出題数<br><span class="small">（直近5回平均）</span></th><th>あなたの正答率</th></tr>
    ${rows.map(r => `<tr><td>${esc(D.cats[r.c])}</td><td>${r.all}</td><td>${r.r5.toFixed(1)}</td><td>${r.acc.a ? pct(r.acc.c, r.acc.a) + "%" : "—"}</td></tr>`).join("")}</table>
    <p class="small muted">本番の出題数は${esc(QUOTA_SRC)}。模擬試験はこの構成で 25 問を出題します。</p></div>
    ${REF ? `<h2>年度別の出題数（出題分析資料）</h2>
    <div class="card scroll-x"><table class="tbl"><tr><th>分野</th>${REF.years.map(y => `<th>${esc(y)}</th>`).join("")}</tr>
    ${Object.entries(REF.cats).sort((a, b) => (CAT_ORDER[a[0]] || 0) - (CAT_ORDER[b[0]] || 0)).map(([c, v]) => `<tr><td>${esc(D.cats[c])}</td>${v.map(n => `<td>${n}</td>`).join("")}</tr>`).join("")}</table>
    <p class="small muted">セキュリティが増加傾向（H26：2問 → R4・R6：5問）。システム開発技術は毎回 11〜12 問で最大の分野です。</p></div>
    <h2>小分類別の出題実績（出題分析資料）</h2>
    <div class="card">${(() => { const all = Object.entries(REF.subs).flatMap(([c, v]) => v.map(([s, n]) => [c, s, n])).sort((a, b) => b[2] - a[2]); const mx = all[0][2]; return all.slice(0, 15).map(([c, s, n]) => barHtml(s, n / mx, n)).join(""); })()}</div>` : ""}
    <h2>過去問の再出題率</h2>
    <div class="card">${repByExam.filter(x => EXAM[x.e].idx >= 3).map(x => barHtml(EXAM[x.e].label.replace(/度.*$/, "度"), x.n / 25, `${x.n}/25`, "warn")).join("")}
    <p class="small muted">それ以前の年度とほぼ同じ問題（問題文・選択肢が一致）の数。直近は 25 問中 10 問前後が再出題で，過去問を確実に解ければそれだけで基準点の 2/3 を確保できます。</p></div>
    <h2>収録問題に多いテーマ（小分類）</h2>
    <div class="card">${topSubs.map(([k, n]) => barHtml(k.split("|")[1], n / topSubs[0][1], n)).join("")}</div>
    <h2>シラバス大項目との対応</h2>
    <div class="card">${Object.keys(D.syl).map(k => barHtml(`${k} ${D.syl[k]}`, (sylCnt[k] || 0) / 400, sylCnt[k] || 0)).join("")}<p class="small muted">Ⅳ（開発）が中心。Ⅵ（関連知識）には，セキュリティ・ネットワーク・ハードウェアなど技術要素の問題を含めています。</p></div>
    <h2>繰り返し出題された問題</h2>
    <button class="btn pri center" id="rep-all">頻出問題を順に解く（${groups.length} グループ）</button>
    <ul class="list card">${groups.slice(0, 40).map(g => { const q = Q[g.sort((a, b) => EXAM[Q[b].exam].idx - EXAM[Q[a].exam].idx)[0]]; return `<li data-q="${q.id}"><div class="main"><div class="small"><span class="pill rep">${g.length}回</span>${g.map(id => esc(srcShort(Q[id]))).sort().join(" ")}</div><div class="desc">${esc(strip(q.q))}</div></div>${resultIcon(q.id)}</li>`; }).join("")}</ul>`;
  el.querySelectorAll("li[data-q]").forEach(li => (li.onclick = () => startDrill([li.dataset.q], "頻出問題")));
  $("#rep-all").onclick = () => startDrill(groups.map(g => g[0]).filter(id => !mastered(id)).concat(groups.map(g => g[0]).filter(id => mastered(id))), "頻出問題（全グループ）");
};

TABS.stats = el => {
  setTitle("成績");
  const all = accOf(D.questions.map(q => q.id));
  const answered = Object.keys(S.q).length, mast = D.questions.filter(q => mastered(q.id)).length;
  const days = Object.entries(S.days).sort().slice(-14);
  const maxDay = Math.max(1, ...days.map(([, v]) => v.a));
  el.innerHTML = `
    <div class="kpi">
      <div><b>${pct(all.c, all.a)}%</b><span>累計正答率</span></div>
      <div><b>${answered}</b><span>解いた問題 /400</span></div>
      <div><b>${mast}</b><span>習得（直近2回正解）</span></div>
    </div>
    <h2>分野別の正答率</h2>
    <div class="card">${CAT_IDS.slice().sort((a, b) => CAT_ORDER[a] - CAT_ORDER[b]).map(c => { const a = catAcc(c), n = D.questions.filter(q => q.cat === c).length, m = D.questions.filter(q => q.cat === c && mastered(q.id)).length; return a.a ? barHtml(D.cats[c], a.c / a.a, `${pct(a.c, a.a)}%`) + `<div class="small muted" style="margin:-4px 0 6px">習得 ${m}/${n} 問</div>` : barHtml(D.cats[c], 0, "—"); }).join("")}</div>
    <h2>模擬試験の履歴</h2>
    <div class="card">${S.mocks.length ? `<ul class="list">${S.mocks.slice().reverse().map((m, k) => `<li data-m="${S.mocks.length - 1 - k}"><div class="main">${new Date(m.d).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}<span class="small muted">　${Math.floor(m.sec / 60)}分</span></div><b style="color:${m.score >= 60 ? "var(--ok)" : "var(--ng)"}">${m.score}点</b></li>`).join("")}</ul>` : `<div class="empty">まだ受験していません</div>`}</div>
    <h2>直近の学習量</h2>
    <div class="card">${days.length ? days.map(([d, v]) => barHtml(d.slice(5), v.a / maxDay, `${v.c}/${v.a}`, "")).join("") : `<div class="empty">記録がありません</div>`}</div>
    <h2>データの管理</h2>
    <div class="card small">
      記録はこの端末のブラウザ内に保存されます。機種変更やブラウザのデータ削除に備えて，定期的にバックアップしてください。
      <div class="row" style="margin-top:8px">
        <button class="btn btn-inline" id="exp">バックアップを保存</button>
        <button class="btn btn-inline" id="imp">バックアップから復元</button>
        <button class="btn btn-inline" id="reset" style="color:var(--ng)">記録を全て消去</button>
      </div>
      <input type="file" id="impf" accept="application/json,.json" hidden>
    </div>
    <p class="small muted">問題の出典：独立行政法人情報処理推進機構（IPA）情報処理技術者試験 システムアーキテクト試験 午前Ⅱ 過去問題。解説は本アプリ独自のものです。</p>`;
  el.querySelectorAll("li[data-m]").forEach(li => (li.onclick = () => { const m = S.mocks[+li.dataset.m]; show(e2 => drillView(e2, { ids: m.ids, res: m.ans.map(a => (a < 0 ? -2 : a)), i: 0, label: "模試の見直し" }), { push: true }); }));
  $("#exp").onclick = () => {
    const blob = new Blob([JSON.stringify(S)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `sa-am2-backup-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("#imp").onclick = () => $("#impf").click();
  $("#impf").onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => { const s = JSON.parse(t); if (s.v !== 1 || !s.q) throw new Error(); if (!confirm("現在の記録を上書きして復元しますか？")) return; S = Object.assign(blank(), s); save(); toast("復元しました"); TABS.stats(el); }).catch(() => toast("ファイルを読み込めませんでした"));
  };
  $("#reset").onclick = () => { if (confirm("全ての学習記録を消去します。よろしいですか？") && confirm("本当に消去しますか？（元に戻せません）")) { S = blank(); save(); TABS.stats(el); } };
};

show(TABS.home, { tab: "home" });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
