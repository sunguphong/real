// 매물 추적기 서버 — 브라우저 창(Playwright)을 띄워 네이버 부동산에서
// 매매 매물을 평형별로 집계하고, 날짜별 스냅샷을 history.json 에 저장합니다.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { fetchSaleAndReal, aggregateByPyeong } = require("./naver");

const ROOT = __dirname;
const HISTORY_FILE = path.join(ROOT, "history.json");
const CONFIG_FILE = path.join(ROOT, "config.json");
const PORT = 5173;

// ---------- 저장소 ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}
function loadHistory() {
  return readJson(HISTORY_FILE, { complexNo: "", complexName: "", snapshots: {} });
}
function loadConfig() {
  return readJson(CONFIG_FILE, { complexNo: "", complexName: "", cookie: "" });
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 화면 표시 시작일 — 이 날짜 이전 집계(추정 백필 구간)는 표/차트/이력에서 숨긴다.
const DISPLAY_START = "2026-06-13";

// 한국식 가격 문자열("5억 7,000") → 만원 단위 숫자
function parsePriceManwon(s) {
  if (!s) return null;
  const str = String(s).replace(/\s/g, "");
  let man = 0;
  const eokM = str.match(/([\d.]+)억/);
  if (eokM) man += parseFloat(eokM[1]) * 10000;
  const restStr = str.replace(/[\d.]+억/, "").replace(/,/g, "");
  const restM = restStr.match(/(\d+)/);
  if (restM) man += parseInt(restM[1], 10);
  return man || null;
}

// 만원 단위 숫자 → "X억 Y,000" 표기 (100만원 단위 반올림)
function fmtPriceManwon(man) {
  if (!man) return "";
  const r = Math.round(man / 100) * 100;
  const eok = Math.floor(r / 10000);
  const rest = r - eok * 10000;
  if (eok && rest) return `${eok}억 ${rest.toLocaleString()}`;
  if (eok) return `${eok}억`;
  return rest.toLocaleString();
}

// 평형별 평균 매물가격(만원) 계산
function avgPriceByPyeong(articles) {
  const sum = {}, n = {};
  for (const r of articles || []) {
    const m = parsePriceManwon(r.price);
    if (!m) continue;
    sum[r.pyeong] = (sum[r.pyeong] || 0) + m;
    n[r.pyeong] = (n[r.pyeong] || 0) + 1;
  }
  const avg = {};
  for (const p in n) avg[p] = sum[p] / n[p];
  return avg;
}

// 네이버 매물 수집 / 평형 집계는 ./naver.js 에서 가져옵니다.

// ---------- 상태 계산 (오늘 vs 직전 스냅샷) ----------
function buildState() {
  const history = loadHistory();
  // DISPLAY_START 이전 날짜(추정 백필 구간)는 표/차트/이력에서 제외
  const dates = Object.keys(history.snapshots).sort().filter((d) => d >= DISPLAY_START); // 오래된→최신
  const todayKey = dates[dates.length - 1] || null;
  const prevKey = dates.length >= 2 ? dates[dates.length - 2] : null;

  const today = todayKey ? history.snapshots[todayKey] : {};
  const prev = prevKey ? history.snapshots[prevKey] : {};

  const labels = history.labels || {};
  // 전체 기간에 등장한 모든 평형
  const allPyeong = new Set();
  for (const d of dates) for (const p of Object.keys(history.snapshots[d])) allPyeong.add(p);
  const pyeongList = [...allPyeong].sort((a, b) => Number(a) - Number(b));

  // 오늘(최신) 수집한 매물 상세에서 평형별 평균가 계산
  const arts = history.articles || {};
  const adates = Object.keys(arts).sort();
  const latestArts = adates.length ? arts[adates[adates.length - 1]] : [];
  const avgPrice = avgPriceByPyeong(latestArts);

  // 최신 실거래 평균가(평형별 { price, count })
  const realMap = history.realAvg || {};
  const rdates = Object.keys(realMap).sort();
  const latestReal = rdates.length ? realMap[rdates[rdates.length - 1]] : {};

  const rows = pyeongList
    .map((p) => {
      const r = latestReal[p];
      return {
        pyeong: Number(p),
        label: labels[p] || "",
        prev: prev[p] || 0,
        today: today[p] || 0,
        diff: (today[p] || 0) - (prev[p] || 0),
        avgPrice: fmtPriceManwon(avgPrice[p]),
        realPrice: r && r.price ? fmtPriceManwon(r.price) : "",
        realCount: r ? r.count : 0,
        realDays: r ? r.days : 10,
        // 실거래 최고가/최저가 (조회 구간 최근 5년) + 거래월
        maxPrice: r && r.max ? fmtPriceManwon(r.max.price) : "",
        maxYm: r && r.max ? r.max.ym : "",
        minPrice: r && r.min ? fmtPriceManwon(r.min.price) : "",
        minYm: r && r.min ? r.min.ym : "",
      };
    });

  // 실거래 가격추이 — realAvg[날짜][평형].price (최근 N일 이동평균, 만원).
  // 창 안에 거래가 없던 날은 price:null 이므로 그대로 null 로 넘겨 그래프에서 선을 끊는다(없는 값을 이어 그리지 않음).
  const realDates = Object.keys(realMap).sort().filter((d) => d >= DISPLAY_START);
  const pick = (d, p) => (realMap[d] && realMap[d][p]) || null;
  const realSeries = pyeongList
    .map((p) => ({
      pyeong: Number(p),
      label: labels[p] || "",
      data: realDates.map((d) => { const e = pick(d, p); return e && typeof e.price === "number" ? Math.round(e.price) : null; }),
      counts: realDates.map((d) => { const e = pick(d, p); return e && typeof e.count === "number" ? e.count : 0; }),
    }))
    .filter((s2) => s2.data.some((v) => v !== null));   // 한 번도 거래가 없던 평형은 뺀다
  // 비교 단지 — 날짜별로 그날까지 최근 10일 거래 평균을 건별 목록에서 계산한다(우리 단지와 같은 방식).
  const compareSeries = [];
  for (const [name, c] of Object.entries(history.compareReal || {})) {
    const byPy = {};
    for (const d of c.deals || []) {
      if (d.canceled) continue;
      (byPy[d.pyeong] = byPy[d.pyeong] || []).push(d);
    }
    for (const py of Object.keys(byPy).sort((a, b) => a - b)) {
      const deals = byPy[py];
      const data = [], counts = [];
      for (const rd of realDates) {
        const from = new Date(Date.parse(rd) - 10 * 86400000).toISOString().slice(0, 10);
        const inWin = deals.filter((x) => x.date >= from && x.date <= rd);
        data.push(inWin.length ? Math.round(inWin.reduce((a, x) => a + x.price, 0) / inWin.length) : null);
        counts.push(inWin.length);
      }
      if (data.some((v) => v !== null)) compareSeries.push({ pyeong: Number(py), complex: name, compare: true, data, counts });
    }
  }

  // 이동평균 창 길이(일) — 최신 기록에서 가져온다
  let realWindow = 10;
  for (let i = realDates.length - 1; i >= 0 && realWindow === 10; i--) {
    for (const p of pyeongList) { const e = pick(realDates[i], p); if (e && e.days) { realWindow = e.days; break; } }
  }

  // 차트용 시계열: 날짜별 평형 매물 수
  const series = pyeongList.map((p) => ({
    pyeong: Number(p),
    label: labels[p] || "",
    data: dates.map((d) => history.snapshots[d][p] || 0),
  }));

  // 실거래 목록 — 최신 수집분. 직전 수집분에 없던 건은 '신규 신고'로 표시한다.
  const dealMap = history.realDeals || {};
  const dk = Object.keys(dealMap).sort();
  const dealKey = (x) => `${x.date}|${x.pyeong}|${x.floor}|${x.price}`;
  const dealPrevSet = dk.length >= 2 ? new Set(dealMap[dk[dk.length - 2]].map(dealKey)) : null;
  const nowStr = todayStr();
  const realDeals = {
    date: dk[dk.length - 1] || null,
    today: nowStr,
    list: (dk.length ? dealMap[dk[dk.length - 1]] : []).map((x) => ({
      ...x,
      label: labels[x.pyeong] || "",
      priceText: fmtPriceManwon(x.price),
      isToday: x.date === nowStr,
      isNew: !!dealPrevSet && !dealPrevSet.has(dealKey(x)),
    })),
  };

  return {
    complexNo: history.complexNo,
    complexName: history.complexName,
    realDeals,
    todayDate: todayKey,
    prevDate: prevKey,
    rows,
    chart: {
      dates,
      estimatedDates: history.estimatedDates || [],
      series,
      totals: dates.map((d) => Object.values(history.snapshots[d]).reduce((s, n) => s + n, 0)),
    },
    realChart: { dates: realDates, series: [...realSeries, ...compareSeries], days: realWindow, mainName: history.complexName || "" },
    history: dates.map((d) => ({
      date: d,
      total: Object.values(history.snapshots[d]).reduce((s, n) => s + n, 0),
    })),
  };
}

// ---------- HTTP ----------
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type + "; charset=utf-8" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function serveStatic(req, res) {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, decodeURIComponent(p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, "Not found", "text/plain");
  }
  const ext = path.extname(file);
  const types = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".png": "image/png" };
  res.writeHead(200, { "Content-Type": (types[ext] || "application/octet-stream") + "; charset=utf-8" });
  fs.createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}

