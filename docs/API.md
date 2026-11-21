# HTTP API прототипа P0

Все маршруты — `src/app/api/**/route.ts`, бизнес-логика — `src/server/domain/*`. Интерфейс пользуется только этим API; права проверяются на сервере в каждом запросе.

## Общие правила

* **Авторизация:** cookie сессии `tsid` (HttpOnly, SameSite=Lax). Активная организация пользователя хранится в сессии (`/api/auth/switch-org`).
* **CSRF:** для изменяющих запросов — cookie `tcsrf` и заголовок `x-csrf-token` с тем же значением, плюс проверка `Origin`.
* **Идемпотентность:** критичные команды (выбор предложения, код подписи, оплата, обращение, выплаты) принимают заголовок `Idempotency-Key`. Тот же ключ и тело — сохранённый ответ; другое тело — `CONFLICT`.
* **Оптимистичные версии:** изменение заявки (`PATCH /api/requests/{id}`) и выбор предложения передают версию; устаревшая — `VERSION_CHANGED`.
* **Ошибки:** `{ "error": { "code", "message", "nextAction", "correlationId" } }`. Коды: `FORBIDDEN`, `UNAUTHENTICATED`, `NEEDS_INFO`, `QUOTE_EXPIRED`, `VERSION_CHANGED`, `CAPACITY_EXHAUSTED`, `ALREADY_DONE`, `LIMIT_EXCEEDED`, `SOURCE_UNAVAILABLE`, `RESULT_PENDING`, `INVALID_TRANSITION`, `VALIDATION`, `CONFLICT`, `RATE_LIMITED`, `NOT_FOUND`, `INTEGRATION_NOT_CONFIGURED`, `SUBSCRIPTION_RESTRICTED`.
* **Входные данные:** строгие Zod-схемы; лишние поля отвергаются (защита от массового присваивания).

## Маршруты

| Маршрут | Методы | Действия |
|---|---|---|
| `/api/auth/{action}` | POST | `register`, `verify`, `login`, `logout`, `reset-request`, `reset`, `totp-setup`, `totp-confirm`, `stepup`, `switch-org`, `revoke-session`, `demo-switch` (только demo) |
| `/api/requests` | POST | создать черновик заявки; `sourceDetail` = `seo:<slug>` для перехода со страницы «Ситуации» |
| `/api/requests/{id}` | GET, PATCH | прочитать (объём данных по роли), автосохранение черновика с версией |
| `/api/requests/{id}/{action}` | GET, POST | GET: `offers`, `review` (проверка помощником); POST: `publish`, `confirm` (ключевое поле), `suggestion` (принять распознанное значение), `cancel`, `repeat`; загрузка файлов |
| `/api/checkouts` | POST | выбрать предложение (`quote_id`, `quote_version`) → матч, 2 ч на оформление |
| `/api/checkouts/{id}/{action}` | GET, POST | `prepare` (документы), `ack` (ознакомление), `code` (запрос кода), `verify` (подпись), `pay`, `cancel` |
| `/api/policies/{id}/{action}` | POST | `claim`, `dispute`, `review`, `terminate`, `termination-preview`, `renew`, `change`, `booking-change` |
| `/api/claims/{id}/{action}` | POST | `submit`, `upload`, `dispute`, `staff` (действия сотрудника по роли) |
| `/api/messages/{id}` | GET, POST | чат по контексту (заявка, сделка, обращение) |
| `/api/documents/{id}/{action}` | GET | `link` (короткоживущая HMAC-ссылка), `download` (приватная отдача с заголовками безопасности) |
| `/api/notifications`, `/api/consents`, `/api/analytics` | POST | прочтение уведомлений, согласия, аналитика (только при согласии на cookie) |
| `/api/agency/{action}` | POST | `calc`, `quote`, `withdraw`, `publish-draft`, `automation`, `submit-product`, `profile`, `invite`, `assign`, `review-reply`, `exception`, `task-done`, `propose`, `commission-dispute` (владелец) |
| `/api/crm/{action}` | POST | CRM агентства: `contact-create`, `contact-update`, `policy-add`, `interaction`, `task`, `import` (CSV, обязательное основание обработки), `invite-prepare` (ссылка + текст, без отправки), `invite-sent` (агент отметил ручную отправку), `draft` (текст продления/«как дела»). Всё в пределах своего агентства; агент — только свои и неназначенные карточки |
| `/api/cabinet/{action}` | POST | кабинет клиента: `external-add`, `external-archive`, `market-check` (новая независимая заявка), `triage` (страховой случай текстом), `invite-accept`, `link-confirm`, `link-revoke` |
| `/api/subscriptions/{action}` | POST | `pay`, `change-plan`, `cancel-renewal`, `enable-renewal`, `promo` |
| `/api/admin/{action}` | POST | `verify-org`, `block-org`, `unblock-org`, `create-mandate`, `revoke-mandate`, `product-transition`, `request-approval`, `decide-approval`, `lift-suspension`, `commission-status` (в т. ч. решение спора: `CONFIRMED` или `REVERSED` со сторно), `hide-review`, `support-access` (требуют второго фактора; чувствительные — двойного подтверждения) |
| `/api/webhooks/payments` | POST | вебхук платёжного провайдера: HMAC-подпись, inbox по внешнему идентификатору события |
| `/api/demo/{action}` | POST | только demo: `reset`, `clock-set`, `clock-advance`, `clock-reset`, `emulators`, `run-jobs`, `pay`, `replay-webhook`, `provider-resolve`, `event-check`, `reconcile`, `expire-mandate`, `saas-card`, `mailbox` |
| `/api/health` | GET | состояние приложения и БД |

