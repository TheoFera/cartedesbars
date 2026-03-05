import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER || "";
  const pass = process.env.BASIC_AUTH_PASS || "";

  const auth = req.headers.get("authorization");
  if (!auth) {
    return new NextResponse("Auth required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Secure Area"' },
    });
  }

  const [scheme, encoded] = auth.split(" ");
  if (scheme !== "Basic" || !encoded) {
    return new NextResponse("Bad auth", { status: 401 });
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const [u, p] = decoded.split(":");

  if (u === user && p === pass) return NextResponse.next();

  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Secure Area"' },
  });
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};