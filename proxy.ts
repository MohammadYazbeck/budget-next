import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const REALM = "Budget Dashboard";

export function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Admin credentials are not configured.", { status: 503 });
    }

    return NextResponse.next();
  }

  if (isAuthorized(request.headers.get("authorization"), username, password)) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};

function isPublicPath(pathname: string) {
  return pathname === "/api/health";
}

function isAuthorized(header: string | null, username: string, password: string) {
  if (!header?.startsWith("Basic ")) return false;

  const decoded = decodeBasicAuth(header.slice("Basic ".length));

  if (!decoded) return false;

  const separator = decoded.indexOf(":");

  if (separator < 0) return false;

  return (
    safeEqual(decoded.slice(0, separator), username) &&
    safeEqual(decoded.slice(separator + 1), password)
  );
}

function decodeBasicAuth(value: string) {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}
