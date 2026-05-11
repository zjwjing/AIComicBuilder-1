import type { ManoPConfig, ManoPInferResponse } from "./types";

export class ManoPClient {
  private config: ManoPConfig;

  constructor(config: ManoPConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      apiKey: config.apiKey,
      maxTokens: config.maxTokens ?? 256,
      temperature: config.temperature ?? 0.7,
      topP: config.topP ?? 0.8,
      topK: config.topK ?? 20,
    };
  }

  async health(): Promise<{ status: string; model_loaded: boolean }> {
    const res = await fetch(`${this.config.baseUrl}/api/manop/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    return res.json();
  }

  async infer(imageBase64: string, task: string): Promise<ManoPInferResponse> {
    const res = await fetch(`${this.config.baseUrl}/api/manop/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageBase64,
        task,
        max_tokens: this.config.maxTokens ?? 256,
        temperature: this.config.temperature ?? 0.7,
        top_p: this.config.topP ?? 0.8,
        top_k: this.config.topK ?? 20,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `Mano-P inference failed: ${res.status}`);
    }

    return res.json();
  }
}
