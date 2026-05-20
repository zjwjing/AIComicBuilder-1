import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, characters, dialogues } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  type ModelConfig,
  getVersionedUploadDir,
  extractErrorMessage,
  isCharacterOnScreen,
  getEpisodeCharacters,
  isComfyUIVideoModel,
} from "@/lib/generate-utils";
import { DEFAULT_ASPECT_RATIO, PORTRAIT_ASPECT_RATIO, DEFAULT_SHOT_DURATION, DEFAULT_CAMERA_DIRECTION } from "@/lib/config/defaults";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { resolveVideoProvider } from "@/lib/ai/provider-factory";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { buildVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { enhanceVideoPrompt } from "@/lib/ai/prompts/video-enhance";

import {
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
  insertAssetVersion,
} from "@/lib/shot-asset-utils";

export async function handleSingleVideoGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  const shotView = await loadShotLegacyView(shot.id);
  if (!shotView.firstFrame || !shotView.lastFrame) {
    return NextResponse.json({ error: "Shot frames not generated yet" }, { status: 400 });
  }

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  const shotCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));

    const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const videoSlots = await resolveSlotContents("video_generate", { userId, projectId });

  const is4Grid = modelConfig?.video?.modelId === "ltx-4grid";

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const requestedRatio = (payload?.ratio as string) || DEFAULT_ASPECT_RATIO;
    const ratio = isComfyUIVideoModel(modelConfig?.video)
      ? (requestedRatio === PORTRAIT_ASPECT_RATIO ? PORTRAIT_ASPECT_RATIO : DEFAULT_ASPECT_RATIO)
      : requestedRatio;

    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? DEFAULT_SHOT_DURATION, videoMaxDuration);

    const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
    const videoContextForDialogue = videoScript;

    const dialogueList = shotDialogues.map((d) => {
      const char = shotCharacters.find((c) => c.id === d.characterId);
      const characterName = char?.name ?? "Unknown";
      const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shotView.startFrameDesc);
      const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
      return {
        characterName,
        text: d.text,
        offscreen: !onScreen,
        visualHint,
      };
    });
    const basePrompt = shot.videoPrompt || buildVideoPrompt({
      videoScript,
      cameraDirection: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
      startFrameDesc: shotView.startFrameDesc ?? undefined,
      endFrameDesc: shotView.endFrameDesc ?? undefined,
      duration: effectiveDuration,
      characters: shotCharacters,
      dialogues: dialogueList.length > 0 ? dialogueList : undefined,
      slotContents: videoSlots,
    });

    const videoPrompt = is4Grid
      ? await enhanceVideoPrompt(
          `[FOUR-PANEL GRID STORYBOARD]
PANEL 1 (开场): ${shotView.startFrameDesc || videoScript}
PANEL 2 (发展): ${shotView.startFrameDesc ? "Scene progresses: " + videoScript : videoScript} — camera transition continues
PANEL 3 (转折): Story escalates — ${videoScript}
PANEL 4 (收束): ${shotView.endFrameDesc || videoScript}

Scene context: ${videoScript}
Camera direction: ${shot.cameraDirection || DEFAULT_CAMERA_DIRECTION}
Duration: ${effectiveDuration} seconds
Style: cinematic sequential storytelling, consistent characters and lighting across all panels`,
          modelConfig,
        )
      : await enhanceVideoPrompt(basePrompt, modelConfig);

    const fourGridRefs = is4Grid
      ? [
          shotView.firstFrame!,
          shotView.sceneRefFrame || shotView.firstFrame!,
          shotView.lastFrame!,
          shotView.sceneRefFrame || shotView.lastFrame!,
        ]
      : undefined;

    const result = await videoProvider.generateVideo({
      firstFrame: shotView.firstFrame,
      lastFrame: shotView.lastFrame,
      prompt: videoPrompt,
      duration: effectiveDuration,
      ratio,
      ...(fourGridRefs ? { referenceImages: fourGridRefs } : {}),
    });

    await insertAssetVersion({
      shotId, type: "keyframe_video", sequenceInType: 0,
      prompt: videoPrompt, fileUrl: result.filePath, status: "completed",
    });

    await db
      .update(shots)
      .set({ status: "completed" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, videoUrl: result.filePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleVideoGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

export async function handleBatchVideoGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const overwrite = payload?.overwrite === true;
  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));
  const eligible = allShots.filter((s) => {
    const v = allShotsLegacy.get(s.id);
    return v?.firstFrame && v?.lastFrame && (overwrite || !v?.videoUrl);
  });
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const batchCharacters = await getEpisodeCharacters(projectId, episodeId);

  const is4Grid = modelConfig?.video?.modelId === "ltx-4grid";
  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const requestedRatio = (payload?.ratio as string) || DEFAULT_ASPECT_RATIO;
  const ratio = isComfyUIVideoModel(modelConfig?.video)
    ? (requestedRatio === PORTRAIT_ASPECT_RATIO ? PORTRAIT_ASPECT_RATIO : DEFAULT_ASPECT_RATIO)
    : requestedRatio;
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const videoSlots = await resolveSlotContents("video_generate", { userId, projectId });

  const results: Array<{ shotId: string; sequence: number; status: "ok" | "error"; videoUrl?: string; error?: string }> = [];
  for (const shot of eligible) {
      try {
        const shotLegacy = allShotsLegacy.get(shot.id);
        const effectiveDuration = Math.min(shot.duration ?? DEFAULT_SHOT_DURATION, videoMaxDuration);
        const shotDialogues = await db
          .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
          .from(dialogues)
          .where(eq(dialogues.shotId, shot.id))
          .orderBy(asc(dialogues.sequence));

        const videoScript = shot.videoScript || shot.motionScript || shot.prompt || "";
        const videoContextForDialogue = videoScript;

        const dialogueList = shotDialogues.map((d) => {
          const char = batchCharacters.find((c) => c.id === d.characterId);
          const characterName = char?.name ?? "Unknown";
          const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shotLegacy?.startFrameDesc ?? null);
          const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
          return {
            characterName,
            text: d.text,
            offscreen: !onScreen,
            visualHint,
          };
        });

        const basePrompt = shot.videoPrompt || buildVideoPrompt({
          videoScript,
          cameraDirection: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
          startFrameDesc: shotLegacy?.startFrameDesc ?? undefined,
          endFrameDesc: shotLegacy?.endFrameDesc ?? undefined,
          duration: effectiveDuration,
          characters: batchCharacters,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          slotContents: videoSlots,
        });

        const videoPrompt = is4Grid
          ? await enhanceVideoPrompt(
              `[FOUR-PANEL GRID STORYBOARD]
PANEL 1 (开场): ${shotLegacy?.startFrameDesc || videoScript}
PANEL 2 (发展): ${shotLegacy?.startFrameDesc ? "Scene progresses: " + videoScript : videoScript} — camera transition continues
PANEL 3 (转折): Story escalates — ${videoScript}
PANEL 4 (收束): ${shotLegacy?.endFrameDesc || videoScript}

Scene context: ${videoScript}
Camera direction: ${shot.cameraDirection || DEFAULT_CAMERA_DIRECTION}
Duration: ${effectiveDuration} seconds
Style: cinematic sequential storytelling, consistent characters and lighting across all panels`,
              modelConfig,
            )
          : await enhanceVideoPrompt(basePrompt, modelConfig);

        await db
          .update(shots)
          .set({ status: "generating" })
          .where(eq(shots.id, shot.id));

        const fourGridRefs = is4Grid
          ? [
              shotLegacy!.firstFrame!,
              shotLegacy!.sceneRefFrame || shotLegacy!.firstFrame!,
              shotLegacy!.lastFrame!,
              shotLegacy!.sceneRefFrame || shotLegacy!.lastFrame!,
            ]
          : undefined;

        const result = await videoProvider.generateVideo({
          firstFrame: shotLegacy!.firstFrame!,
          lastFrame: shotLegacy!.lastFrame!,
          prompt: videoPrompt,
          duration: effectiveDuration,
          ratio,
          ...(fourGridRefs ? { referenceImages: fourGridRefs } : {}),
        });

        await insertAssetVersion({
          shotId: shot.id, type: "keyframe_video", sequenceInType: 0,
          prompt: videoPrompt, fileUrl: result.filePath, status: "completed",
        });
        await db
          .update(shots)
          .set({ status: "completed" })
          .where(eq(shots.id, shot.id));

        console.log(`[BatchVideoGenerate] Shot ${shot.sequence} completed`);
        results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", videoUrl: result.filePath });
      } catch (err) {
        console.error(`[BatchVideoGenerate] Error for shot ${shot.sequence}:`, err);
        await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
        results.push({ shotId: shot.id, sequence: shot.sequence, status: "error", error: extractErrorMessage(err) });
      }
  }

  return NextResponse.json({ results });
}
