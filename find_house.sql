SELECT id, email, "displayName" FROM users WHERE id = 'dd07667f-1f8c-4d0e-9850-b387d2044d47';
UPDATE wallets SET "balanceWp" = 10000000 WHERE "userId" = 'dd07667f-1f8c-4d0e-9850-b387d2044d47';
SELECT "displayName", "balanceWp" FROM users u LEFT JOIN wallets w ON u.id = w."userId" WHERE u.id = 'dd07667f-1f8c-4d0e-9850-b387d2044d47';
