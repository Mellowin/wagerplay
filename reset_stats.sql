UPDATE user_stats 
SET "totalMatches" = 0,
    wins = 0,
    losses = 0,
    "totalWonVp" = 0,
    "totalLostVp" = 0,
    "totalStakedVp" = 0,
    "biggestWinVp" = 0,
    "biggestStakeVp" = 0,
    "winStreak" = 0,
    "maxWinStreak" = 0,
    "updatedAt" = NOW()
WHERE "userId" NOT IN (
    SELECT id FROM users WHERE email = 'house@wagerplay.internal'
);

SELECT u."displayName", 
       s."totalMatches", 
       s.wins, 
       s.losses
FROM users u
LEFT JOIN user_stats s ON u.id = s."userId"
WHERE u.email != 'house@wagerplay.internal'
LIMIT 5;
