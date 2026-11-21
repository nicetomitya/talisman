# ТЗ v2 (US Event Options): gap analysis, ERD, API, права, сценарии, backlog

Исходный текст: [`TZ_v2_US_Event_Options.txt`](TZ_v2_US_Event_Options.txt). Решения — D19–D27, открытые вопросы — U17–U24 в [`DECISIONS.md`](DECISIONS.md). Этап реализации — **P1 «Event-first Demo»** из п. 16 ТЗ: всё работает только в симуляции; реальных денег, ордеров, рынков и цен нет.

## 1. Карта модулей: keep / adapt / replace / add / deprecate

| Модуль | Решение | Что сделано |
|---|---|---|
| Аккаунты, сессии, CSRF, роли, 2FA админа | **keep** | Без изменений. `User.market` (RU/US), `usState`, `riskTierOverride`; `Ctx.user.market`; US-клиент после входа попадает в `/app` |
| AI (эмулятор) | **adapt** | Новый детерминированный AI Event Builder на английском (`src/server/ev/intake.ts`): извлечение категории, места, дат, порога, выплаты и бюджета; вопросы вместо догадок; станция не выбирается автоматически; текст — данные, не команды |
| Погодные эмуляторы RAIN01/WIND01 (RU) | **keep (legacy)** | Остались в страховом контуре. Для v2 — отдельный демо-оракул по станциям (`src/server/ev/oracle.ts`) с резервной станцией и NEEDS_DATA |
| reverse auction, оформление, полисы, выплаты, начисления (RU) | **deprecate → legacy** | Не удалены и работают: `/insurance`, `/c`, `/a`, `/admin`. Изолированы от учёта event contracts (отдельные таблицы, нет общих денег) |
| CRM, внешние полисы, атрибуция (P1-A) | **keep (legacy insurance)** | Без изменений; крит. 23 покрыт тестами `crm.test.ts` |
| Документы, хранилище, уведомления, аудит | **keep** | Аудит используется для всех событий `ev.*`; для прогнозов, наблюдений и расчётов — триггеры неизменяемости в БД |
| Машины состояний | **adapt** | Добавлены `evIntent`, `evMarket`, `evCompliance`, `evResolution`, `evPosition`, `expertProfile` |
| Главная `/` | **replace** | Новый английский лендинг «Protect what matters…»; русский — на `/insurance` |
| Risk Intake, Event Registry | **add** | `RiskIntent`, `EventDefinition`, `EventTemplate` (WIND_LOW, RAIN_HIGH, TEMP_HIGH, CONSTRUCTION_DELAY research-only) |
| Market Discovery | **add** | `VenueAdapter`: `MockVenueAdapter` (работает), `ReadOnlyMarketDataAdapter` (не настроен, данных не отдаёт), `LicensedPartnerExecutionAdapter` (всегда INTEGRATION_NOT_CONFIGURED); `VenueMarket`, `QuoteSnapshot`, `MatchAssessment`, matcher EXACT/PARTIAL/NONE |
| Pricing Simulator | **add** | Обход стакана, VWAP, частичное исполнение, комиссии, max loss, сценарии YES/NO (`src/server/ev/pricing.ts`), TTL котировки 60 с |
| Trading (paper) | **add** | `SimOrder`, `SimFill`, `Position` (лот на ордер), идемпотентность, подтверждение человеком, лимиты по `eventRootKey`, конфликт интересов |
| Oracle & Resolution | **add** | `OracleObservation`, `ResolutionRecord` (NEEDS_DATA → PROPOSED → DISPUTED → CONFIRMED), `SettlementRecord` (UNIQUE positionId, только SIMULATED), события площадки через `WebhookInbox` |
| Expert Hub | **add** | `ExpertProfile` с модерацией, `ExpertForecast` (версии, неизменяемость, запрет после закрытия торгов), калибровка Брайера; статус поставщика ликвидности — только админ |
| Compliance | **add** | `/ops`: статусы рынков с основанием (`ComplianceReview`), торговый статус, смена условий (новая версия), наблюдения и подтверждение исхода, конфликт-декларации, эксперты, уровни, кластерный риск, журнал `ev.*` |
| Revenue / BillingEvent | **не делаем** | Комиссия Talisman = $0, пока нет утверждённого партнёрского тарифа (крит. 22); демо-комиссия площадки показана как иллюстрация |
| PartnerOrder, KYC/geo, live trading | **не делаем (P3)** | Нет таблицы и ни одного маршрута реального ордера; флаг `LIVE_TRADING_ENABLED` маршрут не создаёт |
| HedgeBundle / COMPOSITE | **backlog (U22)** | Сопоставление возвращает только EXACT/PARTIAL/NONE |

