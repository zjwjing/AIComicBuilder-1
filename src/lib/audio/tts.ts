import fs from "node:fs";
import path from "node:path";
import { EdgeTTS } from "node-edge-tts";
import { id as genId } from "@/lib/id";

const uploadDir = process.env.UPLOAD_DIR || "./uploads";

export async function generateDialogueAudio(
  text: string,
  options?: { voice?: string }
): Promise<string | null> {
  const defaultVoice = process.env.TTS_VOICE || "zh-CN-XiaoxiaoNeural";

  const dir = path.join(uploadDir, "audio", "dialogue");
  fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, `${genId()}.mp3`);

  try {
    const tts = new EdgeTTS({
      voice: options?.voice || defaultVoice,
      lang: "zh-CN",
      outputFormat: "audio-24khz-48kbitrate-mono-mp3",
    });

    await tts.ttsPromise(text, filepath);
    return filepath;
  } catch (err) {
    console.warn(`[TTS] Failed: ${err}`);
    return null;
  }
}
