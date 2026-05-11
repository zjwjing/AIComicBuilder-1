import type { VideoProvider, VideoGenerateParams, VideoGenerateResult } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";

type ComfyPromptResponse = {
  prompt_id?: string;
  error?: string;
};

type ComfyHistoryRecord = {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown[];
  };
  outputs?: Record<string, { gifs?: Array<{ filename: string; subfolder?: string; type?: string }>; Filenames?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
};

export class ComfyUIVideoProvider implements VideoProvider {
  private baseUrl: string;
  private model: string;
  private uploadDir: string;
  private authToken?: string;
  private authCookie?: string;

  constructor(params?: { baseUrl?: string; model?: string; uploadDir?: string; authToken?: string; authCookie?: string }) {
    this.baseUrl = (params?.baseUrl || process.env.COMFYUI_BASE_URL || "https://s4t0d2mbyu-8188.cnb.run/").replace(/\/+$/, "");
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

  private buildWorkflow(params: VideoGenerateParams): Record<string, unknown> {
    if (!params.initialImage) {
      throw new Error("ComfyUI video provider requires an initial image");
    }

    const durationSec = Math.max(3, Math.min(10, Math.round(params.duration || 5)));
    const numFrames = durationSec * 16 + 1;
    const positivePrompt = params.prompt || "";
    const negativePrompt = "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走, censored, mosaic censoring, bar censor, pixelated, glowing, bloom, blurry, day, out of focus, low detail, bad anatomy, ugly, overexposed, underexposed, distorted face, extra limbs, cartoonish, 3d render artifacts, duplicate people, unnatural lighting, bad composition, missing shadows, low resolution, poorly textured, glitch, noise, grain, static, motionless, still frame, overall grayish, worst quality, low quality, JPEG compression artifacts, subtitles, stylized, artwork, painting, illustration, cluttered background, many people in background, three legs, walking backward, zoom out, zoom in, mouth speaking, moving mouth, talking, speaking, mute speaking, unnatural skin tone, discolored eyelid, red eyelids, red upper eyelids, no red eyeshadow, closed eyes, no wide-open innocent eyes, poorly drawn hands, extra fingers, fused fingers, poorly drawn face, deformed, disfigured, malformed limbs, thighs, fog, mist, voluminous eyelashes, blush,";

    const seed = Math.floor(Math.random() * 1_000_000_000_000);
    const startImage = path.basename(params.initialImage);

    return {
      "2": {
        class_type: "VAEDecode",
        inputs: { samples: ["96", 0], vae: ["9", 0] },
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: ["373", 0], clip: ["25", 0] },
      },
      "4": {
        class_type: "PathchSageAttentionKJ",
        inputs: { sage_attention: "sageattn_qk_int8_pv_fp8_cuda", allow_compile: false, model: ["62", 0] },
      },
      "5": {
        class_type: "PathchSageAttentionKJ",
        inputs: { sage_attention: "sageattn_qk_int8_pv_fp8_cuda", allow_compile: false, model: ["63", 0] },
      },
      "6": {
        class_type: "ModelPatchTorchSettings",
        inputs: { enable_fp16_accumulation: true, model: ["4", 0] },
      },
      "7": {
        class_type: "ModelPatchTorchSettings",
        inputs: { enable_fp16_accumulation: true, model: ["5", 0] },
      },
      "9": {
        class_type: "VAELoader",
        inputs: { vae_name: "wan_2.1_vae.safetensors" },
      },
      "15": {
        class_type: "easy cleanGpuUsed",
        inputs: { anything: ["2", 0] },
      },
      "19": {
        class_type: "VHS_VideoCombine",
        inputs: {
          frame_rate: 16, loop_count: 0, filename_prefix: `I2V_${genId()}_`, format: "video/h264-mp4",
          pix_fmt: "yuv420p", crf: 19, save_metadata: true, trim_to_audio: false, pingpong: false,
          save_output: true, images: ["15", 0],
        },
      },
      "21": {
        class_type: "WanImageToVideo",
        inputs: {
          width: ["369", 3], height: ["369", 4], length: ["371", 0], batch_size: 1,
          positive: ["29", 0], negative: ["3", 0], vae: ["9", 0], start_image: ["369", 0],
        },
      },
      "25": {
        class_type: "CLIPLoader",
        inputs: { clip_name: "umt5_xxl_fp16.safetensors", type: "wan", device: "cpu" },
      },
      "26": { class_type: "INTConstant", inputs: { value: 6 } },
      "27": {
        class_type: "UNETLoader",
        inputs: { unet_name: "wan2.2_i2v_A14b_high_noise_scaled_fp8_e4m3_lightx2v_4step_comfyui_1030.safetensors", weight_dtype: "fp8_e4m3fn" },
      },
      "28": {
        class_type: "UNETLoader",
        inputs: { unet_name: "wan2.2_i2v_A14b_low_noise_scaled_fp8_e4m3_lightx2v_4step_comfyui.safetensors", weight_dtype: "default" },
      },
      "29": {
        class_type: "CLIPTextEncode",
        inputs: { text: ["372", 0], clip: ["25", 0] },
      },
      "34": {
        class_type: "LoadImage",
        inputs: { image: startImage },
      },
      "36": {
        class_type: "LoraLoaderModelOnly",
        inputs: { lora_name: "lightx2v_I2V_14B_480p_cfg_step_distill_rank256_bf16.safetensors", strength_model: 2, model: ["27", 0] },
      },
      "62": {
        class_type: "LoraLoaderModelOnly",
        inputs: { lora_name: "Wan2.2-Fun-A14B-InP-high-noise-HPS2.1.safetensors", strength_model: 0.5, model: ["36", 0] },
      },
      "63": {
        class_type: "LoraLoaderModelOnly",
        inputs: { lora_name: "Wan2.2-Fun-A14B-InP-low-noise-HPS2.1.safetensors", strength_model: 0.5, model: ["28", 0] },
      },
      "67": {
        class_type: "PreviewImage",
        inputs: { images: ["369", 0] },
      },
      "93": {
        class_type: "ModelSamplingSD3",
        inputs: { shift: 5, model: ["7", 0] },
      },
      "94": {
        class_type: "KSamplerAdvanced",
        inputs: {
          add_noise: "enable", noise_seed: ["379", 0], steps: ["26", 0], cfg: 1,
          sampler_name: "euler", scheduler: "normal", start_at_step: 0, end_at_step: ["97", 0],
          return_with_leftover_noise: "enable", model: ["95", 0], positive: ["21", 0],
          negative: ["21", 1], latent_image: ["21", 2],
        },
      },
      "95": {
        class_type: "ModelSamplingSD3",
        inputs: { shift: 5, model: ["6", 0] },
      },
      "96": {
        class_type: "KSamplerAdvanced",
        inputs: {
          add_noise: "disable", noise_seed: ["379", 0], steps: ["26", 0], cfg: 1,
          sampler_name: "euler", scheduler: "normal", start_at_step: ["97", 0], end_at_step: 10000,
          return_with_leftover_noise: "disable", model: ["93", 0], positive: ["21", 0],
          negative: ["21", 1], latent_image: ["94", 0],
        },
      },
      "97": { class_type: "INTConstant", inputs: { value: 2 } },
      "369": {
        class_type: "LayerUtility: ImageScaleByAspectRatio V2",
        inputs: {
          aspect_ratio: "original", proportional_width: 1, proportional_height: 1, fit: "crop",
          method: "lanczos", round_to_multiple: "16", scale_to_side: "longest",
          scale_to_length: ["370", 0], background_color: "#000000", image: ["34", 0],
        },
      },
      "370": { class_type: "ImpactInt", inputs: { value: 832 } },
      "371": { class_type: "ImpactInt", inputs: { value: numFrames } },
      "372": { class_type: "Text Multiline", inputs: { text: positivePrompt } },
      "373": { class_type: "Text Multiline", inputs: { text: negativePrompt } },
      "379": { class_type: "easy seed", inputs: { seed } },
    };
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

  private async pollForVideo(promptId: string): Promise<{ filename: string; subfolder?: string; type?: string }> {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const res = await fetch(`${this.baseUrl}/history/${promptId}`, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;

      const json = (await res.json()) as Record<string, ComfyHistoryRecord>;
      const record = json[promptId];
      const outputs = record?.outputs || {};
      for (const node of Object.values(outputs)) {
        const filenames = node.Filenames;
        const gif = filenames?.[0] || node.gifs?.[0];
        if (gif?.filename) return gif;
      }

      if (record?.status?.completed && Object.keys(outputs).length === 0) {
        throw new Error("ComfyUI completed without video output");
      }
    }

    throw new Error("ComfyUI video generation timed out after 3 minutes");
  }

  async generateVideo(params: VideoGenerateParams): Promise<VideoGenerateResult> {
    // Accept either firstFrame (keyframe mode) or initialImage (reference mode)
    const imagePath = "firstFrame" in params && params.firstFrame
      ? params.firstFrame
      : "initialImage" in params && params.initialImage
        ? params.initialImage
        : null;
    if (!imagePath) {
      throw new Error("ComfyUI video provider requires a starting image (firstFrame or initialImage)");
    }

    await this.uploadImage(imagePath);
    const workflow = this.buildWorkflow({ ...params, initialImage: imagePath } as VideoGenerateParams);

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

    return { filePath: filepath };
  }
}
