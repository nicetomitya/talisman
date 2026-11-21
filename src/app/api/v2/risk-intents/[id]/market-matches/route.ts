import { api } from "@/server/api";
import * as EV from "@/server/ev/service";
import { ownerFrom } from "@/server/ev/http";

export const GET = api({ auth: false }, async ({ req, ctx, params }) => EV.marketMatches(ownerFrom(req, ctx).owner, params.id));