// 원본 매물 → 저장용 간략 레코드
function toRecord(a) {
  return {
    no: String(a.articleNo || ""),
    pyeong: Math.round(parseFloat(a.area1 || 0) / 3.305785),
    excl: Math.round(parseFloat(a.area2 || 0)),
    price: a.dealOrWarrantPrc || "",
    floor: a.floorInfo || "",
    dir: a.direction || "",
    confirm: a.articleConfirmYmd || "",
    desc: a.articleFeatureDesc || "",
    bldg: a.buildingName || "",
    realtor: a.realtorName || "",
  };
}

// ---------- 매물 수집 → 오늘 스냅샷 저장 (수동/자동 공용) ----------
async function doRefresh() {
  const history = loadHistory();
  const cfg = loadConfig();
  const complexNo = history.complexNo || cfg.complexNo;
  if (!complexNo) throw new Error("단지 번호가 설정되지 않았습니다.");
  // 비교 단지 — 실거래 그래프에 함께 그린다. 그래프 시작일(DISPLAY_START)부터 이동평균을 낼 수 있게 넉넉히 가져온다.
  const compares = (cfg.compareComplexes || []).map((c) => ({
    ...c, listDays: dayDiff(DISPLAY_START, todayStr()) + 15,
  }));
  const { articles, realAvg, realDeals, compareReal } = await fetchSaleAndReal(complexNo, compares);
  if (articles.length === 0) {
    return { fetched: 0, warning: "매매 매물이 0건이거나 단지 번호가 올바르지 않을 수 있습니다." };
  }
  const { counts, exclusive } = aggregateByPyeong(articles);
  const today = todayStr();
  history.snapshots[today] = counts; // 같은 날 재갱신 시 덮어씀
  history.labels = history.labels || {};
  for (const p in exclusive) history.labels[p] = `전용 ${exclusive[p]}㎡`;
  // 매물 단위 기록(증감 목록용) — 실제 수집한 날만 저장
  history.articles = history.articles || {};
  history.articles[today] = articles.map(toRecord).filter((r) => r.no && r.pyeong);
  // 실거래 평균가(최근 1년) — 평형별 { price(만원), count }
  history.realAvg = history.realAvg || {};
  history.realAvg[today] = realAvg || {};
  // 실거래 건별 목록(최근 60일) — 수집 실패(null)면 기존 기록을 건드리지 않는다
  if (realDeals) {
    history.realDeals = history.realDeals || {};
    history.realDeals[today] = realDeals;
  }
  // 비교 단지 실거래 — 최신 수집분만 보관(과거 날짜 평균은 건별 목록에서 다시 계산)
  if (compareReal && compareReal.length) {
    history.compareReal = history.compareReal || {};
    for (const c of compareReal) history.compareReal[c.name] = { complexNo: c.complexNo, updated: today, deals: c.deals };
  }
  writeJson(HISTORY_FILE, history);
  return { fetched: articles.length };
}