## 2. Целевая архитектура (модули `src/server/ev/`)

```
intake.ts    AI Event Builder (эмулятор): extract → build (unresolved, basis risk, статус), UTC окна, canonical key / terms hash
geo.ts       справочник мест и станций (пользователь выбирает станцию)
templates.ts шаблоны контрактов
matcher.ts   EXACT / PARTIAL / NONE + mismatch tags, match_version
pricing.ts   стакан → VWAP, комиссии, max loss, сценарии (только целые центы)
venue.ts     VenueAdapter / ExecutionAdapter, interpretPartnerAck, флаг live
fixtures.ts  детерминированные рынки и наблюдения MockVenue
oracle.ts    наблюдения → исход / NEEDS_DATA, Брайер
limits.ts    уровни T0–T3, агрегированный лимит, ограничения по конфликту
service.ts   операции с БД: intake, matches, quote, sim orders, resolution, settlement, expert, compliance
http.ts      гостевой cookie, общие схемы (USD → центы, порог → сотые)
page.ts      владелец для серверных страниц, перенос черновиков гостя
```

Сетевых вызовов адаптеров внутри транзакций нет: стакан читается до транзакции, в транзакции — только запись снимка, ордера и позиции.

## 3. ERD (новое)

```
User 1─* RiskIntent (ownerUserId | guestKeyHash) ─0..1 EventDefinition (canonicalKey+version, ruleHash)
EventTemplate (code) ─* VenueMarket (venue, venueMarketId, termsHash, termsVersion, eventRootKey, objectKey, status, complianceStatus, sourceKind)
RiskIntent 1─* MatchAssessment *─0..1 VenueMarket (exactness, mismatchTags, matchVersion, termsHash, modelVersion, sourceRefs)
VenueMarket 1─* QuoteSnapshot (yesAsks, noAsks, takenAt, staleAt, termsHash)
User 1─* SimOrder (quoteSnapshotId, termsHash, simulation=true) 1─* SimFill
SimOrder 1─1 Position (лот: side, units, costCents, feeCents, state, sourceKind=SIMULATED)
VenueMarket 1─* OracleObservation (sourceId, isFallback, valueX100|null, evidenceHash)   — неизменяемы
VenueMarket 1─0..1 ResolutionRecord (status, outcome, evidence, disputeDeadline)
Position 1─0..1 SettlementRecord (UNIQUE positionId, partnerRef SIMULATED:*)            — неизменяемы
User 1─* ConflictDeclaration (objectKey, relationship, restriction)
User 1─0..1 ExpertProfile (moderationStatus, liquidityProviderStatus) ; User 1─* ExpertForecast (version, supersedesId) — неизменяемы
RiskIntent 1─* DemandSignal (WATCH | WAITLIST | SUGGEST_SPEC)
VenueMarket 1─* ComplianceReview (from, to, reason, reviewerId)
```

Инварианты в БД: CHECK цен 1..99 и неотрицательных сумм; `Position.sourceKind = 'SIMULATED'`, `SimOrder.simulation = true`, `SettlementRecord.partnerRef LIKE 'SIMULATED:%'`; вероятность 0..10000 bp; триггеры, запрещающие UPDATE/DELETE прогнозов и UPDATE наблюдений и расчётов. Миграция `20261121120000_event_risk_v2` аддитивна, откат — `down.sql` (проверен).

