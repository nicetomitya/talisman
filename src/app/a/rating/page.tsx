import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { agencyRating } from "@/server/domain/reviews";
import { Card, PageTitle, fmtDate } from "@/components/ui";
import { InlineInput } from "@/components/client";

export default async function Rating() {
  const ctx = await requireAgencyPage();
  const rating = await agencyRating(ctx.org.orgId);
  const reviews = await db.review.findMany({ where: { agencyOrgId: ctx.org.orgId }, orderBy: { createdAt: "desc" } });
  return (<><PageTitle title="Рейтинг и отзывы" subtitle={rating.avg ? `Средняя оценка ${rating.avg} из 5 по ${rating.count} опубликованным отзывам. Отзывы оставляют только клиенты завершённых сделок.` : "Отзывов пока нет."} />
    <div className="space-y-3">{reviews.map((r) => <Card key={r.id}><p className="text-sm"><strong className="num">{r.rating}/5</strong> · {r.stage === "CLAIM" ? "урегулирование" : "покупка"} · {fmtDate(r.createdAt)}{r.status === "HIDDEN" && <span className="text-bad"> · скрыт модератором: {r.moderationNote}</span>}</p><p className="mt-1 text-sm">{r.text}</p>
      {r.agentReply ? <p className="mt-2 rounded bg-bg p-2 text-sm">Ваш ответ: {r.agentReply}</p> : <div className="mt-2"><InlineInput url="/api/agency/review-reply" name="reply" label="Ответ на отзыв" submit="Ответить" extra={{ reviewId: r.id }} textarea /></div>}</Card>)}</div></>);
}
