import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const MERCHANTS = 1000;
const IDEMPOTENCY = __ENV.IDEMPOTENCY === '1';

function headers() {
  const n = String(Math.floor(Math.random() * MERCHANTS) + 1).padStart(4, '0');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer test_sk_m_load_${n}`,
  };
}

function idempotencyKey() {
  return `${__VU}-${__ITER}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function post(url, body, h, tags) {
  const headers = IDEMPOTENCY ? { ...h, 'Idempotency-Key': idempotencyKey() } : h;
  return http.post(url, JSON.stringify(body), { headers, tags });
}

export function paymentFlow(tags = {}) {
  const h = headers();
  const orderId = `load-${__VU}-${__ITER}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const amount = 10000;

  const created = post(`${BASE}/v1/payments`, {
    orderId, orderName: 'load test', amount, partialCancelable: true,
  }, h, { ...tags, api: 'create' });
  if (!check(created, { 'create 200': (r) => r.status === 200 })) return;
  const paymentKey = created.json('paymentKey');

  const confirmed = post(`${BASE}/v1/payments/confirm`, { paymentKey, orderId, amount }, h,
    { ...tags, api: 'confirm' });
  check(confirmed, { 'confirm 200': (r) => r.status === 200 });

  const got = http.get(`${BASE}/v1/payments/${paymentKey}`, {
    headers: h, tags: { ...tags, api: 'get', name: '/v1/payments/{paymentKey}' },
  });
  check(got, { 'get 200': (r) => r.status === 200 });

  if (confirmed.status === 200 && Math.random() < 0.2) {
    const canceled = post(`${BASE}/v1/payments/${paymentKey}/cancel`, {
      cancelReason: 'load test', cancelAmount: 3000,
    }, h, { ...tags, api: 'cancel', name: '/v1/payments/{paymentKey}/cancel' });
    check(canceled, { 'cancel 200': (r) => r.status === 200 });
  }
}

export function transactionsFlow(tags = {}) {
  const h = headers();
  const end = new Date(Date.now() + 9 * 3600 * 1000);
  const start = new Date(end.getTime() - 3600 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 19);
  const res = http.get(
    `${BASE}/v1/transactions?startDate=${fmt(start)}&endDate=${fmt(end)}&limit=100`,
    { headers: h, tags: { ...tags, api: 'transactions', name: '/v1/transactions' } },
  );
  check(res, { 'transactions 200': (r) => r.status === 200 });
}