## 4. DTO (основные)

* **RiskIntent**: `id, version, status, rawDescription, category, templateCode, place{key,name,timezone,stations[]}, stationId, window{startLocal,endLocal,timezone,startUtc,endUtc}, trigger{metric,operator,thresholdX100,unit}, desiredPayoutCents, budgetCents, unresolved[{field,question}], basisRisk[], manipulationRisk, confidence, extractorVersion, eventDefinitionId, executionMode="SIMULATION"`.
* **Matches**: `simulated{overall, results[{marketId, exactness, tags[], explanation, confidence, tradable, market}]}, live{overall:"NONE", status, explanation}, matchVersion, termsChangedMarketIds[]`.
* **Quote**: `quoteSnapshotId, venue, source, sourceKind, takenAt, staleAt, ageSec, stale, termsHash, book{yesAsks, noAsks, spreadCents}, calc{requestedUnits, filledUnits, fillPct, partial, fills[], vwapX100, costCents, venueFeeCents, talismanFeeCents, totalCents, maxLossCents, grossPayoutCents, scenarios}, canConfirm, blockers[]`.
* **SimOrder result**: `orderId, positionId, status, filledUnits, requestedUnits, costCents, feeCents, totalCents, maxLossCents, grossPayoutCents, simulation:true, replayed`.

Суммы — целые центы; пороги — целые сотые; вероятность — базисные пункты. Даты события — локальные `YYYY-MM-DD` + IANA timezone, плюс UTC.

## 5. API (проектный, `/api/v2`)

| Метод и путь | Кто | Назначение |
|---|---|---|
| `POST /risk-intents` | гость / клиент | Черновик из текста (`description`). Гостю ставится httpOnly-cookie `tgk` |
| `GET /risk-intents`, `GET /risk-intents/{id}` | владелец | Только свои (по `ownerUserId` или хэшу cookie) |
| `PATCH /risk-intents/{id}`, `POST /risk-intents/{id}/normalize` | владелец | Уточнение (`version`, `placeKey`, `stationId`, даты, `threshold`, `desiredPayoutUsd`, `budgetUsd`) |
| `POST /event-drafts/{id}/validate` | владелец | `confirm: true` → `EventDefinition` |
| `GET /risk-intents/{id}/market-matches` | владелец | EXACT/PARTIAL/NONE, сохраняется `MatchAssessment` |
| `POST /risk-intents/{id}/demand`, `/archive` | владелец | Сигнал спроса без оплаты; архив |
| `GET /markets`, `GET /markets/{id}` | все | Каталог (SIMULATED) и прогнозы экспертов |
| `GET /markets/{id}/quote?side&targetPayoutUsd` | все | Котировка по глубине, `QuoteSnapshot` |
| `POST /sim/orders` | клиент | Бумажная позиция: `quoteSnapshotId`, `termsHash`, `allowPartial`, `confirm:true`, `idempotencyKey`; строгая схема |
| `GET /sim/positions` | клиент | Свои лоты с разрешением и расчётом |
| `GET /events/{marketId}/resolution`, `POST /events/{marketId}/dispute` | все / держатель | Исход, наблюдения, спор |
| `GET/POST /expert/profile`, `GET/POST /expert/forecasts` | клиент / все | Профиль на модерацию, версии прогнозов |
| `GET /participant/eligibility`, `POST /participant/conflicts` | все / клиент | Допуск: симуляция — да, live — нет с причинами; декларация связи |
| `POST /compliance/reviews` | админ + 2FA | Комплаенс-статус рынка с основанием |
| `POST /admin/{action}` | админ + 2FA | `market-status`, `market-terms`, `observe`, `finalize`, `expert-moderate`, `liquidity-provider`, `conflict-restriction`, `tier`, `outage`, `venue-event` |

Маршрута реального ордера нет. Ошибки — единый формат с `correlationId`; мутации — CSRF, строгая zod-схема, аудит; создание черновика — лимит частоты.

