import http from 'k6/http';
import encoding from 'k6/encoding';

const GRAFANA_URL = __ENV.GRAFANA_URL;
const GRAFANA_USER = __ENV.GRAFANA_USER || 'admin';
const GRAFANA_PASSWORD = __ENV.GRAFANA_PASSWORD;

export function toMillis(duration) {
  const units = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  const match = /^(\d+)(ms|s|m|h)$/.exec(duration);
  if (!match) throw new Error(`지원하지 않는 시간 형식입니다: ${duration}`);
  return Number(match[1]) * units[match[2]];
}

export function kst(millis) {
  return new Date(millis + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}

export function annotate(name, from, to, text) {
  console.log(`[${name}] ${text}: ${kst(from)} ~ ${kst(to)} (KST)`);
  if (!GRAFANA_URL || !GRAFANA_PASSWORD) return;

  const res = http.post(`${GRAFANA_URL}/api/annotations`, JSON.stringify({
    time: from,
    timeEnd: to,
    tags: ['k6', name],
    text: `${name} ${text}`,
  }), {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${encoding.b64encode(`${GRAFANA_USER}:${GRAFANA_PASSWORD}`)}`,
    },
    tags: { api: 'grafana' },
  });
  if (res.status !== 200) console.warn(`Grafana 주석 등록 실패: ${res.status} ${res.body}`);
}
