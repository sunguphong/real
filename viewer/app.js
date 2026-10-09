// 읽기 전용 정적 뷰어 — history.json 을 직접 읽어 브라우저에서 모두 계산한다.
// 서버 없이 정적 호스팅에서 동작한다.
const $ = (id) => document.getElementById(id);
const COLORS = ["#3b82f6", "#f59e0b", "#22c55e", "#ef4444", "#a855f7", "#14b8a6"];

let HISTORY = null;

function setStatus(msg, kind = "info") {
  const el = $("status");
  if (!msg) { el.hidden = true; return; }
  el.hidden = false; el.className = "status " + kind; el.textContent = msg;
}

// ---------- history.json → 상태 계산 (서버 buildState 와 동일 로직) ----------
function computeState(history) {
  const snaps = history.snapshots || {};
  const dates = Object.keys(snaps).sort();
  const todayKey = dates[dates.length - 1] || null;
  const prevKey = dates.length >= 2 ? dates[dates.length - 2] : null;
  const today = todayKey ? snaps[todayKey] : {};
  const prev = prevKey ? snaps[prevKey] : {};
  const labels = history.labels || {};

  const allPyeong = new Set();
  for (const d of dates) for (const p of Object.keys(snaps[d])) allPyeong.add(p);
  const pyeongList = [...allPyeong].sort((a, b) => Number(a) - Number(b));

  const rows = pyeongList.map((p) => ({
    pyeong: Number(p), label: labels[p] || "",
    prev: prev[p] || 0, today: today[p] || 0, diff: (today[p] || 0) - (prev[p] || 0),
  }));
  const series = pyeongList.map((p) => ({
    pyeong: Number(p), label: labels[p] || "",
    data: dates.map((d) => snaps[d][p] || 0),
  }));

  return {
    complexName: history.complexName, complexNo: history.complexNo,
    todayDate: todayKey, prevDate: prevKey, rows,
    chart: {
      dates, estimatedDates: history.estimatedDates || [], series,
      totals: dates.map((d) => Object.values(snaps[d]).reduce((s, n) => s + n, 0)),
    },
    history: dates.map((d) => ({ date: d, total: Object.values(snaps[d]).reduce((s, n) => s + n, 0) })),
  };
}

// 특정 평형의 어제→오늘 변동 (서버 computeChanges 와 동일 로직)
function computeChanges(history, pyeong) {
  const arts = history.articles || {};
  const adates = Object.keys(arts).sort();
  const py = Number(pyeong);
  if (adates.length === 0) return { available: false, reason: "no-data" };
  const todayK = adates[adates.length - 1];
  const todayList = arts[todayK].filter((r) => r.pyeong === py);
  const prevK = adates.length >= 2 ? adates[adates.length - 2] : null;
  if (!prevK) return { available: false, reason: "need-2-days", todayDate: todayK, pyeong: py, current: todayList };
  const prevList = arts[prevK].filter((r) => r.pyeong === py);
  const { added, sold, relisted } = classifyChanges(prevList, todayList);
  return { available: true, todayDate: todayK, prevDate: prevK, pyeong: py, added, sold, relisted, current: todayList };
}

// 같은 실물 매물 식별 키 — 동·층·전용면적 (가격은 재등록 시 변동되므로 제외)
function unitKey(r) {
  return `${r.bldg || ""}|${r.floor || ""}|${r.excl || ""}`;
}

// removed 를 added 와 실물 단위로 대조해 분리:
//   added(신규) / sold(거래·소멸 추정) / relisted(같은 동·층·전용 재등록 = 거래 아님)
function classifyChanges(prevList, todayList) {
  const prevSet = new Set(prevList.map((r) => r.no));
  const todaySet = new Set(todayList.map((r) => r.no));
  const rawAdded = todayList.filter((r) => !prevSet.has(r.no));
  const rawRemoved = prevList.filter((r) => !todaySet.has(r.no));

  const addedByKey = new Map();
  for (const a of rawAdded) {
    const k = unitKey(a);
    if (!addedByKey.has(k)) addedByKey.set(k, []);
    addedByKey.get(k).push(a);
  }
  const sold = [], relisted = [];
  for (const r of rawRemoved) {
    const q = addedByKey.get(unitKey(r));
    if (q && q.length) relisted.push({ before: r, after: q.shift() });
    else sold.push(r);
  }
  const matched = new Set(relisted.map((p) => p.after.no));
  const added = rawAdded.filter((a) => !matched.has(a.no));
  return { added, sold, relisted };
}

function fmtDelta(diff) {
  if (diff > 0) return { cls: "up", txt: `▲ ${diff}` };
  if (diff < 0) return { cls: "down", txt: `▼ ${Math.abs(diff)}` };
  return { cls: "same", txt: "–" };
}

