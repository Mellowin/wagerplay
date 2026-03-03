-- Обнуление всех данных игроков (кроме House системного пользователя)

-- 1. Сброс баланса всех игроков кроме House
UPDATE wallets 
SET "balanceWp" = 10000,
    "frozenWp" = 0
WHERE "userId" NOT IN (
    SELECT id FROM users WHERE email = 'house@wagerplay.internal'
);

-- 2. Очистка статистики
UPDATE user_stats 
SET "totalMatches" = 0,
    wins = 0,
    losses = 0,
    "winRate" = 0,
    "totalWonVp" = 0,
    "totalLostVp" = 0,
    "currentStreak" = 0,
    "maxWinStreak" = 0,
    "maxLossStreak" = 0,
    "biggestWin" = 0,
    "biggestLoss" = 0
WHERE "userId" NOT IN (
    SELECT id FROM users WHERE email = 'house@wagerplay.internal'
);

-- 3. Очистка аудита
DELETE FROM audit_events 
WHERE "actorId" NOT IN (
    SELECT id FROM users WHERE email = 'house@wagerplay.internal'
);

-- Проверка результатов
SELECT 
    u."displayName",
    w."balanceWp",
    w."frozenWp"
FROM users u
LEFT JOIN wallets w ON u.id = w."userId"
WHERE u.email != 'house@wagerplay.internal'
ORDER BY w."balanceWp" DESC
LIMIT 10;
