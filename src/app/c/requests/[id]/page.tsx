import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientPage } from "@/server/page";
import { db } from "@/server/db";
import { now } from "@/server/clock";
import { schemaFor } from "@/server/domain/catalog";
import { validateForm } from "@/server/domain/forms";
import { offersForClient } from "@/server/domain/auction";
import { DEMO_RULES } from "@/server/config";
import { Card, PageTitle, Status, Empty, fmtDate } from "@/components/ui";
import { Action, AutoRefresh, Countdown } from "@/components/client";
import { RequestWizard } from "@/components/wizard";
import { OfferCompare } from "@/components/offers";

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireClientPage();
  const { id } = await params; const sp = await searchParams;
  const r = await db.insuranceRequest.findFirst({ where: { id, clientId: ctx.user.id } });
  if (!r) notFound();
  const t = await now();
  const schema = schemaFor(r.productCode);
  const editing = ["DRAFT", "NEEDS_INFO"].includes(r.status) || (sp.edit === "1" && ["OPEN", "SELECTION"].includes(r.status));
  const checkout = await db.checkout.findFirst({ where: { requestId: r.id, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" } });
  const policy = await db.policy.findFirst({ where: { requestId: r.id } });
  const conv = await db.conversation.findFirst({ where: { contextType: "REQUEST", contextId: r.id } });

  let wizard = null;
  if (editing) {
    const docs = await db.document.findMany({ where: { requestId: r.id, kind: "UPLOAD" }, orderBy: { createdAt: "asc" } });
    const issues = r.status === "NEEDS_INFO" ? validateForm(schema, r.data as any, r.confirmed as any) : [];
    wizard = <RequestWizard key={r.version} published={r.currentVersion > 0} req={{ id: r.id, version: r.version, status: r.status, data: r.data as any, confirmed: r.confirmed as any, kind: r.kind }} sections={schema.sections as any} initialIssues={issues}
      docs={docs.map((d) => ({ id: d.id, title: d.title, status: d.status, scanNote: d.scanNote, suggestions: (d.extracted as any)?.suggestions ?? [], untrusted: (d.extracted as any)?.untrustedInstructions ?? [], note: (d.extracted as any)?.note ?? null }))} />;
  }
  const offers = r.currentVersion > 0 && !editing ? await offersForClient(ctx, r.id) : null;
  const a = offers?.auction;
  const open = a && (a.status === "OPEN" || a.status === "EXTENDED");
  const quarantine = editing && (await db.document.count({ where: { requestId: r.id, status: "QUARANTINE" } })) > 0;

  return (
    <>
      <PageTitle title={r.title} subtitle={<>Статус: <Status group="request" value={r.status} />{r.currentVersion > 0 && <> · опубликованная версия {r.currentVersion}</>}</>}
        actions={<>
          {conv && <Link href={`/c/messages/${conv.id}`} className="btn btn-secondary no-underline">Сообщения</Link>}
          {["OPEN", "SELECTION"].includes(r.status) && !editing && <Link href={`/c/requests/${r.id}?edit=1`} className="btn btn-secondary no-underline">Изменить данные</Link>}
          {["DRAFT", "NEEDS_INFO", "OPEN", "SELECTION"].includes(r.status) && <Action url={`/api/requests/${r.id}/cancel`} label="Отменить заявку" variant="danger" confirm="Отменить заявку? Предложения перестанут действовать." />}
        </>} />
      {(open || quarantine || r.status === "CHECKOUT") && <AutoRefresh />}
      {checkout && <Card className="mb-4" title="Оформление"><p className="text-sm">Вы выбрали предложение. <Status group="checkout" value={checkout.status} /> <Link href={`/c/checkouts/${checkout.id}`}>Перейти к оформлению</Link></p></Card>}
      {policy && <Card className="mb-4" title="Полис"><Link href={`/c/policies/${policy.id}`}>{policy.number}</Link></Card>}
      {editing && sp.edit === "1" && <p className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn">! Изменение существенных данных опубликованной заявки создаст новую версию: текущие предложения перестанут действовать, агентства получат уведомление.</p>}
      {wizard}
      {offers && (
        <div className="space-y-4">
          {a && r.kind === "CLASSIC" && (
            <Card title="Подбор предложений">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Status group="auction" value={a.status} />
                {open ? <Countdown label="До окончания приёма предложений" deadline={a.closesAt.toISOString()} serverNow={t.toISOString()} /> : <span>Приём завершён {fmtDate(a.closedAt ?? a.closesAt, true)}</span>}
              </div>
              <p className="mt-2 text-xs text-muted">Агентства могут улучшать цену до окончания срока. Если улучшение пришло за {DEMO_RULES.extendThresholdSec} секунд до конца, срок продлевается на {DEMO_RULES.extendBySec} секунд, но суммарно не более чем на {DEMO_RULES.maxExtensionSec / 60} минуты{a.extensionTotalSec ? ` (уже продлено на ${a.extensionTotalSec} с)` : ""}. Выбрать предложение можно в любой момент: выбор не обязан быть самым дешёвым.</p>
            </Card>
          )}
          {offers.groups.length === 0 ? <Empty title={open ? "Предложений пока нет" : "Предложений не поступило"} text={open ? "Страница обновляется автоматически." : "Можно изменить условия и опубликовать заявку заново."} /> :
            <OfferCompare requestId={r.id} requestVersion={r.currentVersion} groups={offers.groups} canSelect={!checkout && ["OPEN", "SELECTION"].includes(r.status)} />}
        </div>
      )}
    </>
  );
}
