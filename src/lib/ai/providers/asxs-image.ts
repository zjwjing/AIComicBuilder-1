import OpenAI from "openai";
import type { AIProvider, ImageOptions } from "../types";
import fs from "node:fs";
import path from "node:path";
import { id as genId } from "@/lib/id";

type ResponseOutputItem = {
  type?: string;
  result?: string;
  image_base64?: string;
  url?: string;
  image_url?: string;
  content?: Array<{
    type?: string;
    result?: string;
    image_base64?: string;
    image_url?: string;
  }>;
};

const ASPECT_SIZE_MAP: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "4:3": "1536x1024",
  "3:4": "1024x1536",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function resolveSize(options?: ImageOptions): string {
  if (options?.size && options.size !== "2048x2048") return options.size;
  if (options?.aspectRatio) return ASPECT_SIZE_MAP[options.aspectRatio] || "1536x1024";
  return "1024x1024";
}

export class ASXSImageProvider implements AIProvider {
  private client: OpenAI;
  private model: string;
  private responseModel: string;
  private uploadDir: string;

  constructor(params?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    uploadDir?: string;
  }) {
    this.client = new OpenAI({
      apiKey: params?.apiKey || process.env.ASXS_API_KEY || process.env.IMAGEGEN_API_KEY || process.env.OPENAI_API_KEY,
      baseURL: params?.baseUrl || process.env.ASXS_BASE_URL || process.env.IMAGEGEN_BASE_URL || "https://api.asxs.top/v1",
      timeout: 600_000,
      maxRetries: 0,
    });
    this.model = params?.model || process.env.ASXS_IMAGE_MODEL || "gpt-image-2";
    this.responseModel = process.env.ASXS_RESPONSE_MODEL || process.env.IMAGEGEN_RESPONSE_MODEL || "gpt-5.4";
    this.uploadDir = params?.uploadDir || process.env.UPLOAD_DIR || "./uploads";
  }

  async generateText(): Promise<string> {
    throw new Error("ASXS image provider does not support text generation");
  }

  async generateImage(prompt: string, options?: ImageOptions): Promise<string> {
    const refs = this.collectReferenceImages(options);
    const action = refs.length > 0 ? "edit" : "generate";
    const size = resolveSize(options);
    const quality = options?.quality || "auto";
    const outputFormat = "png";

    const input = refs.length > 0
      ? this.buildReferenceInput(prompt, refs)
      : prompt;

    console.log(`[ASXSImage] Generating: model=${this.model}, action=${action}, refs=${refs.length}, size=${size}`);

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await (this.client.responses.create as unknown as (params: Record<string, unknown>) => Promise<unknown>)({
          model: this.responseModel,
          input,
          tools: [
            {
              type: "image_generation",
              model: this.model,
              action,
              size,
              quality,
              output_format: outputFormat,
            },
          ],
        });

        const extracted = this.extractImageOutput(resp);
        if (extracted.base64) {
          return this.saveImageBuffer(Buffer.from(extracted.base64, "base64"), outputFormat);
        }
        if (extracted.url) {
          return await this.fetchImageToFile(extracted.url);
        }

        throw new Error(`No image data returned from ASXS Responses API: ${JSON.stringify(resp)}`);
      } catch (err) {
        lastError = err;
        console.error(`[ASXSImage] attempt ${attempt} failed: ${toErrorMessage(err)}`);
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        }
      }
    }

    throw new Error(`ASXS gpt-image-2 generation failed after 3 attempts: ${toErrorMessage(lastError)}`);
  }

  private collectReferenceImages(options?: ImageOptions): string[] {
    const refs = [
      options?.editBaseImage,
      ...(options?.referenceImages ?? []),
    ].filter((p): p is string => Boolean(p));
    return Array.from(new Set(refs)).filter((filePath) => {
      if (filePath.startsWith("http://") || filePath.startsWith("https://")) return true;
      return fs.existsSync(path.resolve(filePath));
    }).slice(0, 10);
  }

  private buildReferenceInput(prompt: string, refs: string[]): Array<Record<string, unknown>> {
    const content: Array<Record<string, unknown>> = [
      { type: "input_text", text: prompt },
    ];

    refs.forEach((ref, index) => {
      content.push({
        type: "input_text",
        text: `Input image ${index + 1}: reference image. Preserve identity, visual style, layout, or subject details when relevant to the prompt.`,
      });
      content.push({ type: "input_image", image_url: this.fileToImageUrl(ref) });
    });

    return [{ role: "user", content }];
  }

  private fileToImageUrl(filePath: string): string {
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
      return filePath;
    }
    const resolved = path.resolve(filePath);
    const data = fs.readFileSync(resolved).toString("base64");
    return `data:${guessMimeType(resolved)};base64,${data}`;
  }

  private extractImageOutput(resp: unknown): { base64?: string; url?: string } {
    const output = (resp as { output?: ResponseOutputItem[] })?.output;
    if (!Array.isArray(output)) return {};

    for (const item of output) {
      if (item.type === "image_generation_call") {
        if (item.result) return { base64: item.result };
        if (item.image_base64) return { base64: item.image_base64 };
      }
      if (item.result) return { base64: item.result };
      if (item.image_base64) return { base64: item.image_base64 };
      if (item.url) return { url: item.url };
      if (item.image_url) return { url: item.image_url };
      if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.result) return { base64: part.result };
          if (part.image_base64) return { base64: part.image_base64 };
          if (part.image_url) return { url: part.image_url };
        }
      }
    }

    return {};
  }

  private saveImageBuffer(buffer: Buffer, ext = "png"): string {
    const filename = `${genId()}.${ext}`;
    const dir = path.join(this.uploadDir, "images");
    fs.mkdirSync(dir, { recursive: true });
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  private async fetchImageToFile(url: string): Promise<string> {
    const imageResponse = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!imageResponse.ok) {
      const body = await imageResponse.text().catch(() => "");
      throw new Error(`Failed to download ASXS image: ${imageResponse.status} ${body}`);
    }
    const contentType = imageResponse.headers.get("content-type") || "";
    const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    return this.saveImageBuffer(buffer, ext);
  }
}
