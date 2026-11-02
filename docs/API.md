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
| `/api/requests` | POST | создать черновик заявки |
| `/api/requests/{id}` | GET, PATCH | прочитать (объём данных по роли), автосохранение черновика с версией |
| `/api/requests/{id}/{action}` | GET, POST | `publish`, `confirm` (ключевое поле), `suggestion` (принять распознанное значение), `cancel`; загрузка файлов |
| `/api/checkouts` | POST | выбрать предложение (`quote_id`, `quote_version`) → резерв на 15 мин |
| `/api/checkouts/{id}/{action}` | GET, POST | `prepare` (документы), `ack` (ознакомление), `code` (запрос кода), `verify` (подпись), `pay`, `cancel` |
| `/api/policies/{id}/{action}` | POST | `claim`, `dispute`, `review`, `terminate`, `termination-preview`, `renew`, `change`, `booking-change` |
| `/api/claims/{id}/{action}` | POST | `submit`, `upload`, `dispute`, `staff` (действия сотрудника по роли) |
| `/api/messages/{id}` | GET, POST | чат по контексту (заявка, сделка, обращение) |
| `/api/documents/{id}/{action}` | GET | `link` (короткоживущая HMAC-ссылка), `download` (приватная отдача с заголовками безопасности) |
| `/api/notifications`, `/api/consents`, `/api/analytics` | POST | прочтение уведомлений, согласия, аналитика (только при согласии на cookie) |
| `/api/agency/{action}` | POST | `calc`, `quote`, `withdraw`, `publish-draft`, `automation`, `submit-product`, `profile`, `invite`, `assign`, `review-reply`, `exception`, `task-done`, `propose` |
| `/api/subscriptions/{action}` | POST | `pay`, `change-plan`, `cancel-renewal`, `enable-renewal`, `promo` |
| `/api/admin/{action}` | POST | `verify-org`, `block-org`, `unblock-org`, `create-mandate`, `revoke-mandate`, `product-transition`, `request-approval`, `decide-approval`, `lift-suspension`, `commission-status`, `hide-review`, `support-access` (требуют второго фактора; чувствительные — двойного подтверждения) |
| `/api/webhooks/payments` | POST | вебхук платёжного провайдера: HMAC-подпись, inbox по внешнему идентификатору события |
| `/api/demo/{action}` | POST | только demo: `reset`, `clock-set`, `clock-advance`, `clock-reset`, `emulators`, `run-jobs`, `pay`, `replay-webhook`, `provider-resolve`, `event-check`, `reconcile`, `expire-mandate`, `saas-card`, `mailbox` |
| `/api/health` | GET | состояние приложения и БД |

## Интеграционная матрица

Источник — `INTEGRATION_MATRIX` в `src/server/adapters/index.ts`; отображается на странице `/admin/integrations`. В P0 все адаптеры — эмуляторы; в боевом режиме без настройки любой вызов возвращает `INTEGRATION_NOT_CONFIGURED`. Что нужно для P1 — в [`P1_BLOCKERS.md`](P1_BLOCKERS.md).
