import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createLanguageModel, extractJSON } from "@/lib/ai/ai-sdk";
import { db } from "@/lib/db";
import { projects, episodes, characters, episodeCharacters, characterRelations, shots } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  type ModelConfig,
  findBoundAgent,
  callAndValidateAgent,
  extractErrorMessage,
} from "@/lib/generate-utils";
import { resolvePrompt } from "@/lib/ai/prompts/resolver";
import { buildCharacterExtractPrompt } from "@/lib/ai/prompts/character-extract";
import { buildCharacterTurnaroundPrompt } from "@/lib/ai/prompts/character-image";
import { resolveImageProvider } from "@/lib/ai/provider-factory";
import { id as genId } from "@/lib/id";
import {
  loadShotLegacyViewsBatch,
  patchAsset,
} from "@/lib/shot-asset-utils";

export async function handleCharacterExtract(
  projectId: string,
  userId: string,
  _payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  let script: string | null = null;

  if (episodeId) {
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    script = episode?.script ?? null;
  } else {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    script = project?.script ?? null;
  }

  if (!script) {
    return NextResponse.json(
      { error: "Project or script not found" },
      { status: 404 }
    );
  }

  // Fetch all existing project characters for dedup
  const existingChars = await db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId));
  const existingByName = new Map(
    existingChars.map((c) => [c.name.toLowerCase().trim(), c])
  );

  // If extracting for an episode, capture the old episode-linked character ids
  // BEFORE deleting the links, so we can scope relation cleanup to this episode only.
  let oldEpisodeCharIds: string[] = [];
  if (episodeId) {
    const oldLinks = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    oldEpisodeCharIds = oldLinks.map((l) => l.characterId);
    await db.delete(episodeCharacters).where(eq(episodeCharacters.episodeId, episodeId));
  }

  let aiText: string;
  const boundAgent = await findBoundAgent(projectId, "character_extract");
  if (boundAgent) {
    const agentResult = await callAndValidateAgent(boundAgent, "character_extract", buildCharacterExtractPrompt(script));
    if (agentResult instanceof NextResponse) return agentResult;
    aiText = agentResult.text;
  } else {
    if (!modelConfig?.text) {
      return NextResponse.json({ error: "No text model configured" }, { status: 400 });
    }
    const model = createLanguageModel(modelConfig.text);
    const charExtractSystem = await resolvePrompt("character_extract", { userId, projectId });
    console.log("[CharacterExtract] resolved system prompt:\n", charExtractSystem);
    const { text } = await generateText({
      model,
      system: charExtractSystem,
      prompt: buildCharacterExtractPrompt(script),
    });
    aiText = text;
  }

  const parsed = JSON.parse(extractJSON(aiText));

  // Support both formats: new { characters, relationships } and legacy array
  const extracted: Array<{
    name: string;
    description: string;
    visualHint?: string;
    scope?: string;
    heightCm?: number;
    bodyType?: string;
    performanceStyle?: string;
  }> = Array.isArray(parsed) ? parsed : (parsed.characters || []);
  const extractedRelations: Array<{
    characterA: string;
    characterB: string;
    relationType: string;
    description?: string;
  }> = Array.isArray(parsed) ? [] : (parsed.relationships || []);

  let reusedCount = 0;
  let createdCount = 0;
  const linkedCharIds: string[] = [];

  for (const char of extracted) {
    const key = char.name.toLowerCase().trim();
    const existing = existingByName.get(key);

    if (existing) {
      // Reuse existing character — always update description from new extraction
      await db.update(characters)
        .set({
          description: char.description,
          visualHint: char.visualHint ?? existing.visualHint ?? "",
          scope: (char.scope === "guest" ? "guest" : "main") as "main" | "guest",
        })
        .where(eq(characters.id, existing.id));
      console.log(`[CharacterExtract] Updated existing character "${char.name}" (${existing.id}), desc length: ${char.description.length}`);
      linkedCharIds.push(existing.id);
      reusedCount++;
    } else {
      // Create new character
      const charId = genId();
      const scope = char.scope === "guest" ? "guest" : "main";
      await db.insert(characters).values({
        id: charId,
        projectId,
        name: char.name,
        description: char.description,
        visualHint: char.visualHint ?? "",
        heightCm: char.heightCm || 0,
        bodyType: char.bodyType || "average",
        performanceStyle: char.performanceStyle || "",
        scope,
        episodeId: null,
      });
      existingByName.set(key, { id: charId, name: char.name } as typeof existingChars[0]);
      linkedCharIds.push(charId);
      createdCount++;
    }
  }

  // Create episode_characters links
  if (episodeId) {
    for (const charId of linkedCharIds) {
      await db.insert(episodeCharacters).values({
        id: genId(),
        episodeId,
        characterId: charId,
      });
    }
  }

  // Auto-create character relationships from extraction — replace existing on re-run.
  // Scoping rule: a relation belongs to this episode iff BOTH endpoints are in the
  // episode's character list. Project-level extraction clears all project relations.
  if (extractedRelations.length > 0) {
    if (episodeId) {
      // Episode-scoped: only clear relations whose both endpoints were in this episode.
      if (oldEpisodeCharIds.length > 0) {
        await db
          .delete(characterRelations)
          .where(
            and(
              eq(characterRelations.projectId, projectId),
              inArray(characterRelations.characterAId, oldEpisodeCharIds),
              inArray(characterRelations.characterBId, oldEpisodeCharIds)
            )
          );
      }
    } else {
      // Project-level: clear everything for the project.
      await db.delete(characterRelations).where(eq(characterRelations.projectId, projectId));
    }

    const allChars = await db.select().from(characters).where(eq(characters.projectId, projectId));
    const nameToId = new Map(allChars.map((c) => [c.name, c.id]));

    for (const rel of extractedRelations) {
      const aId = nameToId.get(rel.characterA);
      const bId = nameToId.get(rel.characterB);
      if (aId && bId && aId !== bId) {
        try {
          await db.insert(characterRelations).values({
            id: genId(),
            projectId,
            characterAId: aId,
            characterBId: bId,
            relationType: rel.relationType || "neutral",
            description: rel.description || "",
          });
        } catch {
          // Skip duplicates
        }
      }
    }
  }

  console.log(
    `[CharacterExtract] ${extracted.length} characters: ${reusedCount} reused, ${createdCount} new, ${linkedCharIds.length} linked to episode, ${extractedRelations.length} relations`
  );

  return NextResponse.json({ characters: extracted });
}

