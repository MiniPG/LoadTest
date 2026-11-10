-- 실시간 대사 스케줄러가 처리할 대상을 만든다: 카드사 응답을 받지 못해 결과를 모르는 승인 1,000건
-- 결제는 APPROVING, 승인 거래는 REQUESTED이고, 거래 시각을 1시간 전으로 둬 10초 기준을 넘긴 상태
-- 카드사에는 이 거래가 없으므로, 대사가 망취소를 보내면 카드사가 무효 기록(REVERSED)을 남기고 결제는 ABORTED가 된다
-- 사용 (Infra 레포 루트에서): ./scripts/seed-pg-merchants.sh ../LoadTest/seeds/unresolved-approvals.sql
-- 가맹점 시드(m_load_0001 ~ m_load_1000)가 먼저 들어가 있어야 한다

SET SESSION cte_max_recursion_depth = 1000;

INSERT INTO payment (payment_key, order_id, order_name, m_id, total_amount, balance_amount,
                     is_partial_cancelable, status, requested_at)
WITH RECURSIVE seq(n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM seq WHERE n < 1000
)
SELECT CONCAT('seed_unresolved_', LPAD(n, 6, '0')),
       CONCAT('seed_unresolved_', LPAD(n, 6, '0')),
       '실시간 대사 실험',
       CONCAT('m_load_', LPAD(n, 4, '0')),
       15000,
       15000,
       1,
       'APPROVING',
       NOW() - INTERVAL 1 HOUR
FROM seq;

INSERT INTO payment_transaction (transaction_key, payment_key, m_id, type, amount, status, transacted_at)
WITH RECURSIVE seq(n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM seq WHERE n < 1000
)
SELECT CONCAT('seed_unresolved_tx_', LPAD(n, 6, '0')),
       CONCAT('seed_unresolved_', LPAD(n, 6, '0')),
       CONCAT('m_load_', LPAD(n, 4, '0')),
       'APPROVE',
       15000,
       'REQUESTED',
       NOW() - INTERVAL 1 HOUR
FROM seq;

SELECT
    (SELECT COUNT(*) FROM payment WHERE payment_key LIKE 'seed_unresolved_%' AND status = 'APPROVING') AS approving_payments,
    (SELECT COUNT(*) FROM payment_transaction WHERE transaction_key LIKE 'seed_unresolved_tx_%' AND status = 'REQUESTED') AS requested_transactions;
