interface Globals {
  __AUTH_SECRET?: string;
}

function getSecret(): string {
  const g = globalThis as unknown as Globals;
  if (g.__AUTH_SECRET) return g.__AUTH_SECRET;
  g.__AUTH_SECRET = process.env.AUTH_SECRET || randomId();
  return g.__AUTH_SECRET;
}

function randomId(): string {
  const arr = new Uint32Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => n.toString(36)).join("");
}

export async function createSignedUserId(): Promise<string> {
  const uid = randomId();
  const sig = await hmacSign(uid);
  return `${uid}.${sig}`;
}

async function hmacSign(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
