import Link from "next/link";
import { pageCtx } from "@/server/page";
import { invitationPreview } from "@/server/domain/crm";
import { Action } from "@/components/client";
import { fmtDate } from "@/components/ui";

export const metadata = { title: "Приглашение в кабинет" };

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await pageCtx().catch(() => null);
  const p = await invitationPreview(token).catch((e) => ({ error: String(e?.message ?? "Приглашение недействительно") }));
  return (
    <section className="card mx-auto max-w-lg space-y-3">
      <h1 className="text-xl font-semibold">Приглашение в кабинет «Талисман»</h1>
      {"error" in p ? <p role="alert" className="text-sm text-bad">✕ {p.error}</p> : <>
        <p className="text-sm">Агентство «{p.orgName}» предлагает хранить ваши полисы в личном кабинете: напоминания о продлении, документы и помощь при страховом случае в одном месте.</p>
        <ul className="list-disc space-y-1 pl-5 text-sm"><li>Регистрация бесплатная и необязательная: агентство продолжит обслуживать вас и без неё.</li><li>Вы сами подтверждаете данные и решаете, переносить ли полисы.</li><li>Для новых потребностей вы можете сравнить предложения разных агентств — приглашение не закрепляет вас за этим агентством.</li><li>Доступ можно отозвать в любой момент.</li></ul>
        <p className="text-xs text-muted">Ссылка действует до {fmtDate(p.expiresAt)}.</p>
        {ctx?.user.kind === "CLIENT" ? <Action url="/api/cabinet/invite-accept" body={{ token }} variant="primary" label="Принять приглашение" redirect="/c/agents" /> :
          ctx ? <p className="text-sm text-warn">! Вы вошли как сотрудник. Приглашение принимает клиент.</p> :
            <div className="flex flex-wrap gap-2"><Link className="btn btn-primary no-underline" href={`/login?next=/invite/${encodeURIComponent(token)}`}>Войти</Link><Link className="btn btn-secondary no-underline" href="/register">Зарегистрироваться</Link></div>}
        {!ctx && <p className="text-xs text-muted">После регистрации подтвердите email, войдите и откройте эту ссылку снова.</p>}
      </>}
    </section>
  );
}
