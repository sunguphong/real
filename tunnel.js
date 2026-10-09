// localtunnel 로 로컬 서버(5173)를 고정 주소로 외부에 공개한다.
// 끊기면 자동으로 재연결한다. 주소: https://<SUBDOMAIN>.loca.lt
const fs = require("fs");
const path = require("path");
const localtunnel = require("localtunnel");

const PORT = 5173;
const SUBDOMAIN = process.env.LT_SUBDOMAIN || "dongtan-forenus";
const LOG_FILE = path.join(__dirname, "tunnel.log");

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(m) {
  const line = `[${ts()}] ${m}`;
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
  console.log(line);
}

process.on("uncaughtException", (e) => { log("uncaughtException: " + (e && e.stack || e)); });
process.on("unhandledRejection", (e) => { log("unhandledRejection: " + (e && e.stack || e)); });

let tunnel = null;
let retry = 0;
let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(30000, 2000 * Math.pow(2, retry++)); // 2s→4s→…최대 30s
  log(`재연결 예약: ${Math.round(delay / 1000)}초 후`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; start(); }, delay);
}

async function start() {
  try {
    log(`연결 시도 (subdomain=${SUBDOMAIN}, port=${PORT})`);
    tunnel = await localtunnel({ port: PORT, subdomain: SUBDOMAIN });
    retry = 0;
    log(`터널 연결됨 → ${tunnel.url}`);
    if (tunnel.url !== `https://${SUBDOMAIN}.loca.lt`) {
      log(`⚠ 원하던 주소(${SUBDOMAIN})를 못 받아 임시 주소가 발급됨: ${tunnel.url}`);
    }
    tunnel.on("close", () => { log("터널 종료됨"); scheduleReconnect(); });
    tunnel.on("error", (e) => { log("터널 오류: " + e.message); try { tunnel.close(); } catch {} scheduleReconnect(); });
  } catch (e) {
    log("연결 실패: " + e.message);
    scheduleReconnect();
  }
}

log("tunnel.js 시작");
start();
// 이벤트 루프 유지용 (연결이 끊겨 재연결 대기 중에도 프로세스가 살아있도록)
setInterval(() => {}, 1 << 30);
