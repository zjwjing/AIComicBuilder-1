import type { VideoProvider, VideoGenerateParams, VideoGenerateResult, CameraControl } from "../types";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { id as genId } from "@/lib/id";
import { buildLTXi2vT2vWorkflow, buildLTXFlf2vWorkflow, getSigmaSchedules, getCameraLoRAName } from "./ltx-workflows";

const LTX_PRO_NEGATIVE =
  "pc game, console game, video game, cartoon, childish, ugly,nsfw,\u6587\u5b57\uff0c\u6c34\u5370\uff0c\u5b57\u5e55\uff0ctext, subtitles, captions, burned-in text, overlay text, watermark, logo, signature, numbers, letters, blurry text, garbage characters, unreadable symbols";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ComfyNode = { inputs: Record<string, unknown>; class_type?: string; _meta?: { title?: string } };

type ComfyPromptResponse = {
  prompt_id?: string;
  error?: string;
};

type ComfyOutputFile = { filename: string; subfolder?: string; type?: string };
type ComfyHistoryRecord = {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown[];
  };
  outputs?: Record<string, Record<string, ComfyOutputFile[]>>;
};

const COMFYUI_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR || "M:\\ComfyUI_windows_portable\\ComfyUI\\output";

export class ComfyUIVideoProvider implements VideoProvider {
  private baseUrl: string;
  private model: string;
  private uploadDir: string;
  private authToken?: string;
  private authCookie?: string;

  constructor(params?: { baseUrl?: string; model?: string; uploadDir?: string; authToken?: string; authCookie?: string }) {
    this.baseUrl = (params?.baseUrl || process.env.COMFYUI_BASE_URL || "http://localhost:8188").replace(/\/+$/, "");
    this.model = params?.model || "wan-i2v";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.authToken = params?.authToken || process.env.COMFYUI_AUTH_TOKEN;
    this.authCookie = params?.authCookie || process.env.COMFYUI_AUTH_COOKIE;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    if (this.authCookie) {
      headers["Cookie"] = this.authCookie;
    }
    return headers;
  }

  private templatesDir = path.resolve(__dirname, "templates");

  private buildWanWorkflow(params: VideoGenerateParams, outputPrefix: string): Record<string, unknown> {
    if (!params.initialImage) {
      throw new Error("ComfyUI Wan video provider requires an initial image");
    }

    const durationSec = Math.min(10, Math.max(1, Math.round(params.duration || 5)));
    const numFrames = durationSec * 24 + 1;
    const positivePrompt = params.prompt || "";
    const negativePrompt = "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走, censored, mosaic censoring, bar censor, pixelated, glowing, bloom, blurry, day, out of focus, low detail, bad anatomy, ugly, overexposed, underexposed, distorted face, extra limbs, cartoonish, 3d render artifacts, duplicate people, unnatural lighting, bad composition, missing shadows, low resolution, poorly textured, glitch, noise, grain, static, motionless, still frame, overall grayish, worst quality, low quality, JPEG compression artifacts, subtitles, stylized, artwork, painting, illustration, cluttered background, many people in background, three legs, walking backward, zoom out, zoom in, mouth speaking, moving mouth, talking, speaking, mute speaking, unnatural skin tone, discolored eyelid, red eyelids, red upper eyelids, no red eyeshadow, closed eyes, no wide-open innocent eyes, poorly drawn hands, extra fingers, fused fingers, poorly drawn face, deformed, disfigured, malformed limbs, thighs, fog, mist, voluminous eyelashes, blush,";

    const startImage = path.basename(params.initialImage);

    const [width, height] = params.ratio === "16:9" ? [832, 480] : [480, 832];

    const templatePath = path.join(this.templatesDir, "wan-i2v-api.json");
    let raw = fs.readFileSync(templatePath, "utf-8");

    // Replace simple placeholders first (clean values, no special chars)
    raw = raw.replaceAll("{{seed_high}}", String(Math.floor(Math.random() * 1_000_000_000_000)));
    raw = raw.replaceAll("{{seed_low}}", String(Math.floor(Math.random() * 1_000_000_000_000)));
    raw = raw.replaceAll("{{width}}", String(width));
    raw = raw.replaceAll("{{height}}", String(height));
    raw = raw.replaceAll("{{numFrames}}", String(numFrames));
    raw = raw.replaceAll("{{startImage}}", startImage);
    raw = raw.replaceAll("{{filenamePrefix}}", outputPrefix);

    const template = JSON.parse(raw) as Record<string, ComfyNode>;

    // Set prompt texts via object assignment (safe with special characters)
    const node99 = template["99"];
    const node100 = template["100"];
    if (node99?.inputs) (node99.inputs as Record<string, string>).text = positivePrompt;
    if (node100?.inputs) (node100.inputs as Record<string, string>).text = negativePrompt;

    return template;
  }

