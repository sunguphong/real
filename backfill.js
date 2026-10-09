// 6월 1일 ~ 오늘 구간을 "현재 매물의 등록(확인)일" 기준으로 추정 백필한다.
// 주의: 그 사이 팔리거나 내려간 매물은 알 수 없으므로 실제보다 낮을 수 있는 '추정치'.
// 오늘 날짜는 실제 수집값으로 둔다(추정 아님).
const fs = require("fs");
const path = require("path");
const { fetchSaleListings } = require("./naver");

const PYEONG = 3.305785;
const HISTORY_FILE = path.join(__dirname, "history.json");
const COMPLEX_NO = "110837";
const START = "2026-06-01"; // 백필 시작일

function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseYmd(s) { return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); }

(async () => {
  console.log("매물 수집 중…");
  const arts = await fetchSaleListings(COMPLEX_NO);
  console.log("현재 매매 매물:", arts.length, "건");

  // 각 매물: 평형 + 등록일(Date)
  const items = arts
    .map((a) => ({
      pyeong: Math.round(parseFloat(a.area1 || 0) / PYEONG),
      excl: Math.round(parseFloat(a.area2 || 0)),
      confirm: a.articleConfirmYmd ? parseYmd(a.articleConfirmYmd) : null,
    }))
    .filter((x) => x.pyeong && x.confirm);

  const labels = {};
  for (const it of items) labels[it.pyeong] = `전용 ${it.excl}㎡`;

  // 날짜 범위: START ~ 오늘
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = parseYmd(START.replace(/-/g, ""));

  const snapshots = {};
  const estimatedDates = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = ymd(d);
    const counts = {};
    for (const it of items) {
      if (it.confirm <= d) counts[it.pyeong] = (counts[it.pyeong] || 0) + 1;
    }
    snapshots[key] = counts;
    if (key !== ymd(today)) estimatedDates.push(key); // 오늘만 실제값
  }

  // 오늘은 방금 수집한 실제값(묶기 ON)이므로 그대로 둔다 (보존 로직 제거).
  // 오늘자 매물 상세도 저장해 증감 목록(모달)에서 쓰도록 한다.
  const todayRecords = arts
    .map((a) => ({
      no: String(a.articleNo || ""),
      pyeong: Math.round(parseFloat(a.area1 || 0) / PYEONG),
      excl: Math.round(parseFloat(a.area2 || 0)),
      price: a.dealOrWarrantPrc || "",
      floor: a.floorInfo || "",
      dir: a.direction || "",
      confirm: a.articleConfirmYmd || "",
      desc: a.articleFeatureDesc || "",
      bldg: a.buildingName || "",
      realtor: a.realtorName || "",
    }))
    .filter((r) => r.no && r.pyeong);

  const history = {
    complexNo: COMPLEX_NO,
    complexName: "동탄역포레너스",
    labels,
    estimatedDates,
    snapshots,
    articles: { [ymd(today)]: todayRecords },
  };
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
  console.log("백필 완료:", Object.keys(snapshots).length, "일치 기록");
  console.log("추정 구간:", estimatedDates.length, "일 / 실제:", ymd(today));
})().catch((e) => console.log("ERR", e.message));
