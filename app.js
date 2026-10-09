// 프론트엔드 — 서버 API와 통신해 평형별 매매 매물 증감을 표시
const $ = (id) => document.getElementById(id);

// 읽기 전용 정적 모드(GitHub Pages) — 서버 API 대신 data.json 에서 같은 응답을 꺼낸다.
const STATIC = !!window.STATIC_MODE;
let staticData = null;
async function api(path, opts) {
  if (STATIC) {
    if (!staticData) staticData = await (await fetch("data.json", { cache: "no-store" })).json();
    if (path.startsWith("/api/state")) return staticData.state;
    if (path.startsWith("/api/news")) return staticData.news || { items: [] };
    if (path.startsWith("/api/changes")) {
      const py = decodeURIComponent((path.match(/pyeong=([^&]+)/) || [])[1] || "");
      return staticData.changes[py] || { available: false, reason: "no-data" };
    }
    throw new Error("읽기 전용 페이지입니다.");
  }
  const res = await fetch(path, opts);
  return res.json();
}

function setStatus(msg, kind = "info") {
  const el = $("status");
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.className = "status " + kind;
  el.textContent = msg;
}

function esc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 전일/오늘 건수 셀 — 0건이 아니면 눌러서 그 날짜의 매물 목록을 볼 수 있다
function cntCell(r, which) {
  const n = which === "prev" ? r.prev : r.today;
  if (!n) return "–";
  return `<button class="cnt-btn" data-pyeong="${r.pyeong}" data-label="${esc(r.label)}" data-which="${which}" title="${which === "prev" ? "전일" : "오늘"} ${r.pyeong}평 매물 목록 보기">${n}</button>`;
}

function fmtDelta(diff) {
  if (diff > 0) return { cls: "up", txt: `▲ ${diff}` };
  if (diff < 0) return { cls: "down", txt: `▼ ${Math.abs(diff)}` };
  return { cls: "same", txt: "–" };
}

// 카테고리 팔레트 — 다크 배경(#181b22)에서 검증 통과:
//   명도대 L 0.48~0.67 / 채도 >=0.1 / 색약 분리 ΔE 8.4 이상 / 정상시야 19.3 이상 / 배경 대비 3:1 이상
// 두 차트가 같은 배열을 쓴다 — 색이 순위가 아니라 평형(개체)을 따라가야 하므로 25평은 두 그래프에서 같은 색.
const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];