// 같은 실물 매물을 식별하는 키 — 동·층·전용면적.
// 가격은 재등록 시 바뀔 수 있어 키에서 제외한다.
function unitKey(r) {
  return `${r.bldg || ""}|${r.floor || ""}|${r.excl || ""}`;
}

// 어제 있었으나 오늘 없는 매물(removed)을 오늘 새로 올라온 매물(added)과
// 실물 단위로 대조해 분리한다.
//   added    : 진짜 신규 (어제 같은 실물 없음)
//   sold     : 거래/소멸 추정 (오늘 같은 실물로 재등록되지 않고 사라짐)
//   relisted : 재등록 (같은 동·층·전용이 새 번호로 다시 올라옴 = 거래 아님)
function classifyChanges(prevList, todayList) {
  const prevSet = new Set(prevList.map((r) => r.no));
  const todaySet = new Set(todayList.map((r) => r.no));
  const rawAdded = todayList.filter((r) => !prevSet.has(r.no));
  const rawRemoved = prevList.filter((r) => !todaySet.has(r.no));

  // 신규 매물을 실물키별 큐로 색인해 재등록 짝을 찾는다.
  const addedByKey = new Map();
  for (const a of rawAdded) {
    const k = unitKey(a);
    if (!addedByKey.has(k)) addedByKey.set(k, []);
    addedByKey.get(k).push(a);
  }

  const sold = [], relisted = [];
  for (const r of rawRemoved) {
    const q = addedByKey.get(unitKey(r));
    if (q && q.length) relisted.push({ before: r, after: q.shift() }); // 재등록
    else sold.push(r);                                                 // 거래/소멸 추정
  }
  const matched = new Set(relisted.map((p) => p.after.no));
  const added = rawAdded.filter((a) => !matched.has(a.no));
  return { added, sold, relisted };
}

