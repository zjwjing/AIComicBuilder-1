import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEFAULT_ASPECT_RATIO, DEFAULT_IMAGE_QUALITY } from "@/lib/config/defaults";
import { shots, characters, episodeCharacters, projects, episodes } from "@/lib/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import {
  type ModelConfig,
  ratioToImageOpts,
  getVersionedUploadDir,
  extractErrorMessage,
  getEpisodeCharacters,
  collectStoryboardEditReferences,
} from "@/lib/generate-utils";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import { resolveSlotContents } from "@/lib/ai/prompts/resolver";
import {
  buildFirstFramePrompt,
  buildLastFramePrompt,
} from "@/lib/ai/prompts/frame-generate";
import { buildSceneFramePrompt } from "@/lib/ai/prompts/scene-frame-generate";
import {
  loadShotLegacyViewsBatch,
  loadShotLegacyView,
  getActiveAsset,
  insertAssetVersion,
  patchAsset,
  type ShotAssetType,
  type ShotLegacyView,
} from "@/lib/shot-asset-utils";

async function resolveGenerationMode(projectId: string, episodeId?: string | null): Promise<string> {
  if (episodeId) {
    const [ep] = await db.select({ mode: episodes.generationMode }).from(episodes).where(eq(episodes.id, episodeId));
    if (ep?.mode) return ep.mode;
  }
  const [project] = await db.select({ mode: projects.generationMode }).from(projects).where(eq(projects.id, projectId));
  return project?.mode ?? "keyframe";
}

function getPanelFrames(view: ShotLegacyView): string[] {
  return view.panels.filter((p): p is string => !!p);
}

function buildPanelPrompt(params: {
  panelLabel: string;
  sceneDescription: string;
  panelDescription: string;
  characterDescriptions: string;
}) {
  return [
    `生成四宫格分镜中的 ${params.panelLabel}，作为一张高质量图像。`,
    "",
    "=== 场景描述 ===",
    params.sceneDescription,
    "",
    "=== 当前面板画面 ===",
    params.panelDescription,
    "",
    "=== 角色描述 ===",
    params.characterDescriptions,
    "",
    "要求：保持同一镜头内的角色、服装、光线、画风和空间连续性；画面应像漫画/分镜的单个 panel，而不是拼贴图。",
  ].join("\n");
}

async function upsertGeneratedAsset(params: {
  shotId: string;
  type: ShotAssetType;
  prompt: string;
  fileUrl: string;
  characters?: string[];
}) {
  const existing = await getActiveAsset(params.shotId, params.type, 0);
  if (existing) {
    await patchAsset(existing.id, { prompt: params.prompt, fileUrl: params.fileUrl, status: "completed" });
  } else {
    await insertAssetVersion({
      shotId: params.shotId,
      type: params.type,
      sequenceInType: 0,
      prompt: params.prompt,
      fileUrl: params.fileUrl,
      status: "completed",
      characters: params.characters,
    });
  }
}

