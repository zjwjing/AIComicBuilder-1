import crypto from "node:crypto";

const AUTH_COOKIE = "ai_comic_auth";

interface Globals {
  __AUTH_SECRET?: string;
}

function getSecret(): string {
  const g = globalThis as unknown as Globals;
  if (g.__AUTH_SECRET) return g.__AUTH_SECRET;
  g.__AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomUUID().replace(/-/g, "");
  return g.__AUTH_SECRET;
}

function hmacSign(data: string): string {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    result[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return result;
}

function verifyToken(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const uid = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sig !== hmacSign(uid)) return null;
  return uid;
}

export function createSignedUserId(): string {
  const uid = crypto.randomUUID().replace(/-/g, "");
  return `${uid}.${hmacSign(uid)}`;
}

export function getUserIdFromRequest(request: Request): string {
  // 1. Try signed cookie
  const cookies = parseCookies(request.headers.get("cookie"));
  const cookieToken = cookies[AUTH_COOKIE];
  if (cookieToken) {
    const uid = verifyToken(cookieToken);
    if (uid) return uid;
  }
  // 2. Try signed x-user-id header
  const headerToken = request.headers.get("x-user-id") || "";
  if (headerToken.includes(".")) {
    const uid = verifyToken(headerToken);
    if (uid) return uid;
  }
  return "";
}