// SVG 라인 차트 — 평형별 매물 추이. 추정 구간은 점선.
function renderChart(chart) {
  const wrap = $("chart-wrap");
  const note = $("chart-note");
  const legend = $("chart-legend");
  if (!chart || !chart.dates || chart.dates.length === 0) {
    wrap.innerHTML = `<p class="empty">데이터가 쌓이면 그래프가 표시됩니다.</p>`;
    note.textContent = ""; legend.textContent = "";
    return;
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

  // y 격자 + 눈금
  for (let g = 0; g <= 5; g++) {
    const yy = pad.t + (ih * g) / 5;
    svg.appendChild(el("line", { x1: pad.l, y1: yy, x2: W - pad.r, y2: yy, stroke: "#2b313c", "stroke-width": 1 }));
    const lab = el("text", { x: pad.l - 8, y: yy + 4, fill: "#9aa3b2", "font-size": 11, "text-anchor": "end" });
    lab.textContent = Math.round(maxY - (maxY * g) / 5);
    svg.appendChild(lab);
  }

  // x 라벨 (최대 8개만)
  const step = Math.ceil(dates.length / 8);
  dates.forEach((d, i) => {
    if (i % step !== 0 && i !== dates.length - 1) return;
    const t = el("text", { x: x(i), y: H - pad.b + 18, fill: "#9aa3b2", "font-size": 10, "text-anchor": "middle" });
    t.textContent = d.slice(5); // MM-DD
    svg.appendChild(t);
  });

  // 추정/실제 경계 표시 (첫 실제 날짜에 세로선)
  const firstReal = dates.findIndex((d) => !estSet.has(d));
  if (firstReal > 0) {
    svg.appendChild(el("line", { x1: x(firstReal), y1: pad.t, x2: x(firstReal), y2: pad.t + ih, stroke: "#5f6b7e", "stroke-width": 1, "stroke-dasharray": "3 3" }));
  }

  // 평형별 라인 — 추정 구간(점선)과 실제 구간(실선) 분리
  chart.series.forEach((s, si) => {
    const color = COLORS[si % COLORS.length];
    for (let i = 1; i < dates.length; i++) {
      const seg = el("line", {
        x1: x(i - 1), y1: y(s.data[i - 1]), x2: x(i), y2: y(s.data[i]),
        stroke: color, "stroke-width": 2.4, "stroke-linecap": "round",
      });
      if (estSet.has(dates[i])) seg.setAttribute("stroke-dasharray", "4 4");
      svg.appendChild(seg);
    }
    dates.forEach((d, i) => {
      const c = el("circle", { cx: x(i), cy: y(s.data[i]), r: 3, fill: color });
      const title = el("title"); title.textContent = `${d} · ${s.pyeong}평: ${s.data[i]}개${estSet.has(d) ? " (추정)" : ""}`;
      c.appendChild(title);
      svg.appendChild(c);
    });
  });

  wrap.innerHTML = "";
  wrap.appendChild(svg);

  legend.innerHTML = chart.series
    .map((s, i) => `<span class="lg line"><i style="background:${COLORS[i % COLORS.length]}"></i>${s.pyeong}평</span>`)
    .join("");
  note.innerHTML = estSet.size
    ? `점선 구간(${chart.estimatedDates[0].slice(5)}~)은 <b>추정치</b>(현재 매물 등록일 기준), 실선은 <b>실제 수집값</b>입니다.`
    : "";
}

// ---------- 실거래 가격추이 (SVG 라인 차트) ----------
// 설계 메모
//  - 거래가 없던 날(price:null)은 선을 끊는다. 없는 값을 이어 그리면 거래가 있었던 것처럼 보인다.
//  - y축은 0에서 시작하지 않는다. 5~9억 가격대에서 0 기준선은 변동을 전부 눌러버린다. 대신 축 범위를 화면과 설명에 밝힌다.
//  - 점은 실제 관측치만 찍는다. 점이 있는 날에만 거래가 있었다는 뜻.
//  - 평형 색은 매물 차트와 같다(색이 순위가 아니라 평형을 따라간다).
function fmtMan(man) {
  if (man == null) return "–";
  const r = Math.round(man / 100) * 100;            // 100만원 단위로 반올림
  const eok = Math.floor(r / 10000), rest = r - eok * 10000;
  if (eok && rest) return `${eok}억 ${rest.toLocaleString()}`;
  if (eok) return `${eok}억`;
  return rest.toLocaleString();
}

// 비교 단지 체크박스 — 켰을 때만 비교 계열을 그린다(선택은 이 브라우저에 기억).
let lastRealChart = null;
const CMP_KEY = "showCompare";
function cmpOn() { try { return localStorage.getItem(CMP_KEY) === "1"; } catch { return false; } }
$("cmp-check").addEventListener("change", (e) => {
  try { localStorage.setItem(CMP_KEY, e.target.checked ? "1" : "0"); } catch {}
  renderRealChart(lastRealChart);
});

function renderRealChart(rc) {
  lastRealChart = rc;
  const wrap = $("real-wrap"), note = $("real-note"), legend = $("real-legend"), tv = $("real-table-view");
  const dates = (rc && rc.dates) || [];
  const allSeries = (rc && rc.series) || [];
  const cmpNames = [...new Set(allSeries.filter((s) => s.compare).map((s) => s.complex))];
  $("cmp-toggle").hidden = !cmpNames.length;
  $("cmp-name").textContent = cmpNames.map((n) => n.replace(/^동탄역/, "")).join(", ");
  $("cmp-check").checked = cmpOn();
  const series = cmpOn() ? allSeries : allSeries.filter((s) => !s.compare);
  const hasAny = series.some((s) => s.data.some((v) => v !== null));
  if (!dates.length || !hasAny) {
    wrap.innerHTML = `<p class="empty">실거래 기록이 쌓이면 그래프가 표시됩니다.</p>`;
    note.textContent = ""; legend.textContent = ""; tv.hidden = true;
    return;
  }

  // y 범위 — 관측값을 5,000만원 단위로 넓혀서 사용
  const vals = [];
  for (const s of series) for (const v of s.data) if (v !== null) vals.push(v);
  const STEP = 5000;
  const lo = Math.floor(Math.min(...vals) / STEP) * STEP;
  const hi = Math.ceil(Math.max(...vals) / STEP) * STEP;
  const ticks = Math.max(1, Math.round((hi - lo) / STEP));

  // 비교 단지 계열은 우리 단지와 겹치지 않는 별도 색 + 점선·속빈 점으로 구분한다.
  // 우리 단지는 팔레트 앞쪽(파랑·주황), 비교 단지는 초록·분홍부터 쓴다.
  const CMP_COLORS = [COLORS[2], COLORS[4], COLORS[5], COLORS[3]];
  const cmpIdx = series.map((s, i) => (s.compare ? i : -1)).filter((i) => i >= 0);
  const colorOf = (si) => series[si].compare
    ? CMP_COLORS[cmpIdx.indexOf(si) % CMP_COLORS.length]
    : COLORS[si % COLORS.length];
  const shortName = (n) => String(n || "").replace(/^동탄역/, "");
  const nameOf = (s) => (s.compare ? `${shortName(s.complex)} ` : "") + `${s.pyeong}평`;

  const W = 760, H = 300, pad = { l: 56, r: 62, t: 16, b: 44 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (dates.length === 1 ? iw / 2 : (iw * i) / (dates.length - 1));
  const y = (v) => pad.t + ih - (ih * (v - lo)) / (hi - lo);

  const NS = "http://www.w3.org/2000/svg";
  const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const txt = (a, s) => { const t = el("text", a); t.textContent = s; return t; };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", preserveAspectRatio: "xMidYMid meet", role: "img" });

  // y 격자 + 눈금 (억 단위)
  for (let g = 0; g <= ticks; g++) {
    const v = hi - ((hi - lo) * g) / ticks;
    const yy = y(v);
    svg.appendChild(el("line", { x1: pad.l, y1: yy, x2: W - pad.r, y2: yy, stroke: "#2b313c", "stroke-width": 1 }));
    svg.appendChild(txt({ x: pad.l - 8, y: yy + 4, fill: "#9aa3b2", "font-size": 11, "text-anchor": "end" }, (v / 10000).toFixed(1) + "억"));
  }

  // x 라벨 (최대 8개)
  const step = Math.ceil(dates.length / 8);
  dates.forEach((d, i) => {
    if (i % step !== 0 && i !== dates.length - 1) return;
    svg.appendChild(txt({ x: x(i), y: H - pad.b + 18, fill: "#9aa3b2", "font-size": 10, "text-anchor": "middle" }, d.slice(5)));
  });

  // 계열별: 값이 있는 구간만 이어서 그린다(결측에서 끊김) + 관측점 + 마지막 점 직접 라벨
  series.forEach((s, si) => {
    const color = colorOf(si);
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        svg.appendChild(el("polyline", {
          points: run.map((i) => `${x(i)},${y(s.data[i])}`).join(" "),
          fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round",
          ...(s.compare ? { "stroke-dasharray": "6 5" } : {}),
        }));
      }
      run = [];
    };
    dates.forEach((d, i) => { if (s.data[i] === null) flush(); else run.push(i); });
    flush();

    // 관측점 — r=4 (지름 8px) + 배경색 2px 링
    let lastIdx = -1;
    dates.forEach((d, i) => {
      if (s.data[i] === null) return;
      lastIdx = i;
      svg.appendChild(s.compare
        ? el("circle", { cx: x(i), cy: y(s.data[i]), r: 3.5, fill: "#181b22", stroke: color, "stroke-width": 2 })
        : el("circle", { cx: x(i), cy: y(s.data[i]), r: 4, fill: color, stroke: "#181b22", "stroke-width": 2 }));
    });

    // 직접 라벨 (계열 4개 이하이므로 색에만 의존하지 않게 평형을 바로 적는다)
    if (lastIdx >= 0) {
      const ly = Math.min(pad.t + ih - 2, Math.max(pad.t + 10, y(s.data[lastIdx])));
      svg.appendChild(txt({ x: x(lastIdx) + 9, y: ly + 4, fill: "#e7ebf0", "font-size": 11, "font-weight": s.compare ? 400 : 700 }, nameOf(s)));
    }
  });

  // 크로스헤어 + 툴팁
  const hair = el("line", { y1: pad.t, y2: pad.t + ih, stroke: "#5f6b7e", "stroke-width": 1, visibility: "hidden" });
  svg.appendChild(hair);
  const hit = el("rect", { x: pad.l, y: pad.t, width: iw, height: ih, fill: "transparent" });
  svg.appendChild(hit);

  wrap.innerHTML = "";
  wrap.appendChild(svg);
  const tip = document.createElement("div");
  tip.className = "viz-tip";
  tip.hidden = true;
  wrap.appendChild(tip);

  let cur = -1;
  function showAt(i) {
    if (i < 0 || i >= dates.length) return;
    cur = i;
    hair.setAttribute("x1", x(i)); hair.setAttribute("x2", x(i));
    hair.setAttribute("visibility", "visible");

    tip.textContent = "";
    const head = document.createElement("div");
    head.className = "viz-tip-date";
    head.textContent = dates[i];                      // 라벨은 textContent 로만 넣는다
    tip.appendChild(head);
    for (let si = 0; si < series.length; si++) {
      const s = series[si];
      const row = document.createElement("div");
      row.className = "viz-tip-row";
      const key = document.createElement("i");
      key.style.background = s.compare ? `repeating-linear-gradient(90deg, ${colorOf(si)} 0 4px, transparent 4px 6px)` : colorOf(si);
      const val = document.createElement("b");
      val.textContent = s.data[i] === null ? "거래 없음" : fmtMan(s.data[i]);
      const nm = document.createElement("span");
      nm.textContent = nameOf(s) + (s.data[i] !== null && s.counts ? ` · ${s.counts[i]}건` : "");
      row.append(key, val, nm);
      tip.appendChild(row);
    }
    tip.hidden = false;

    // SVG 좌표 → 화면 좌표 (뷰박스가 반응형이라 배율 보정)
    const rect = wrap.getBoundingClientRect();
    const scale = rect.width / W;
    const left = x(i) * scale;
    tip.style.left = Math.max(4, Math.min(rect.width - tip.offsetWidth - 4, left - tip.offsetWidth / 2)) + "px";
    tip.style.top = Math.max(2, pad.t * scale) + "px";
  }
  function hide() { tip.hidden = true; hair.setAttribute("visibility", "hidden"); }
  function nearest(clientX) {
    const rect = wrap.getBoundingClientRect();
    const scale = rect.width / W;
    const ux = (clientX - rect.left) / scale;
    let best = 0, bd = Infinity;
    for (let i = 0; i < dates.length; i++) { const d = Math.abs(x(i) - ux); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  svg.addEventListener("pointermove", (e) => showAt(nearest(e.clientX)));
  svg.addEventListener("pointerleave", hide);
  // 키보드 — 마우스와 같은 정보를 제공
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { showAt(Math.min(dates.length - 1, (cur < 0 ? -1 : cur) + 1)); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { showAt(Math.max(0, (cur < 0 ? dates.length : cur) - 1)); e.preventDefault(); }
    else if (e.key === "Escape") hide();
  });
  wrap.addEventListener("blur", hide);

  // 범례 — 선 차트이므로 선 모양 키를 쓴다
  legend.innerHTML = series
    .map((s, i) => `<span class="lg line"><i style="background:${s.compare ? `repeating-linear-gradient(90deg, ${colorOf(i)} 0 4px, transparent 4px 7px)` : colorOf(i)}"></i>${esc(nameOf(s))}</span>`)
    .join("");

  const win = (rc && rc.days) || 10;
  note.innerHTML =
    `최근 <b>${win}일</b> 실거래 평균가입니다. 그 기간에 거래가 없던 날은 평균을 낼 수 없어 <b>선이 끊깁니다</b> ` +
    `(점이 찍힌 날만 실제 거래가 있었습니다). 세로축은 변동을 보기 위해 0이 아니라 <b>${(lo / 10000).toFixed(1)}억~${(hi / 10000).toFixed(1)}억</b> 구간만 보여줍니다.` +
    (series.some((s) => s.compare)
      ? ` <b>점선·속빈 점</b>은 비교 단지(${esc([...new Set(series.filter((s) => s.compare).map((s) => s.complex))].join(", "))})입니다.`
      : "");

  // 표로 보기 — 호버 없이도 값에 닿을 수 있게
  const obs = dates.map((d, i) => i).filter((i) => series.some((s) => s.data[i] !== null));
  $("real-table").innerHTML =
    `<table><thead><tr><th>날짜</th>` +
    series.map((s) => `<th class="num">${esc(nameOf(s))}</th>`).join("") +
    `</tr></thead><tbody>` +
    obs.slice().reverse().map((i) =>
      `<tr><td>${dates[i]}</td>` +
      series.map((s) => `<td class="num">${s.data[i] === null ? "–" : fmtMan(s.data[i])}</td>`).join("") +
      `</tr>`
    ).join("") +
    `</tbody></table>`;
  tv.hidden = false;
}

function render(state) {
  // 헤더/요약
  $("complexNo").value = state.complexNo || "";
  $("complexName").value = state.complexName || "";
  $("title").textContent = state.complexName || (state.complexNo ? `단지 ${state.complexNo}` : "단지를 설정해 주세요");

  // 표 헤더 날짜
  $("col-prev").textContent = state.prevDate ? `${state.prevDate}` : "이전";
  $("col-today").textContent = state.todayDate ? `${state.todayDate} (오늘)` : "오늘";
  $("dates").textContent =
    state.prevDate && state.todayDate ? `${state.prevDate} → ${state.todayDate}`
    : state.todayDate ? `기준일: ${state.todayDate} (내일부터 증감 표시)`
    : "";

  // 본문
  const tbody = $("tbody");
  tbody.innerHTML = "";
  if (!state.rows || state.rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">아직 데이터가 없습니다. 단지 번호를 넣고 “오늘 매물 갱신”을 눌러주세요.</td></tr>`;
    $("tfoot").hidden = true;
  } else {
    let sp = 0, st = 0;
    for (const r of state.rows) {
      sp += r.prev; st += r.today;
      const d = fmtDelta(r.diff);
      const tr = document.createElement("tr");
      const sub = r.label ? `<span class="sub-label">${r.label}</span>` : "";
      tr.innerHTML =
        `<td><b>${r.pyeong}평</b> ${sub}</td>` +
        `<td class="num">${cntCell(r, "prev")}</td>` +
        `<td class="num">${cntCell(r, "today")}</td>` +
        `<td class="num"><button class="delta-btn ${d.cls}" data-pyeong="${r.pyeong}" data-label="${r.label}" title="매물 목록 보기">${d.txt} <span class="chev">›</span></button></td>` +
        `<td class="num price">${r.avgPrice || "–"}</td>` +
        `<td class="num price real">${r.realPrice ? `${r.realPrice}<span class="real-cnt">최근 ${r.realDays || 10}일 ${r.realCount}건</span>` : "–"}</td>`;
      tbody.appendChild(tr);
    }
    const ds = fmtDelta(st - sp);
    $("sum-prev").textContent = sp || "–";
    $("sum-today").textContent = st || "–";
    $("sum-diff").innerHTML = `<span class="delta ${ds.cls}">${ds.txt}</span>`;
    $("tfoot").hidden = false;
  }

  renderDeals(state.realDeals);

  // 차트
  renderChart(state.chart);
  renderRealChart(state.realChart);

  // 이력
  const h = $("history-list");
  if (!state.history || state.history.length === 0) {
    h.textContent = "기록이 없습니다.";
  } else {
    h.innerHTML = state.history
      .slice().reverse()
      .map((x) => `<div class="h-row"><span>${x.date}</span><span>총 ${x.total}건</span></div>`)
      .join("");
  }
}

// ---------- 실거래 목록 ----------
function renderDeals(rd) {
  const body = $("deals-body"), top = $("deals-today"), dl = $("deals-dates");
  const list = (rd && rd.list) || [];
  dl.textContent = rd && rd.date ? `${rd.date} 수집` : "";
  if (!rd || !rd.date) {
    body.innerHTML = `<tr><td colspan="5" class="empty">실거래 목록은 다음 “오늘 매물 갱신” 때부터 표시됩니다.</td></tr>`;
    top.hidden = true;
    return;
  }
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">최근 60일 실거래가 없습니다.</td></tr>`;
  } else {
    body.innerHTML = list.map((x) => {
      const tags = [
        x.isToday ? `<span class="tag today">오늘 거래</span>` : "",
        x.isNew ? `<span class="tag new">신규 신고</span>` : "",
        x.canceled ? `<span class="tag cancel">해제</span>` : "",
      ].join("");
      const cls = [x.isToday || x.isNew ? "deal-hl" : "", x.canceled ? "deal-cancel" : ""].join(" ").trim();
      return `<tr class="${cls}"><td>${esc(x.date)}</td>` +
        `<td><b>${esc(x.pyeong)}평</b> <span class="sub-label">${esc(x.excl ? `전용 ${x.excl}㎡` : x.label)}</span></td>` +
        `<td class="num">${x.floor ? esc(x.floor) + "층" : "–"}</td>` +
        `<td class="num price real">${esc(x.priceText)}</td>` +
        `<td class="tags">${tags}</td></tr>`;
    }).join("");
  }
  const nToday = list.filter((x) => x.isToday).length;
  const nNew = list.filter((x) => x.isNew).length;
  if (nToday || nNew) {
    top.hidden = false;
    top.innerHTML = [nToday && `오늘(${esc(rd.today)}) 거래 <b>${nToday}건</b>`, nNew && `새로 신고된 실거래 <b>${nNew}건</b>`].filter(Boolean).join(" · ");
  } else {
    top.hidden = false;
    top.className = "deals-today none";
    top.textContent = "오늘 거래·신규 신고된 실거래는 없습니다.";
    return;
  }
  top.className = "deals-today";
}

