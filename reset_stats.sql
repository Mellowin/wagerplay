-- Полный сброс статистики и балансов WP
TRUNCATE TABLE user_stats;
UPDATE wallets SET "balanceWp" = 10000, "frozenWp" = 0;