## 6. Матрица прав

| Действие | Гость | Клиент (consumer) | Эксперт (одобрен) | Поддержка | Админ (2FA) |
|---|---|---|---|---|---|
| Описать риск, уточнить, подтвердить, найти рынок, котировка | ✓ (свой cookie) | ✓ (свои) | ✓ | — | — |
| Бумажная позиция | — | ✓ T1 $5k/событие | ✓ T2 $25k | — | — |
| Позиция на рынок стройки | — | только после декларации NONE | то же | — | — |
| Спор исхода | — | держатель позиции | держатель | — | — |
| Профиль эксперта | — | подать на модерацию | редактировать (снова на модерацию) | — | модерация |
| Прогноз | — | — | ✓ до закрытия торгов, новой версией | — | — |
| Статус поставщика ликвидности | — | — | — (нельзя себе) | — | ✓ |
| Комплаенс/торговый статус, условия, исход, расчёт, уровни, outage | — | — | — | просмотр `/ops` | ✓ с основанием |
| Кластерный риск | — | — | — | ✓ | ✓ |
| Реальные деньги и ордера | — | — | — | — | — (не существует) |

## 7. UX-потоки и состояния

`/` → описать → `/risk/{id}` (Needs details: вопросы, выбор станции с базисным риском, даты в часовом поясе события) → Ready for review → подтверждение галочкой → Confirmed → блок «Available contracts»: реальные рынки — NONE с объяснением; симулированная площадка — EXACT/PARTIAL с причинами или NONE с Watch / Waitlist / Suggest spec → `/markets/{id}`: карточка события, источник данных, missing-data policy, прогнозы экспертов, калькулятор (max loss → итог → выплата → источник и возраст котировки → сценарии → стакан и комиссии → подтверждение) → `/app/portfolio` (SIMULATED · virtual USD): статусы, окно спора, NEEDS_DATA, симулированный расчёт.

Покрытые состояния: loading, empty, exact, partial, no match, stale quote, partner offline (outage), paper only, KYC required (live недоступен с причинами), partial fill, suspended market, research only, restricted (декларация), pending resolution, contested, resolved, settled.

## 8. Критерии приёмки (п. 17) → тесты

| № | Где проверено |
|---|---|
| 1, 2, 3, 4 | unit `ev.test.ts` (AI Event Builder, UTC), integration «крит. 1–3», e2e «Гость: регата…» |
| 5, 6, 8 | unit «Калькулятор»; integration «частичное исполнение»; e2e клиента (60%) |
| 7 | integration «крит. 7» (Phoenix — устаревший стакан; TTL 60 с по демо-часам) |
| 9, 10, 11, 12, 13 | integration «Реальные деньги отсутствуют», unit `interpretPartnerAck`, e2e (`/api/v2/orders` → 404, `mode: LIVE` → 422) |
| 14 | integration «крит. 14» и «повтор события площадки» |
| 15 | unit оракула, integration «NEEDS_DATA без выплаты», спор |
| 16 | integration «крит. 16», e2e консоли (сотрудник застройщика) |
| 17 | integration «крит. 17» |
| 18 | integration «крит. 18» (10 лотов на двух рынках одного события) |
| 19 | integration «крит. 19», e2e `/ops` |
| 20 | e2e «not an insurance policy» на странице контракта |
| 21 | legacy-страхование: страница продукта показывает страховщика, условия и порядок выплат (P0, без изменений); стакан в страховом контуре не используется |
| 22 | unit «Калькулятор» (`talismanFeeCents = 0`), комиссии видны в калькуляторе до кнопки |
| 23 | `tests/integration/crm.test.ts` (P1-A) |
| 24 | integration «крит. 12, 24» (CHECK в БД), бейдж SIMULATED и «virtual» во всех суммах |
| 25 | integration «крит. 25», пометка в «Available contracts» |
| 26 | integration «крит. 26», журнал в `/ops` |
| 27 | e2e 360 px: max loss и источник выше CTA |
| 28 | integration «крит. 28» |
| 29 | integration «крит. 29» (триггер БД + запрет после закрытия) |
| 30 | unit «Тексты интерфейса» (сканирование строк US-интерфейса) |

