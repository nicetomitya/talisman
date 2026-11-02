import { z } from "zod";
import { api } from "@/server/api";
import { asClient } from "@/server/access";
import { createRequest, suggestProduct } from "@/server/domain/requests";

export const POST = api({ schema: z.object({ productCode: z.enum(["KASKO", "PROPERTY", "RAIN01", "WIND01"]).optional(), freeText: z.string().max(2000).optional(), savedObjectId: z.string().uuid().optional() }).strict() }, async ({ ctx, body }) => {
  const c = asClient(ctx);
  const productCode = body.productCode ?? suggestProduct(body.freeText ?? "");
  if (!productCode) return { needProduct: true, message: "Не удалось определить вид страхования по описанию — выберите вручную" };
  const r = await createRequest(c, { productCode, freeText: body.freeText, savedObjectId: body.savedObjectId });
  return { id: r.id };
});
