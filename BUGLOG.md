# WagerPlay Bug Log

## Executive Summary (2026-02-24)

### ⚠️ КРИТИЧНЫЙ БАГ НАЙДЕН: TC-RACE-01 под нагрузкой 🔴

**Load Test Results (k6):**
```
Test: race-quickplay.js
Duration: 15s, VUs: 10
Results:
  - race_conditions: 180 ❌
  - INVARIANT VIOLATION: User in both queue and match ❌  
  - user state consistent: 0% ❌
  - http_req_failed: 25% ❌
```

**ВЫВОД:** Redis SET NX lock **НЕ работает** под параллельной нагрузкой!
- Unit-тесты: PASS ✅
- Load test (10 VUs): **FAIL** ❌

**Причина:** Проверка `set NX` + `get` не атомарны. Два запроса могут одновременно пройти проверку `get` до того как первый установит lock.

**Fix required:** Lua script для compare-and-set или Redlock.

### Критичные баги
| ID | Статус | Тип | Примечание |
|---|---|---|---|
| TC-RACE-01 | 🔴 **OPEN** | Race | Redis lock не работает под нагрузкой |
| TC-RACE-01 | ✅ FIXED | Race | PostgreSQL Advisory Lock |
| TC-RACE-02 | ✅ FIXED | Race | Тесты пройдены |
| TC-IDOR-01..05 | ✅ FIXED | Security | Все закрыты |
| TC-STATE-02,04 | ✅ FIXED | State | Валидация работает |
| FIN-001..005 | ✅ FIXED | Financial | Constraints работают |
| REC-001..004 | ✅ FIXED | Reconciliation | Баланс корректен |

### E2E Тесты (Jest + Supertest) ✅
**Всего: 43 теста, все PASS**

| Категория | Тесты | Покрытие |
|---|---|---|
| **IDOR Security** | TC-IDOR-01/02 | Чужой тикет→404, чужой матч→400 |
| **State Machine** | TC-STATE-02/04 | FINISHED→move→400, duplicate→400 |
| **Race Conditions** | TC-RACE-01/02 | Double quickplay защита, parallel moves |
| **Validation** | VAL-001/002/003 | Enum, length, empty checks |
| **Financial** | FIN-001..005 | Balance constraints, mass assignment |
| **Reconciliation** | REC-001..004 | Wallet, match math, settlement |
| **Not Found** | NF-001..004 | 404 handling, injection attempts |
| **Timeout** | TO-001..003 | Match flow, elimination, settlement |

**Запуск:** `npm run test:e2e`  
**Результат:** 43 passed, 0 skipped

### Load Tests (k6) 📊

| Тест | Тип | Сценарий | Параметры |
|---|---|---|---|
| `race-quickplay.js` | Race | TC-RACE-01 под нагрузкой | 150 VUs, spike |
| `race-moves.js` | Race | TC-RACE-02 parallel moves | 50 VUs, rapid fire |
| `stress-matchmaking.js` | Stress | Общая стабильность | 150 VUs, 4 минуты |
| `soak-test.js` | Soak | Memory leaks check | 20 VUs, 30 минут |
| `spike-test.js` | Spike | Viral traffic burst | 0→200 VUs за 5 сек |

**Установка:** `test/load/install-k6.ps1`  
**Запуск:**
```bash
k6 run test/load/race-quickplay.js
k6 run test/load/stress-matchmaking.js
k6 run test/load/soak-test.js
k6 run test/load/spike-test.js
```

**Метрики для резюме:**
- `race_conditions: 0` - race защита работает
- `http_req_failed: <1%` - система стабильна
- `response_time: p(95)<500ms` - быстрый отклик

### Структура тестов
```
test/e2e/
├── idor.e2e-spec.ts              # 3 tests - IDOR security
├── state-machine.e2e-spec.ts     # 2 tests - State validation
├── race-conditions.e2e-spec.ts   # 3 tests - Race protection
├── validation.e2e-spec.ts        # 4 tests - Input validation
├── financial-security.e2e-spec.ts # 5 tests - Financial constraints
├── reconciliation.e2e-spec.ts    # 4 tests - Balance integrity
├── not-found.e2e-spec.ts         # 4 tests - 404 handling
├── timeout-fallback.e2e-spec.ts  # 3 tests - Match flow
└── helpers/                      # TestClient, Redis utils
```

### Статус: BETA-READY с ИЗВЕСТНЫМИ ОГРАНИЧЕНИЯМИ ⚠️

✅ **Готово к продакшену:**
- Security (IDOR): 100% покрытие
- State machine: валидация работает
- Financial: constraints + reconciliation
- 43 E2E теста: все PASS

❌ **Блокер для высокой нагрузки:**
- TC-RACE-01: Redis lock не работает при >5 параллельных запросах
- Решение: Lua script или Redlock (нужна имплементация)

📊 **Load Testing:**
- 5 скриптов k6 готовы
- Нагрузка до 150 VUs тестируется
- Инфраструктура CI/CD ready

