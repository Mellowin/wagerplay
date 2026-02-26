# Load Testing with k6

Нагрузочное тестирование критичных race condition сценариев.

## Установка k6

```bash
# Windows (PowerShell)
choco install k6

# Или скачать с https://k6.io/
```

## Тесты

### 1. TC-RACE-01: Double Quickplay Race

**Цель:** Проверить, что параллельные quickplay запросы не создают дубликаты.

```bash
k6 run test/load/race-quickplay.js
```

**Что проверяет:**
- Два параллельных quickplay от одного пользователя
- Создаётся только один тикет/матч
- Пользователь не может быть одновременно в очереди и матче
- 99% запросов < 500ms

**Метрики:**
- `race_conditions` - счётчик найденных race
- `duplicate_errors` - ошибки дублирования
- `quickplay_latency` - время отклика

### 2. TC-RACE-02: Double Move Race

**Цель:** Проверить обработку параллельных move под нагрузкой.

```bash
k6 run test/load/race-moves.js
```

**Что проверяет:**
- Один игрок шлёт несколько move одновременно
- Дубликаты отклоняются
- Матч корректно завершается

**Метрики:**
- `accepted_duplicate_moves` - критично! Должно быть 0
- `move_latency` - время обработки хода

### 3. Stress Test: Overall System

**Цель:** Проверить стабильность системы под экстремальной нагрузкой.

```bash
k6 run test/load/stress-matchmaking.js
```

**Параметры:**
- Max VUs: 150
- Duration: ~4 минуты
- Mix: 40% create, 40% move, 20% check state

**Что проверяет:**
- Нет memory leaks
- Соединения с БД/Redis не исчерпываются
- 95% запросов < 2s даже под нагрузкой
- Ошибки < 5%

## Запуск всех тестов

```bash
# PowerShell
k6 run test/load/race-quickplay.js
k6 run test/load/race-moves.js
k6 run test/load/stress-matchmaking.js
```

## Интерпретация результатов

### ✅ Хороший результат

```
✓ status is 201
✓ user state consistent
✓ duplicate properly rejected

race_conditions: 0
accepted_duplicate_moves: 0
http_req_failed: 0.00%
```

### ⚠️ Проблема

```
race_conditions: 5
accepted_duplicate_moves: 3
http_req_failed: 2.00%
```

**Действие:** Redis lock не работает под нагрузкой, нужен Lua script.

## CI/CD интеграция

```yaml
# .github/workflows/load-test.yml
- name: Load Tests
  run: |
    k6 run --out json=results.json test/load/race-quickplay.js
    k6 run test/load/race-moves.js
```

## Требования к окружению

- Сервер должен быть запущен: `npm run start:prod`
- Redis должен быть доступен
- Не запускать на production!

## Результаты для резюме

Пример хорошего результата:

> "Провёл нагрузочное тестирование matchmaking системы. При 150 параллельных пользователях:
> - 0 race conditions найдено
> - Среднее время отклика 120ms
> - 99.9% запросов успешны
> - Система стабильна под пиковой нагрузкой"
