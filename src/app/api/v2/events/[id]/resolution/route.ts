import { api } from "@/server/api";
import * as EV from "@/server/ev/service";

export const GET = api({ auth: false }, async ({ params }) => EV.resolutionFor(params.id));
