import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  shots, episodes, projects, characters, dialogues, storyboardVersions,
} from "@/lib/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import {
  type ModelConfig,
  getVersionedUploadDir,
  extractErrorMessage,
  isCharacterOnScreen,
  getEpisodeCharacters,
  isComfyUIVideoModel,
  clampComfyUIDuration,
} from "@/lib/generate-utils";
import { getModelMaxDuration } from "@/lib/ai/model-limits";
import { resolveVideoProvider, resolveAIProvider } from "@/lib/ai/provider-factory";
import { resolvePrompt, resolveSlotContents } from "@/lib/ai/prompts/resolver";
import { buildVideoPrompt, buildReferenceVideoPrompt } from "@/lib/ai/prompts/video-generate";
import { buildRefVideoPromptRequest } from "@/lib/ai/prompts/ref-video-prompt-generate";
import { assembleVideo, extractLastFrame, concatVideos } from "@/lib/video/ffmpeg";
import { generateDialogueAudio } from "@/lib/audio/tts";
import {
  loadShotLegacyView,
  loadShotLegacyViewsBatch,
  insertAssetVersion,
} from "@/lib/shot-asset-utils";
import type { VideoGenerateParams } from "@/lib/ai/types";

const MAX_SEGMENT_DURATION = 5;

async function generateVideoSegments(
  videoProvider: { generateVideo(params: VideoGenerateParams): Promise<{ filePath: string; lastFrameUrl?: string }> },
  params: {
    firstFrame?: string;
    lastFrame?: string;
    initialImage?: string;
    prompt: string;
    duration: number;
    ratio: string;
    referenceImages?: string[];
  }
): Promise<{ filePath: string; segmentCount: number; lastFrameUrl?: string }> {
  const { duration, prompt, ratio, referenceImages } = params;

  if (duration <= MAX_SEGMENT_DURATION) {
    const result = await videoProvider.generateVideo(
      params.firstFrame
        ? { firstFrame: params.firstFrame, lastFrame: params.lastFrame!, prompt, duration, ratio, ...(referenceImages ? { referenceImages } : {}) }
        : { initialImage: params.initialImage!, prompt, duration, ratio, ...(referenceImages ? { referenceImages } : {}) }
    );
    return { filePath: result.filePath, segmentCount: 1, lastFrameUrl: result.lastFrameUrl };
  }

  const segmentCount = Math.ceil(duration / MAX_SEGMENT_DURATION);
  const segmentPaths: string[] = [];
  let currentFrame: string;

  if (params.firstFrame) {
    currentFrame = params.firstFrame;
  } else if (params.initialImage) {
    currentFrame = params.initialImage;
  } else {
    throw new Error("No start frame provided");
  }

  for (let i = 0; i < segmentCount; i++) {
    const isLast = i === segmentCount - 1;
    const segDuration = isLast
      ? duration - i * MAX_SEGMENT_DURATION
      : MAX_SEGMENT_DURATION;

    const segParams: VideoGenerateParams = isLast && params.lastFrame
      ? { firstFrame: currentFrame, lastFrame: params.lastFrame, prompt, duration: segDuration, ratio, ...(referenceImages ? { referenceImages } : {}) }
      : { initialImage: currentFrame, prompt, duration: segDuration, ratio, ...(referenceImages ? { referenceImages } : {}) };

    const result = await videoProvider.generateVideo(segParams);
    segmentPaths.push(result.filePath);
    currentFrame = result.lastFrameUrl ?? await extractLastFrame(result.filePath);
  }

  const filePath = await concatVideos(segmentPaths);
  return { filePath, segmentCount, lastFrameUrl: currentFrame };
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

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const requestedRatio = (payload?.ratio as string) || "16:9";
    const ratio = isComfyUIVideoModel(modelConfig?.video)
      ? (requestedRatio === "9:16" ? "9:16" : "16:9")
      : requestedRatio;

    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);

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
    const videoPrompt = shot.videoPrompt || buildVideoPrompt({
      videoScript,
      cameraDirection: shot.cameraDirection || "static",
      startFrameDesc: shotView.startFrameDesc ?? undefined,
      endFrameDesc: shotView.endFrameDesc ?? undefined,
      duration: effectiveDuration,
      characters: shotCharacters,
      dialogues: dialogueList.length > 0 ? dialogueList : undefined,
      slotContents: videoSlots,
    });

    const result = await generateVideoSegments(videoProvider, {
      firstFrame: shotView.firstFrame,
      lastFrame: shotView.lastFrame,
      prompt: videoPrompt,
      duration: effectiveDuration,
      ratio,
    });

    // Track video history via shot_assets keyframe_video slot
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

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const requestedRatio = (payload?.ratio as string) || "16:9";
  const ratio = isComfyUIVideoModel(modelConfig?.video)
    ? (requestedRatio === "9:16" ? "9:16" : "16:9")
    : requestedRatio;
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const videoSlots = await resolveSlotContents("video_generate", { userId, projectId });

  const results: Array<{ shotId: string; sequence: number; status: "ok" | "error"; videoUrl?: string; error?: string }> = [];
  for (const shot of eligible) {
      try {
        const shotLegacy = allShotsLegacy.get(shot.id);
        const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);
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

        const videoPrompt = shot.videoPrompt || buildVideoPrompt({
          videoScript,
          cameraDirection: shot.cameraDirection || "static",
          startFrameDesc: shotLegacy?.startFrameDesc ?? undefined,
          endFrameDesc: shotLegacy?.endFrameDesc ?? undefined,
          duration: effectiveDuration,
          characters: batchCharacters,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          slotContents: videoSlots,
        });

        await db
          .update(shots)
          .set({ status: "generating" })
          .where(eq(shots.id, shot.id));

        const result = await generateVideoSegments(videoProvider, {
          firstFrame: shotLegacy!.firstFrame!,
          lastFrame: shotLegacy!.lastFrame!,
          prompt: videoPrompt,
          duration: effectiveDuration,
          ratio,
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

export async function handleSingleReferenceVideo(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const shotId = payload?.shotId as string | undefined;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  const shotView = await loadShotLegacyView(shot.id);

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  const projectCharacters = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, shot.projectId));

  // Collect the union of character names declared on this shot's
  // reference assets — this is the precise set of characters the AI said
  // will act in this shot. Only these get passed to the video model.
  const shotCharNameSet = new Set<string>();
  for (const r of shotView.referenceImages) {
    for (const n of r.characters ?? []) shotCharNameSet.add(n);
  }

  const charRefs = projectCharacters
    .filter((c) => !!c.referenceImage && shotCharNameSet.has(c.name))
    .map((c) => ({ name: c.name, imagePath: c.referenceImage as string }));

  // charRefs may be empty — that's legal for shots with no characters
  // (pure environment / transition shots). Scene-only videos will be
  // generated from scene frames alone.

  const shotDialogues = await db
    .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
    .from(dialogues)
    .where(eq(dialogues.shotId, shotId))
    .orderBy(asc(dialogues.sequence));
  const videoContextForDialogue = shot.motionScript || shot.videoScript || shot.prompt || "";

  const dialogueList = shotDialogues.map((d) => {
    const char = projectCharacters.find((c) => c.id === d.characterId);
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

  const ratio = (payload?.ratio as string) || "16:9";
  const refVideoSlots = await resolveSlotContents("ref_video_generate", { userId, projectId });

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    // Step 1: Collect scene frames (pure environment) — may be multiple per shot
    //         (e.g. ground → sky transitions in an action beat).
    const sceneFramePaths: string[] = shotView.referenceImages
      .filter((r) => r.fileUrl)
      .sort((a, b) => a.sequenceInType - b.sequenceInType)
      .map((r) => r.fileUrl as string);

    if (sceneFramePaths.length === 0) {
      return NextResponse.json(
        { error: "No scene reference images. Please generate scene reference images first." },
        { status: 400 }
      );
    }

    console.log(`[SingleReferenceVideo] Shot ${shot.sequence}: ${sceneFramePaths.length} scene frame(s), ${charRefs.length} character ref(s)`);

    // Step 2: Build Seedance 2 multi-reference image list.
    //         Order matters — it becomes 图1, 图2, … in the mapping.
    const orderedRefImages: string[] = [
      ...charRefs.map((c) => c.imagePath),
      ...sceneFramePaths,
    ];

    // Build explicit index mapping for the prompt builder
    const characterRefInfos = charRefs.map((c, i) => ({
      name: c.name,
      index: i + 1,
      visualHint: projectCharacters.find((pc) => pc.name === c.name)?.visualHint,
    }));
    const sceneAssetList = shotView.referenceImages
      .filter((r) => r.fileUrl)
      .sort((a, b) => a.sequenceInType - b.sequenceInType);
    const sceneFrameInfos = sceneFramePaths.map((_, i) => {
      const metaObj = sceneAssetList[i]?.meta as { sceneName?: string } | null;
      const name = metaObj?.sceneName || (sceneFramePaths.length > 1 ? `场景-${i + 1}` : `场景`);
      return { label: name, index: charRefs.length + i + 1 };
    });
    const fullMapping = [
      ...characterRefInfos.map((c) => `@图片${c.index}是${c.name}`),
      ...sceneFrameInfos.map((s) => `@图片${s.index}是${s.label}`),
    ].join("，") + "。";

    const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);

    const videoModelId = modelConfig?.video?.modelId;
    const videoMaxDuration = getModelMaxDuration(videoModelId);
    const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);

    // Step 3: Use stored videoPrompt if available; otherwise auto-plan via AI
    let videoPrompt: string;
    if (shot.videoPrompt) {
      // If the stored prompt already has mapping, trust it; otherwise prepend.
      videoPrompt = shot.videoPrompt.includes("图像映射")
        ? shot.videoPrompt
        : `图像映射：${fullMapping}。\n\n${shot.videoPrompt}`;
    } else {
      const textProvider = resolveAIProvider(modelConfig);
      const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
      try {
        const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
        const promptRequest = buildRefVideoPromptRequest({
          motionScript: motionContext,
          cameraDirection: shot.cameraDirection || "static",
          duration: isComfyUIVideoModel(modelConfig?.video)
            ? clampComfyUIDuration(effectiveDuration)
            : effectiveDuration,
          characters: characterRefInfos,
          sceneFrames: sceneFrameInfos,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          mode: isComfyUIVideoModel(modelConfig?.video) ? "comfyui" : "default",
        });
        console.log(`[SingleReferenceVideo] Shot ${shot.sequence} promptRequest:\n${promptRequest}`);
        const rawPrompt = await textProvider.generateText(promptRequest, {
          systemPrompt: refVideoSystem,
          images: sceneFramePaths,
          temperature: 0.7,
        });
        videoPrompt = `Duration: ${isComfyUIVideoModel(modelConfig?.video) ? clampComfyUIDuration(effectiveDuration) : effectiveDuration}s.\n\n${rawPrompt.trim()}`;
      } catch (err) {
        console.warn("[SingleReferenceVideo] Vision prompt generation failed, falling back:", err);
        const fallback = buildReferenceVideoPrompt({
          videoScript: shot.videoScript || shot.motionScript || shot.prompt || "",
          cameraDirection: shot.cameraDirection || "static",
          duration: isComfyUIVideoModel(modelConfig?.video)
            ? clampComfyUIDuration(effectiveDuration)
            : effectiveDuration,
          characters: projectCharacters,
          dialogues: dialogueList.length > 0 ? dialogueList : undefined,
          slotContents: refVideoSlots,
        });
        videoPrompt = `图像映射：${fullMapping}。\n\n${fallback}`;
      }
    }

    console.log(`[SingleReferenceVideo] Shot ${shot.sequence}: generating video with ${orderedRefImages.length} reference images`);

    const result = await generateVideoSegments(videoProvider, {
      initialImage: sceneFramePaths[0],
      prompt: videoPrompt,
      duration: isComfyUIVideoModel(modelConfig?.video)
        ? clampComfyUIDuration(effectiveDuration)
        : effectiveDuration,
      ratio,
      referenceImages: orderedRefImages,
    });

    await insertAssetVersion({
      shotId, type: "reference_video", sequenceInType: 0,
      prompt: videoPrompt, fileUrl: result.filePath, status: "completed",
      meta: result.lastFrameUrl ? { lastFrameUrl: result.lastFrameUrl } : null,
    });
    await db
      .update(shots)
      .set({ status: "completed" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, referenceVideoUrl: result.filePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleReferenceVideo] Error for shot ${shot.sequence}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}

export async function handleBatchReferenceVideo(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.video) {
    return NextResponse.json({ error: "No video model configured" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
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
    return s.status !== "generating" && (overwrite || !v?.referenceVideoUrl);
  });
  if (eligible.length === 0) {
    return NextResponse.json({ results: [], message: "No eligible shots" });
  }

  const projectCharacters = await getEpisodeCharacters(projectId, episodeId);

  // Character list is now per-shot (derived from that shot's reference
  // assets' `characters` metadata). Project-wide charRefs is not used in
  // the batch pipeline anymore; it's computed fresh inside the shot loop.
  const charsWithRefsAll = projectCharacters.filter((c) => !!c.referenceImage);
  if (charsWithRefsAll.length === 0) {
    return NextResponse.json(
      { error: "No character reference images available." },
      { status: 400 }
    );
  }

  const videoProvider = resolveVideoProvider(modelConfig, versionedUploadDir);
  const textProvider = resolveAIProvider(modelConfig);
  const refVideoSystem = await resolvePrompt("ref_video_prompt", { userId, projectId });
  const ratio = (payload?.ratio as string) || "16:9";
  const videoMaxDuration = getModelMaxDuration(modelConfig?.video?.modelId);
  const refVideoSlots = await resolveSlotContents("ref_video_generate", { userId, projectId });

  // Mark all as generating
  await Promise.all(
    eligible.map((shot) =>
      db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id))
    )
  );

  const results: Array<{ shotId: string; sequence: number; status: "ok" | "error"; referenceVideoUrl?: string; error?: string }> = [];
  for (const shot of eligible) {
    try {
      const shotLegacy = allShotsLegacy.get(shot.id)!;
      const effectiveDuration = Math.min(shot.duration ?? 10, videoMaxDuration);
      const shotDialogues = await db
        .select({ text: dialogues.text, characterId: dialogues.characterId, sequence: dialogues.sequence })
        .from(dialogues)
        .where(eq(dialogues.shotId, shot.id))
        .orderBy(asc(dialogues.sequence));
      const videoContextForDialogue = shot.motionScript || shot.videoScript || shot.prompt || "";

      const dialogueList = shotDialogues.map((d) => {
        const char = projectCharacters.find((c) => c.id === d.characterId);
        const characterName = char?.name ?? "Unknown";
        const onScreen = isCharacterOnScreen(characterName, videoContextForDialogue, shotLegacy.startFrameDesc);
        const visualHint = onScreen ? (char?.visualHint || undefined) : undefined;
        return {
          characterName,
          text: d.text,
          offscreen: !onScreen,
          visualHint,
        };
      });

      // Step 1: Collect all scene frames (pure environments, ordered by sequenceInType)
      const sceneFramePaths: string[] = shotLegacy.referenceImages
        .filter((r) => r.fileUrl)
        .sort((a, b) => a.sequenceInType - b.sequenceInType)
        .map((r) => r.fileUrl as string);

      if (sceneFramePaths.length === 0) {
        throw new Error("No scene reference images. Generate scene reference images first.");
      }

      // Per-shot character set from ref assets' metadata
      const shotCharNameSet = new Set<string>();
      for (const r of shotLegacy.referenceImages) {
        for (const n of r.characters ?? []) shotCharNameSet.add(n);
      }
      const charRefs = charsWithRefsAll
        .filter((c) => shotCharNameSet.size === 0 || shotCharNameSet.has(c.name))
        .map((c) => ({ name: c.name, imagePath: c.referenceImage as string }));

      // Step 2: Build ordered Seedance 2 reference image list (chars first, scenes second)
      const orderedRefImages: string[] = [
        ...charRefs.map((c) => c.imagePath),
        ...sceneFramePaths,
      ];
      const characterRefInfos = charRefs.map((c, i) => ({
        name: c.name,
        index: i + 1,
        visualHint: projectCharacters.find((pc) => pc.name === c.name)?.visualHint,
      }));
      // Scene labels: prefer AI-generated sceneName from meta, fall back to index
      const sceneAssetList = shotLegacy.referenceImages
        .filter((r) => r.fileUrl)
        .sort((a, b) => a.sequenceInType - b.sequenceInType);
      const sceneFrameInfos = sceneFramePaths.map((_, i) => {
        const metaObj = sceneAssetList[i]?.meta as { sceneName?: string } | null;
        const name = metaObj?.sceneName || (sceneFramePaths.length > 1 ? `场景-${i + 1}` : `场景`);
        return { label: name, index: charRefs.length + i + 1 };
      });
      const fullMapping = [
        ...characterRefInfos.map((c) => `@图片${c.index}是${c.name}`),
        ...sceneFrameInfos.map((s) => `@图片${s.index}是${s.label}`),
      ].join("，") + "。";

      // Step 3: Resolve video prompt
      let videoPrompt: string;
      if (shot.videoPrompt) {
        videoPrompt = shot.videoPrompt.includes("图像映射")
          ? shot.videoPrompt
          : `图像映射：${fullMapping}。\n\n${shot.videoPrompt}`;
      } else {
        try {
          const motionContext = shot.motionScript || shot.videoScript || shot.prompt || "";
          const promptRequest = buildRefVideoPromptRequest({
            motionScript: motionContext,
            cameraDirection: shot.cameraDirection || "static",
            duration: isComfyUIVideoModel(modelConfig?.video)
              ? clampComfyUIDuration(effectiveDuration)
              : effectiveDuration,
            characters: characterRefInfos,
            sceneFrames: sceneFrameInfos,
            dialogues: dialogueList.length > 0 ? dialogueList : undefined,
            mode: isComfyUIVideoModel(modelConfig?.video) ? "comfyui" : "default",
          });
          const rawPrompt = await textProvider.generateText(promptRequest, {
            systemPrompt: refVideoSystem,
            images: sceneFramePaths,
            temperature: 0.7,
          });
          videoPrompt = `Duration: ${isComfyUIVideoModel(modelConfig?.video) ? clampComfyUIDuration(effectiveDuration) : effectiveDuration}s.\n\n${rawPrompt.trim()}`;
        } catch (err) {
          console.warn("[BatchReferenceVideo] Vision prompt generation failed, falling back:", err);
          const fallback = buildReferenceVideoPrompt({
            videoScript: shot.videoScript || shot.motionScript || shot.prompt || "",
            cameraDirection: shot.cameraDirection || "static",
            duration: isComfyUIVideoModel(modelConfig?.video)
              ? clampComfyUIDuration(effectiveDuration)
              : effectiveDuration,
            characters: projectCharacters,
            dialogues: dialogueList.length > 0 ? dialogueList : undefined,
            slotContents: refVideoSlots,
          });
          videoPrompt = `图像映射：${fullMapping}。\n\n${fallback}`;
        }
      }

      console.log(`[BatchReferenceVideo] Shot ${shot.sequence}: ${sceneFramePaths.length} scenes + ${charRefs.length} chars → video`);

      const result = await generateVideoSegments(videoProvider, {
        initialImage: sceneFramePaths[0],
        prompt: videoPrompt,
        duration: isComfyUIVideoModel(modelConfig?.video)
          ? clampComfyUIDuration(effectiveDuration)
          : effectiveDuration,
        ratio,
        referenceImages: orderedRefImages,
      });

      await insertAssetVersion({
        shotId: shot.id, type: "reference_video", sequenceInType: 0,
        prompt: videoPrompt, fileUrl: result.filePath, status: "completed",
        meta: result.lastFrameUrl ? { lastFrameUrl: result.lastFrameUrl } : null,
      });
      await db
        .update(shots)
        .set({ status: "completed" })
        .where(eq(shots.id, shot.id));

      console.log(`[BatchReferenceVideo] Shot ${shot.sequence} completed`);
      results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", referenceVideoUrl: result.filePath });
    } catch (err) {
      console.error(`[BatchReferenceVideo] Error for shot ${shot.sequence}:`, err);
      await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
      results.push({ shotId: shot.id, sequence: shot.sequence, status: "error", error: extractErrorMessage(err) });
    }
  }

  return NextResponse.json({ results });
}

