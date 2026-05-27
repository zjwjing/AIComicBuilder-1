import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shots, characters, dialogues } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  type ModelConfig,
  getVersionedUploadDir,
  resolveGenerationMode,
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
  type ShotLegacyView,
} from "@/lib/shot-asset-utils";
import { diagnosticError } from "@/lib/pipeline/diagnostics";
import { execSync } from "node:child_process";

function getPanelFrames(view: ShotLegacyView): string[] {
  return view.panels.filter((p): p is string => !!p);
}

async function build4GridPrompt(slotKey: string, userId: string, projectId: string, replacements: Record<string, string>): Promise<string> {
  try {
    const slots = await resolveSlotContents(slotKey, { userId, projectId });
    const template = slots["structure_template"];
    if (template) {
      let result = template;
      for (const [key, val] of Object.entries(replacements)) {
        result = result.replaceAll(`{{${key}}}`, val);
      }
      return result;
    }
  } catch {
    // fall through to hardcoded default
  }
  const p1 = replacements["PANEL1_DESC"] ?? "";
  const p2 = replacements["PANEL2_DESC"] ?? "";
  const p3 = replacements["PANEL3_DESC"] ?? "";
  const p4 = replacements["PANEL4_DESC"] ?? "";
  return `[FOUR-PANEL GRID STORYBOARD]
PANEL 1 (开场): ${p1}
PANEL 2 (发展): ${p2}
PANEL 3 (转折): ${p3}
PANEL 4 (收束): ${p4}

Scene context: ${replacements["SCENE_CONTEXT"] ?? ""}
Camera direction: ${replacements["CAMERA_DIRECTION"] ?? ""}
Duration: ${replacements["DURATION"] ?? ""} seconds
Style: cinematic sequential storytelling, consistent characters and lighting across all panels`;
}

