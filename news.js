// 주제별 최신 기사(동탄트램 / GTX-C 병점역) — Google 뉴스 RSS 검색 결과를 최신순으로 정리한다.
const TOPICS = {
  tram: '동탄트램 OR "동탄 트램"',
  gtx: '"GTX-C" 병점 OR "GTX C" 병점역',
};
// 분양·홍보성 기사 제외 — 분양 용어, '공급', 아파트 브랜드명(단지명 끝)이 제목에 있으면 광고로 본다.
const AD_RE = /분양|선착순|견본주택|모델하우스|잔여\s?세대|동·호|청약|계약\s?진행|홍보관|입주자\s?모집|수혜\s?(아파트|단지)|공급|(자이|힐스테이트|푸르지오|래미안|e편한세상|아이파크|롯데캐슬|더샵|하늘채|써밋|센트레빌|그웬\s?\d*)(?=[’'"”\s,…·]|$)/i;
const rssUrl = (q) => "https://news.google.com/rss/search?hl=ko&gl=KR&ceid=KR:ko&q=" + encodeURIComponent(q);

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
}

// KST 기준 YYYY-MM-DD
function kstDate(ms) {
  return new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
}

async function fetchNews(topic, limit = 10) {
  const res = await fetch(rssUrl(TOPICS[topic]), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`뉴스 응답 오류: HTTP ${res.status}`);
  const xml = await res.text();
  const today = kstDate(Date.now());
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const source = tag(it, "source");
    let title = tag(it, "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)); // 제목 뒤 언론사명 제거
    const ms = Date.parse(tag(it, "pubDate"));
    if (!title || !ms || AD_RE.test(title)) continue;
    items.push({ title, link: tag(it, "link"), source, time: new Date(ms).toISOString(), isToday: kstDate(ms) === today });
  }
  items.sort((a, b) => b.time.localeCompare(a.time));
  return { fetchedAt: new Date().toISOString(), today, items: items.slice(0, limit) };
}

module.exports = { fetchNews, TOPICS };
