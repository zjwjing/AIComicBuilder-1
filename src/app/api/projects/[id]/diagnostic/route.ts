import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, episodes, shots, shotAssets, storyboardVersions } from "@/lib/db/schema";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { getUserIdFromRequest } from "@/lib/get-user-id";

/** Structured per-shot diagnostic state */
interface ShotDiagnostic {
  id: string;
  sequence: number;
  episodeId: string | null;
  status: string;
  duration: number;
  hasPanel1: boolean;
  hasPanel2: boolean;
  hasPanel3: boolean;
  hasPanel4: boolean;
  hasFirstFrame: boolean;
  hasLastFrame: boolean;
  hasVideo: boolean;
  hasVideoPrompt: boolean;
  isStale: boolean;
  missingRequired: string[];
}

async function resolveProject(id: string, userId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return project ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = getUserIdFromRequest(request);
  const project = await resolveProject(id, userId);

  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allVersions = await db
    .select()
    .from(storyboardVersions)
    .where(eq(storyboardVersions.projectId, id))
    .orderBy(desc(storyboardVersions.versionNum));

  const latestVersion = allVersions[0] ?? null;

  const episodeRows = await db
    .select()
    .from(episodes)
    .where(eq(episodes.projectId, id))
    .orderBy(asc(episodes.sequence));

  const shotRows = latestVersion
    ? await db
        .select()
        .from(shots)
        .where(and(eq(shots.projectId, id), eq(shots.versionId, latestVersion.id)))
        .orderBy(asc(shots.sequence))
    : [];

  const shotIds = shotRows.map((s) => s.id);

  // Bulk-load all active assets for these shots
  const assetRows = shotIds.length
    ? await db
        .select()
        .from(shotAssets)
        .where(and(inArray(shotAssets.shotId, shotIds), eq(shotAssets.isActive, 1)))
    : [];

  // Group assets by shotId
  const assetsByShot = new Map<string, typeof assetRows>();
  for (const a of assetRows) {
    const list = assetsByShot.get(a.shotId);
    if (list) list.push(a);
    else assetsByShot.set(a.shotId, [a]);
  }

  // Determine required panel types based on generation mode
  const genMode = project.generationMode;
  const requiredPanelTypes: string[] =
    genMode === "4grid"
      ? ["panel_1", "panel_2", "panel_3", "panel_4"]
      : genMode === "keyframe"
        ? ["first_frame", "last_frame"]
        : ["reference"];

  const requiredVideoType =
    genMode === "4grid" || genMode === "keyframe"
      ? "keyframe_video"
      : "reference_video";

  const shotsDiagnostic: ShotDiagnostic[] = shotRows.map((shot) => {
    const assets = assetsByShot.get(shot.id) ?? [];
    const assetTypes = new Set(assets.map((a) => a.type));
    const completedAssets = assets.filter((a) => a.status === "completed");

    const hasPanel1 = assetTypes.has("panel_1") && completedAssets.some((a) => a.type === "panel_1");
    const hasPanel2 = assetTypes.has("panel_2") && completedAssets.some((a) => a.type === "panel_2");
    const hasPanel3 = assetTypes.has("panel_3") && completedAssets.some((a) => a.type === "panel_3");
    const hasPanel4 = assetTypes.has("panel_4") && completedAssets.some((a) => a.type === "panel_4");
    const hasFirstFrame = assetTypes.has("first_frame") && completedAssets.some((a) => a.type === "first_frame");
    const hasLastFrame = assetTypes.has("last_frame") && completedAssets.some((a) => a.type === "last_frame");
    const hasVideo = [assetTypes.has("keyframe_video"), assetTypes.has("reference_video")].some(Boolean)
      && completedAssets.some((a) => a.type === "keyframe_video" || a.type === "reference_video");
    const hasVideoPrompt = !!shot.videoPrompt;

    const missingRequired: string[] = [];
    for (const p of requiredPanelTypes) {
      const has = assets.some((a) => a.type === p && a.status === "completed");
      if (!has) missingRequired.push(p);
    }
    if (!hasVideo) missingRequired.push(requiredVideoType);

    return {
      id: shot.id,
      sequence: shot.sequence,
      episodeId: shot.episodeId,
      status: shot.status,
      duration: shot.duration,
      hasPanel1,
      hasPanel2,
      hasPanel3,
      hasPanel4,
      hasFirstFrame,
      hasLastFrame,
      hasVideo,
      hasVideoPrompt,
      isStale: !!shot.isStale,
      missingRequired,
    };
  });

  const totalShots = shotsDiagnostic.length;
  const completedShots = shotsDiagnostic.filter((s) => s.status === "completed").length;
  const failedShots = shotsDiagnostic.filter((s) => s.status === "failed").length;
  const stuckShots = shotsDiagnostic.filter((s) => s.status === "generating").length;
  const readyForVideo = shotsDiagnostic.filter((s) => !s.missingRequired.includes(requiredVideoType)).length;
  const shotsWithAllPanels = shotsDiagnostic.filter((s) =>
    requiredPanelTypes.every((p) => s.missingRequired.indexOf(p) === -1)
  ).length;
  const staleShots = shotsDiagnostic.filter((s) => s.isStale).length;
  const shotsWithVideoPrompt = shotsDiagnostic.filter((s) => s.hasVideoPrompt).length;

  return NextResponse.json({
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      generationMode: genMode,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    version: latestVersion
      ? { id: latestVersion.id, label: latestVersion.label, versionNum: latestVersion.versionNum }
      : null,
    episodes: episodeRows.map((e) => ({
      id: e.id,
      title: e.title,
      sequence: e.sequence,
      status: e.status,
      generationMode: e.generationMode,
    })),
    shots: shotsDiagnostic,
    summary: {
      totalShots,
      completedShots,
      failedShots,
      stuckShots,
      pendingShots: totalShots - completedShots - failedShots - stuckShots,
      readyForVideo,
      shotsWithAllPanels,
      shotsWithVideoPrompt,
      staleShots,
      completionPercent: totalShots ? Math.round((completedShots / totalShots) * 100) : 0,
      videoCompletionPercent: totalShots ? Math.round((readyForVideo / totalShots) * 100) : 0,
    },
    // Agent-readable diagnostic messages
    diagnostics: [
      ...(stuckShots > 0
        ? [{ severity: "warning" as const, code: "DIAG_001", message: `${stuckShots} shot(s) stuck in "generating" state`, fix: "Run reset_stuck_shots action" }]
        : []),
      ...(failedShots > 0
        ? [{ severity: "error" as const, code: "DIAG_002", message: `${failedShots} shot(s) failed`, fix: "Check individual shot errors and retry" }]
        : []),
      ...(staleShots > 0
        ? [{ severity: "warning" as const, code: "DIAG_003", message: `${staleShots} shot(s) stale (content changed after generation)`, fix: "Regenerate affected shots" }]
        : []),
      ...(shotsWithAllPanels > 0 && readyForVideo < totalShots
        ? [{ severity: "info" as const, code: "DIAG_004", message: `${totalShots - readyForVideo} shot(s) missing video`, fix: "Run batch_video_generate or single_video_generate" }]
        : []),
      ...(genMode === "4grid" && shotsWithAllPanels < totalShots
        ? [{ severity: "info" as const, code: "DIAG_005", message: `${totalShots - shotsWithAllPanels} shot(s) missing panel images`, fix: "Run batch_frame_generate or single_frame_generate" }]
        : []),
      ...(!latestVersion
        ? [{ severity: "error" as const, code: "DIAG_006", message: "No storyboard version found", fix: "Run shot_split action first" }]
        : []),
    ],
  });
}
