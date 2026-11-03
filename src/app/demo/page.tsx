import Link from "next/link";
import { notFound } from "next/navigation";
import { isDemo } from "@/server/config";
import { pageCtx } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { emu } from "@/server/adapters/emu";
import { rub } from "@/server/money";
import { Card, PageTitle, fmtDate } from "@/components/ui";
import { ClockSet, DemoAction, EmuSelect } from "@/components/demo";

export const metadata = { title: "Демопанель" };
const SCEN = [
  ["А. Каско через подбор", "Войдите как Анна → «Новая заявка» → Каско → загрузите fixtures/docs/sts_kia_k5.pdf и dkp_kia_k5.pdf → подставьте и подтвердите поля → опубликуйте. Переключитесь на агента «Надёжный курс» и «Мост», рассчитайте и предложите цену. Вернитесь к Анне → выберите → документы → код из демопочты → оплата на странице эмулятора → полис."],
  ["Б. Квартира с автоответом", "Анна создаёт заявку «Квартира или дом» в Санкт-Петербурге. «Мост» отвечает автоматически по правилам (журнал на странице «Автоматизация»), «Надёжный курс» готовит черновик на подтверждение."],
  ["В. Дождь на мероприятии", "У Анны есть полис RAIN01. Выберите набор наблюдений (5.2, 5.0, 4.9 мм, пропуск основного источника, пропуск обоих) и запустите проверку события ниже. Результат и выплата видны в полисе."],
  ["Г. Ветер на парусном занятии", "Полис Игоря WIND01: наборы «условие выполнено», «ровно 3.0 м/с», «пропуск данных», «конфликт источников». Конфликт уходит специалисту в очередь исключений."],
  ["Д. Сбои и восстановление", "Потеря вебхука → сверка; повтор вебхука → без двойного списания; страховщик не подтверждает → задача поддержке; подписка агентства с отказом карты → льготный период → ограничение."],
];

