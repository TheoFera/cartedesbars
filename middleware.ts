import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const BASIC_AUTH_HEADER = {
  "WWW-Authenticate": 'Basic realm="cartedesbars", charset="UTF-8"',
};

function unauthorized() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: BASIC_AUTH_HEADER,
  });
}

function parseAuthorizationHeader(authHeader: string | null) {
  if (!authHeader) return null;

  const [scheme, encoded] = authHeader.split(" ");
  if (!scheme || scheme.toLowerCase() !== "basic" || !encoded) return null;

  try {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function middleware(req: NextRequest) {
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASS;

  if (!expectedUser || !expectedPass) {
    return new NextResponse("Basic Auth is not configured.", { status: 500 });
  }

  const credentials = parseAuthorizationHeader(req.headers.get("authorization"));
  if (!credentials) return unauthorized();

  if (
    credentials.username !== expectedUser ||
    credentials.password !== expectedPass
  ) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