// ---------- 동탄트램 최신 기사 ----------
function fmtNewsTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderNews(n) {
  const box = $("news-list"), meta = $("news-meta");
  const items = (n && n.items) || [];
  const nToday = items.filter((x) => x.isToday).length;
  meta.textContent = n && n.fetchedAt ? `${nToday ? `오늘 ${nToday}건 · ` : ""}${fmtNewsTime(n.fetchedAt)} 기준` : "";
  if (!items.length) {
    box.innerHTML = `<p class="empty-sm">${n && n.error ? "기사를 불러오지 못했습니다." : "관련 기사가 없습니다."}</p>`;
    return;
  }
  box.innerHTML = (nToday ? "" : `<p class="chg-note">오늘 나온 기사는 없어 최신 기사를 보여줍니다.</p>`) +
    items.map((x) =>
      `<a class="news-item" href="${esc(x.link)}" target="_blank" rel="noopener">` +
      `<div class="news-title">${x.isToday ? `<span class="tag today">오늘</span> ` : ""}${esc(x.title)}</div>` +
      `<div class="news-meta">${esc(x.source)} · ${fmtNewsTime(x.time)}</div></a>`
    ).join("");
}

async function load() {
  render(await api("/api/state"));
  try { renderNews(await api("/api/news")); }
  catch { renderNews(null); }
}

