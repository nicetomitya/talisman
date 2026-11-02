import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/page";
import { db } from "@/server/db";
import { PageTitle } from "@/components/ui";
import { StaffClaimDetail } from "@/components/claimdetail";
import { isCarrier } from "@/components/adminctx";

export default async function AdminClaim({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdminPage();
  const { id } = await params;
  const carrier = isCarrier(ctx);
  const c = await db.claim.findFirst({ where: { id, ...(carrier ? { carrierOrgId: ctx.org.orgId } : {}) } });
  if (!c) notFound();
  return (<><PageTitle title="Обращение" /><StaffClaimDetail claimId={c.id} role={carrier ? "CARRIER" : "ADMIN"} /></>);
}