// 매물별 최초 등장일 — 날짜순으로 훑으며 처음 보인 날을 기록한다.
// 같은 동·층·전용이 새 번호로 재등록된 경우(relisted)는 이전 매물의 최초 등장일을 이어받는다.
function firstSeenMap(arts, adates) {
  const first = new Map();
  let prevList = null;
  for (const d of adates) {
    const list = arts[d] || [];
    const inherit = new Map();
    if (prevList) {
      for (const p of classifyChanges(prevList, list).relisted) {
        if (first.has(p.before.no)) inherit.set(p.after.no, first.get(p.before.no));
      }
    }
    for (const r of list) if (!first.has(r.no)) first.set(r.no, inherit.get(r.no) || d);
    prevList = list;
  }
  return first;
}

function dayDiff(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

// 매물 목록에 등록 경과일을 붙이고 최근 등록순(최초 등장일 → 네이버 확인일 내림차순)으로 정렬
function withAge(list, first, refDate, startDate) {
  return list
    .map((r) => {
      const fs0 = first.get(r.no) || refDate;
      return { ...r, firstSeen: fs0, days: Math.max(0, dayDiff(fs0, refDate)), beforeStart: fs0 === startDate };
    })
    .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || String(b.confirm).localeCompare(String(a.confirm)));
}

// 특정 평형의 어제→오늘 매물 변동 계산
function computeChanges(pyeong) {
  const history = loadHistory();
  const arts = history.articles || {};
  const adates = Object.keys(arts).sort();
  const py = Number(pyeong);
  if (adates.length === 0) return { available: false, reason: "no-data" };

  const todayK = adates[adates.length - 1];
  const prevK = adates.length >= 2 ? adates[adates.length - 2] : null;
  const first = firstSeenMap(arts, adates);
  const todayList = withAge(arts[todayK].filter((r) => r.pyeong === py), first, todayK, adates[0]);

  if (!prevK) {
    // 비교할 이전 매물 기록이 아직 없음 → 현재 목록만 제공
    return { available: false, reason: "need-2-days", todayDate: todayK, pyeong: py, current: todayList };
  }
  const prevList = withAge(arts[prevK].filter((r) => r.pyeong === py), first, prevK, adates[0]);
  const { added, sold, relisted } = classifyChanges(prevList, todayList);
  return { available: true, todayDate: todayK, prevDate: prevK, pyeong: py, added, sold, relisted, current: todayList, prevList };
}

