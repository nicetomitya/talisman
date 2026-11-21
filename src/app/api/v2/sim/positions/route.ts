import { api } from "@/server/api";
import { asClient } from "@/server/access";
import * as EV from "@/server/ev/service";

export const GET = api({}, async ({ ctx }) => ({ items: await EV.positions(asClient(ctx)), simulation: true }));
