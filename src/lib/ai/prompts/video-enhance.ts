import { resolveAIProvider } from "../provider-factory";
import type { ModelConfig } from "@/lib/generate-utils";

const ENHANCE_SYSTEM_PROMPT = `你是一个视频提示词优化专家。你的任务是将原始视频提示词改写成适合 LTX 视频生成模型的格式。

LTX 模型要求的提示词风格：
- 以主要动作开篇，一句话描述核心动作
- 添加具体的运动、姿态细节
- 精确描述角色/物体的外观
- 包含背景和环境细节
- 指定镜头角度和运动方式
- 描述灯光和色彩
- 按时间顺序描述场景发展
- 不超过 200 字
- 用一段连贯的文字描述，不要分点列表
- 使用中文

规则：
1. 保留原始提示中的所有关键信息
2. 补充缺失的细节使画面更生动
3. 确保描述是时间线性的（先发生什么，再发生什么）
4. 不要添加原始提示中没有的信息
5. 输出只包含改写后的提示词，不要有任何解释`;

export async function enhanceVideoPrompt(
  rawPrompt: string,
  modelConfig?: ModelConfig,
): Promise<string> {
  const trimmed = rawPrompt.trim();
  if (!trimmed || trimmed.length < 20) return trimmed;

  try {
    const provider = resolveAIProvider(modelConfig);
    const enhanced = await provider.generateText(trimmed, {
      systemPrompt: ENHANCE_SYSTEM_PROMPT,
      temperature: 0.3,
    });
    const result = enhanced.trim();
    return result.length > trimmed.length * 3 ? trimmed : result;
  } catch {
    return trimmed;
  }
}

