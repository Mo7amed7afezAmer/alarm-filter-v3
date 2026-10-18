// FR-26 / NFR-17: pages need a session (else redirect to /login); API calls need one (else 401
// JSON), except /api/health and /api/auth/*.
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

// Decision "P7 mobile login": POST /api/v1/auth/login is how the mobile app signs in.
const PUBLIC = [/^\/login(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/health(\/|$)/, /^\/api\/v1\/auth\/login$/];

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    // P3-T07: API tokens are checked by the route layer (lib/api.ts), which needs the database.
    if (/^Bearer\s+\S/i.test(req.headers.get("authorization") ?? "")) return NextResponse.next();
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "sign in required" } }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  login.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
