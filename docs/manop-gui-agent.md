# Mano-P GUI Agent (本地)

Mano-P (Mininglamp/Mano-P) is a GUI VLA (Vision-Language-Action) agent based on Qwen3-VL-4B. It screenshots and outputs GUI action descriptions.

## Setup

### 1. Start the server

```bash
python I:\AIs\Mano-P\app.py --port 7861
```

The server loads the model (~5s) and listens on `http://localhost:7861`.

### 2. Configure in Settings

Go to **Settings → Mano-P (本地 GUI 代理)**:
- Server URL defaults to `http://localhost:7861`
- Click **Check** to verify the server is running
- Adjust Temperature, Max Tokens, Top P, Top K as needed

## API

### POST `/api/manop/infer`

```json
{
  "image": "<base64 PNG>",
  "task": "Describe the UI elements and suggest actions",
  "max_tokens": 256,
  "temperature": 0.7,
  "top_p": 0.8,
  "top_k": 20
}
```

Response:
```json
{
  "text": "The screen contains...",
  "elapsed": 7.2
}
```

### GET `/api/manop/health`

```json
{ "status": "ok", "model_loaded": true }
```

## TypeScript Client

```typescript
import { ManoPClient } from "@/lib/manop";

const client = new ManoPClient({ baseUrl: "http://localhost:7861" });

// Health check
const health = await client.health();

// Inference (image must be base64)
const result = await client.infer(imageBase64, "Describe this UI");
console.log(result.text);
```

## Model Details

| Property | Value |
|----------|-------|
| Base model | Qwen3-VL-4B |
| Params | 4.44B |
| Hidden size | 2560 |
| Layers | 36 |
| KV heads | 8 |
| Weights | bfloat16, ~8.5 GB |
| Inference | ~7s on RTX 4080 SUPER |

## Notes

- This is a GUI automation agent, **not** an image generation model
- Use it for test automation, UI interaction, and screen understanding
- The model outputs natural language descriptions of GUI elements and potential actions
