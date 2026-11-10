SELECT @@binlog_format AS binlog_format, @@transaction_isolation AS default_isolation;
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'pg' AND table_name = 'payment_transaction' AND column_name = 'claimed_until';
SELECT status, COUNT(*) AS cnt FROM payment_transaction GROUP BY status;
