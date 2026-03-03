UPDATE wallets SET "balanceWp" = 10000000 WHERE "userId" = (SELECT id FROM users WHERE email = 'house@wagerplay.internal');
SELECT "displayName", "balanceWp" FROM users u LEFT JOIN wallets w ON u.id = w."userId" WHERE email = 'house@wagerplay.internal';
