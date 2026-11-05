import http from 'k6/http';
import { paymentFlow, transactionsFlow } from '../lib/flows.js';
import { annotate, kst, toMillis } from '../lib/annotation.js';

const WARMUP = __ENV.WARMUP || '1m';
const DURATION = __ENV.DURATION || '10m';
const RATE = Number(__ENV.RATE || 2);

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-arrival-rate',
      exec: 'payment',
      rate: RATE,
      timeUnit: '1s',
      duration: WARMUP,
      preAllocatedVUs: 20,
      maxVUs: 200,
    },
    payment: {
      executor: 'constant-arrival-rate',
      exec: 'payment',
      rate: RATE,
      timeUnit: '1s',
      startTime: WARMUP,
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 200,
    },
    transactions: {
      executor: 'constant-arrival-rate',
      exec: 'transactions',
      rate: 1,
      timeUnit: '5s',
      startTime: WARMUP,
      duration: DURATION,
      preAllocatedVUs: 2,
      maxVUs: 20,
    },
  },
  thresholds: {
    'http_req_duration{scenario:payment,api:create}': ['p(99)<100'],
    'http_req_duration{scenario:payment,api:get}': ['p(99)<100'],
    'http_req_duration{scenario:transactions,api:transactions}': ['p(99)<200'],
    'http_req_duration{scenario:payment,api:confirm}': ['p(99)<800'],
    'http_req_duration{scenario:payment,api:cancel}': ['p(99)<800'],
    'http_req_failed{scenario:payment,api:create}': ['rate<0.001'],
    'http_req_failed{scenario:payment,api:get}': ['rate<0.001'],
    'http_req_failed{scenario:transactions,api:transactions}': ['rate<0.001'],
    'http_req_failed{scenario:payment,api:confirm}': ['rate<0.005'],
    'http_req_failed{scenario:payment,api:cancel}': ['rate<0.005'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const startedAt = Date.now();
  console.log(`[baseline] 시작: ${kst(startedAt)} (KST), 예열 ${WARMUP}, 측정 ${DURATION}`);
  return { startedAt };
}

export function teardown({ startedAt }) {
  const measuredFrom = startedAt + toMillis(WARMUP);
  annotate('baseline', startedAt, measuredFrom, '예열');
  annotate('baseline', measuredFrom, Date.now(), `측정 (결제 흐름 초당 ${RATE}회)`);
}

export function payment() {
  paymentFlow();
}

export function transactions() {
  transactionsFlow();
}