// ---------- 증감 매물 목록 모달 ----------
function fmtConfirm(ymd) {
  if (!ymd || ymd.length < 8) return "";
  return `${ymd.slice(4, 6)}/${ymd.slice(6, 8)} 확인`;
}
// 등록 경과일 — 서버가 계산한 최초 등장일 기준
function ageTag(r) {
  if (r.days == null) return "";
  if (r.beforeStart) return `<span class="age old" title="기록 시작(${esc(r.firstSeen)}) 이전부터 있던 매물">${r.days}일+</span>`;
  if (r.days === 0) return `<span class="age new" title="최초 등장 ${esc(r.firstSeen)}">오늘 등록</span>`;
  return `<span class="age${r.days <= 7 ? " recent" : ""}" title="최초 등장 ${esc(r.firstSeen)}">${r.days}일 경과</span>`;
}
function articleItem(complexNo, r) {
  const url = `https://new.land.naver.com/complexes/${complexNo}?articleNo=${r.no}`;
  const meta = [r.floor && `${r.floor}층`, r.excl && `전용 ${r.excl}㎡`, r.dir, fmtConfirm(r.confirm)]
    .filter(Boolean).join(" · ");
  return (
    `<a class="item" href="${url}" target="_blank" rel="noopener">` +
    `<div class="item-top"><span class="item-price">${r.price || "-"} ${ageTag(r)}</span>` +
    `<span class="item-bldg">${r.bldg || ""}</span></div>` +
    `<div class="item-meta">${meta}</div>` +
    (r.desc ? `<div class="item-desc">${r.desc}</div>` : "") +
    `<div class="item-realtor">${r.realtor || ""}</div></a>`
  );
}
function listBlock(title, cls, items, complexNo, emptyMsg) {
  const body = items.length
    ? items.map((r) => articleItem(complexNo, r)).join("")
    : `<p class="empty-sm">${emptyMsg}</p>`;
  return `<div class="chg-block"><h4 class="${cls}">${title} (${items.length})</h4>${body}</div>`;
}
// 재등록 매물 — 어제 매물(before)이 오늘 같은 동·층·전용으로 새 번호 재등록(after)
function relistedItem(complexNo, pair) {
  const a = pair.after, b = pair.before;
  const url = `https://new.land.naver.com/complexes/${complexNo}?articleNo=${a.no}`;
  const meta = [a.floor && `${a.floor}층`, a.excl && `전용 ${a.excl}㎡`, a.dir, fmtConfirm(a.confirm)]
    .filter(Boolean).join(" · ");
  const price = (b.price && a.price && b.price !== a.price)
    ? `<span class="item-price">${b.price} → ${a.price}</span>`
    : `<span class="item-price">${a.price || "-"}</span>`;
  const age = ageTag(a);
  return (
    `<a class="item relisted" href="${url}" target="_blank" rel="noopener">` +
    `<div class="item-top"><span>${price} ${age}</span><span class="item-bldg">${a.bldg || ""}</span></div>` +
    `<div class="item-meta">${meta}</div>` +
    (a.desc ? `<div class="item-desc">${a.desc}</div>` : "") +
    `<div class="item-realtor">${a.realtor || ""}</div></a>`
  );
}
function relistedBlock(complexNo, pairs) {
  if (!pairs || !pairs.length) return "";
  return `<div class="chg-block"><h4 class="neutral">🔁 재등록 (단순 갱신·거래 아님) (${pairs.length})</h4>` +
    pairs.map((p) => relistedItem(complexNo, p)).join("") + `</div>`;
}
async function openChanges(pyeong, label) {
  const box = $("modal-content");
  box.innerHTML = `<p class="empty-sm">불러오는 중…</p>`;
  $("modal").hidden = false;
  let c;
  try { c = await api(`/api/changes?pyeong=${pyeong}`); }
  catch (e) { box.innerHTML = `<p class="empty-sm">불러오기 실패: ${e.message}</p>`; return; }

  const head = `<h3>${pyeong}평 <span class="sub-label">${label || ""}</span></h3>`;
  const cn = c.complexNo;

  if (c.available) {
    box.innerHTML =
      head +
      `<p class="chg-dates">${c.prevDate} → ${c.todayDate} 변동</p>` +
      `<p class="chg-note">‘사라진 매물(거래 추정)’은 어제 매물 중 오늘 같은 동·층·전용으로 재등록되지 않고 없어진 건이에요. 재등록(단순 갱신)은 아래에 따로 분리했습니다.</p>` +
      listBlock("🟢 사라진 매물 (거래 추정)", "down", c.sold, cn, "거래로 사라진 매물 없음") +
      listBlock("🔴 새로 올라온 매물 (신규)", "up", c.added, cn, "신규 매물 없음") +
      relistedBlock(cn, c.relisted);
  } else if (c.reason === "need-2-days") {
    box.innerHTML =
      head +
      `<p class="chg-note">매물 단위 비교는 2일치 기록이 필요해요. 오늘(${c.todayDate}) 기록됨 → <b>내일부터</b> 추가/사라진 매물이 표시됩니다.</p>` +
      listBlock(`현재 ${pyeong}평 매물 목록`, "neutral", c.current || [], cn, "매물 없음");
  } else {
    box.innerHTML = head + `<p class="empty-sm">아직 매물 기록이 없습니다. “오늘 매물 갱신”을 먼저 눌러주세요.</p>`;
  }
}
// 전일/오늘 건수 클릭 → 그 날짜의 평형별 매물 목록
// /api/changes 가 이미 current(오늘)·prevList(전일)를 함께 주므로 추가 API 없이 재사용한다.
async function openDayList(pyeong, label, which) {
  const box = $("modal-content");
  box.innerHTML = `<p class="empty-sm">불러오는 중…</p>`;
  $("modal").hidden = false;
  let c;
  try { c = await api(`/api/changes?pyeong=${encodeURIComponent(pyeong)}`); }
  catch (e) { box.innerHTML = `<p class="empty-sm">불러오기 실패: ${esc(e.message)}</p>`; return; }

  const isPrev = which === "prev";
  const head = `<h3>${esc(pyeong)}평 <span class="sub-label">${esc(label)}</span></h3>`;
  const cn = c.complexNo;

  // 전일 목록은 2일치 기록이 있어야 만들 수 있다
  if (isPrev && !c.available) {
    box.innerHTML = head + `<p class="chg-note">전일 매물 목록은 2일치 기록이 필요합니다. 아직 비교할 이전 기록이 없습니다.</p>`;
    return;
  }
  const list = isPrev ? (c.prevList || []) : (c.current || []);
  const date = isPrev ? c.prevDate : c.todayDate;
  box.innerHTML =
    head +
    `<p class="chg-dates">${esc(date)} 기준${isPrev ? " (전일)" : " (오늘)"} · 최근 등록순</p>` +
    listBlock(`${isPrev ? "전일" : "오늘"} ${esc(pyeong)}평 매물`, "neutral", list, cn, "이 날짜에 기록된 매물이 없습니다.");
}

