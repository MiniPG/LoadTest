import http from 'k6/http';
import { paymentFlow, transactionsFlow } from '../lib/flows.js';
import { kst, mark, toMillis } from '../lib/annotation.js';

const RATE = Number(__ENV.RATE || 200);
const WARMUP_RATE = Number(__ENV.WARMUP_RATE || 40);
const WARMUP = __ENV.WARMUP || '3m';
const RAMP = __ENV.RAMP || '30s';

export const PHASES = [
  { name: 'normal', duration: '2m' },
  { name: 'slow', duration: '1m' },
  { name: 'recover-slow', duration: '2m' },
  { name: 'hang', duration: '1m' },
  { name: 'recover-hang', duration: '3m' },
  { name: 'fail', duration: '1m' },
  { name: 'recover-fail', duration: '2m' },
];

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

function timeline() {
  const windows = [
    { name: 'warmup', from: 0, to: toMillis(WARMUP) },
    { name: 'ramp', from: toMillis(WARMUP), to: toMillis(WARMUP) + toMillis(RAMP) },
  ];
  let t = toMillis(WARMUP) + toMillis(RAMP);
  for (const p of PHASES) {
    windows.push({ name: p.name, from: t, to: t + toMillis(p.duration) });
    t += toMillis(p.duration);
  }
  return windows;
}

const WINDOWS = timeline();
const HOLD_MILLIS = WINDOWS[WINDOWS.length - 1].to - WINDOWS[2].from;

function thresholds() {
  const result = {};
  for (const p of PHASES) {
    for (const api of ['create', 'confirm', 'get', 'transactions']) {
      result[`http_req_duration{api:${api},phase:${p.name}}`] = ['p(99)<100000'];
      result[`http_req_failed{api:${api},phase:${p.name}}`] = ['rate<1.01'];
    }
    for (const api of ['create', 'get']) {
      for (const part of ['blocked', 'connecting', 'tls_handshaking', 'waiting']) {
        result[`http_req_${part}{api:${api},phase:${p.name}}`] = ['p(99)<100000'];
      }
    }
  }
  return result;
}

const stages = [
  { target: WARMUP_RATE, duration: WARMUP },
  { target: RATE, duration: RAMP },
  { target: RATE, duration: `${HOLD_MILLIS / 1000}s` },
];

export const options = {
  scenarios: {
    payment: {
      executor: 'ramping-arrival-rate',
      exec: 'payment',
      startRate: WARMUP_RATE,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: Number(__ENV.MAX_VUS || 3000),
      stages,
    },
    transactions: {
      executor: 'ramping-arrival-rate',
      exec: 'transactions',
      startRate: WARMUP_RATE,
      timeUnit: '10s',
      preAllocatedVUs: 5,
      maxVUs: 200,
      stages,
    },
  },
  thresholds: thresholds(),
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

function phaseAt(startedAt) {
  const elapsed = Date.now() - startedAt;
  const w = WINDOWS.find((x) => elapsed >= x.from && elapsed < x.to);
  return w ? w.name : 'end';
}

export function setup() {
  const startedAt = Date.now();
  console.log(`[card-fault] 시작: ${kst(startedAt)} (KST), 예열 ${WARMUP_RATE}회/s ${WARMUP} → ${RATE}회/s 유지`);
  for (const w of WINDOWS) {
    console.log(`[card-fault] ${w.name}: 시작 후 ${w.from / 1000}초 (${kst(startedAt + w.from)})`);
  }
  return { startedAt };
}

export function payment({ startedAt }) {
  paymentFlow({ phase: phaseAt(startedAt) });
}

export function transactions({ startedAt }) {
  transactionsFlow({ phase: phaseAt(startedAt) });
}

export function teardown({ startedAt }) {
  for (const w of WINDOWS) {
    mark('card-fault', startedAt + w.from, w.name);
  }
  mark('card-fault', Date.now(), '종료');
}
