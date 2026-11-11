import http from 'k6/http';
import { paymentFlow, transactionsFlow } from '../lib/flows.js';
import { kst, mark, toMillis } from '../lib/annotation.js';

const BASE = Number(__ENV.BASE || 40);
const SPIKES = (__ENV.SPIKES || '400,800').split(',').map(Number);
const WARMUP = __ENV.WARMUP || '3m';
const SPIKE = __ENV.SPIKE || '1m';
const RECOVER = __ENV.RECOVER || '3m';
const JUMP = '1s';

function phases() {
  const list = [{ name: 'warmup', rate: BASE, duration: WARMUP }, { name: 'base', rate: BASE, duration: '2m' }];
  for (const s of SPIKES) {
    list.push({ name: `spike-${s}`, rate: s, duration: SPIKE });
    list.push({ name: `recover-${s}`, rate: BASE, duration: RECOVER });
  }
  return list;
}

export const PHASES = phases();

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

function timeline() {
  let t = 0;
  return PHASES.map((p) => {
    const w = { name: p.name, from: t, to: t + toMillis(p.duration) };
    t = w.to;
    return w;
  });
}

const WINDOWS = timeline();

function stages(scale) {
  const result = [];
  for (const p of PHASES) {
    const rest = toMillis(p.duration) - toMillis(JUMP);
    result.push({ target: p.rate * scale, duration: JUMP });
    result.push({ target: p.rate * scale, duration: `${rest / 1000}s` });
  }
  return result;
}

function thresholds() {
  const result = {};
  for (const p of PHASES) {
    for (const api of ['create', 'confirm', 'get', 'cancel', 'transactions']) {
      result[`http_req_duration{api:${api},phase:${p.name}}`] = ['p(99)<100000'];
      result[`http_req_failed{api:${api},phase:${p.name}}`] = ['rate<1.01'];
    }
  }
  return result;
}

export const options = {
  scenarios: {
    payment: {
      executor: 'ramping-arrival-rate',
      exec: 'payment',
      startRate: BASE,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: Number(__ENV.MAX_VUS || 3000),
      stages: stages(1),
    },
    transactions: {
      executor: 'ramping-arrival-rate',
      exec: 'transactions',
      startRate: BASE,
      timeUnit: '10s',
      preAllocatedVUs: 5,
      maxVUs: 300,
      stages: stages(1),
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
  console.log(`[spike] 시작: ${kst(startedAt)} (KST), 평소 ${BASE}회/s, 순간 ${SPIKES.join(', ')}회/s를 ${SPIKE}씩`);
  for (const w of WINDOWS) {
    console.log(`[spike] ${w.name}: 시작 후 ${w.from / 1000}초 (${kst(startedAt + w.from)})`);
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
    mark('spike', startedAt + w.from, w.name);
  }
  mark('spike', Date.now(), '종료');
}
