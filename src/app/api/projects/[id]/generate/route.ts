import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";
import { GenerateRequestSchema, parseOrThrow } from "@/lib/validation";
import { rateLimitMiddleware } from "@/lib/rate-limit";
import type { ModelConfig } from "@/lib/generate-utils";
import { summarizeProviderConfig } from "@/lib/generate-utils";
import { dispatchAction } from "@/lib/pipeline/handlers";

export const maxDuration = 300;

const _rateLimit = rateLimitMiddleware({ windowMs: 60_000, maxRequests: 20 });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const blocked = _rateLimit(request);
  if (blocked) return blocked;

  const { id: projectId } = await params;
  const userId = getUserIdFromRequest(request);

  const [ownerCheck] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!ownerCheck) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await request.json();
  const parsed = parseOrThrow(GenerateRequestSchema, raw);
  const { action, payload, episodeId } = parsed;
  const modelConfig = parsed.modelConfig as ModelConfig | undefined;
  console.log(`[Generate] action=${action}, projectId=${projectId}, episodeId=${episodeId || "none"}`);
  console.log("[Generate] modelConfig", {
    text: summarizeProviderConfig(modelConfig?.text),
    image: summarizeProviderConfig(modelConfig?.image),
    video: summarizeProviderConfig(modelConfig?.video),
  });

  const handler = dispatchAction(action, projectId, userId, payload, modelConfig, episodeId);
  if (!handler) {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
  return handler;
}