  private buildLTX4GridWorkflow(
    prompt: string,
    images: string[],
    durationSec: number,
    fps: number,
    outputPrefix: string,
    sigmaPreset?: string,
  ): Record<string, unknown> {
    const templatePath = path.join(this.templatesDir, "ltx-i2v-multiguide.json");
    let raw = fs.readFileSync(templatePath, "utf-8");

    // Placeholder substitution
    raw = raw.replaceAll("{{filenamePrefix}}", outputPrefix);
    raw = raw.replaceAll("{{startImage}}", images[0] ?? "");
    raw = raw.replaceAll("{{charImage1}}", images[1] ?? images[0]);
    raw = raw.replaceAll("{{charImage2}}", images[2] ?? images[0]);
    raw = raw.replaceAll("{{charImage3}}", images[3] ?? images[0]);
    raw = raw.replaceAll("{{charImage4}}", images[0]);

    // Prompt: use single prompt (no timeline segmentation by default)
    raw = raw.replaceAll("{{prompt}}", prompt);
    raw = raw.replaceAll("{{localPrompts}}", prompt);
    raw = raw.replaceAll("{{segmentLengths}}", String(Math.max(1, Math.round(durationSec * fps / 4))));

    // Timeline data: single segment covering full duration
    const totalFrames = durationSec * fps;
    const segmentLen = Math.max(1, Math.round(totalFrames / 4));
    const tl = {
      segments: [
        { prompt: "开场", length: segmentLen, color: "#4f8edc" },
        { prompt: "发展", length: segmentLen, color: "#5cb85c" },
        { prompt: "转折", length: segmentLen, color: "#e07b3a" },
        { prompt: "收束", length: totalFrames - segmentLen * 3, color: "#d9534f" },
      ],
    };
    raw = raw.replaceAll("{{timelineData}}", JSON.stringify(tl));
    raw = raw.replaceAll("{{numGuides}}", String(Math.min(4, images.length)));

    // Replace checkpoint placeholder with default path
    const ckptName = process.env.COMFYUI_LTX_CHECKPOINT || "LTX2.3\\ltx-2.3-22b-dev-fp8.safetensors";
    raw = raw.replaceAll("CKPT_PLACEHOLDER", ckptName);

    const template = JSON.parse(raw) as Record<string, ComfyNode>;
    const inputs = (id: string) => template[id]?.inputs as Record<string, unknown> | undefined;

    const n328 = inputs("328");
    const n329 = inputs("329");
    const n349 = inputs("349");
    const n350 = inputs("350");
    const n351 = inputs("351");
    const n359 = inputs("359");
    const n363 = inputs("363");
    const n366 = inputs("366");
    const n281 = inputs("332");
    const n306 = inputs("354");

    if (n328) n328.noise_seed = Math.floor(Math.random() * 1_000_000_000_000_000);
    if (n329) n329.noise_seed = Math.floor(Math.random() * 1_000_000_000_000_000);
    if (n349) n349.value = 1088;
    if (n350) n350.value = fps;
    if (n351) n351.value = durationSec;
    if (n359) n359.value = 1920;
    if (n363) n363.value = prompt;
    if (n366) n366.text = "";

    if (sigmaPreset) {
      const sigmas = getSigmaSchedules(sigmaPreset as "speed" | "balanced" | "quality");
      if (n281) n281.sigmas = sigmas.refiner;
      if (n306) n306.sigmas = sigmas.main;
    }

    // Remove unused character image nodes
    for (let i = images.length + 1; i <= 4; i++) {
      const loadId = [381, 385, 389, 397][i - 1];
      const preprocId = [384, 388, 392][i - 2];
      if (loadId <= 397) delete template[String(loadId)];
      if (preprocId) {
        delete template[String(preprocId)];
        delete template[String(preprocId - 1)]; // ResizeImagesByLongerEdge
        delete template[String(preprocId - 2)]; // ResizeImageMaskNode
      }
    }

    return template;
  }