export async function handleBatchFrameGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.image) {
    return NextResponse.json(
      { error: "No image model configured" },
      { status: 400 }
    );
  }

  const batchVersionId = payload?.versionId as string | undefined;
  const imageOpts = ratioToImageOpts(payload?.ratio as string | undefined);
  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db
    .select()
    .from(shots)
    .where(and(...shotWhereConditions))
    .orderBy(asc(shots.sequence));

  if (allShots.length === 0) {
    return NextResponse.json({ results: [], message: "No shots found" });
  }
  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));
  const generationMode = await resolveGenerationMode(projectId, episodeId);
  const is4Grid = generationMode === "4grid";

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  // Fetch only characters linked to this episode
  let frameCharacters: typeof characters.$inferSelect[];
  if (episodeId) {
    const linkedIds = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    frameCharacters = linkedIds.length > 0
      ? await db.select().from(characters).where(inArray(characters.id, linkedIds.map((r) => r.characterId)))
      : [];
  } else {
    frameCharacters = await db.select().from(characters).where(eq(characters.projectId, projectId));
  }

  const characterDescriptions = frameCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  const charsWithImages = frameCharacters.filter((c) => c.referenceImage);

  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
  const results: Array<{ shotId: string; sequence: number; status: string; firstFrame?: string; lastFrame?: string; panels?: string[]; error?: string }> = [];

  const overwrite = payload?.overwrite === true;
  const needProcess = allShots.filter((s) => {
    const v = allShotsLegacy.get(s.id);
    if (is4Grid) return overwrite || !v || getPanelFrames(v).length < 4;
    return overwrite || !v?.firstFrame || !v?.lastFrame;
  });
  const skipCount = allShots.length - needProcess.length;

  console.log(`[BatchFrameGenerate] Total: ${allShots.length} shots, need: ${needProcess.length}, skip: ${skipCount}, characters: ${frameCharacters.length}`);

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  // ── Serial per-shot generation ──
  // Process shots one at a time to avoid overwhelming local image generators.
  const total = allShots.length;
  let doneCount = 0;
  console.log(`[BatchFrameGenerate] Starting serial generation: 0/${total}`);

  for (const shot of allShots) {
    const shotLegacy = allShotsLegacy.get(shot.id);

    if (!overwrite && (is4Grid ? shotLegacy && getPanelFrames(shotLegacy).length === 4 : shotLegacy?.firstFrame && shotLegacy?.lastFrame)) {
      doneCount++;
      console.log(`[BatchFrameGenerate] ⊙ shot ${shot.sequence} skipped (${doneCount}/${total})`);
      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "skipped",
      });
      continue;
    }

    const startTime = Date.now();
    try {
      await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id));

      // Per-shot character filter: read the first_frame / last_frame asset
      // characters metadata (set by handleGenerateKeyframePrompts). Only
      // inject those characters' ref images into the image model, so shots
      // only see their relevant characters.
      const ffAssetExisting = await getActiveAsset(shot.id, "first_frame", 0);
      const lfAssetExisting = await getActiveAsset(shot.id, "last_frame", 0);
      const shotCharNameSet = new Set<string>([
        ...(ffAssetExisting?.characters ?? []),
        ...(lfAssetExisting?.characters ?? []),
      ]);
      const filteredChars = shotCharNameSet.size > 0
        ? charsWithImages.filter((c) => shotCharNameSet.has(c.name))
        : charsWithImages;
      const shotCharRefImages = filteredChars.map((c) => c.referenceImage!);
      const shotCharRefLabels = filteredChars.map((c) => c.name);
      const shotCharsForPersist = filteredChars.length > 0 ? filteredChars.map((c) => c.name) : undefined;

      if (is4Grid) {
        const panelInputs = [
          { type: "panel_1" as const, label: "PANEL 1（开场）", description: shotLegacy?.startFrameDesc || shot.prompt || "" },
          { type: "panel_2" as const, label: "PANEL 2（发展）", description: shot.prompt || shot.videoScript || "" },
          { type: "panel_3" as const, label: "PANEL 3（转折）", description: shot.motionScript || shot.videoScript || shot.prompt || "" },
          { type: "panel_4" as const, label: "PANEL 4（收束）", description: shotLegacy?.endFrameDesc || shot.videoScript || shot.prompt || "" },
        ];
        const generatedPanels: string[] = [];
        for (const panel of panelInputs) {
          const panelPrompt = buildPanelPrompt({
            panelLabel: panel.label,
            sceneDescription: shot.prompt || "",
            panelDescription: panel.description,
            characterDescriptions,
          });
          const panelPath = await ai.generateImage(panelPrompt, {
            ...imageOpts,
            quality: DEFAULT_IMAGE_QUALITY,
            referenceImages: [...generatedPanels, ...shotCharRefImages],
            referenceLabels: [...generatedPanels.map((_, i) => `Previous Panel ${i + 1}`), ...shotCharRefLabels],
          });
          await upsertGeneratedAsset({
            shotId: shot.id,
            type: panel.type,
            prompt: panel.description,
            fileUrl: panelPath,
            characters: shotCharsForPersist,
          });
          generatedPanels.push(panelPath);
        }

        await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shot.id));
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        doneCount++;
        console.log(`[BatchFrameGenerate] ✓ 4grid shot ${shot.sequence} (${doneCount}/${total}) ${elapsed}s`);
        results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", panels: generatedPanels });
        continue;
      }

      // Each shot is independent — generate its own first frame from prompt.
      const firstPrompt = buildFirstFramePrompt({
        sceneDescription: shot.prompt || "",
        startFrameDesc: shotLegacy?.startFrameDesc || shot.prompt || "",
        characterDescriptions,
        slotContents: frameFirstSlots,
      });
      const firstFramePath = await ai.generateImage(firstPrompt, {
        ...imageOpts,
        quality: DEFAULT_IMAGE_QUALITY,
        referenceImages: shotCharRefImages,
        referenceLabels: shotCharRefLabels,
      });

      const lastPrompt = buildLastFramePrompt({
        sceneDescription: shot.prompt || "",
        endFrameDesc: shotLegacy?.endFrameDesc || shot.prompt || "",
        characterDescriptions,
        firstFramePath,
        slotContents: frameLastSlots,
      });
      const lastFramePath = await ai.generateImage(lastPrompt, {
        ...imageOpts,
        quality: DEFAULT_IMAGE_QUALITY,
        referenceImages: [firstFramePath, ...shotCharRefImages],
        referenceLabels: ["首帧/First Frame", ...shotCharRefLabels],
      });

      await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shot.id));

      if (ffAssetExisting) await patchAsset(ffAssetExisting.id, { fileUrl: firstFramePath, status: "completed" });
      else
        await insertAssetVersion({
          shotId: shot.id,
          type: "first_frame",
          sequenceInType: 0,
          prompt: shotLegacy?.startFrameDesc ?? "",
          fileUrl: firstFramePath,
          status: "completed",
          characters: shotCharsForPersist,
        });
      if (lfAssetExisting) await patchAsset(lfAssetExisting.id, { fileUrl: lastFramePath, status: "completed" });
      else
        await insertAssetVersion({
          shotId: shot.id,
          type: "last_frame",
          sequenceInType: 0,
          prompt: shotLegacy?.endFrameDesc ?? "",
          fileUrl: lastFramePath,
          status: "completed",
          characters: shotCharsForPersist,
        });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      doneCount++;
      console.log(`[BatchFrameGenerate] ✓ shot ${shot.sequence} (${doneCount}/${total}) ${elapsed}s`);

      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "ok",
        firstFrame: firstFramePath,
        lastFrame: lastFramePath,
      });
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      doneCount++;
      console.error(`[BatchFrameGenerate] ✗ shot ${shot.sequence} (${doneCount}/${total}) ${elapsed}s:`, err);
      await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shot.id));
      results.push({
        shotId: shot.id,
        sequence: shot.sequence,
        status: "error",
        error: extractErrorMessage(err),
      });
    }
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;
  console.log(`[BatchFrameGenerate] Done: ${okCount} ok, ${errCount} errors, ${skipCount} skipped`);

  return NextResponse.json({ results });
}

