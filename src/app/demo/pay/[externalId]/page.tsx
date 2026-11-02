import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { isDemo } from "@/server/config";
import { rub } from "@/server/money";
import { PayerActions } from "@/components/demo";

export const metadata = { title: "Эмулятор оплаты" };
export default async function DemoPay({ params }: { params: Promise<{ externalId: string }> }) {
  if (!isDemo()) notFound();
  const { externalId } = await params;
  const e = await db.emulatorPayment.findUnique({ where: { externalId } });
  if (!e) notFound();
  const p = await db.payment.findUnique({ where: { externalId } });
  const back = p?.checkoutId ? `/c/checkouts/${p.checkoutId}` : p?.invoiceId ? "/a/subscription" : "/";
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-8">
      <div className="card space-y-4">
        <p className="rounded bg-warn-soft p-2 text-xs text-warn">Эмулятор платёжного провайдера. Реальные деньги не списываются, данные карты не вводятся.</p>
        <h1 className="text-xl font-semibold">Оплата {rub(e.amountKop)}</h1>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Получатель</dt><dd>{p?.recipientLabel ?? "—"}</dd>
          <dt className="text-muted">Назначение</dt><dd>{e.purpose === "PREMIUM" ? "Страховая премия" : "Подписка на сервис"}</dd>
          <dt className="text-muted">Номер операции</dt><dd className="break-all">{e.externalId}</dd>
          <dt className="text-muted">Статус у провайдера</dt><dd>{e.status}</dd>
        </dl>
        {e.status === "PENDING" ? <PayerActions externalId={e.externalId} back={back} /> : <p className="text-sm">Операция завершена. <a href={back}>Вернуться в кабинет</a></p>}
      </div>
    </main>
  );
}