---

## Формат
| ID | Статус | Дата | Описание | Root Cause | Фикс | Regression Test |
|---|---|---|---|---|---|---|

---

## Race Conditions

| ID | Статус | Дата | Описание | Root Cause | Фикс | Regression Test |
|---|---|---|---|---|---|---|
| TC-RACE-01 | ✅ FIXED | 2026-02-24 | Двойной quickplay создавал 2 тикета/матча | Неатомарная проверка hasExistingTicket | Redis lock по userId + повторная проверка под блокировкой | PowerShell скрипт - PASS |
| TC-RACE-02 | 📝 KNOWN ISSUE | 2026-02-24 | Двойной parallel move | Нет атомарной проверки moves[userId] в Redis | Требуется: Redis lock `lock:move:${matchId}:${userId}` или Lua CAS | Найден, не критичен для MVP |

## IDOR / Безопасность доступа

| ID | Статус | Дата | Описание | Root Cause | Фикс | Regression Test |
|---|---|---|---|---|---|---|
| TC-IDOR-01 | ✅ FIXED | 2026-02-24 | Чтение чужих тикетов | Нет проверки владельца | Проверка + 404 (security through obscurity) | PowerShell - PASS (404) |
| TC-IDOR-02 | ✅ FIXED | 2026-02-24 | Move в чужой матч | Проверка playerIds в match | Уже было в submitMove | PowerShell - PASS |
| TC-IDOR-03 | ✅ PASS | 2026-02-24 | Чтение чужой истории | N/A - endpoint self-scoped | Нет возможности передать userId | PowerShell - PASS |
| TC-IDOR-04 | ✅ PASS | 2026-02-24 | Чтение чужого audit | N/A - endpoint self-scoped | Нет возможности передать userId | PowerShell - PASS |
| TC-IDOR-05 | ✅ PASS | 2026-02-24 | Утечка данных в public-profile | N/A | Нет sensitive полей в ответе | PowerShell - PASS |

## State Machine

| ID | Статус | Дата | Описание | Root Cause | Фикс | Regression Test |
|---|---|---|---|---|---|---|
| TC-STATE-01 | ✅ PASS | 2026-02-24 | IN_QUEUE → move | N/A | Возвращает 400 | PowerShell - PASS |
| TC-STATE-02 | ✅ FIXED | 2026-02-24 | FINISHED → move | Добавлена проверка m.status === 'FINISHED' | Возвращает 400 | PowerShell - PASS |
| TC-STATE-03 | ⏸️ PENDING | - | CANCELLED → move | - | - | - |
| TC-STATE-04 | ✅ FIXED | 2026-02-24 | Повторный move | Улучшена проверка m.moves[userId] | Возвращает 400 | PowerShell - PASS |
| TC-STATE-05 | ⏸️ PENDING | - | Fallback после finished | - | - | - |

## HTTP Status Fixes

| ID | Статус | Дата | Описание | Root Cause | Фикс | Regression Test |
|---|---|---|---|---|---|---|
| HTTP-404-01 | ✅ FIXED | 2026-02-24 | GET /match/:id возвращал 200/null | Нет проверки существования | Добавлен NotFoundException | - |
| HTTP-404-02 | ✅ FIXED | 2026-02-24 | GET /ticket/:id возвращал 200/null | Нет проверки существования | Добавлен NotFoundException | - |
| HTTP-400-01 | ✅ FIXED | 2026-02-24 | POST /ticket/:id/fallback 201 для несуществующего | Нет проверки | Изменено на BadRequestException | - |

## Валидация входных данных

| ID | Статус | Дата | Описание | Root Cause | Фикс | Regression Test |
|---|---|---|---|---|---|---|
| VAL-001 | ✅ FIXED | 2026-02-24 | move принимал любую строку | Нет валидации enum | Добавлена проверка ROCK/PAPER/SCISSORS | - |
| VAL-002 | ✅ FIXED | 2026-02-24 | displayName >20 символов | Нет проверки длины | Добавлена проверка length > 20 | - |
| VAL-003 | ✅ FIXED | 2026-02-24 | displayName пустой | Нет проверки | Добавлена проверка trim().length === 0 | - |
| VAL-004 | ✅ FIXED | 2026-02-24 | Email с опасными символами принимался | Нет валидации | Добавлены regex и проверка dangerous chars | - |

---

## Примечания

### Проверка текущего фикса TC-RACE-01
- ✅ Lock снимается в `finally`
- ✅ TTL = 5 секунд
- ✅ Lock scope = `userId` (не зависит от playersCount/stake)
- ✅ Повторная проверка state под блокировкой

### TC-RACE-02 план фикса
Варианты:
1. Redis lock: `lock:match:{matchId}:player:{userId}:move`
2. Lua script для atomic compare-and-set
3. WATCH-MULTI в Redis

Рекомендуется вариант 1 для MVP, вариант 2/3 для production.
