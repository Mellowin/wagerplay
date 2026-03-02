-- Сбрасываем сессию админа
UPDATE users SET "lastAdminActivityMs" = EXTRACT(EPOCH FROM NOW()) * 1000 WHERE id = '8207cf04-3bef-4c10-91bf-9c4bac23671e';
SELECT "lastAdminActivityMs" FROM users WHERE id = '8207cf04-3bef-4c10-91bf-9c4bac23671e';
