import { NextResponse } from "next/server";

// Next.js 16: Middleware is now called Proxy.
// Client-side Firebase Auth handles route protection via AuthGuard component.

export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
