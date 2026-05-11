import type { AIProvider, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";

export class HiDreamImageProvider implements AIProvider {
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.baseUrl = (
      params?.baseUrl ||
      "http://localhost:7860"
    ).replace(/\/+$/, "");
    this.model = params?.model || "HiDream-O1-Image-Dev";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(): Promise<string> {
    throw new Error("HiDream image models do not support text generation");
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const baseUrl = this.baseUrl;

    // Start generation job
    const startRes = await fetch(`${baseUrl}/api/generate/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "t2i",
        prompt,
        width: 2048,
        height: 2048,
        seed: 32,
        refs_b64: [],
        keep_original_aspect: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!startRes.ok) {
      const errText = await startRes.text().catch(() => "");
      throw new Error(`HiDream start failed: ${startRes.status} ${errText}`);
    }

    const { job_id } = (await startRes.json()) as { job_id: string };
    if (!job_id) throw new Error("HiDream: no job_id returned");

    // Poll SSE stream for result
    const imageBase64 = await this.pollStream(baseUrl, job_id);

    // Decode and save
    const buffer = Buffer.from(imageBase64, "base64");
    const filename = `${genId()}.png`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(`[HiDream] Saved: ${filepath}`);
    return filepath;
  }

  private async pollStream(baseUrl: string, jobId: string): Promise<string> {
    const url = `${baseUrl}/api/generate/stream/${jobId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`HiDream stream failed: ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error("HiDream: no response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(data); } catch { continue; }

        if (parsed.type === "done") {
          return parsed.image as string;
        }
        if (parsed.type === "error") {
          throw new Error(`HiDream error: ${parsed.message || "unknown"}`);
        }
      }
    }

    throw new Error("HiDream stream ended without result");
  }
}
