import type { AIProvider, TextOptions, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";
import { preflightWorkflow } from "@/lib/comfyui/preflight";
import { ErrorCodes } from "@/lib/comfyui/errors";

type ComfyPromptResponse = {
  prompt_id?: string;
  error?: string;
};

type ComfyHistoryRecord = {
  outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
};

type UploadedImageInfo = {
  name: string;
};

function ratioToImageSize(ratio?: string): { width: number; height: number } {
  switch (ratio) {
    case "16:9":
      return { width: 1536, height: 1024 };
    case "9:16":
      return { width: 1024, height: 1536 };
    case "4:3":
      return { width: 1024, height: 768 };
    case "3:4":
      return { width: 768, height: 1024 };
    case "1:1":
    default:
      return { width: 1024, height: 1024 };
  }
}

export class ComfyUIImageProvider implements AIProvider {
  private baseUrl: string;
  private model: string;
  private uploadDir: string;
  private authToken?: string;
  private authCookie?: string;

  constructor(params?: { baseUrl?: string; model?: string; uploadDir?: string; authToken?: string; authCookie?: string }) {
    this.baseUrl = (params?.baseUrl || process.env.COMFYUI_BASE_URL || "https://2wdf3izjfh-8188.cnb.run/").replace(/\/+$/, "");
    this.model = params?.model || "z-image-turbo-comfyui";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
    this.authToken = params?.authToken || process.env.COMFYUI_AUTH_TOKEN;
    this.authCookie = params?.authCookie || process.env.COMFYUI_AUTH_COOKIE;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;
    if (this.authCookie) headers["Cookie"] = this.authCookie;
    return headers;
  }

  async generateText(_prompt: string, _options?: TextOptions): Promise<string> {
    throw new Error("ComfyUI image provider does not support text generation");
  }

  private async uploadImage(imagePath: string): Promise<UploadedImageInfo> {
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
    const form = new FormData();
    const filename = path.basename(imagePath);
    form.append("image", new Blob([fs.readFileSync(imagePath)], { type: mime }), filename);
    form.append("type", "input");
    form.append("overwrite", "true");

    const res = await fetch(`${this.baseUrl}/upload/image`, {
      method: "POST",
      body: form,
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ComfyUI image upload failed: ${res.status} ${text}`);
    }

    return { name: filename };
  }

  private buildReferenceBoardPrompt(
    prompt: string,
    labels: string[],
    roles: string[],
  ): string {
    if (labels.length === 0) return prompt;

    const lines = labels.map((label, index) => {
      const role = roles[index] || "reference";
      return `Reference ${index + 1} (${role}): ${label}`;
    });

    return [
      prompt,
      "",
      "Use the uploaded multi-reference images as strict visual anchors.",
      ...lines,
      "Preserve identity, costume, pose intent, scene style, and lighting where those reference roles apply.",
    ].join("\n");
  }

  private buildQwenEditWorkflow(
    prompt: string,
    options: ImageOptions | undefined,
    uploadedBaseImage: UploadedImageInfo,
    uploadedReferences: UploadedImageInfo[],
  ): Record<string, unknown> {
    const size = ratioToImageSize(options?.aspectRatio);
    const labels = options?.referenceLabels ?? [];
    const roles = options?.referenceRoles ?? [];
    const finalPrompt = this.buildReferenceBoardPrompt(prompt, labels, roles);
    const secondaryReference = uploadedReferences[0]?.name ?? uploadedBaseImage.name;

    return {
      "36": {
        inputs: {
          prompt: "Describe the key features of the input image and apply the requested edit while preserving the identity and reference consistency.",
          clip: ["223", 0],
          vae: ["221", 2],
        },
        class_type: "TextEncodeQwenImageEditPlus",
      },
      "37": {
        inputs: {
          prompt: finalPrompt,
          clip: ["223", 0],
          vae: ["221", 2],
          image1: ["50", 0],
          image2: ["54", 0],
        },
        class_type: "TextEncodeQwenImageEditPlus",
      },
      "38": {
        inputs: {
          samples: ["46", 0],
          vae: ["221", 2],
        },
        class_type: "VAEDecode",
      },
      "46": {
        inputs: {
          seed: Math.floor(Math.random() * 1_000_000_000_000_000),
          steps: 6,
          cfg: 1,
          sampler_name: "euler_ancestral",
          scheduler: "beta57",
          denoise: 1,
          model: ["222", 0],
          positive: ["37", 0],
          negative: ["36", 0],
          latent_image: ["248", 2],
        },
        class_type: "KSampler",
      },
      "49": {
        inputs: { image: uploadedBaseImage.name },
        class_type: "LoadImage",
      },
      "50": {
        inputs: {
          upscale_method: "lanczos",
          megapixels: 2,
          resolution_steps: 1,
          image: ["49", 0],
        },
        class_type: "ImageScaleToTotalPixels",
      },
      "54": {
        inputs: {
          upscale_method: "lanczos",
          megapixels: 1,
          resolution_steps: 1,
          image: ["246", 0],
        },
        class_type: "ImageScaleToTotalPixels",
      },
      "102": {
        inputs: {
          filename_prefix: "qwen-edit-storyboard",
          images: ["252", 0],
        },
        class_type: "SaveImage",
      },
      "221": {
        inputs: { ckpt_name: "Qwen-Rapid-AIO-NSFW-v19.safetensors" },
        class_type: "CheckpointLoaderSimple",
      },
      "222": {
        inputs: {
          lora_name: "Qwen-Image-Edit-F2P 人脸生成.safetensors",
          strength_model: 0.25,
          model: ["221", 0],
        },
        class_type: "LoraLoaderModelOnly",
      },
      "223": {
        inputs: {
          clip_name: "qwen_2.5_vl_7b.safetensors",
          type: "lumina2",
          device: "default",
        },
        class_type: "CLIPLoader",
      },
      "246": {
        inputs: { image: secondaryReference },
        class_type: "LoadImage",
      },
      "247": {
        inputs: { image: ["50", 0] },
        class_type: "GetImageSize",
      },
      "248": {
        inputs: {
          预设: "自定义",
          互换宽高: false,
          随机模式: false,
          自定义宽: size.width,
          自定义高: size.height,
          批次数量: 1,
          管理预设: null,
        },
        class_type: "ZML_PresetResolutionV2",
      },
      "252": {
        inputs: { anything: ["38", 0] },
        class_type: "easy cleanGpuUsed",
      },
    };
  }

  private buildWorkflow(prompt: string, options?: ImageOptions): Record<string, unknown> {
    const size = ratioToImageSize(options?.aspectRatio);

    return {
      "9": {
        inputs: {
          filename_prefix: "z-image-turbo",
          images: ["57:8", 0],
        },
        class_type: "SaveImage",
      },
      "57:30": {
        inputs: {
          clip_name: "qwen_3_4b.safetensors",
          type: "lumina2",
          device: "default",
        },
        class_type: "CLIPLoader",
      },
      "57:29": {
        inputs: { vae_name: "ae.safetensors" },
        class_type: "VAELoader",
      },
      "57:28": {
        inputs: {
          unet_name: "z_image_turbo_bf16.safetensors",
          weight_dtype: "default",
        },
        class_type: "UNETLoader",
      },
      "57:13": {
        inputs: {
          width: size.width,
          height: size.height,
          batch_size: 1,
        },
        class_type: "EmptySD3LatentImage",
      },
      "57:27": {
        inputs: {
          text: prompt,
          clip: ["57:30", 0],
        },
        class_type: "CLIPTextEncode",
      },
      "57:11": {
        inputs: {
          shift: 3,
          model: ["57:28", 0],
        },
        class_type: "ModelSamplingAuraFlow",
      },
      "57:33": {
        inputs: {
          conditioning: ["57:27", 0],
        },
        class_type: "ConditioningZeroOut",
      },
      "57:3": {
        inputs: {
          seed: Math.floor(Math.random() * 1_000_000_000_000_000),
          steps: 8,
          cfg: 1,
          sampler_name: "res_multistep",
          scheduler: "simple",
          denoise: 1,
          model: ["57:11", 0],
          positive: ["57:27", 0],
          negative: ["57:33", 0],
          latent_image: ["57:13", 0],
        },
        class_type: "KSampler",
      },
      "57:8": {
        inputs: {
          samples: ["57:3", 0],
          vae: ["57:29", 0],
        },
        class_type: "VAEDecode",
      },
    };
  }

  private async pollForImage(promptId: string): Promise<{ filename: string; subfolder?: string; type?: string }> {
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const res = await fetch(`${this.baseUrl}/history/${promptId}`, {
        headers: this.getAuthHeaders(),
      });
      if (!res.ok) continue;

      const json = (await res.json()) as Record<string, ComfyHistoryRecord>;
      const record = json[promptId];
      const outputs = record?.outputs || {};
      for (const node of Object.values(outputs)) {
        const image = node.images?.[0];
        if (image?.filename) return image;
      }
    }

    throw new Error("ComfyUI image generation timed out after 4 minutes");
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const workflowFamily = this.model.includes("qwen-edit") ? "qwen-edit-dual" : "z-image-turbo-comfyui";
    const preflightResult = await preflightWorkflow(this.baseUrl, workflowFamily, [], this.getAuthHeaders());
    if (!preflightResult.ok) {
      console.warn(`[ComfyUIImage] Preflight failed for ${this.model}:`, preflightResult.error);
      if (preflightResult.error?.code === ErrorCodes.SERVER_UNAVAILABLE) {
        throw new Error(`ComfyUI server unreachable: ${preflightResult.error.message}`);
      }
    }

    if (this.model.includes("qwen-edit")) {
      const baseImage = options?.editBaseImage || options?.referenceImages?.[0];
      if (!baseImage) {
        throw new Error("ComfyUI qwen-edit requires an editBaseImage or at least one reference image");
      }

      const uploadedBaseImage = await this.uploadImage(baseImage);
      const extraReferences = (options?.referenceImages ?? []).filter((img) => img !== baseImage).slice(0, 6);
      const uploadedReferences = await Promise.all(extraReferences.map((img) => this.uploadImage(img)));
      const workflow = this.buildQwenEditWorkflow(prompt, options, uploadedBaseImage, uploadedReferences);

      const submitRes = await fetch(`${this.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.getAuthHeaders() },
        body: JSON.stringify({ prompt: workflow }),
      });

      if (!submitRes.ok) {
        const errText = await submitRes.text().catch(() => "");
        throw new Error(`ComfyUI qwen-edit prompt submit failed: ${submitRes.status} ${errText}`);
      }

      const submitResult = (await submitRes.json()) as ComfyPromptResponse;
      const promptId = submitResult.prompt_id;
      if (!promptId) {
        throw new Error(`ComfyUI qwen-edit returned no prompt_id: ${JSON.stringify(submitResult)}`);
      }

      const output = await this.pollForImage(promptId);
      const query = new URLSearchParams({
        filename: output.filename,
        subfolder: output.subfolder || "",
        type: output.type || "output",
      });
      const imageRes = await fetch(`${this.baseUrl}/view?${query.toString()}`, {
        headers: this.getAuthHeaders(),
      });
      if (!imageRes.ok) {
        throw new Error(`ComfyUI qwen-edit download failed: ${imageRes.status}`);
      }

      const contentType = imageRes.headers.get("content-type") || "image/png";
      const ext = contentType.includes("jpeg") ? "jpg" : "png";
      const buffer = Buffer.from(await imageRes.arrayBuffer());
      const filename = `${genId()}.${ext}`;
      const dir = path.join(this.uploadDir, "frames");
      fs.mkdirSync(dir, { recursive: true });
      const filepath = path.join(dir, filename);
      fs.writeFileSync(filepath, buffer);
      return filepath;
    }

    const workflow = this.buildWorkflow(prompt, options);

    const submitRes = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.getAuthHeaders() },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      throw new Error(`ComfyUI image prompt submit failed: ${submitRes.status} ${errText}`);
    }

    const submitResult = (await submitRes.json()) as ComfyPromptResponse;
    const promptId = submitResult.prompt_id;
    if (!promptId) {
      throw new Error(`ComfyUI image prompt returned no prompt_id: ${JSON.stringify(submitResult)}`);
    }

    const output = await this.pollForImage(promptId);
    const query = new URLSearchParams({
      filename: output.filename,
      subfolder: output.subfolder || "",
      type: output.type || "output",
    });
    const imageRes = await fetch(`${this.baseUrl}/view?${query.toString()}`, {
      headers: this.getAuthHeaders(),
    });
    if (!imageRes.ok) {
      throw new Error(`ComfyUI image download failed: ${imageRes.status}`);
    }

    const contentType = imageRes.headers.get("content-type") || "image/png";
    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "frames");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);

    return filepath;
  }
}
