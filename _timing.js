const { chromium } = require("playwright");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
(async () => {
  let t = Date.now();
  const mark = (s) => { console.log(s, ((Date.now()-t)/1000).toFixed(1)+"s"); t = Date.now(); };
  const browser = await chromium.launch({ headless: false });
  mark("launch");
  const ctx = await browser.newContext({ userAgent: UA, locale: "ko-KR" });
  const page = await ctx.newPage();
  let token = null;
  page.on("request", (req) => { if (!token && req.url().includes("/api/")) { const a = req.headers().authorization; if (a) token = a; } });
  await page.goto("https://new.land.naver.com/complexes/110837", { waitUntil: "domcontentloaded", timeout: 30000 });
  mark("goto");
  for (let i = 0; i < 80 && !token; i++) await page.waitForTimeout(250);
  mark("token");
  const headers = { authorization: token, referer: "https://new.land.naver.com/complexes/110837", "accept-language": "ko-KR,ko;q=0.9" };
  let n = 0;
  for (let p = 1; p <= 60; p++) {
    const res = await ctx.request.get(`https://new.land.naver.com/api/articles/complex/110837?realEstateType=APT%3APRE%3AABYG%3AJGC&tradeType=A1&tag=%3A%3A%3A%3A%3A%3A%3A%3A&rentPriceMin=0&rentPriceMax=900000000&priceMin=0&priceMax=900000000&areaMin=0&areaMax=900000000&showArticle=false&sameAddressGroup=true&priceType=RETAIL&page=${p}&complexNo=110837&order=prc`, { headers });
    const d = await res.json();
    n += (d.articleList||[]).length;
    if (!(d.articleList||[]).length || !d.isMoreData) break;
  }
  mark("listings("+n+")");
  const cRes = await ctx.request.get("https://new.land.naver.com/api/complexes/110837?sameAddressGroup=false", { headers });
  const cJson = await cRes.json();
  const plist = cJson.complexPyeongDetailList || [];
  mark("complexInfo(types:"+plist.length+")");
  for (const pt of plist) {
    if (!pt.pyeongNo) continue;
    await ctx.request.get(`https://new.land.naver.com/api/complexes/110837/prices/real?complexNo=110837&tradeType=A1&year=5&priceChartChange=false&areaNo=${pt.pyeongNo}&type=table`, { headers });
  }
  mark("realPrices");
  await browser.close();
  mark("close");
})();