export async function handleSingleFrameGenerate(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }
  const generationMode = await resolveGenerationMode(projectId, episodeId || shot.episodeId);
  const is4Grid = generationMode === "4grid";
  const shotLegacy = await loadShotLegacyView(shotId);

  // Read prompts from shot_assets — they were generated by the dedicated
  // "生成首尾帧提示词" step. Each shot is independent: no continuity chain.
  const ffAsset = await getActiveAsset(shotId, "first_frame", 0);
  const lfAsset = await getActiveAsset(shotId, "last_frame", 0);
  const startFramePromptText = ffAsset?.prompt || shot.prompt || "";
  const endFramePromptText = lfAsset?.prompt || shot.prompt || "";

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);
  const shotEpisodeId = episodeId || shot.episodeId;
  const projectCharacters = await getEpisodeCharacters(projectId, shotEpisodeId);

  const characterDescriptions = projectCharacters
    .map((c) => `${c.name}: ${c.description}`)
    .join("\n");

  // Per-shot character filter: only inject refs for characters declared
  // on the first_frame / last_frame asset metadata for this shot.
  const shotCharNameSet = new Set<string>([
    ...(ffAsset?.characters ?? []),
    ...(lfAsset?.characters ?? []),
  ]);
  const filteredChars = shotCharNameSet.size > 0
    ? projectCharacters.filter((c) => c.referenceImage && shotCharNameSet.has(c.name))
    : projectCharacters.filter((c) => c.referenceImage);
  const shotCharRefImages = filteredChars.map((c) => c.referenceImage as string);

  const ai = resolveImageProvider(modelConfig, versionedUploadDir);
  const imageOpts = ratioToImageOpts(payload?.ratio as string | undefined);

  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const frameLastSlots = await resolveSlotContents("frame_generate_last", { userId, projectId });

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    if (is4Grid) {
      const panelInputs = [
        { type: "panel_1" as const, label: "PANEL 1（开场）", description: shotLegacy.startFrameDesc || shot.prompt || "" },
        { type: "panel_2" as const, label: "PANEL 2（发展）", description: shot.prompt || shot.videoScript || "" },
        { type: "panel_3" as const, label: "PANEL 3（转折）", description: shot.motionScript || shot.videoScript || shot.prompt || "" },
        { type: "panel_4" as const, label: "PANEL 4（收束）", description: shotLegacy.endFrameDesc || shot.videoScript || shot.prompt || "" },
      ];
      const generatedPanels: string[] = [];
      for (const panel of panelInputs) {
        const panelPrompt = buildPanelPrompt({
          panelLabel: panel.label,
          sceneDescription: shot.prompt || "",
          panelDescription: panel.description,
          characterDescriptions,
        });
        const panelPath = await ai.generateImage(panelPrompt, {
          ...imageOpts,
          quality: DEFAULT_IMAGE_QUALITY,
          referenceImages: [...generatedPanels, ...shotCharRefImages],
        });
        await upsertGeneratedAsset({
          shotId,
          type: panel.type,
          prompt: panel.description,
          fileUrl: panelPath,
        });
        generatedPanels.push(panelPath);
      }

      await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shotId));
      return NextResponse.json({ shotId, panels: generatedPanels, status: "ok" });
    }

    const firstPrompt = buildFirstFramePrompt({
      sceneDescription: shot.prompt || "",
      startFrameDesc: startFramePromptText,
      characterDescriptions,
      slotContents: frameFirstSlots,
    });
    const firstFramePath = await ai.generateImage(firstPrompt, {
      ...imageOpts,
      quality: DEFAULT_IMAGE_QUALITY,
      referenceImages: shotCharRefImages,
    });

    const lastPrompt = buildLastFramePrompt({
      sceneDescription: shot.prompt || "",
      endFrameDesc: endFramePromptText,
      characterDescriptions,
      firstFramePath,
      slotContents: frameLastSlots,
    });
    const lastFramePath = await ai.generateImage(lastPrompt, {
      ...imageOpts,
      quality: DEFAULT_IMAGE_QUALITY,
      referenceImages: [firstFramePath, ...shotCharRefImages],
    });

    await db.update(shots).set({ status: "completed" }).where(eq(shots.id, shotId));

    if (ffAsset) await patchAsset(ffAsset.id, { fileUrl: firstFramePath, status: "completed" });
    else
      await insertAssetVersion({
        shotId,
        type: "first_frame",
        sequenceInType: 0,
        prompt: startFramePromptText,
        fileUrl: firstFramePath,
        status: "completed",
      });
    if (lfAsset) await patchAsset(lfAsset.id, { fileUrl: lastFramePath, status: "completed" });
    else
      await insertAssetVersion({
        shotId,
        type: "last_frame",
        sequenceInType: 0,
        prompt: endFramePromptText,
        fileUrl: lastFramePath,
        status: "completed",
      });

    return NextResponse.json({ shotId, firstFrame: firstFramePath, lastFrame: lastFramePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleFrameGenerate] Error for shot ${shotId}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json({ shotId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

export async function handleSingleStoryboardEdit(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string,
) {
  const shotId = payload?.shotId as string;
  if (!shotId) {
    return NextResponse.json({ error: "No shotId provided" }, { status: 400 });
  }
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);
  const references = collectStoryboardEditReferences(payload);
  const fallbackBaseImage = typeof payload?.baseImage === "string" ? payload.baseImage : references[0]?.path;
  if (!fallbackBaseImage) {
    return NextResponse.json({ error: "No base image/reference images provided" }, { status: 400 });
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const frameFirstSlots = await resolveSlotContents("frame_generate_first", { userId, projectId });
  const prompt = buildFirstFramePrompt({
    sceneDescription: shot.prompt || "",
    startFrameDesc: String(payload?.editInstruction || payload?.instruction || shot.prompt || ""),
    characterDescriptions: project?.title || "",
    slotContents: frameFirstSlots,
  });

  const imageProvider = resolveImageProvider(
    {
      ...modelConfig,
      image: modelConfig.image
        ? { ...modelConfig.image, modelId: modelConfig.image.modelId || "qwen-edit-dual" }
        : modelConfig.image,
    },
    versionedUploadDir,
  );

  try {
    const imagePath = await imageProvider.generateImage(prompt, {
      aspectRatio: payload?.ratio as string | undefined,
      quality: DEFAULT_IMAGE_QUALITY,
      editBaseImage: fallbackBaseImage,
      referenceImages: references.map((r) => r.path),
      referenceLabels: references.map((r) => r.label || r.role),
      referenceRoles: references.map((r) => r.role),
    });

    return NextResponse.json({ shotId, imagePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleStoryboardEdit] Error for shot ${shotId}:`, err);
    return NextResponse.json({ shotId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

export async function handleSingleSceneFrame(
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
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [shot] = await db.select().from(shots).where(eq(shots.id, shotId));
  if (!shot) {
    return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  }

  const versionedUploadDir = await getVersionedUploadDir(shot.versionId);

  try {
    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shotId));

    const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
    const slotContents = await resolveSlotContents("scene_frame_generate", { userId, projectId });
    const sceneFrameView = await loadShotLegacyView(shot.id);
    const sceneFramePrompt = buildSceneFramePrompt({
      sceneDescription: shot.prompt || "",
      charRefMapping: "",
      characterDescriptions: "",
      cameraDirection: shot.cameraDirection,
      startFrameDesc: sceneFrameView.startFrameDesc,
      motionScript: shot.motionScript,
      slotContents,
    });

    console.log(`[SingleSceneFrame] Shot ${shot.sequence}: generating scene-only frame (no character refs)`);

    // Scene-only: no character reference images injected.
    const sceneFramePath = await imageProvider.generateImage(sceneFramePrompt, {
      quality: DEFAULT_IMAGE_QUALITY,
    });

    {
      const refEx = await getActiveAsset(shotId, "reference", 0);
      if (refEx) {
        // Preserve pre-existing characters metadata on regeneration.
        await patchAsset(refEx.id, { fileUrl: sceneFramePath, status: "completed" });
      } else {
        // Fresh creation: copy characters from sibling ref assets if any.
        const siblingChars = sceneFrameView.referenceImages[0]?.characters ?? undefined;
        await insertAssetVersion({
          shotId,
          type: "reference",
          sequenceInType: 0,
          prompt: "",
          fileUrl: sceneFramePath,
          status: "completed",
          characters: siblingChars,
        });
      }
    }
    await db
      .update(shots)
      .set({ status: "pending" })
      .where(eq(shots.id, shotId));

    return NextResponse.json({ shotId, sceneRefFrame: sceneFramePath, status: "ok" });
  } catch (err) {
    console.error(`[SingleSceneFrame] Error for shot ${shot.sequence}:`, err);
    await db.update(shots).set({ status: "failed" }).where(eq(shots.id, shotId));
    return NextResponse.json(
      { shotId, status: "error", error: extractErrorMessage(err) },
      { status: 500 }
    );
  }
}

export async function handleBatchSceneFrame(
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const overwrite = payload?.overwrite === true;
  const ratio = (payload?.ratio as string) || DEFAULT_ASPECT_RATIO;
  const imageOpts = ratioToImageOpts(ratio);
  const batchVersionId = payload?.versionId as string | undefined;

  const shotWhereConditions = [eq(shots.projectId, projectId)];
  if (batchVersionId) shotWhereConditions.push(eq(shots.versionId, batchVersionId));
  if (episodeId) shotWhereConditions.push(eq(shots.episodeId, episodeId));
  const allShots = await db.select().from(shots).where(and(...shotWhereConditions)).orderBy(asc(shots.sequence));

  const versionedUploadDir = batchVersionId
    ? await getVersionedUploadDir(batchVersionId)
    : process.env.UPLOAD_DIR || "./uploads";

  const imageProvider = resolveImageProvider(modelConfig, versionedUploadDir);
  const allShotsLegacy = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));

  // Mark all eligible shots as generating
  const results: Array<{ shotId: string; sequence: number; status: string; generated?: number }> = [];

  for (const shot of allShots) {
    const refImages = allShotsLegacy.get(shot.id)?.referenceImages ?? [];
    const targets = overwrite
      ? refImages.filter((r) => r.prompt.trim())
      : refImages.filter((r) => r.status === "pending" && r.prompt.trim());

    if (targets.length === 0) {
      results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", generated: 0 });
      continue;
    }

    console.log(`[BatchSceneFrame] Shot ${shot.sequence}: ${targets.length} scene-only refs (no character injection)`);

    await db.update(shots).set({ status: "generating" }).where(eq(shots.id, shot.id));

    // Generate all ref images for this shot serially.
    let generated = 0;
    for (const entry of targets) {
      try {
        const imagePath = await imageProvider.generateImage(entry.prompt, {
          quality: DEFAULT_IMAGE_QUALITY,
          ...imageOpts,
        });
        await insertAssetVersion({
          shotId: shot.id, type: "reference", sequenceInType: entry.sequenceInType,
          prompt: entry.prompt, fileUrl: imagePath, status: "completed",
          characters: entry.characters ?? undefined,
        });
        generated++;
        console.log(`[BatchRefImage] Shot ${shot.sequence}: ref "${entry.id}" done`);
      } catch (err) {
        console.warn(`[BatchRefImage] Shot ${shot.sequence} ref ${entry.id} failed:`, err);
      }
    }

    await db
      .update(shots)
      .set({ status: "pending" })
      .where(eq(shots.id, shot.id));

    results.push({ shotId: shot.id, sequence: shot.sequence, status: "ok", generated });
  }

  return NextResponse.json({ results });
}