  private buildLTXProWorkflow(
    prompt: string,
    durationSec: number,
    fps: number,
    outputPrefix: string,
    startImage: string,
    ratio?: string,
    sigmaPreset?: string,
    cameraControl?: CameraControl,
  ): Record<string, unknown> {
    const [width, height] = ratio === "9:16" || ratio === "portrait" ? [720, 1280] : [1280, 720];

    const templatePath = path.join(this.templatesDir, "ltx-i2v-pro.json");
    let raw = fs.readFileSync(templatePath, "utf-8");

    raw = raw.replaceAll("{{startImage}}", startImage);
    raw = raw.replaceAll("{{filenamePrefix}}", outputPrefix);

    const template = JSON.parse(raw) as Record<string, ComfyNode>;
    const inputs = (id: string) => template[id]?.inputs as Record<string, unknown> | undefined;

    const n276 = inputs("320:276");
    const n277 = inputs("320:277");
    const n299 = inputs("320:299");
    const n300 = inputs("320:300");
    const n301 = inputs("320:301");
    const n312 = inputs("320:312");
    const n319 = inputs("320:319");
    const n313 = inputs("320:313");
    const n281 = inputs("320:281");
    const n306 = inputs("320:306");
    const n282 = inputs("320:282");
    const n314 = inputs("320:314");
    const n285 = inputs("320:285");

    if (n276) n276.noise_seed = Math.floor(Math.random() * 1_000_000_000_000_000);
    if (n277) n277.noise_seed = Math.floor(Math.random() * 1_000_000_000_000_000);
    if (n299) n299.value = height;
    if (n300) n300.value = fps;
    if (n301) n301.value = durationSec;
    if (n312) n312.value = width;
    if (n319) n319.value = prompt;
    if (n313) n313.text = LTX_PRO_NEGATIVE;

    if (sigmaPreset) {
      const sigmas = getSigmaSchedules(sigmaPreset as "speed" | "balanced" | "quality");
      if (n281) n281.sigmas = sigmas.refiner;
      if (n306) n306.sigmas = sigmas.main;
    }

    const cameraLoraName = getCameraLoRAName(cameraControl);
    if (cameraLoraName && n285) {
      template["320:333"] = {
        class_type: "LoraLoaderModelOnly",
        inputs: {
          lora_name: cameraLoraName,
          strength_model: 0.5,
          model: ["320:285", 0],
        },
      };
      if (n282) n282.model = ["320:333", 0];
      if (n314) n314.model = ["320:333", 0];
    }

    return template;
  }

