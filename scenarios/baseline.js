import http from 'k6/http';
import { check } from 'k6';
import { annotate, kst, toMillis } from '../lib/annotation.js';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const MERCHANTS = 1000;
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

function headers() {
  const n = String(Math.floor(Math.random() * MERCHANTS) + 1).padStart(4, '0');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer test_sk_m_load_${n}`,
  };
}

function post(url, body, h, api) {
  return http.post(url, JSON.stringify(body), { headers: h, tags: { api } });
}

export function payment() {
  const h = headers();
  const orderId = `load-${__VU}-${__ITER}-${Date.now()}`;
  const amount = 10000;

  const created = post(`${BASE}/v1/payments`, {
    orderId, orderName: 'load test', amount, partialCancelable: true,
  }, h, 'create');
  if (!check(created, { 'create 200': (r) => r.status === 200 })) return;
  const paymentKey = created.json('paymentKey');

  const confirmed = post(`${BASE}/v1/payments/confirm`, { paymentKey, orderId, amount }, h, 'confirm');
  check(confirmed, { 'confirm 200': (r) => r.status === 200 });

  const got = http.get(`${BASE}/v1/payments/${paymentKey}`, { headers: h, tags: { api: 'get' } });
  check(got, { 'get 200': (r) => r.status === 200 });

  if (confirmed.status === 200 && Math.random() < 0.2) {
    const canceled = post(`${BASE}/v1/payments/${paymentKey}/cancel`, {
      cancelReason: 'load test', cancelAmount: 3000,
    }, h, 'cancel');
    check(canceled, { 'cancel 200': (r) => r.status === 200 });
  }
}

export function transactions() {
  const h = headers();
  const end = new Date(Date.now() + 9 * 3600 * 1000);
  const start = new Date(end.getTime() - 3600 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 19);
  const res = http.get(
    `${BASE}/v1/transactions?startDate=${fmt(start)}&endDate=${fmt(end)}&limit=100`,
    { headers: h, tags: { api: 'transactions' } },
  );
  check(res, { 'transactions 200': (r) => r.status === 200 });
}
