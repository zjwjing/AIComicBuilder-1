import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";
import { streamBodyToFile } from "./stream-utils";

const AIVIDEO_ALLOWED_DURATIONS_V3 = [5, 10, 15, 20] as const;
const AIVIDEO_ALLOWED_DURATIONS_V1 = [5, 8] as const;

export class AivideoVideoProvider implements VideoProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.apiKey = (params?.apiKey || process.env.AIVIDEO_API_KEY || "").trim();
    this.baseUrl = (params?.baseUrl || "https://aivideomaker.ai").replace(/\/+$/, "");
    this.model = params?.model || "i2v_v3";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  private headers(): Record<string, string> {
    return {
      key: this.apiKey,
      "content-type": "application/json",
    };
  }

  private fileToDataUrl(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : "image/webp";
    const data = fs.readFileSync(filePath);
    return `data:${mime};base64,${data.toString("base64")}`;
  }

  private mapDuration(d: number): number {
    const clamped = Math.max(1, Math.round(d));
    const isV3 = this.model.includes("v3");
    const allowed = isV3 ? [...AIVIDEO_ALLOWED_DURATIONS_V3] : [...AIVIDEO_ALLOWED_DURATIONS_V1];
    let closest = allowed[0];
    for (const v of allowed) {
      if (Math.abs(v - clamped) < Math.abs(closest - clamped)) closest = v;
    }
    return closest;
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const duration = this.mapDuration(params.duration);
    const aspectRatio = params.ratio;

    if (this.model === "t2v" || this.model === "t2v_v3") {
      return this.generateT2v(params.prompt, duration, aspectRatio);
    }

    const imagePath = "firstFrame" in params && params.firstFrame
      ? params.firstFrame
      : "initialImage" in params && params.initialImage
        ? params.initialImage
        : null;
    if (!imagePath) {
      throw new Error("Aivideo: i2v requires firstFrame or initialImage");
    }

    const image = this.fileToDataUrl(imagePath);

    const body: Record<string, unknown> = {
      image,
      prompt: params.prompt || null,
      duration: String(duration),
    };

    if (this.model === "i2v") {
      body.aspectRatio = aspectRatio;
    }

    console.log(`[Aivideo] submit i2v: model=${this.model}, duration=${duration}s`);
    return this.submitAndPoll(body);
  }

  private async generateT2v(
    prompt: string,
    duration: number,
    aspectRatio: string,
  ): Promise<VideoGenerateResult> {
    console.log(`[Aivideo] submit t2v: model=${this.model}, duration=${duration}s`);
    return this.submitAndPoll({
      prompt,
      aspectRatio,
      duration: String(duration),
    });
  }

  private async submitAndPoll(body: Record<string, unknown>): Promise<VideoGenerateResult> {
    const submitRes = await fetch(`${this.baseUrl}/api/v1/generate/${this.model}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(`Aivideo submit failed: ${submitRes.status} ${errText}`);
    }

    const submitJson = (await submitRes.json()) as {
      status: string;
      taskId: string;
      message?: string;
    };

    if (submitJson.status !== "SUBMITTED") {
      throw new Error(`Aivideo submit error: ${submitJson.message || submitJson.status}`);
    }

    const taskId = submitJson.taskId;
    console.log(`[Aivideo] task submitted: ${taskId}`);

    const videoUrl = await this.pollForResult(taskId);

    const videoRes = await fetch(videoUrl, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!videoRes.ok) {
      throw new Error(`Aivideo download failed: ${videoRes.status}`);
    }

    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await streamBodyToFile(videoRes, filepath);

    console.log(`[Aivideo] saved: ${filepath}`);
    return { filePath: filepath };
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 120;
    let consecutiveFailures = 0;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5_000));

      const res = await fetch(`${this.baseUrl}/api/v1/tasks/${taskId}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        consecutiveFailures++;
        if (consecutiveFailures >= 5) {
          throw new Error(`Aivideo poll failed: ${res.status} after ${consecutiveFailures} consecutive failures`);
        }
        continue;
      }
      consecutiveFailures = 0;

      const json = (await res.json()) as { status: string; output?: { url?: string }; message?: string };
      console.log(`[Aivideo] poll ${i + 1}: status=${json.status}`);

      if (json.status === "COMPLETED") {
        const url = json.output?.url;
        if (!url) throw new Error("Aivideo: no video URL in completed task");
        return url;
      }

      if (json.status === "FAILED") {
        throw new Error(`Aivideo generation failed: ${json.message || "unknown"}`);
      }
    }

    throw new Error("Aivideo generation timed out after 10 minutes");
  }
}