  private async uploadImage(imagePath: string): Promise<void> {
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
    const form = new FormData();
    form.append("image", new Blob([fs.readFileSync(imagePath)], { type: mime }), path.basename(imagePath));
    form.append("type", "input");
    form.append("overwrite", "true");

    const res = await fetch(`${this.baseUrl}/upload/image`, {
      method: "POST",
      body: form,
      headers: this.getAuthHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ComfyUI image upload failed: ${res.status} ${text}`);
    }
  }

  private outputPrefix = "";

  private findFileInOutputs(outputs: Record<string, Record<string, ComfyOutputFile[]>>): ComfyOutputFile | null {
    for (const node of Object.values(outputs)) {
      for (const key of Object.keys(node)) {
        const arr = node[key];
        if (Array.isArray(arr)) {
          for (const f of arr) {
            if (f?.filename && (f.filename.endsWith(".mp4") || f.filename.endsWith(".gif") || f.filename.endsWith(".webm"))) {
              return f;
            }
          }
        }
      }
    }
    return null;
  }

  private async checkOutputDir(prefix: string): Promise<ComfyOutputFile | null> {
    const videoDir = path.join(COMFYUI_OUTPUT_DIR, "video");
    try {
      if (!fs.existsSync(videoDir)) return null;
      const files = fs.readdirSync(videoDir);
      const match = files.find((f) => f.startsWith(prefix) && (f.endsWith(".mp4") || f.endsWith(".gif") || f.endsWith(".webm")));
      if (match) return { filename: match, subfolder: "video", type: "output" };
    } catch { /* ignore */ }
    return null;
  }

  private async pollForVideo(promptId: string): Promise<{ filename: string; subfolder?: string; type?: string }> {
    const maxAttempts = 600;
    for (let i = 0; i < maxAttempts; i++) {
      if (i > 0 && i % 20 === 0) {
        console.log(`  [pollForVideo] Still waiting... ${i * 3}s elapsed (promptId: ${promptId})`);
      }

      // Filesystem fallback: check ComfyUI output/video/ directory
      if (this.outputPrefix) {
        const fsResult = await this.checkOutputDir(this.outputPrefix);
        if (fsResult) {
          console.log(`  [pollForVideo] Found video file in output dir: ${fsResult.filename}`);
          return fsResult;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
      const res = await fetch(`${this.baseUrl}/history/${promptId}`, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;

      const json = (await res.json()) as Record<string, ComfyHistoryRecord>;
      const record = json[promptId];
      if (!record) continue;

      const outputs = record.outputs || {};
      // Check all output keys (files, images, gifs, Filenames, video, etc.)
      const found = this.findFileInOutputs(outputs);
      if (found) return found;

      if (record?.status?.completed) {
        // If completed but nothing found via history, fallback to filesystem one more time
        if (this.outputPrefix) {
          const finalFs = await this.checkOutputDir(this.outputPrefix);
          if (finalFs) return finalFs;
        }
        throw new Error("ComfyUI completed without video output");
      }
    }

    throw new Error("ComfyUI video generation timed out after 30 minutes");
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    const isLtxPro = this.model === "ltx-i2v-pro";
    const is4Grid = this.model === "ltx-4grid";
    const isLTX = !isLtxPro && !is4Grid && this.model.startsWith("ltx-");
    const isFlf2v = this.model === "ltx-flf2v";
    const isT2v = this.model === "ltx-t2v";

    // Upload image(s) for non-t2v modes
    let firstFrameImage: string | undefined;
    let lastFrameImage: string | undefined;
    let imagePath: string | null = null;
    let fourGridImages: string[] = [];

    if (is4Grid) {
      const refs = params.referenceImages;
      if (!refs || refs.length < 4) {
        throw new Error("LTX 4-grid requires exactly 4 reference images (referenceImages)");
      }
      fourGridImages = refs.slice(0, 4);
      for (const img of fourGridImages) {
        await this.uploadImage(img);
      }
    } else if (isLTX) {
      if (isFlf2v) {
        firstFrameImage = "firstFrame" in params ? params.firstFrame : undefined;
        lastFrameImage = "lastFrame" in params ? params.lastFrame : undefined;
        if (!firstFrameImage || !lastFrameImage) {
          throw new Error("LTX flf2v requires both firstFrame and lastFrame");
        }
        await this.uploadImage(firstFrameImage);
        await this.uploadImage(lastFrameImage);
      } else if (!isT2v) {
        imagePath = "firstFrame" in params && params.firstFrame
          ? params.firstFrame
          : "initialImage" in params && params.initialImage
            ? params.initialImage
            : null;
        if (!imagePath) {
          throw new Error("LTX i2v requires a starting image (firstFrame or initialImage)");
        }
        await this.uploadImage(imagePath);
      }
    } else {
      imagePath = "firstFrame" in params && params.firstFrame
        ? params.firstFrame
        : "initialImage" in params && params.initialImage
          ? params.initialImage
          : null;
      if (!imagePath) {
        throw new Error("ComfyUI video provider requires a starting image (firstFrame or initialImage)");
      }
      await this.uploadImage(imagePath);
    }

    const isWan = this.model === "wan-i2v";
    const sigmaPreset = "sigmaPreset" in params ? params.sigmaPreset : undefined;
    const cameraControl = "cameraControl" in params ? params.cameraControl : undefined;
    const outputPrefix = `${isWan ? "Wan" : "LTX"}_${genId()}_`;
    this.outputPrefix = outputPrefix.replace("video/", "");
    const workflow = is4Grid
      ? this.buildLTX4GridWorkflow(
          params.prompt,
          fourGridImages.map((f) => path.basename(f)),
          params.duration,
          24,
          outputPrefix,
          sigmaPreset,
        )
      : isLtxPro
        ? this.buildLTXProWorkflow(
            params.prompt,
            params.duration,
            24,
            outputPrefix,
            path.basename(imagePath!),
            params.ratio,
            sigmaPreset,
            cameraControl,
          )
        : isLTX
          ? isFlf2v
            ? buildLTXFlf2vWorkflow(
                params.prompt,
                path.basename(firstFrameImage!),
                path.basename(lastFrameImage!),
                params.duration,
                25,
                outputPrefix,
                sigmaPreset,
                cameraControl,
              )
            : buildLTXi2vT2vWorkflow(
                params.prompt,
                params.duration,
                25,
                outputPrefix,
                isT2v ? undefined : path.basename(imagePath!),
                params.ratio,
                sigmaPreset,
                cameraControl,
              )
          : isWan
            ? this.buildWanWorkflow({ ...params, initialImage: imagePath! } as VideoGenerateParams, outputPrefix)
            : this.buildWanWorkflow({ ...params, initialImage: imagePath! } as VideoGenerateParams, outputPrefix);

    const submitRes = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.getAuthHeaders() },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(`ComfyUI prompt submit failed: ${submitRes.status} ${errText}`);
    }

    const submitResult = (await submitRes.json()) as ComfyPromptResponse;
    const promptId = submitResult.prompt_id;
    if (!promptId) {
      throw new Error(`ComfyUI prompt submit returned no prompt_id: ${JSON.stringify(submitResult)}`);
    }

    const output = await this.pollForVideo(promptId);
    console.log(`  [generateVideo] Got video output: ${output.filename}, downloading...`);
    const query = new URLSearchParams({
      filename: output.filename,
      subfolder: output.subfolder || "",
      type: output.type || "output",
    });
    const videoRes = await fetch(`${this.baseUrl}/view?${query.toString()}`, {
      headers: this.getAuthHeaders(),
      signal: AbortSignal.timeout(120_000),
    });
    if (!videoRes.ok) {
      throw new Error(`ComfyUI video download failed: ${videoRes.status}`);
    }

    const buffer = Buffer.from(await videoRes.arrayBuffer());
    const filename = `${genId()}.mp4`;
    const dir = path.join(this.uploadDir, "videos");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    console.log(`  [generateVideo] Saved: ${filepath}`);

    return { filePath: filepath };
  }
}
