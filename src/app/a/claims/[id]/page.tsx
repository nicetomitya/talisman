import { notFound } from "next/navigation";
import { requireAgencyPage } from "@/server/page";
import { db } from "@/server/db";
import { PageTitle } from "@/components/ui";
import { StaffClaimDetail } from "@/components/claimdetail";

export default async function AgencyClaim({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAgencyPage();
  const { id } = await params;
  const c = await db.claim.findFirst({ where: { id, agencyOrgId: ctx.org.orgId } });
  if (!c) notFound();
  return (<><PageTitle title="Обращение клиента" /><StaffClaimDetail claimId={c.id} role="AGENT" /></>);
}