// ---------- 차트 ----------
function renderChart(chart) {
  const wrap = $("chart-wrap"), note = $("chart-note"), legend = $("chart-legend");
  if (!chart || !chart.dates || chart.dates.length === 0) {
    wrap.innerHTML = `<p class="empty">데이터가 없습니다.</p>`; note.textContent = ""; legend.textContent = ""; return;
  }
  const dates = chart.dates;
  const estSet = new Set(chart.estimatedDates || []);
  const W = 760, H = 300, pad = { l: 40, r: 16, t: 16, b: 46 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  let maxY = 0;
  for (const s of chart.series) for (const v of s.data) if (v > maxY) maxY = v;
  maxY = Math.max(5, Math.ceil(maxY / 5) * 5);
  const x = (i) => pad.l + (dates.length === 1 ? iw / 2 : (iw * i) / (dates.length - 1));
  const y = (v) => pad.t + ih - (ih * v) / maxY;
  const NS = "http://www.w3.org/2000/svg";
  const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", preserveAspectRatio: "xMidYMid meet" });

  for (let g = 0; g <= 5; g++) {
    const yy = pad.t + (ih * g) / 5;
    svg.appendChild(el("line", { x1: pad.l, y1: yy, x2: W - pad.r, y2: yy, stroke: "#2b313c", "stroke-width": 1 }));
    const lab = el("text", { x: pad.l - 8, y: yy + 4, fill: "#9aa3b2", "font-size": 11, "text-anchor": "end" });
    lab.textContent = Math.round(maxY - (maxY * g) / 5); svg.appendChild(lab);
  }
  const step = Math.ceil(dates.length / 8);
  dates.forEach((d, i) => {
    if (i % step !== 0 && i !== dates.length - 1) return;
    const t = el("text", { x: x(i), y: H - pad.b + 18, fill: "#9aa3b2", "font-size": 10, "text-anchor": "middle" });
    t.textContent = d.slice(5); svg.appendChild(t);
  });
  const firstReal = dates.findIndex((d) => !estSet.has(d));
  if (firstReal > 0) svg.appendChild(el("line", { x1: x(firstReal), y1: pad.t, x2: x(firstReal), y2: pad.t + ih, stroke: "#5f6b7e", "stroke-width": 1, "stroke-dasharray": "3 3" }));

  chart.series.forEach((s, si) => {
    const color = COLORS[si % COLORS.length];
    for (let i = 1; i < dates.length; i++) {
      const seg = el("line", { x1: x(i - 1), y1: y(s.data[i - 1]), x2: x(i), y2: y(s.data[i]), stroke: color, "stroke-width": 2.4, "stroke-linecap": "round" });
      if (estSet.has(dates[i])) seg.setAttribute("stroke-dasharray", "4 4");
      svg.appendChild(seg);
    }
    dates.forEach((d, i) => {
      const c = el("circle", { cx: x(i), cy: y(s.data[i]), r: 3, fill: color });
      const title = el("title"); title.textContent = `${d} · ${s.pyeong}평: ${s.data[i]}개${estSet.has(d) ? " (추정)" : ""}`;
      c.appendChild(title); svg.appendChild(c);
    });
  });
  wrap.innerHTML = ""; wrap.appendChild(svg);
  legend.innerHTML = chart.series.map((s, i) => `<span class="lg"><i style="background:${COLORS[i % COLORS.length]}"></i>${s.pyeong}평</span>`).join("");
  note.innerHTML = estSet.size ? `점선 구간(${chart.estimatedDates[0].slice(5)}~)은 <b>추정치</b>(현재 매물 등록일 기준), 실선은 <b>실제 수집값</b>입니다.` : "";
}

// ---------- 모달 ----------
function fmtConfirm(ymd) { return (!ymd || ymd.length < 8) ? "" : `${ymd.slice(4, 6)}/${ymd.slice(6, 8)} 확인`; }
function articleItem(complexNo, r) {
  const url = `https://new.land.naver.com/complexes/${complexNo}?articleNo=${r.no}`;
  const meta = [r.floor && `${r.floor}층`, r.excl && `전용 ${r.excl}㎡`, r.dir, fmtConfirm(r.confirm)].filter(Boolean).join(" · ");
  return `<a class="item" href="${url}" target="_blank" rel="noopener">` +
    `<div class="item-top"><span class="item-price">${r.price || "-"}</span><span class="item-bldg">${r.bldg || ""}</span></div>` +
    `<div class="item-meta">${meta}</div>` + (r.desc ? `<div class="item-desc">${r.desc}</div>` : "") +
    `<div class="item-realtor">${r.realtor || ""}</div></a>`;
}
function listBlock(title, cls, items, complexNo, emptyMsg) {
  const body = items.length ? items.map((r) => articleItem(complexNo, r)).join("") : `<p class="empty-sm">${emptyMsg}</p>`;
  return `<div class="chg-block"><h4 class="${cls}">${title} (${items.length})</h4>${body}</div>`;
}
// 재등록 매물 — 어제 매물(before)이 오늘 같은 동·층·전용으로 새 번호 재등록(after)
function relistedItem(complexNo, pair) {
  const a = pair.after, b = pair.before;
  const url = `https://new.land.naver.com/complexes/${complexNo}?articleNo=${a.no}`;
  const meta = [a.floor && `${a.floor}층`, a.excl && `전용 ${a.excl}㎡`, a.dir, fmtConfirm(a.confirm)].filter(Boolean).join(" · ");
  const price = (b.price && a.price && b.price !== a.price)
    ? `<span class="item-price">${b.price} → ${a.price}</span>`
    : `<span class="item-price">${a.price || "-"}</span>`;
  return `<a class="item relisted" href="${url}" target="_blank" rel="noopener">` +
    `<div class="item-top">${price}<span class="item-bldg">${a.bldg || ""}</span></div>` +
    `<div class="item-meta">${meta}</div>` + (a.desc ? `<div class="item-desc">${a.desc}</div>` : "") +
    `<div class="item-realtor">${a.realtor || ""}</div></a>`;
}
function relistedBlock(complexNo, pairs) {
  if (!pairs || !pairs.length) return "";
  return `<div class="chg-block"><h4 class="neutral">🔁 재등록 (단순 갱신·거래 아님) (${pairs.length})</h4>` +
    pairs.map((p) => relistedItem(complexNo, p)).join("") + `</div>`;
}
function openChanges(pyeong, label) {
  const box = $("modal-content");
  $("modal").hidden = false;
  const c = computeChanges(HISTORY, pyeong);
  const head = `<h3>${pyeong}평 <span class="sub-label">${label || ""}</span></h3>`;
  const cn = HISTORY.complexNo;
  if (c.available) {
    box.innerHTML = head + `<p class="chg-dates">${c.prevDate} → ${c.todayDate} 변동</p>` +
      `<p class="chg-note">‘사라진 매물(거래 추정)’은 어제 매물 중 오늘 같은 동·층·전용으로 재등록되지 않고 없어진 건이에요. 재등록(단순 갱신)은 아래에 따로 분리했습니다.</p>` +
      listBlock("🟢 사라진 매물 (거래 추정)", "down", c.sold, cn, "거래로 사라진 매물 없음") +
      listBlock("🔴 새로 올라온 매물 (신규)", "up", c.added, cn, "신규 매물 없음") +
      relistedBlock(cn, c.relisted);
  } else if (c.reason === "need-2-days") {
    box.innerHTML = head + `<p class="chg-note">매물 단위 비교는 2일치 기록이 필요해요. 다음 날부터 추가/사라진 매물이 표시됩니다.</p>` +
      listBlock(`현재 ${pyeong}평 매물 목록`, "neutral", c.current || [], cn, "매물 없음");
  } else {
    box.innerHTML = head + `<p class="empty-sm">아직 매물 기록이 없습니다.</p>`;
  }
}
function closeModal() { $("modal").hidden = true; }
$("modal").addEventListener("click", (e) => { if (e.target.dataset.close !== undefined) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
$("tbody").addEventListener("click", (e) => {
  const btn = e.target.closest(".delta-btn");
  if (btn) openChanges(btn.dataset.pyeong, btn.dataset.label);
});

// ---------- 렌더 ----------
function render(state) {
  $("title").textContent = state.complexName || "매물 추이";
  $("updated").textContent = state.todayDate ? `마지막 업데이트 ${state.todayDate}` : "";
  $("col-prev").textContent = state.prevDate || "이전";
  $("col-today").textContent = state.todayDate ? `${state.todayDate} (최신)` : "오늘";
  $("dates").textContent = state.prevDate && state.todayDate ? `${state.prevDate} → ${state.todayDate}`
    : state.todayDate ? `기준일: ${state.todayDate}` : "";

  const tbody = $("tbody"); tbody.innerHTML = "";
  if (!state.rows || state.rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">데이터가 없습니다.</td></tr>`; $("tfoot").hidden = true;
  } else {
    let sp = 0, st = 0;
    for (const r of state.rows) {
      sp += r.prev; st += r.today;
      const d = fmtDelta(r.diff);
      const sub = r.label ? `<span class="sub-label">${r.label}</span>` : "";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><b>${r.pyeong}평</b> ${sub}</td>` +
        `<td class="num">${r.prev || "–"}</td><td class="num">${r.today || "–"}</td>` +
        `<td class="num"><button class="delta-btn ${d.cls}" data-pyeong="${r.pyeong}" data-label="${r.label}" title="매물 목록 보기">${d.txt} <span class="chev">›</span></button></td>`;
      tbody.appendChild(tr);
    }
    const ds = fmtDelta(st - sp);
    $("sum-prev").textContent = sp || "–"; $("sum-today").textContent = st || "–";
    $("sum-diff").innerHTML = `<span class="delta ${ds.cls}">${ds.txt}</span>`; $("tfoot").hidden = false;
  }

  renderChart(state.chart);

  const h = $("history-list");
  h.innerHTML = (!state.history || !state.history.length) ? "기록이 없습니다."
    : state.history.slice().reverse().map((x) => `<div class="h-row"><span>${x.date}</span><span>총 ${x.total}건</span></div>`).join("");
}

async function load() {
  try {
    const res = await fetch("history.json?t=" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    HISTORY = await res.json();
    render(computeState(HISTORY));
  } catch (e) {
    setStatus("데이터를 불러오지 못했습니다: " + e.message, "error");
  }
}
load();
