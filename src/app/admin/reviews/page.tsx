import { redirect } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { MODERATION_REASONS } from "@/server/domain/reviews";
import { Card, PageTitle, fmtDate } from "@/components/ui";
import { Action } from "@/components/client";
import { isCarrier } from "@/components/adminctx";

export default async function Reviews() {
  const ctx = await requireAdminPage();
  if (isCarrier(ctx)) redirect("/admin");
  const list = await db.review.findMany({ orderBy: { createdAt: "desc" } });
  const orgs = await db.organization.findMany({ where: { id: { in: list.map((r) => r.agencyOrgId) } } });
  return (<><PageTitle title="Модерация отзывов" subtitle="Скрыть отзыв можно только по одной из опубликованных причин. Отзыв не удаляется, причина видна автору." />
    <div className="space-y-3">{list.map((r) => <Card key={r.id}><p className="text-sm"><strong>{orgs.find((o) => o.id === r.agencyOrgId)?.name}</strong> · {r.rating}/5 · {fmtDate(r.createdAt)} · {r.status === "HIDDEN" ? `скрыт: ${r.moderationNote}` : "опубликован"}</p><p className="mt-1 text-sm">{r.text}</p>
      {r.status === "PUBLISHED" && <div className="mt-2 flex flex-wrap gap-2">{Object.entries(MODERATION_REASONS).map(([k, v]) => <Action key={k} url="/api/admin/hide-review" body={{ id: r.id, reason: k }} label={`Скрыть: ${v}`} variant="secondary" />)}</div>}</Card>)}</div></>);
}