export async function handleSingleCharacterImage(
  _projectId: string,
  _userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  _episodeId?: string
) {
  const characterId = payload?.characterId as string;
  if (!characterId) {
    return NextResponse.json({ error: "No characterId provided" }, { status: 400 });
  }

  if (!modelConfig?.image) {
    return NextResponse.json({ error: "No image model configured" }, { status: 400 });
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId));

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const ai = resolveImageProvider(modelConfig);
  const prompt = buildCharacterTurnaroundPrompt(character.description || character.name, character.name);

  try {
    const imagePath = await ai.generateImage(prompt, {
      size: "2560x1440",
      aspectRatio: "16:9",
      quality: "hd",
    });

    // Append to history
    let history: string[] = [];
    try {
      history = JSON.parse(character.referenceImageHistory || "[]");
    } catch {}
    if (character.referenceImage && !history.includes(character.referenceImage)) {
      history.push(character.referenceImage);
    }
    if (!history.includes(imagePath)) {
      history.push(imagePath);
    }

    await db
      .update(characters)
      .set({ referenceImage: imagePath, referenceImageHistory: JSON.stringify(history) })
      .where(eq(characters.id, characterId));

    // Mark downstream ref images stale: any shot's referenceImages that include this character
    // as a "characters" entry should have its generated items reset to pending so they're
    // regenerated with the new character reference image.
    const allShots = await db.select().from(shots).where(eq(shots.projectId, character.projectId));
    const legacyMap = await loadShotLegacyViewsBatch(allShots.map((s) => s.id));
    let staleCount = 0;
    for (const shot of allShots) {
      const view = legacyMap.get(shot.id);
      if (!view) continue;
      const refItems = view.referenceImages;
      let modified = false;
      for (const item of refItems) {
        if (item.characters?.includes(character.name) && item.status === "completed") {
          await patchAsset(item.id, { status: "pending", fileUrl: null });
          modified = true;
        }
      }
      if (modified) {
        staleCount++;
      }
    }
    console.log(`[SingleCharacterImage] ${character.name} regenerated; marked ${staleCount} shots' ref images as stale`);

    return NextResponse.json({ characterId, imagePath, status: "ok", staleShots: staleCount });
  } catch (err) {
    console.error(`[SingleCharacterImage] Error for ${character.name}:`, err);
    return NextResponse.json({ characterId, status: "error", error: extractErrorMessage(err) }, { status: 500 });
  }
}

export async function handleBatchCharacterImage(
  projectId: string,
  _userId: string,
  _payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string
) {
  if (!modelConfig?.image) {
    return NextResponse.json(
      { error: "No image model configured" },
      { status: 400 }
    );
  }

  let allCharacters: typeof characters.$inferSelect[];
  if (episodeId) {
    const linkedIds = await db
      .select({ characterId: episodeCharacters.characterId })
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId));
    allCharacters = linkedIds.length > 0
      ? await db.select().from(characters).where(inArray(characters.id, linkedIds.map((r) => r.characterId)))
      : [];
  } else {
    allCharacters = await db.select().from(characters).where(eq(characters.projectId, projectId));
  }

  const needImages = allCharacters.filter((c) => !c.referenceImage);
  if (needImages.length === 0) {
    return NextResponse.json({ results: [], message: "All characters already have images" });
  }

  const ai = resolveImageProvider(modelConfig);

  const results: Array<{ characterId: string; name: string; imagePath?: string; status: string; error?: string }> = [];

  for (const character of needImages) {
    try {
      const prompt = buildCharacterTurnaroundPrompt(character.description || character.name, character.name);
      const imagePath = await ai.generateImage(prompt, {
        size: "2560x1440",
        aspectRatio: "16:9",
        quality: "hd",
      });

      // Append to history
      let history: string[] = [];
      try { history = JSON.parse(character.referenceImageHistory || "[]"); } catch {}
      if (character.referenceImage && !history.includes(character.referenceImage)) history.push(character.referenceImage);
      if (!history.includes(imagePath)) history.push(imagePath);

      await db
        .update(characters)
        .set({ referenceImage: imagePath, referenceImageHistory: JSON.stringify(history) })
        .where(eq(characters.id, character.id));
      results.push({ characterId: character.id, name: character.name, imagePath, status: "ok" });
    } catch (err) {
      console.error(`[BatchCharacterImage] Error for ${character.name}:`, err);
      results.push({ characterId: character.id, name: character.name, status: "error", error: extractErrorMessage(err) });
    }
  }

  return NextResponse.json({ results });
}