export async function handleSingleVideoGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json(
      diagnosticError("PIPE_001", "No shotId provided", "Pass payload.shotId when calling single video generation."),
      { status: 400 },
    );
  }
  if (!modelConfig?.video) {
    return NextResponse.json(
      diagnosticError("PIPE_002", "No video model configured", "Configure modelConfig.video before generating videos."),
      { status: 400 },
    );
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json(
      diagnosticError("PIPE_003", "Shot not found", "Verify the shotId belongs to the current project/version."),
      { status: 404 },
    );
  }
  const shotView = await loadShotLegacyView(shot.id);
  const genMode = await resolveGenerationMode(projectId, shot.episodeId);
  const is4Grid = genMode === "4grid";

  if (!is4Grid && (!shotView.firstFrame || !shotView.lastFrame)) {
    return NextResponse.json(
      diagnosticError("PIPE_004", "Shot frames not generated yet", "Generate first and last frames before video generation."),
      { status: 400 },
    );
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
          await build4GridPrompt("video_generate_4grid", userId, projectId, {
            PANEL1_DESC: shotView.startFrameDesc || shot.prompt || videoScript,
            PANEL2_DESC: shot.motionScript || videoScript,
            PANEL3_DESC: shot.prompt || videoScript,
            PANEL4_DESC: shotView.endFrameDesc || videoScript,
            SCENE_CONTEXT: videoScript,
            CAMERA_DIRECTION: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
            DURATION: String(effectiveDuration),
            SHOT_CHARACTERS: shotCharacters.map((c) => c.name).join(", "),
            DIALOGUES: dialogueList.length > 0 ? dialogueList.map((d) => `${d.characterName}: "${d.text}"`).join("\n") : "",
          }),
          modelConfig,
        )
      : await enhanceVideoPrompt(basePrompt, modelConfig);

    const fourGridRefs = is4Grid
      ? [shotView.panels[0], shotView.panels[1], shotView.panels[2], shotView.panels[3]].filter(Boolean) as string[]
      : undefined;

    if (is4Grid && (!fourGridRefs || fourGridRefs.length < 4)) {
      return NextResponse.json(
        diagnosticError("PIPE_005", "4-grid requires all 4 panel images. Upload panel images first.", "Generate or upload panel_1 to panel_4 before 4-grid video generation."),
        { status: 400 },
      );
    }

    const result = await videoProvider.generateVideo({
      ...(is4Grid
        ? { initialImage: fourGridRefs![0], firstFrame: undefined, lastFrame: undefined }
        : { firstFrame: shotView.firstFrame!, lastFrame: shotView.lastFrame! }
      ),
      prompt: videoPrompt,
      duration: effectiveDuration,
      ratio,
      ...(fourGridRefs ? { referenceImages: fourGridRefs } : {}),
    });

    // Trim tail-end panel flash for 4-grid videos
    let videoPath = result.filePath;
    if (is4Grid && videoPath) {
      try {
        const duration = execSync(
          `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
          { timeout: 10000, encoding: "utf-8" },
        ).trim();
        const dur = parseFloat(duration);
        if (dur > 2) {
          const trimmed = videoPath.replace(/\.mp4$/, "_trimmed.mp4");
          execSync(
            `ffmpeg -i "${videoPath}" -t ${dur - 1.5} -c copy -y "${trimmed}"`,
            { timeout: 30000, stdio: "ignore" },
          );
          videoPath = trimmed;
        }
      } catch (e) {
        console.warn("[SingleVideoGenerate] Trim failed, using original:", e);
      }
    }

    await db.update(shots).set({ videoPrompt }).where(eq(shots.id, shotId));

    await insertAssetVersion({
      shotId, type: "keyframe_video", sequenceInType: 0,
      prompt: videoPrompt, fileUrl: videoPath, status: "completed",
    });

    await db
      .update(shots)
      .set({ status: "completed" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, videoUrl: videoPath, status: "ok" });
  } catch (err) {
    console.error(`[SingleVideoGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      {
        shotId,
        status: "error",
        ...diagnosticError(
          "PIPE_006",
          extractErrorMessage(err),
          "Inspect the video provider logs and retry the shot after the upstream issue is resolved.",
        ),
      },
      { status: 500 },
    );
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
    return NextResponse.json(
      diagnosticError("PIPE_002", "No video model configured", "Configure modelConfig.video before generating videos."),
      { status: 400 },
    );
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
  const batchGenMode = await resolveGenerationMode(projectId, episodeId);
  const is4Grid = batchGenMode === "4grid";
  const eligible = allShots.filter((s) => {
    const v = allShotsLegacy.get(s.id);
    if (!v || (!overwrite && v.videoUrl)) return false;
    if (is4Grid) return getPanelFrames(v).length === 4;
    return !!(v.firstFrame && v.lastFrame);
  });
  if (eligible.length === 0) {
    return NextResponse.json({
      results: [],
      message: "No eligible shots",
      diagnostic: {
        code: "PIPE_009",
        severity: "warning",
        message: "No eligible shots",
        fix: "Generate the required frame assets or enable overwrite before running batch video generation.",
      },
    });
  }

  const batchCharacters = await getEpisodeCharacters(projectId, episodeId);

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const requestedRatio = (payload?.ratio as string) || DEFAULT_ASPECT_RATIO;
  const ratio = isComfyUIVideoModel(modelConfig?.video)
    ? (requestedRatio === PORTRAIT_ASPECT_RATIO ? PORTRAIT_ASPECT_RATIO : DEFAULT_ASPECT_RATIO)
    : requestedRatio;
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const videoSlots = await resolveSlotContents("video_generate", { userId, projectId });

  const results: Array<{ shotId: string; sequence: number; status: "ok" | "error"; videoUrl?: string; error?: string; diagnostic?: { code: string; severity: "info" | "warning" | "error"; message: string; fix: string } }> = [];
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
              await build4GridPrompt("video_generate_4grid", userId, projectId, {
                PANEL1_DESC: shotLegacy?.startFrameDesc || shot.prompt || videoScript,
                PANEL2_DESC: shot.motionScript || videoScript,
                PANEL3_DESC: shot.prompt || videoScript,
                PANEL4_DESC: shotLegacy?.endFrameDesc || videoScript,
                SCENE_CONTEXT: videoScript,
                CAMERA_DIRECTION: shot.cameraDirection || DEFAULT_CAMERA_DIRECTION,
                DURATION: String(effectiveDuration),
                SHOT_CHARACTERS: batchCharacters.map((c) => c.name).join(", "),
                DIALOGUES: dialogueList.length > 0 ? dialogueList.map((d) => `${d.characterName}: "${d.text}"`).join("\n") : "",
              }),
              modelConfig,
            )
          : await enhanceVideoPrompt(basePrompt, modelConfig);

        await db
          .update(shots)
          .set({ status: "generating" })
          .where(eq(shots.id, shot.id));

        const fourGridRefs = is4Grid ? getPanelFrames(shotLegacy!) : undefined;

        const result = await videoProvider.generateVideo({
          ...(is4Grid
            ? { initialImage: fourGridRefs![0], firstFrame: undefined, lastFrame: undefined }
            : { firstFrame: shotLegacy!.firstFrame!, lastFrame: shotLegacy!.lastFrame! }
          ),
          prompt: videoPrompt,
          duration: effectiveDuration,
          ratio,
          ...(fourGridRefs ? { referenceImages: fourGridRefs } : {}),
        });

        let videoPath = result.filePath;
        if (is4Grid && videoPath) {
          try {
            const duration = execSync(
              `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
              { timeout: 10000, encoding: "utf-8" },
            ).trim();
            const dur = parseFloat(duration);
            if (dur > 2) {
              const trimmed = videoPath.replace(/\.mp4$/, "_trimmed.mp4");
              execSync(
                `ffmpeg -i "${videoPath}" -t ${dur - 1.5} -c copy -y "${trimmed}"`,
                { timeout: 30000, stdio: "ignore" },
              );
              videoPath = trimmed;
            }
          } catch (e) {
            console.warn("[BatchVideoGenerate] Trim failed, using original:", e);
          }
        }

        await db.update(shots).set({ videoPrompt }).where(eq(shots.id, shot.id));

        await insertAssetVersion({
          shotId: shot.id, type: "keyframe_video", sequenceInType: 0,
          prompt: videoPrompt, fileUrl: videoPath, status: "completed",
        });
        await db
          .update(shots)
          .set({ status: "completed" })
          .where(eq(shots.id, shot.id));

        console.log(`[BatchVideoGenerate] Shot ${shot.sequence} completed`);
        results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", videoUrl: videoPath });
      } catch (err) {
        console.error(`[BatchVideoGenerate] Error for shot ${shot.sequence}:`, err);
        await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
        results.push({
          shotId: shot.id,
          sequence: shot.sequence,
          status: "error",
          error: extractErrorMessage(err),
          diagnostic: {
            code: "PIPE_006",
            severity: "error",
            message: extractErrorMessage(err),
            fix: "Inspect the video provider logs and retry the failed shot after the upstream issue is resolved.",
          },
        });
      }
  }

  return NextResponse.json({ results });
}
