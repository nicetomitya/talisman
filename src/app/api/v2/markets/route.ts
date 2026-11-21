import { api } from "@/server/api";
import * as EV from "@/server/ev/service";
import { mockVenue, readOnlyMarketData } from "@/server/ev/venue";

export const GET = api({ auth: false }, async () => ({ items: await EV.listMarkets(), venues: [await mockVenue.getVenueStatus(), await readOnlyMarketData.getVenueStatus()] }));
