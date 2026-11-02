import { redirect } from "next/navigation";
import { pageCtx, homeFor } from "@/server/page";
export default async function Go() { redirect(homeFor(await pageCtx())); }