export async function handleVideoAssembleSync(projectId: string, _userId: string, payload?: Record<string, unknown>, _modelConfig?: ModelConfig, episodeId?: string) {
  let generationModeValue: string = "keyframe";
  if (episodeId) {
    const [episode] = await db.select({ generationMode: episodes.generationMode }).from(episodes).where(eq(episodes.id, episodeId));
    generationModeValue = episode?.generationMode ?? "keyframe";
  } else {
    const [project] = await db.select({ generationMode: projects.generationMode }).from(projects).where(eq(projects.id, projectId));
    generationModeValue = project?.generationMode ?? "keyframe";
  }

  let versionId = payload?.versionId as string | undefined;

  // If no versionId provided, fall back to the latest version for this project/episode
  if (!versionId) {
    const versionWhere = episodeId
      ? and(eq(storyboardVersions.projectId, projectId), eq(storyboardVersions.episodeId, episodeId))
      : eq(storyboardVersions.projectId, projectId);
    const [latestVersion] = await db
      .select({ id: storyboardVersions.id })
      .from(storyboardVersions)
      .where(versionWhere)
      .orderBy(desc(storyboardVersions.versionNum))
      .limit(1);
    versionId = latestVersion?.id;
  }

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (versionId) shotWhereConditions.push(eq(shots.versionId, versionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const projectShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  const isReference = generationModeValue === "reference";
  const projectShotsLegacy = await loadShotLegacyViewsBatch(projectShots.map((s) => s.id));
  const videoPaths = projectShots
    .map((s) => {
      const v = projectShotsLegacy.get(s.id);
      return isReference ? v?.referenceVideoUrl : v?.videoUrl;
    })
    .filter(Boolean) as string[];

  if (videoPaths.length === 0) {
    return NextResponse.json({ error: "No video clips to assemble" }, { status: 400 });
  }

  // Build transitions array from shot transitionOut / transitionIn fields
  type TransitionType = "cut" | "dissolve" | "fade_in" | "fade_out" | "wipeleft" | "slideright" | "circleopen";
  const completedShots = projectShots.filter((s) => {
    const v = projectShotsLegacy.get(s.id);
    return isReference ? v?.referenceVideoUrl : v?.videoUrl;
  });
  const transitions: TransitionType[] = completedShots.slice(0, -1).map((shot, i) => {
    const nextShot = completedShots[i + 1];
    return ((shot.transitionOut && shot.transitionOut !== "cut")
      ? shot.transitionOut
      : (nextShot?.transitionIn || "cut")) as TransitionType;
  });

  // Get dialogues for subtitles
  const allSubtitles: {
    text: string;
    shotSequence: number;
    dialogueSequence: number;
    dialogueCount: number;
    startRatio?: number;
    endRatio?: number;
  }[] = [];
  for (const shot of completedShots) {
    const shotDialogues = await db
      .select({
        text: dialogues.text,
        characterName: characters.name,
        sequence: dialogues.sequence,
        shotSequence: shots.sequence,
        startRatio: dialogues.startRatio,
        endRatio: dialogues.endRatio,
      })
      .from(dialogues)
      .innerJoin(characters, eq(dialogues.characterId, characters.id))
      .innerJoin(shots, eq(dialogues.shotId, shots.id))
      .where(eq(dialogues.shotId, shot.id))
      .orderBy(asc(dialogues.sequence));

    const count = shotDialogues.length;
    shotDialogues.forEach((d, idx) => {
      const sr = d.startRatio ? parseFloat(String(d.startRatio)) : undefined;
      const er = d.endRatio ? parseFloat(String(d.endRatio)) : undefined;
      allSubtitles.push({
        text: `${d.characterName}: ${d.text}`,
        shotSequence: d.shotSequence,
        dialogueSequence: idx,
        dialogueCount: count,
        startRatio: sr,
        endRatio: er,
      });
    });
  }

  // Generate TTS audio for dialogues
  const shotDurations = completedShots.map((s) => s.duration ?? 10);
  const shotStartTimes: number[] = [];
  let cumTime = 0;
  for (const d of shotDurations) {
    shotStartTimes.push(cumTime);
    cumTime += d;
  }

  const dialogueAudio: { path: string; startTime: number; endTime: number }[] = [];
  for (const sub of allSubtitles) {
    const shotIdx = sub.shotSequence - 1;
    if (shotIdx < 0 || shotIdx >= shotDurations.length) continue;
    const sr = sub.startRatio ?? 0;
    const er = sub.endRatio ?? 1;
    const startTime = shotStartTimes[shotIdx] + shotDurations[shotIdx] * sr;
    const endTime = shotStartTimes[shotIdx] + shotDurations[shotIdx] * er;
    const audioPath = await generateDialogueAudio(sub.text);
    if (audioPath) {
      dialogueAudio.push({ path: audioPath, startTime, endTime });
    }
  }

  try {
    const result = await assembleVideo({
      videoPaths,
      subtitles: allSubtitles,
      projectId,
      shotDurations,
      transitions,
      dialogueAudio: dialogueAudio.length > 0 ? dialogueAudio : undefined,
    });

    if (episodeId) {
      await db
        .update(episodes)
        .set({ status: "completed", finalVideoUrl: result.videoPath, updatedAt: new Date() })
        .where(eq(episodes.id, episodeId));
    } else {
      await db
        .update(projects)
        .set({ status: "completed", finalVideoUrl: result.videoPath, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    }

    console.log(`[VideoAssemble] Completed: ${result.videoPath}`);
    return NextResponse.json({ outputPath: result.videoPath, srtPath: result.srtPath, status: "ok" });
  } catch (err) {
    console.error("[VideoAssemble] Error:", err);
    return NextResponse.json({ status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}
