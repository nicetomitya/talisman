import { api } from "@/server/api";
import * as EV from "@/server/ev/service";
import { ownerFrom, clarifySchema } from "@/server/ev/http";


export const GET = api({ auth: false }, async ({ req, ctx, params }) => EV.getIntent(ownerFrom(req, ctx).owner, params.id));
export const PATCH = api({ auth: false, schema: clarifySchema }, async ({ req, ctx, params, body }) => {
  const { version, threshold, desiredPayoutUsd, budgetUsd, ...rest } = body;
  return EV.clarifyIntent(ownerFrom(req, ctx).owner, params.id, version, { ...rest, thresholdX100: threshold, desiredPayoutCents: desiredPayoutUsd, budgetCents: budgetUsd }, ctx);
});
