import { embedTextSafe } from "@/lib/embedding";
import { storeEmbedding, hasEmbedding } from "@/lib/vector-search";
import { getEmbeddingModel } from "@/lib/embedding";

type ContentType = "character" | "shot" | "scene" | "episode";

/**
 * Ensure a text embedding exists for (contentType, contentId).
 * If already cached, skip. Otherwise compute + store.
 * Returns the embedding vector, or null on failure.
 */
export async function ensureEmbedding(
  contentType: ContentType,
  contentId: string,
  text: string,
): Promise<number[] | null> {
  if (await hasEmbedding(contentType, contentId)) return null;

  const vec = await embedTextSafe(text);
  if (!vec) return null;

  const model = getEmbeddingModel();
  await storeEmbedding(contentType, contentId, vec, text.slice(0, 500), model);
  return vec;
}

/**
 * Batch-embed multiple items. Skips items that already have embeddings.
 * Returns count of newly stored embeddings.
 */
export async function ensureEmbeddings(
  items: Array<{ contentType: ContentType; contentId: string; text: string }>,
): Promise<number> {
  let stored = 0;
  for (const item of items) {
    const vec = await ensureEmbedding(item.contentType, item.contentId, item.text);
    if (vec) stored++;
  }
  return stored;
}
