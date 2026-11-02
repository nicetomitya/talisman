import { NextResponse, type NextRequest } from "next/server";

/** Выдаёт CSRF-cookie (double-submit) и запрещает демомаршруты в боевом режиме. */
export function middleware(req: NextRequest) {
  const prod = process.env.APP_MODE === "production";
  const p = req.nextUrl.pathname;
  if (prod && (p.startsWith("/demo") || p.startsWith("/api/demo"))) return new NextResponse("Not found", { status: 404 });
  const res = NextResponse.next();
  if (!req.cookies.get("tcsrf")) {
    res.cookies.set("tcsrf", crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""), { httpOnly: false, sameSite: "lax", secure: req.nextUrl.protocol === "https:", path: "/" });
  }
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
