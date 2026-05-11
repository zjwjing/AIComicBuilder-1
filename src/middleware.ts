import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { createSignedUserId } from "@/lib/auth-edge";

const COOKIE_NAME = "ai_comic_auth";

const intlMiddleware = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
  const response = intlMiddleware(request);

  if (!request.cookies.get(COOKIE_NAME)) {
    const token = await createSignedUserId();
    response.cookies.set(COOKIE_NAME, token, {
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
