UPDATE users SET "lastAdminActivityMs" = EXTRACT(EPOCH FROM NOW()) * 1000 WHERE id = '6b20853f-fde4-45af-98e7-0d35d210daaa';
SELECT "lastAdminActivityMs" FROM users WHERE id = '6b20853f-fde4-45af-98e7-0d35d210daaa';
