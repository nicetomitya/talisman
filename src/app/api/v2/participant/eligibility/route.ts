import { api } from "@/server/api";
import * as EV from "@/server/ev/service";

export const GET = api({ auth: false }, async ({ ctx }) => EV.eligibility(ctx));