// ---------- Basic Auth ----------
// config.json 의 auth:{user,pass} 가 있으면 모든 요청에 인증을 요구한다.
function loadAuth() {
  const cfg = loadConfig();
  return cfg.auth && cfg.auth.user ? cfg.auth : null;
}
function checkAuth(req) {
  const auth = loadAuth();
  if (!auth) return true; // 인증 미설정 시 통과
  const h = req.headers.authorization || "";
  const m = h.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const idx = Buffer.from(m[1], "base64").toString("utf8").indexOf(":");
  if (idx < 0) return false;
  const u = Buffer.from(m[1], "base64").toString("utf8").slice(0, idx);
  const p = Buffer.from(m[1], "base64").toString("utf8").slice(idx + 1);
  return u === auth.user && p === auth.pass;
}
function requireAuth(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="maemul-tracker", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("인증이 필요합니다.");
}

const server = http.createServer(async (req, res) => {
  // 모든 요청에 Basic Auth 적용 (config.json 에 auth 설정이 있을 때)
  if (!checkAuth(req)) return requireAuth(res);

  const url = req.url.split("?")[0];

  // 현재 상태
  if (url === "/api/state" && req.method === "GET") {
    return send(res, 200, buildState());
  }

  // 특정 평형의 증감 매물 목록
  if (url === "/api/changes" && req.method === "GET") {
    const q = new URLSearchParams(req.url.split("?")[1] || "");
    const pyeong = q.get("pyeong");
    if (!pyeong) return send(res, 400, { error: "pyeong 파라미터가 필요합니다." });
    const history = loadHistory();
    return send(res, 200, { complexNo: history.complexNo, ...computeChanges(pyeong) });
  }

  // 단지 설정 저장
  if (url === "/api/config" && req.method === "POST") {
    const body = await readBody(req);
    const history = loadHistory();
    if (body.complexNo != null) history.complexNo = String(body.complexNo).trim();
    if (body.complexName != null) history.complexName = String(body.complexName).trim();
    writeJson(HISTORY_FILE, history);
    const cfg = loadConfig();
    writeJson(CONFIG_FILE, { ...cfg, complexNo: history.complexNo, complexName: history.complexName });
    return send(res, 200, buildState());
  }

  // 오늘 매물 갱신 (네이버 수집 → 스냅샷 저장)
  if (url === "/api/refresh" && req.method === "POST") {
    try {
      const r = await doRefresh();
      if (r.warning) return send(res, 200, { warning: r.warning, ...buildState() });
      return send(res, 200, { ok: true, fetched: r.fetched, ...buildState() });
    } catch (e) {
      return send(res, 502, { error: "네이버에서 매물을 가져오지 못했습니다: " + e.message });
    }
  }

  return serveStatic(req, res);
});

// ---------- 매일 자동 갱신 ----------
// 서버가 켜져 있으면 매일 REFRESH_HOUR 시 이후 오늘치를 자동 수집한다.
const REFRESH_HOUR = 9; // 오전 9시 이후 자동 수집
let lastAutoYmd = loadHistory().snapshots[todayStr()] ? todayStr() : null;
async function maybeAutoRefresh() {
  const t = todayStr();
  const missing = !loadHistory().snapshots[t];
  const due = lastAutoYmd !== t && new Date().getHours() >= REFRESH_HOUR;
  if (!missing && !due) return;
  try {
    const r = await doRefresh();
    lastAutoYmd = t;
    console.log(`  [자동] ${t} 갱신 완료 — 매매 ${r.fetched ?? 0}건`);
  } catch (e) {
    console.log(`  [자동] ${t} 갱신 실패: ${e.message}`);
  }
}
setTimeout(maybeAutoRefresh, 5000);            // 시작 직후 1회
setInterval(maybeAutoRefresh, 30 * 60 * 1000); // 30분마다 점검

server.listen(PORT, () => {
  console.log(`\n  매물 추적기 실행 중 →  http://localhost:${PORT}`);
  console.log(`  매일 오전 ${REFRESH_HOUR}시 이후 자동 갱신됩니다.\n`);
});
