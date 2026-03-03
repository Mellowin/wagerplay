-- Обнуление всех данных игроков (кроме House системного пользователя)
-- ВНИМАНИЕ: Это сбросит ВСЕ данные игроков!

-- 1. Сброс баланса всех игроков кроме House
UPDATE wallets 
SET balance_vp = 10000,  -- начальный баланс 10000 VP
    frozen_vp = 0,
    updated_at = NOW()
WHERE user_id NOT IN (
    SELECT id FROM users WHERE email = 'house@wagerplay.internal'
);

-- 2. Сброс статистики игроков
UPDATE player_stats 
SET total_matches = 0,
    wins = 0,
    losses = 0,
    win_rate = 0,
    total_won_vp = 0,
    total_lost_vp = 0,
    current_streak = 0,
    max_win_streak = 0,
    max_loss_streak = 0,
    biggest_win = 0,
    biggest_loss = 0,
    updated_at = NOW()
WHERE user_id NOT IN (
    SELECT id FROM users WHERE email = 'house@wagerplay.internal'
);

-- 3. Очистка истории матчей (опционально - если нужно чистое начало)
-- DELETE FROM match_history WHERE created_at < NOW();

-- 4. Очистка транзакций (кроме системных)
DELETE FROM transactions 
WHERE user_id NOT IN (
    SELECT id FROM users WHERE email = 'house@wagerplay.internal'
);

-- 5. Очистка тикетов очереди
DELETE FROM queue_tickets;

-- 6. Очистка активных матчей
DELETE FROM matches WHERE status != 'FINISHED';

-- Проверка результатов
SELECT 
    u.display_name,
    w.balance_vp,
    ps.total_matches,
    ps.wins,
    ps.losses
FROM users u
LEFT JOIN wallets w ON u.id = w.user_id
LEFT JOIN player_stats ps ON u.id = ps.user_id
WHERE u.email != 'house@wagerplay.internal'
ORDER BY w.balance_vp DESC
LIMIT 10;
