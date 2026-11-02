import Link from "next/link";
import { Suspense } from "react";
import { isDemo } from "@/server/config";
import { DemoSwitch, LoginForm, Mailbox } from "@/components/auth";

export const metadata = { title: "Вход" };
const DEMO = [
  { email: "anna@client.test", title: "Клиент: Анна (каско, квартира, дождь)" },
  { email: "igor@client.test", title: "Клиент: Игорь (парусное занятие)" },
  { email: "owner@nadezhny.test", title: "Владелец агентства «Надёжный курс»" },
  { email: "agent@nadezhny.test", title: "Агент «Надёжный курс»" },
  { email: "owner@most.test", title: "Владелец агентства «Мост»" },
  { email: "agent1@most.test", title: "Агент «Мост»" },
  { email: "owner@parus.test", title: "Агентство «Парус и погода» (льготный период)" },
  { email: "owner@horizon.test", title: "Новое агентство без проверки" },
  { email: "admin1@talisman.test", title: "Администратор платформы" },
  { email: "admin2@talisman.test", title: "Второй администратор (согласования)" },
  { email: "support@talisman.test", title: "Поддержка платформы" },
  { email: "rep@severshield.test", title: "Представитель страховщика «Северный щит»" },
];
export default function Login() {
  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <section className="card"><h1 className="mb-4 text-xl font-semibold">Вход</h1><Suspense><LoginForm /></Suspense>
        <p className="mt-4 text-sm"><Link href="/register">Регистрация</Link> · <Link href="/reset">Забыли пароль?</Link></p></section>
      {isDemo() && (
        <div className="space-y-6">
          <section className="card"><h2 className="font-semibold">Быстрый вход в демо-роли</h2><p className="mb-3 mt-1 text-sm text-muted">Доступно только в демонстрационном режиме и только для вымышленных аккаунтов *.test. Пароль всех демо-аккаунтов указан в README.</p><DemoSwitch accounts={DEMO} /></section>
          <section className="card"><h2 className="font-semibold">Демопочта</h2><p className="mb-3 mt-1 text-sm text-muted">Здесь приходят ссылки подтверждения email, сброса пароля и демонстрационные коды подписи. Реальные письма не отправляются.</p><Mailbox /></section>
        </div>
      )}
    </div>
  );
}
