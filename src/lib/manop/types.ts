export interface ManoPConfig {
  baseUrl: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
}

export interface ManoPInferRequest {
  image: string; // base64
  task: string;
  max_tokens?: number;
  do_sample?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
}

export interface ManoPInferResponse {
  text: string;
  elapsed: number;
}