export default async function DemoPanel() {
  if (!isDemo()) notFound();
  const ctx = await pageCtx();
  const t = await now();
  const e = await emu();
  const pending = await db.emulatorPayment.findMany({ where: { kind: "PAYMENT" }, orderBy: { createdAt: "desc" }, take: 8 });
  const eventPolicies = await db.policy.findMany({ where: { productCode: { in: ["RAIN01", "WIND01"] } }, orderBy: { startsAt: "asc" } });
  const agencies = await db.organization.findMany({ where: { type: "AGENCY" } });
  const jobs = await db.job.count({ where: { status: "PENDING" } });
  return (
    <main id="main" className="mx-auto max-w-6xl px-4 py-6">
      <PageTitle title="Демопанель" subtitle="Доступна только в APP_MODE=demo. Управляет эмуляторами и демо-временем. Каждое действие записывается в журнал аудита." actions={<Link href="/go" className="btn btn-secondary no-underline">В кабинет</Link>} />
      {!ctx && <p className="mb-4 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn">Войдите в любой демо-аккаунт на <Link href="/login">странице входа</Link>, чтобы управлять эмуляторами.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Демо-время">
          <p className="text-sm">Сейчас (демо): <strong>{fmtDate(t, true)}</strong> МСК. Заданий в очереди: {jobs}.</p>
          <div className="mt-2 flex flex-wrap gap-2">{[[1, "+1 мин"], [5, "+5 мин"], [60, "+1 час"], [121, "+2 ч 1 мин (истечь время на оформление)"], [1440, "+1 день"], [21600, "+15 дней"]].map(([m, l]) => <DemoAction key={m} action="clock-advance" body={{ minutes: m }} label={String(l)} />)}<DemoAction action="clock-reset" label="Сбросить время" /><DemoAction action="run-jobs" label="Выполнить задания сейчас" /></div>
          <div className="mt-3"><ClockSet now={new Date(t.getTime() + 3 * 3600_000).toISOString()} /></div>
        </Card>
        <Card title="Сценарии">
          <ol className="space-y-2 text-sm">{SCEN.map(([h, x]) => <li key={h}><strong>{h}.</strong> {x}</li>)}</ol>
          <p className="mt-2 text-xs text-muted">Пароль демо-аккаунтов: Demo-Talisman-2026. Тестовые файлы для загрузки лежат в fixtures/docs.</p>
        </Card>
        <Card title="Страховщик (эмулятор)">
          <div className="grid gap-3 sm:grid-cols-2">
            <EmuSelect label="Окончательная котировка" path={["carrier", "finalQuote"]} value={e.carrier.finalQuote} options={[["ok", "Подтверждает цену"], ["price_changed", "Меняет цену"], ["unavailable", "Недоступен"]]} />
            <EmuSelect label="Подтверждение заключения" path={["carrier", "confirm"]} value={e.carrier.confirm} options={[["ok", "Сразу"], ["delay", "С задержкой"], ["error", "Ошибка, повторы"]]} />
            <EmuSelect label="Тарифы" path={["tariffs", "stale"]} value={String(e.tariffs.stale)} options={[["false", "Актуальные"], ["true", "Устаревшие"]]} />
            <EmuSelect label="Антивирус" path={["antivirus", "mode"]} value={e.antivirus.mode} options={[["demo_clean", "Проверка в демо-режиме"], ["unavailable", "Недоступен"]]} />
          </div>
        </Card>
        <Card title="Платежи (эмулятор)">
          <div className="grid gap-3 sm:grid-cols-2">
            <EmuSelect label="Дублировать вебхук" path={["payment", "duplicateWebhook"]} value={String(e.payment.duplicateWebhook)} options={[["false", "Нет"], ["true", "Да, отправлять дважды"]]} />
            <EmuSelect label="Задержка вебхука" path={["payment", "webhookDelaySec"]} value={String(e.payment.webhookDelaySec)} options={[["0", "Нет"], ["30", "30 секунд"], ["600", "10 минут"]]} />
          </div>
          <div className="mt-3"><DemoAction action="reconcile" label="Сверка с провайдером" /></div>
          <ul className="mt-3 space-y-2 text-sm">{pending.map((p) => <li key={p.externalId} className="border-t border-line pt-2"><span className="break-all text-xs">{p.externalId}</span> · {rub(p.amountKop)} · {p.status}
            <div className="mt-1 flex flex-wrap gap-2">{p.status === "PENDING" && <Link className="btn btn-secondary no-underline" href={`/demo/pay/${p.externalId}`}>Страница оплаты</Link>}<DemoAction action="replay-webhook" body={{ externalId: p.externalId }} label="Повторить вебхук" />{p.status === "UNKNOWN" && <><DemoAction action="provider-resolve" body={{ externalId: p.externalId, status: "SUCCEEDED" }} label="У провайдера: успех" /><DemoAction action="provider-resolve" body={{ externalId: p.externalId, status: "FAILED" }} label="У провайдера: отказ" /></>}</div></li>)}</ul>
        </Card>
        <Card title="Наблюдения и события" className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <EmuSelect label="Набор для RAIN01" path={["weather", "RAIN01"]} value={e.weather.RAIN01} options={[["r52", "5.2 мм: выполнено"], ["r50", "Ровно 5.0 мм: выполнено"], ["r49", "4.9 мм: не выполнено"], ["r_gap_backup", "Пропуск основного, есть резерв"], ["r_gap_both", "Пропуск обоих источников"]]} />
            <EmuSelect label="Набор для WIND01" path={["weather", "WIND01"]} value={e.weather.WIND01} options={[["w_met", "Слабый ветер: выполнено"], ["w_exact3", "Ровно 3.0 м/с: не считается"], ["w_missing", "Пропуск данных"], ["w_conflict", "Конфликт источников"]]} />
            <EmuSelect label="Недоступные источники" path={["weather", "unavailable"]} value={JSON.stringify(e.weather.unavailable)} options={[["[]", "Все доступны"], ['["DEMO_STATION_SPB_01"]', "Основная станция дождя недоступна"], ['["DEMO_WIND_01","DEMO_WIND_02"]', "Обе станции ветра недоступны"]]} />
          </div>
          <ul className="mt-3 space-y-2 text-sm">{eventPolicies.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-2">{p.number} · {p.productCode} · {p.objectTitle} · {fmtDate(p.startsAt, true)} · {p.contractStatus}<DemoAction action="event-check" body={{ policyId: p.id }} label="Рассчитать событие сейчас" /></li>)}</ul>
        </Card>
        <Card title="Агентства">
          <ul className="space-y-2 text-sm">{agencies.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2">{a.name}<DemoAction action="saas-card" body={{ orgId: a.id, behavior: "fail" }} label="Карта: отказ" /><DemoAction action="saas-card" body={{ orgId: a.id, behavior: "success" }} label="Карта: успех" /><DemoAction action="expire-mandate" body={{ agencyOrgId: a.id }} label="Истечь полномочия" confirm="Истечь все полномочия агентства?" /></li>)}</ul>
        </Card>
        <Card title="Сброс">
          <p className="mb-2 text-sm">Полностью пересоздаёт демо-данные через реальную доменную логику (около 10 секунд). Все сессии завершатся.</p>
          <DemoAction action="reset" body={{ confirm: true }} label="Сбросить демо-данные" variant="danger" confirm="Сбросить все демо-данные?" />
        </Card>
      </div>
    </main>
  );
}
