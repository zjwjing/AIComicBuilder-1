# AI Comic Builder — Pipeline Agent Guide

This file describes the full video production pipeline for AI agents. When you see a task instruction mentioning "pipeline entry", read this file first.

## Overview

The pipeline transforms a project → episodes → script → shots → frames → videos → final assembly.

Architecture: BFF (Backend-For-Frontend) pattern. API routes handle HTTP, pipeline handlers do the actual AI work.

```
Project
 └─ Episode
     ├─ Script        (text → structured script)
     ├─ Character     (text → character definitions + images)
     ├─ Shots         (script → shot list + transitions)
     ├─ Keyframes     (shot → keyframe prompts)
     ├─ Ref Images    (shot → reference images for consistency)
     ├─ Scene Frames  (refs + keyframes → frame generation)
     ├─ Video Prompt  (frame → video prompt)
     ├─ Video Keyframe(shot → video generation)
     ├─ Video Ref     (reference → video generation)
     └─ Assemble      (videos + audio → final cut)
```

## Entry Points

| Action | Handler | Input | Output |
|--------|---------|-------|--------|
| `shot_split` | `shots.ts` | episodeId + script | shot rows in DB |
| `generate_keyframe_prompts` | `keyframe.ts` | shots → keyframe prompts | DB + image gen |
| `generate_ref_prompts` | `ref-image.ts` | shots → ref prompts | DB |
| `batch_ref_image_generate` | `ref-image.ts` | ref prompts → images | files |
| `batch_scene_frame` | `frames.ts` | refs + scene → frames | images |
| `batch_video_generate` | `video-keyframe.ts` | keyframes → video | video files |
| `batch_reference_video` | `video-reference.ts` | refs → video | video files |
| `batch_video_prompt` | `video-prompt.ts` | frames + refs → prompts | DB |
| `video_assemble` | `video-assemble.ts` | videos + audio → final cut | MP4 file |
| `batch_character_image` | `character.ts` | character → reference images | image files |
| `script.ts` / `ai-optimize.ts` | (streaming, single-shot) | text → LLM | text |

## Zero-Cost Path (0 API calls)

All core features work WITHOUT paid API keys:

| Feature | Zero-cost provider | Config |
|---------|-------------------|--------|
| **LLM (text)** | NVIDIA NIM free tier | `OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1` → `minimaxai/minimax-m3` or `meta/llama-3.1-8b-instruct` |
| **Image gen** | ComfyUI local (Wan/FLUX) | `COMFYUI_BASE_URL=http://localhost:8188` |
| **Video gen** | ComfyUI local (LTX-2.3) | Same as above |
| **TTS** | Edge TTS (built-in, free) | `TTS_VOICE=zh-CN-XiaoxiaoNeural` |
| **Embedding** | NVIDIA NIM free tier | `EMBEDDING_BASE_URL=https://integrate.api.nvidia.com/v1`, model `nvidia/nv-embed-v1` |

## Task Infrastructure

Every batched handler registers as a background task with:

1. `registerTask(taskId)` — creates abort-signal for cancellation
2. `updateTaskProgress(taskId, {total, completed, failed})` — SSE progress events
3. `completeTask(taskId)` or `failTask(taskId, error)` — final state

Batch actions flow: `BATCH_ACTIONS` set (in `route.ts`) → `createTask()` → `dispatchAction()` → handler.

The single-shot handlers (script.ts, ai-optimize.ts) are synchronous/streaming and skip the task system.

## Handler Contract

Each handler receives:
```ts
HandlerFn = (
  projectId: string,
  userId: string,
  payload?: Record<string, unknown>,
  modelConfig?: ModelConfig,
  episodeId?: string,
  taskId?: string
) => Promise<Response>
```

Registered in `src/lib/pipeline/handlers/index.ts` under `HANDLER_MAP`.

## Cost Tracking

Cost per task is tracked in `tasks.result` as `BatchProgress` with optional `costs` array:
```ts
interface BatchProgress {
  total: number
  completed: number
  failed: string[]
}

interface TaskCost {
  model?: string      // e.g. "ffmpeg", "minimaxai/minimax-m3" 
  apiCost?: number    // USD cost for API calls
  itemCount?: number
}
```

To add costs from a handler:
```ts
import { updateTaskProgress, completeTask, addTaskCost } from "@/lib/task-utils"

// At the end of a handler:
completeTask(taskId, addTaskCost(
  { total: 5, completed: 5, failed: [] },
  { model: "ffmpeg", apiCost: 0, itemCount: 1 }
))
```

Handlers with cost tracking: all 10 batched handlers are wired via `addTaskCost()`. The cost values default to `apiCost: 0` for free-tier providers; adjust the cost parameters when using paid APIs.
