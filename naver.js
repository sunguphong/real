// 브라우저 창을 띄워 네이버 부동산에서 매매 매물을 수집한다.
// 네이버가 자동 생성하는 토큰을 가로채 같은 세션으로 페이지네이션한다.
// 토큰을 손으로 복사할 필요가 없다.
const { chromium } = require("playwright");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const PYEONG = 3.305785;

function articlesUrl(complexNo, page) {
  return (
    `https://new.land.naver.com/api/articles/complex/${encodeURIComponent(complexNo)}` +
    `?realEstateType=APT%3APRE%3AABYG%3AJGC&tradeType=A1&tag=%3A%3A%3A%3A%3A%3A%3A%3A` +
    `&rentPriceMin=0&rentPriceMax=900000000&priceMin=0&priceMax=900000000` +
    `&areaMin=0&areaMax=900000000&showArticle=false&sameAddressGroup=true` +
    `&priceType=RETAIL&page=${page}&complexNo=${encodeURIComponent(complexNo)}&order=prc`
  );
}

// 브라우저를 띄워 네이버 인증 토큰을 확보하고, 콜백에 (ctx, headers)를 넘긴다.
async function withSession(complexNo, fn) {
  const browser = await chromium.launch({ headless: false });
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
    const page = await ctx.newPage();

    // 페이지가 자동 발급하는 토큰을 가로챈다
    let token = null;
    page.on("request", (req) => {
      if (!token && req.url().includes("/api/")) {
        const a = req.headers().authorization;
        if (a) token = a;
      }
    });

    // 토큰(첫 /api/ 요청의 authorization 헤더)만 잡히면 바로 진행한다.
    // networkidle 대기는 지도 타일 로딩 때문에 수 초~수십 초를 낭비한다.
    await page.goto(`https://new.land.naver.com/complexes/${complexNo}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    for (let i = 0; i < 80 && !token; i++) await page.waitForTimeout(250);
    if (!token) throw new Error("네이버 인증 토큰을 가져오지 못했습니다.");

    const headers = {
      authorization: token,
      referer: `https://new.land.naver.com/complexes/${complexNo}`,
      "accept-language": "ko-KR,ko;q=0.9",
    };
    return await fn(ctx, headers);
  } finally {
    await browser.close();
  }
}

// 매매(A1) 매물 전체를 한 세션에서 수집해 배열로 반환
async function fetchListings(ctx, headers, complexNo) {
  const all = [];
  const MAX_PAGES = 60;
  for (let p = 1; p <= MAX_PAGES; p++) {
    const res = await ctx.request.get(articlesUrl(complexNo, p), { headers });
    if (!res.ok()) throw new Error(`네이버 응답 오류: HTTP ${res.status()}`);
    const data = await res.json();
    const list = (data && data.articleList) || [];
    if (list.length === 0) break;
    for (const a of list) {
      const trad = a.tradeTypeName || a.tradeTypeCode;
      if (trad && !/매매|A1/.test(trad)) continue; // 매매만
      all.push(a);
    }
    if (!data.isMoreData) break;
  }
  return all;
}

