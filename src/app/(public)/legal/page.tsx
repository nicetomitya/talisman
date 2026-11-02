import { PageTitle, Card } from "@/components/ui";
import { PURPOSES, TEXT_VERSIONS } from "@/server/domain/consents";
export const metadata = { title: "Документы платформы" };
export default function Legal() {
  return (
    <>
      <PageTitle title="Документы платформы" subtitle="Демонстрационные тексты. Юридическую проверку проходят до пилота (блокер P1)." />
      <div className="space-y-3">
        {Object.entries(PURPOSES).map(([k, p]) => <Card key={k} title={`${p.title} · версия ${(TEXT_VERSIONS as any)[k]}`}><p className="text-sm">{p.text}</p><p className="mt-1 text-xs text-muted">{p.required ? "Обязательное для пользования сервисом" : "Необязательное, по умолчанию выключено"}</p></Card>)}
        <section id="cookies" className="card"><h2 className="font-semibold">Cookie</h2><p className="mt-2 text-sm">Обязательные: tsid (сессия, HttpOnly), tcsrf (защита от подделки запросов), tcookie (ваш выбор). Необязательная аналитика просмотров записывается только при согласии и выключается в настройках.</p></section>
        <section className="card"><h2 className="font-semibold">Роль платформы</h2><p className="mt-2 text-sm">Платформа не является страховщиком и не принимает премии на свой счёт. Премия оплачивается страховщику напрямую. Агентства работают по полномочиям страховщиков, срок которых проверяется перед каждым предложением.</p></section>
      </div>
    </>
  );
}