## 9. Сценарии ручной проверки

1. `/` как гость: вставить пример про регату → видно 3 вопроса, станция «not chosen». Выбрать KUUU, даты 10–12.08.2027, порог 8 → «Ready for your review» и UTC `2027-08-10T04:00Z` → подтвердить → «Exact match» и «SIMULATED»; реальные рынки — «No match».
2. Сменить порог на 7 → статус снова «Ready for review», совпадение PARTIAL с тегом порога.
3. «See cost and payout» → на 360 px сначала Maximum loss, затем источник котировки, затем кнопка входа. Подождать 60 с → «This quote is out of date», кнопка недоступна.
4. Войти как Olivia (демо) → Austin rain, payout 5000 → предупреждение 60% → без галочки частичного исполнения кнопка неактивна → открыть позицию → портфель «SIMULATED · virtual USD».
5. Описать перелёт («flight… delayed») → NONE и три кнопки интереса; ничего не покупается.
6. Maya → Portfolio: рассчитанная регата Oct 2026 (YES, +$), дождь Nov 2026 — «dispute window open» → отправить спор.
7. Jordan → контракт Oak Ridge lot 14 → «not available to you». Alex Park → тот же контракт доступен после декларации.
8. Sam → Expert: опубликовать новую версию прогноза → в карточке контракта видны обе версии.
9. Админ → `/ops`: «Simulate venue outage» → котировки «temporarily unavailable»; сменить комплаенс-статус с основанием → запись в истории и журнале; «Collect observations» по прошедшему рынку → NEEDS_DATA или PROPOSED; «Confirm outcome and settle».
10. `/insurance`, `/c`, `/a`, `/admin` — прежний русский страховой контур работает.

## 10. Юридические и партнёрские зависимости (до любого live)

Из п. 18 ТЗ и `DECISIONS.md` (U17–U24): письменный compliance memo о роли Talisman на каждом шаге (информация, SaaS, IB, CTA, insurance producer); договор с DCM / интермедиаром и его ответы о data API, referral/IB и execution; реальные листингованные контракты, глубина и комиссии; кто делает KYC/AML, проверку штатов, хранение средств, клиринг, выписки и споры; список штатов; допуск экспертов к торговле за свой счёт; законность referral / subscription / transaction revenue; погодные источники и fallback конкретного рынка (NOAA NCEI — кандидат, не проверен); отдельная регистрация insurance producer для страхового rail; SEC-вопросы для событий по показателям компаний; порядок и стоимость сертификации новой категории. **Go/no-go: без memo, договора, KYC/restricted-state flow, проверенных данных, сверки и утверждённой fee policy — NO LIVE TRADING.**

## 11. Backlog

| Этап | Задача | Критерий |
|---|---|---|
| P1+ | Реальная LLM для Event Builder с тем же контрактом вывода и защитой от prompt injection (U18) | Те же unit-тесты проходят на записанных ответах |
| P1+ | Голосовой ввод, многошаговый диалог | — |
| P1+ | Пакетная защита (HedgeBundle, COMPOSITE) с пошаговой авторизацией legs (U22) | Ни одной «гарантированной» единой выплаты |
| P2 | ReadOnlyMarketData по проверенному источнику с условиями API (U17) | Каждая котировка — venue, время, ссылка; при отсутствии — NONE |
| P2 | Уведомления об изменении условий и статуса, watchlist | Письмо/уведомление на смену `termsHash` |
| P2 | Реальный погодный источник и fallback-иерархия (U20) | Наблюдения с evidence hash из источника |
| P3 | Partner pilot: PartnerOrder, KYC/geo от партнёра, сверка | Только после go/no-go п. 18 |
| P4 | Организации экспертов, B2B API, аналитика спроса | — |
| P5 | Страховой rail через лицензированных партнёров | Визуально и юридически отделён от деривативов |