### ТЗ v2: US Event Risk (`/api/v2`, только симуляция)

Полное описание, DTO и права — в [`GAP_ANALYSIS_v2_US_EVENTS.md`](GAP_ANALYSIS_v2_US_EVENTS.md), пп. 4–6. Деньги в запросах — `…Usd` (строка или число, до центов), в ответах — `…Cents`.

| Маршрут | Методы | Действия |
|---|---|---|
| `/api/v2/risk-intents` | GET, POST | список своих / новый черновик из `description` (гостю — cookie `tgk`) |
| `/api/v2/risk-intents/{id}` | GET, PATCH | чтение / уточнение (`version`, `placeKey`, `stationId`, `windowStartLocal`, `windowEndLocal`, `threshold`, `desiredPayoutUsd`, `budgetUsd`) |
| `/api/v2/risk-intents/{id}/{normalize,market-matches,demand,archive}` | POST/GET | уточнение; сопоставление EXACT/PARTIAL/NONE; сигнал спроса; архив |
| `/api/v2/event-drafts/{id}/validate` | POST | `version`, `confirm: true` → EventDefinition |
| `/api/v2/markets`, `/api/v2/markets/{id}`, `/api/v2/markets/{id}/quote` | GET | каталог, контракт с прогнозами, котировка `side`, `targetPayoutUsd` |
| `/api/v2/sim/orders`, `/api/v2/sim/positions` | POST, GET | бумажная позиция (строгая схема, `idempotencyKey`, `confirm: true`); свои лоты |
| `/api/v2/events/{id}/resolution`, `/api/v2/events/{id}/dispute` | GET, POST | исход и наблюдения; спор держателя |
| `/api/v2/expert/profile`, `/api/v2/expert/forecasts` | GET, POST | профиль эксперта (на модерацию), прогнозы-версии |
| `/api/v2/participant/eligibility`, `/api/v2/participant/conflicts` | GET, POST | допуск (live всегда запрещён с причинами), декларация связи с объектом |
| `/api/v2/compliance/reviews` | POST | админ + 2FA: комплаенс-статус рынка с основанием |
| `/api/v2/admin/{action}` | POST | админ + 2FA: `market-status`, `market-terms`, `observe`, `finalize`, `expert-moderate`, `liquidity-provider`, `conflict-restriction`, `tier`, `outage`, `venue-event` |

Маршрута реального ордера нет ни при каком флаге.

## Интеграционная матрица

Источник — `INTEGRATION_MATRIX` в `src/server/adapters/index.ts`; отображается на странице `/admin/integrations`. В P0 все адаптеры — эмуляторы; в боевом режиме без настройки любой вызов возвращает `INTEGRATION_NOT_CONFIGURED`. Что нужно для P1 — в [`P1_BLOCKERS.md`](P1_BLOCKERS.md).
