import { api } from "@/server/api";
import * as EV from "@/server/ev/service";

export const GET = api({ auth: false }, async ({ params }) => ({ market: await EV.getMarket(params.id), forecasts: await EV.publicForecasts(params.id) }));
