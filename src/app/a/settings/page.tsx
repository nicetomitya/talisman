import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { Card } from "@/components/ui";
import { ApiForm } from "@/components/client";
import { SettingsView } from "@/components/settingsview";

export default async function AgencySettings() {
  const ctx = await requireAgencyPage();
  const o = await db.organization.findUniqueOrThrow({ where: { id: ctx.org.orgId } });
  return (
    <>
      {ctx.org.role === "AGENCY_OWNER" && <Card title="Публичный профиль агентства" className="mb-4"><ApiForm url="/api/agency/profile" submit="Сохранить профиль" successText="Сохранено" fields={[
        { name: "description", label: "Описание", type: "textarea", defaultValue: o.description ?? "" }, { name: "specialization", label: "Специализация", defaultValue: o.specialization ?? "" },
        { name: "territory", label: "Территория", defaultValue: o.territory ?? "" }, { name: "languages", label: "Языки", defaultValue: o.languages ?? "" }, { name: "responseMode", label: "Режим ответов", defaultValue: o.responseMode ?? "" }]} transformEmpty /></Card>}
      <SettingsView />
    </>
  );
}