function closeModal() { $("modal").hidden = true; }
$("modal").addEventListener("click", (e) => { if (e.target.dataset.close !== undefined) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
$("tbody").addEventListener("click", (e) => {
  const delta = e.target.closest(".delta-btn");
  if (delta) { openChanges(delta.dataset.pyeong, delta.dataset.label); return; }
  const cnt = e.target.closest(".cnt-btn");
  if (cnt) openDayList(cnt.dataset.pyeong, cnt.dataset.label, cnt.dataset.which);
});

$("save-config").addEventListener("click", async () => {
  const state = await api("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ complexNo: $("complexNo").value, complexName: $("complexName").value }),
  });
  render(state);
  setStatus("단지 정보를 저장했습니다.", "ok");
});

$("refresh").addEventListener("click", async () => {
  const btn = $("refresh");
  btn.disabled = true; btn.textContent = "수집 중…";
  setStatus("네이버에서 매매 매물을 가져오는 중입니다…", "info");
  try {
    const r = await api("/api/refresh", { method: "POST" });
    if (r.error) { setStatus(r.error, "error"); }
    else if (r.warning) { setStatus(r.warning, "error"); render(r); }
    else { setStatus(`갱신 완료 — 매매 매물 ${r.fetched}건 수집됨.`, "ok"); render(r); }
  } catch (e) {
    setStatus("요청 실패: " + e.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "📥 오늘 매물 갱신";
  }
});

if (STATIC) {
  // 설정·수집은 PC 서버에서만 — 정적 페이지에서는 숨긴다
  document.querySelector(".setup").style.display = "none";
  $("refresh").style.display = "none";
  load().then(() => {
    const t = staticData && staticData.generatedAt ? new Date(staticData.generatedAt).toLocaleString("ko-KR") : "";
    $("subtitle").textContent = `매매 매물만 집계합니다. 매일 자동 갱신 · 마지막 갱신 ${t}`;
  });
} else {
  load();
}
