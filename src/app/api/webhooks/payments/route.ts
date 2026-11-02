import { NextRequest, NextResponse } from "next/server";
import { processWebhook } from "@/server/domain/payments";
import { toAppError } from "@/server/api";
import { errorBody, newCorrelationId } from "@/server/errors";

/** Вход вебхуков провайдера: подпись HMAC (x-signature), без CSRF и сессии. Подтверждение оплаты — только отсюда или из сверки. */
export async function POST(req: NextRequest) {
  const cid = newCorrelationId();
  try {
    const raw = await req.text();
    const provider = req.nextUrl.searchParams.get("provider") === "saas" ? "DEMO_SAAS_PAY" : "DEMO_CARRIER_PAY";
    const r = await processWebhook(provider, raw, req.headers.get("x-signature"));
    return NextResponse.json(r);
  } catch (e) {
    const a = toAppError(e);
    return NextResponse.json(errorBody(a, cid), { status: a.status });
  }
}
