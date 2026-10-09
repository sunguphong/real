// 동탄트램 관련 최신 기사 — Google 뉴스 RSS 검색 결과를 최신순으로 정리한다.
const QUERY = '동탄트램 OR "동탄 트램"';
const RSS_URL =
  "https://news.google.com/rss/search?hl=ko&gl=KR&ceid=KR:ko&q=" + encodeURIComponent(QUERY);

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

async function fetchTramNews(limit = 10) {
  const res = await fetch(RSS_URL, { signal: AbortSignal.timeout(15000) });
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
    if (!title || !ms) continue;
    items.push({ title, link: tag(it, "link"), source, time: new Date(ms).toISOString(), isToday: kstDate(ms) === today });
  }
  items.sort((a, b) => b.time.localeCompare(a.time));
  return { fetchedAt: new Date().toISOString(), today, items: items.slice(0, limit) };
}

module.exports = { fetchTramNews };
