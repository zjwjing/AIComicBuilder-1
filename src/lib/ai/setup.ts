import { setDefaultAIProvider, setDefaultVideoProvider } from "./index";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { SeedanceProvider } from "./providers/seedance";
import { ComfyUIImageProvider } from "./providers/comfyui-image";
import { ComfyUIVideoProvider } from "./providers/comfyui-video";
import { OmnigenImageProvider } from "./providers/omnigen-image";
import { NvidiaNimVideoProvider } from "./providers/nvidia-nim-video";

let initialized = false;

export function initializeProviders() {
  if (initialized) return;

  if (process.env.COMFYUI_BASE_URL) {
    setDefaultAIProvider(
      new ComfyUIImageProvider({ baseUrl: process.env.COMFYUI_BASE_URL }),
      (uploadDir) =>
        new ComfyUIImageProvider({ baseUrl: process.env.COMFYUI_BASE_URL, ...(uploadDir && { uploadDir }) }),
    );
  } else if (process.env.OMNIGEN_BASE_URL) {
    setDefaultAIProvider(
      new OmnigenImageProvider({ baseUrl: process.env.OMNIGEN_BASE_URL }),
      (uploadDir) => new OmnigenImageProvider({ baseUrl: process.env.OMNIGEN_BASE_URL, ...(uploadDir && { uploadDir }) }),
    );
  } else if (process.env.OPENAI_API_KEY) {
    setDefaultAIProvider(
      new OpenAIProvider(),
      (uploadDir) => new OpenAIProvider({ ...(uploadDir && { uploadDir }) }),
    );
  } else if (process.env.GEMINI_API_KEY) {
    setDefaultAIProvider(
      new GeminiProvider(),
      (uploadDir) => new GeminiProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  if (process.env.COMFYUI_BASE_URL) {
    setDefaultVideoProvider(
      new ComfyUIVideoProvider({ baseUrl: process.env.COMFYUI_BASE_URL }),
      (uploadDir) => new ComfyUIVideoProvider({ baseUrl: process.env.COMFYUI_BASE_URL, ...(uploadDir && { uploadDir }) }),
    );
  } else if (process.env.SEEDANCE_API_KEY) {
    setDefaultVideoProvider(
      new SeedanceProvider(),
      (uploadDir) => new SeedanceProvider({ ...(uploadDir && { uploadDir }) }),
    );
  } else if (process.env.NVIDIA_NIM_API_KEY || process.env.NVIDIA_API_KEY) {
    setDefaultVideoProvider(
      new NvidiaNimVideoProvider(),
      (uploadDir) => new NvidiaNimVideoProvider({ ...(uploadDir && { uploadDir }) }),
    );
  }

  initialized = true;
}
