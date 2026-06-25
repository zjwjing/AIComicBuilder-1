import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";
import { streamBodyToFile } from "./stream-utils";

const AGNES_ASPECT_MAP: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1152, height: 648 },
  "9:16": { width: 648, height: 1152 },
  "1:1": { width: 768, height: 768 },
  "4:3": { width: 1024, height: 768 },
  "3:4": { width: 768, height: 1024 },
  "3:2": { width: 1152, height: 768 },
  "2:3": { width: 768, height: 1152 },
  "21:9": { width: 1344, height: 576 },
};

function resolveResolution(ratio: string): { width: number; height: number } {
  return AGNES_ASPECT_MAP[ratio] ?? { width: 1152, height: 768 };
}

function resolveFrameCount(durationSec: number): number {
  return Math.max(25, Math.min(193, Math.round(durationSec * 24)));
}

export class AgnesVideoProvider implements VideoProvider {
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
    this.apiKey = (params?.apiKey || process.env.AGNES_API_KEY || "").trim();
    this.baseUrl = (params?.baseUrl || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "");
    this.model = params?.model || "agnes-video-v2.0";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const { width, height } = resolveResolution(params.ratio);
    const numFrames = resolveFrameCount(params.duration);

    const body: Record<string, unknown> = {
      model: this.model,
      prompt: params.prompt,
      width,
      height,
      num_frames: numFrames,
      frame_rate: 24,
    };

    if ("firstFrame" in params && params.firstFrame) {
      body.image = this.fileToBase64(params.firstFrame);
    } else if ("initialImage" in params && params.initialImage) {
      body.image = this.fileToBase64(params.initialImage);
    }

    console.log(`[AgnesVideo] Submitting: model=${this.model}, ratio=${params.ratio}, ${width}x${height}, ${numFrames}fr`);

    const submitRes = await fetch(`${this.baseUrl}/videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(`Agnes video submit failed: ${submitRes.status} ${errText}`);
    }

    const submitJson = (await submitRes.json()) as {
      task_id: string;
      id?: string;
    };

    const taskId = submitJson.task_id || submitJson.id;
    if (!taskId) {
      throw new Error(`Agnes video: no task_id in submit response: ${JSON.stringify(submitJson)}`);
    }

    console.log(`[AgnesVideo] Task submitted: ${taskId}`);
    const videoUrl = await this.pollForResult(taskId);

    const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!videoRes.ok) {
      throw new Error(`Agnes video download failed: ${videoRes.status}`);
    }

    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    await streamBodyToFile(videoRes, filepath);

    console.log(`[AgnesVideo] Saved: ${filepath}`);
    return { filePath: filepath };
  }

  private fileToBase64(filePath: string): string {
    return fs.readFileSync(filePath).toString("base64");
  }

  private async pollForResult(taskId: string): Promise<string> {
    const maxAttempts = 120;
    let consecutiveFailures = 0;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5_000));

      const res = await fetch(`${this.baseUrl}/videos/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        consecutiveFailures++;
        if (consecutiveFailures >= 5) {
          throw new Error(`Agnes video poll failed: ${res.status} after ${consecutiveFailures} consecutive failures`);
        }
        continue;
      }
      consecutiveFailures = 0;

      const json = (await res.json()) as {
        status?: string;
        progress?: number;
        error?: string | null;
        remixed_from_video_id?: string;
        video_url?: string;
      };

      console.log(`[AgnesVideo] Poll ${i + 1}: status=${json.status}, progress=${json.progress}`);

      if (json.status === "completed") {
        const url = json.remixed_from_video_id || json.video_url;
        if (url) return url;
        throw new Error(`Agnes video: no URL in completed response: ${JSON.stringify(json)}`);
      }

      if (json.status === "failed") {
        throw new Error(`Agnes video generation failed: ${json.error || "unknown"}`);
      }
    }

    throw new Error(`Agnes video generation timed out after ${(maxAttempts * 5) / 60} minutes`);
  }
}
