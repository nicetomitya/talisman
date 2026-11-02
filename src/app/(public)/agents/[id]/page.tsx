import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { Card, KV, PageTitle, Status, fmtDate } from "@/components/ui";
import { agencyRating } from "@/server/domain/reviews";

export default async function AgentProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await db.organization.findUnique({ where: { id } });
  if (!o || o.type !== "AGENCY") notFound();
  const rating = await agencyRating(o.id);
  const reviews = await db.review.findMany({ where: { agencyOrgId: o.id, status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, take: 20 });
  const mandates = await db.mandate.findMany({ where: { agencyOrgId: o.id, status: "ACTIVE" } });
  const products = await db.product.findMany({ where: { id: { in: mandates.map((m) => m.productId) } } });
  return (
    <>
      <PageTitle title={o.name} subtitle={o.description ?? undefined} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Профиль">
          <KV items={[["Проверка платформой", <Status key="v" group="verification" value={o.verificationStatus} />], ["Проверка действует до", fmtDate(o.verifiedUntil)], ["Специализация", o.specialization ?? "—"], ["Территория", o.territory ?? "—"], ["Языки", o.languages ?? "—"], ["Режим ответов", o.responseMode ?? "—"], ["Полномочия", products.map((p) => p.title).join(", ") || "нет действующих"], ["Рейтинг", rating.avg ? `${rating.avg} из 5 (${rating.count} отзывов, только по завершённым сделкам)` : "пока нет отзывов"]]} />
          <p className="mt-3 text-xs text-muted">Демонстрационное агентство. Сведения вымышлены.</p>
        </Card>
        <Card title="Отзывы клиентов">
          {reviews.length === 0 ? <p className="text-sm text-muted">Отзывов пока нет.</p> :
            <ul className="space-y-3">{reviews.map((r) => <li key={r.id} className="border-b border-line pb-2 text-sm"><p><strong className="num">{r.rating} / 5</strong> · {r.stage === "CLAIM" ? "после обращения" : "после покупки"} · {fmtDate(r.createdAt)}</p><p className="mt-1">{r.text}</p>{r.agentReply && <p className="mt-1 rounded bg-bg p-2 text-muted">Ответ агентства: {r.agentReply}</p>}</li>)}</ul>}
        </Card>
      </div>
    </>
  );
}
