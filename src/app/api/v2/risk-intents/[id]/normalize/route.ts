import { api } from "@/server/api";
import * as EV from "@/server/ev/service";
import { ownerFrom, clarifySchema } from "@/server/ev/http";

/** Уточнить условия (синоним PATCH): сервер пересобирает намерение и список открытых вопросов. */
export const POST = api({ auth: false, schema: clarifySchema }, async ({ req, ctx, params, body }) => {
  const { version, threshold, desiredPayoutUsd, budgetUsd, ...rest } = body;
  return EV.clarifyIntent(ownerFrom(req, ctx).owner, params.id, version, { ...rest, thresholdX100: threshold, desiredPayoutCents: desiredPayoutUsd, budgetCents: budgetUsd }, ctx);
});
