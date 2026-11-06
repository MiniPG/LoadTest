import http from 'k6/http';
import { paymentFlow, transactionsFlow } from '../lib/flows.js';
import { kst, mark, toMillis } from '../lib/annotation.js';

const STEPS = (__ENV.STEPS || '2,5,10,20,40').split(',').map(Number);
const WARMUP = __ENV.WARMUP || '1m';
const RAMP = __ENV.RAMP || '30s';
const HOLD = __ENV.HOLD || '3m';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

function timeline() {
  const windows = [{ step: 'warmup', from: 0, to: toMillis(WARMUP) }];
  let t = toMillis(WARMUP);
  for (const rate of STEPS) {
    windows.push({ step: 'ramp', from: t, to: t + toMillis(RAMP) });
    t += toMillis(RAMP);
    windows.push({ step: String(rate), from: t, to: t + toMillis(HOLD) });
    t += toMillis(HOLD);
  }
  return windows;
}

const WINDOWS = timeline();

function stages() {
  const result = [{ target: STEPS[0], duration: WARMUP }];
  for (const rate of STEPS) {
    result.push({ target: rate, duration: RAMP });
    result.push({ target: rate, duration: HOLD });
  }
  return result;
}

function thresholds() {
  const result = {};
  for (const rate of STEPS) {
    result[`http_req_duration{api:create,step:${rate}}`] = ['p(99)<100'];
    result[`http_req_duration{api:get,step:${rate}}`] = ['p(99)<100'];
    result[`http_req_duration{api:confirm,step:${rate}}`] = ['p(99)<800'];
    result[`http_req_failed{step:${rate}}`] = ['rate<0.005'];
  }
  return result;
}

export const options = {
  scenarios: {
    payment: {
      executor: 'ramping-arrival-rate',
      exec: 'payment',
      startRate: STEPS[0],
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: Number(__ENV.MAX_VUS || 2000),
      stages: stages(),
    },
    transactions: {
      executor: 'ramping-arrival-rate',
      exec: 'transactions',
      startRate: STEPS[0],
      timeUnit: '10s',
      preAllocatedVUs: 5,
      maxVUs: 100,
      stages: stages(),
    },
  },
  thresholds: thresholds(),
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

function stepAt(startedAt) {
  const elapsed = Date.now() - startedAt;
  const w = WINDOWS.find((x) => elapsed >= x.from && elapsed < x.to);
  return w ? w.step : 'end';
}

export function setup() {
  const startedAt = Date.now();
  console.log(`[capacity] 시작: ${kst(startedAt)} (KST), 단계 ${STEPS.join(' → ')}회/s, 단계마다 ${RAMP} 증가 + ${HOLD} 유지`);
  return { startedAt };
}

export function payment({ startedAt }) {
  paymentFlow({ step: stepAt(startedAt) });
}

export function transactions({ startedAt }) {
  transactionsFlow({ step: stepAt(startedAt) });
}

export function teardown({ startedAt }) {
  for (const w of WINDOWS) {
    if (w.step === 'ramp') continue;
    const text = w.step === 'warmup' ? '예열 시작' : `결제 흐름 초당 ${w.step}회 시작`;
    mark('capacity', startedAt + w.from, text);
  }
  mark('capacity', Date.now(), '종료');
}