// 실거래 평균가 — 평형타입(areaNo)별 실거래 중 '조회일 기준 최근 days일' 거래만
// 평형으로 묶어 평균(만원) 계산. 네이버 prices/real(type=table)은 최신순으로
// 거래를 주므로, 반환된 데이터에서 최근 days일 구간만 추려도 충분하다.
// 함께, 조회 구간(최근 5년) 전체에서 평형별 최고가/최저가와 그 거래월도 계산한다.
// 함께, 거래일 기준 최근 listDays일 실거래를 건별 목록(deals)으로 반환한다.
async function fetchRealAvgByPyeong(ctx, headers, complexNo, days = 10, listDays = 60) {
  // 단지의 평형타입 목록(pyeongNo + 공급면적) 확보
  const cRes = await ctx.request.get(
    `https://new.land.naver.com/api/complexes/${complexNo}?sameAddressGroup=false`,
    { headers }
  );
  if (!cRes.ok()) return { avg: {}, deals: [] };
  const cJson = await cRes.json();
  const plist = cJson.complexPyeongDetailList || [];

  // 기준일(cutoff) = 오늘 - days일 → YYYYMMDD 숫자 (이 값 이상만 집계)
  const cd = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const cutoff = cd.getFullYear() * 10000 + (cd.getMonth() + 1) * 100 + cd.getDate();
  const ld = new Date(Date.now() - listDays * 24 * 60 * 60 * 1000);
  const listCutoff = ld.getFullYear() * 10000 + (ld.getMonth() + 1) * 100 + ld.getDate();
  const deals = []; // 최근 listDays일 실거래 건별 목록

  const agg = {}; // pyeong -> { sum, n, max, min }
  for (const pt of plist) {
    const supply = parseFloat(pt.supplyArea || pt.supplyAreaDouble || 0);
    if (!supply) continue;
    const pyeong = Math.round(supply / PYEONG);
    const excl = Math.round(parseFloat(pt.exclusiveArea || 0)) || null;
    const areaNo = pt.pyeongNo;
    if (!areaNo) continue;

    const url =
      `https://new.land.naver.com/api/complexes/${complexNo}/prices/real` +
      `?complexNo=${complexNo}&tradeType=A1&year=5&priceChartChange=false&areaNo=${areaNo}&type=table`;
    const rRes = await ctx.request.get(url, { headers });
    if (!rRes.ok()) continue;
    const rj = await rRes.json();

    const seen = new Set(); // 같은 거래 중복 제거
    for (const mon of rj.realPriceOnMonthList || []) {
      for (const t of mon.realPriceList || []) {
        if (t.tradeType && t.tradeType !== "A1") continue; // 매매만
        const price = Number(t.dealPrice);
        if (!price) continue;
        const key = `${t.tradeYear}-${t.tradeMonth}-${t.tradeDate}-${t.floor}-${price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = (agg[pyeong] = agg[pyeong] || { sum: 0, n: 0, max: null, min: null });
        // 최고가/최저가는 조회 구간(최근 5년) 전체 거래 기준
        const ym = `${t.tradeYear}.${String(t.tradeMonth).padStart(2, "0")}`;
        if (!a.max || price > a.max.price) a.max = { price, ym };
        if (!a.min || price < a.min.price) a.min = { price, ym };
        const ymd = Number(t.tradeYear) * 10000 + Number(t.tradeMonth) * 100 + Number(t.tradeDate);
        if (ymd >= listCutoff) {
          const p2 = (n) => String(n).padStart(2, "0");
          deals.push({
            date: `${t.tradeYear}-${p2(t.tradeMonth)}-${p2(t.tradeDate)}`,
            pyeong, excl, floor: t.floor != null ? String(t.floor) : "", price,
            canceled: t.deleteYn === true || t.deleteYn === "Y",
          });
        }
        if (ymd < cutoff) continue; // 평균은 조회일 기준 최근 days일 거래만
        a.sum += price;
        a.n += 1;
      }
    }
  }

  const avg = {};
  for (const p in agg) {
    const a = agg[p];
    avg[p] = { price: a.n ? a.sum / a.n : null, count: a.n, days, max: a.max, min: a.min };
  }
  deals.sort((a, b) => b.date.localeCompare(a.date) || b.price - a.price);
  return { avg, deals };
}

// 비교 단지 실거래 — 단지별 실거래 건별 목록을 listDays일치 가져온다.
async function fetchCompareReal(ctx, headers, compares) {
  const out = [];
  for (const c of compares || []) {
    if (!c.complexNo) continue;
    try {
      const { deals } = await fetchRealAvgByPyeong(ctx, headers, c.complexNo, 10, c.listDays || 150);
      out.push({ name: c.name, complexNo: String(c.complexNo), deals });
    } catch (e) {
      console.log(`  [비교] ${c.name} 수집 실패:`, e.message);
    }
  }
  return out;
}

// 한 세션에서 매물 + 실거래 평균/목록(+비교 단지 실거래)을 함께 수집
async function fetchSaleAndReal(complexNo, compares = []) {
  return withSession(complexNo, async (ctx, headers) => {
    const articles = await fetchListings(ctx, headers, complexNo);
    let realAvg = {}, realDeals = null;
    try {
      ({ avg: realAvg, deals: realDeals } = await fetchRealAvgByPyeong(ctx, headers, complexNo));
    } catch (e) {
      // 실거래 수집 실패는 매물 수집을 막지 않는다(선택 정보)
      console.log("  [실거래] 수집 실패:", e.message);
    }
    const compareReal = await fetchCompareReal(ctx, headers, compares);
    return { articles, realAvg, realDeals, compareReal };
  });
}

// 매매(A1) 매물만 수집해 배열 반환 (backfill 등에서 사용)
async function fetchSaleListings(complexNo) {
  return withSession(complexNo, (ctx, headers) => fetchListings(ctx, headers, complexNo));
}

// 공급면적(area1) 기준으로 평형 그룹핑.
// 네이버 표기와 동일하게 평형 = round(공급면적/3.3058). 전용면적도 함께 집계해 라벨에 사용.
// 반환: { counts: { "33": 112 }, exclusive: { "33": 84 } }
function aggregateByPyeong(articles) {
  const counts = {}, exSum = {}, exN = {};
  for (const a of articles) {
    const supply = parseFloat(a.area1 || 0);
    const excl = parseFloat(a.area2 || 0);
    if (!supply) continue;
    const p = Math.round(supply / PYEONG);
    counts[p] = (counts[p] || 0) + 1;
    if (excl) { exSum[p] = (exSum[p] || 0) + excl; exN[p] = (exN[p] || 0) + 1; }
  }
  const exclusive = {};
  for (const p in exN) exclusive[p] = Math.round(exSum[p] / exN[p]);
  return { counts, exclusive };
}

module.exports = { fetchSaleListings, fetchSaleAndReal, aggregateByPyeong };
