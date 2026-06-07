# Progress

## 2026-06-07 Session — HiDream-O1 工作流对齐官方 dev 参数
- 诊断 web app "不符合要求"的生图：pink/blue 噪点图是 ComfyUI 端发散
- 关键发现：通过 ComfyUI `object_info/ModelNoiseScale` 的 tooltip 看到官方推荐值 **"HiDream-O1 base: 8.0, dev: 7.5"**，当前 `noise_scale: 6` 显著偏低 → 信号被噪声淹没
- 关键误判：先怀疑 `CLIPTextEncode`（普通）应改为 `CLIPTextEncodeHiDream`（4 encoder），但 ComfyUI 历史显示 `KeyError: 'l'`——`clip_l_hidream.safetensors` 等 4 个 HiDream 专用 encoder 在该环境未安装（系统只有 `clip_l.safetensors` for FLUX / `clip_g.safetensors` / `t5xxl_fp8_e4m3fn` 不带 scaled / `llava_llama3` 而非 `llama_3.1_8b_instruct`）
- 关键真相：读 `M:\ComfyUI_windows_portable\ComfyUI\comfy\text_encoders\hidream_o1.py:1-7` 看到 "The real Qwen3-VL backbone runs inside diffusion_model.* every step, so this module just tokenizes the prompt"——**HiDream-O1-Image 是把 Qwen3-VL 嵌入到 diffusion model 内部的 passthrough 架构**，单 text encoder 路径，**不是**官方 `hidream_i1_*`（4 encoder）那套
- 拿到用户提供的官方 dev workflow (`image_hidream_o1_dev.json` + `image_hidream_o1_dev-API.json`) 对齐参数：
  - `ckpt_name`: `hidream_o1_image_mxfp8.safetensors` (base) → `hidream_o1_image_dev_mxfp8.safetensors` (dev)
  - `noise_scale`: 6 → **7.6** (dev 推荐)
  - sampler: `KSamplerSelect` + `dpmpp_2m_sde_gpu` → **`SamplerLCM`** (s_noise=1, s_noise_end=1, noise_clip_std=2.5)
  - `cfg`: 7 → **1** (dev 官方参数)
  - 移除 `HiDreamO1PatchSeamSmoothing`（官方未使用）
  - 移除 `KSamplerSelect`（被 SamplerLCM 替代）
- 修改 `src/lib/ai/providers/comfyui-image.ts:433-547`：
  - 模型/噪声/采样器节点替换
  - `cfg: 7` → `cfg: 1`
  - `model: ["232", 0]` → `model: ["124", 0]`（移除 Patch 节点后）
  - `sampler: ["230", 0]` → `sampler: ["125", 0]`（改用 SamplerLCM）
- 更新测试 `src/lib/ai/providers/__tests__/comfyui-image.test.ts:213-239`：
  - ckpt 名称断言
  - noise_scale 断言 7.6
  - SamplerLCM 三个参数断言
  - cfg=1 断言
  - 移除 PatchSeamSmoothing / KSamplerSelect 的存在断言
- 端到端验证：构造 28-step 测试 workflow → ComfyUI 实际生成 `hidream_dev_test_00001_.png` (24s, 1.4MB)，虎斑小猫红色坐垫，毛发细腻无伪影
- lint ✅ tsc ✅ vitest ✅ 43/43 passed

## 2026-06-06 Session (续) — HiDream-O1 中文 Prompt → 英文自动翻译
- 诊断 web app 中 HiDream-O1 生成图"不合适"的根因：ComfyUI 历史确认生图成功，但 HiDream-O1 使用 Llama2 CLIP 文本编码器，中文 prompt 编码质量差
- 修复：在 `ComfyUIImageProvider.generateImage()` 的 `isHiDreamO1` 分支中，检测中文后自动调用 OpenAI 兼容 API 翻译为英文，再送入 `buildHiDreamO1Workflow()`（`src/lib/ai/providers/comfyui-image.ts:61-107`）
- `translateToEnglish()` 函数：检查 `/[\u4e00-\u9fff]/`，使用 `OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL` 环境变量，temperature 0.1，30s 超时，失败时静默回退原文
- 进一步修复 HiDream-O1 出图“不符合提示词、质量差”：不再把整段中文规则直译成英文说明文，而是让翻译器输出简洁、CLIP 友好的英文视觉 prompt；同时将 HiDream 高质量档步数改为 `28`（`quality=hd/default/undefined -> 28 steps`，其它质量档保持 `20`）
- 用户确认 HiDream-O1 可直接识别中文后，已撤销英文翻译链，恢复为直接向 HiDream 发送原始中文 prompt；保留 `28` 步高质量档映射修复
- 外部仓库 `I:\claw\Windows-MCP-Enhanced` 已做最小可运行修复：
  - `utils.py` 补 `Tuple` import，修正默认配置路径到根目录 `configs/vla_config.yaml`
  - `gui_agent.py` 改为 `load_config(vla_config_path)`，使 provider 覆盖真正生效；修正 `self.desktop.apps` -> `self.desktop.get_apps_from_start_menu()`；`window.title` -> `window.name` 兼容 Windows-MCP `Window` 结构；`screenshot_callback` 改为显式 `Callable`
  - `vla_client.py` 新增 `mano-p` provider 专用分支：不再错误调用 `/chat/completions`，而是调用 `http://localhost:7861/api/manop/infer`，并从返回 `{ text }` 解析动作
  - `tools/gui_agent.py` 修正 `vla_provider` 覆盖逻辑：临时写 YAML 配置并传入 `WindowsGUIAgent(vla_config_path=...)`，避免参数被忽略
  - 运行验证通过：`load_config()` 正常读取配置，`create_windows_gui_agent()` 可实例化，`mano-p` provider 覆盖生效，`find_window('Chrome')` 返回 `True`，`compileall` 通过
- 继续完善 `I:\claw\Windows-MCP-Enhanced` 的 agent 核心逻辑：
  - 修复 `run_task()` / `_execute_action()` 返回语义：普通动作返回 `"continue"`，仅 `FINISH` 返回 `"finished"`，避免第一步点击/输入后就误报“任务完成”
  - 修复 `TYPE` 高风险误操作：没有 `click_first + click_x/click_y` 时不再调用 `Desktop.type((0,0), text)` 误点左上角，而是显式返回失败
  - 修复目标窗口绑定：`find_window()` 只使用真实打开窗口，不再把“开始菜单已安装应用”误当成当前窗口；成功匹配后会记录 `target_window_bounds`、切换前台窗口，并在截图/坐标执行时应用窗口偏移
  - `list_windows()` 改为基于真实桌面窗口而非开始菜单应用列表
  - `vla_client.py` 增加 fenced JSON / 文本中 JSON 块提取，提升 Mano-P / GPT 输出解析鲁棒性
  - `utils.py` 改为优先使用 `OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL` 环境变量，减少硬编码密钥依赖；`tools/gui_agent.py` 会在执行后清理临时 YAML 配置文件
  - 运行验证通过：`compileall` 通过，`find_window('Chrome')` 返回 `True`，且 `target_window_bounds` 已成功写入
- 继续硬化 `I:\claw\Windows-MCP-Enhanced`：
  - 增加 Win32 原生窗口兜底：前台窗口和顶层窗口枚举不再完全依赖 Windows-MCP 高层窗口列表，`find_window('Chrome')` / `bind_active_window()` 已恢复可用
  - 截图链改为优先使用窗口区域原生截图，并对空图直接抛错；`configs/vla_config.yaml` 默认 backend 改为 `pillow`，绕开当前环境下不稳定的 `dxcam`
  - 强化 VLA schema：prompt 强制要求只返回一个 JSON object 且必须包含 `action_type`；空 `{}` / 缺字段动作直接转为 `FAIL`
  - `tools/gui_agent.py` 不再为 provider 覆盖写入带密钥的临时 YAML；直接把内存配置注入 `WindowsGUIAgent` / `VLAClient`
  - `configs/vla_config.yaml` 已移除明文 `api_key`，改为依赖环境变量覆盖
  - 动作成功语义补齐：
    - `FINISH` 测试已真实跑通，返回 `success=True`
    - 单步 `MOVE` 测试也已真实跑通，返回 `success=True`，并带 `execution: {status: 'continue', executed: True}`
  - 单步动作联调继续扩展：`CLICK`、`SCROLL`、`TYPE` 均已真实跑通；`TYPE` 需要把 VLA timeout 提高到 90s 才稳定返回动作
  - 多步 Notepad 任务暴露新问题：某些窗口边界会退化成极小截图（例如 `160x28`），导致 VLA 无法定位编辑区；已加入最小窗口尺寸过滤和过小截图回退到整窗/整屏截图的兜底逻辑
- lint ✅ tsc ✅

## 2026-06-06 Session - project audit follow-up
- Fixed `pnpm-workspace.yaml` by adding `packages: ['.']`, so pnpm commands run from the project root again.
- Fixed `src/lib/ai/providers/__tests__/agnes-video.test.ts` fake-timer helper by attaching a temporary catch before advancing timers; expected rejection tests no longer produce Vitest unhandled errors.
- Added an `AUTH_SECRET` bootstrap warning and documented it in `.env.example`; local `.env` was checked for presence without printing the secret.
- Fixed runtime `ENOENT ... .next/server/edge-instrumentation.js` by deleting the mixed Webpack/Turbopack `.next` cache and rebuilding; verified the regenerated middleware manifest no longer references `server/edge-instrumentation.js`.
- Started dev server with `I:\pnpm.exe run dev` and verified `http://localhost:3000/zh` returns HTTP 200.
- Tightened first/last frame image prompts to prevent reference-sheet/contact-sheet outputs: added a single-frame layout contract, explicit bans on collage/storyboard/multi-panel/thumbnail rows, and clarified character references are identity/style references only, never layout references. Added `frame-generate.test.ts` coverage for these constraints.
- Current verification for the frame prompt fix passed: `vitest run src/lib/ai/prompts/__tests__/frame-generate.test.ts`, `npm.cmd run lint -- --quiet`, `tsc --noEmit`, `npm.cmd run build`.
- Updated non-4-grid batch video generation to chain shots from actual generated video tails: after each shot video finishes, FFmpeg extracts the final video frame, saves it as that shot's active `last_frame`, and uses it as the next shot's active `first_frame`. If a shot fails, the propagation chain is reset to avoid using a stale tail frame. Added FFmpeg tail-frame extraction test coverage.
- Current verification for the video-tail chaining fix passed: `vitest run src/lib/video/__tests__/ffmpeg.test.ts`, `vitest run src/lib/ai/prompts/__tests__/frame-generate.test.ts`, `npm.cmd run lint -- --quiet`, `tsc --noEmit`, `npm.cmd run build`.
- Wired keyframe Auto Run into the chained workflow: Auto Run now calls `batch_frame_generate` with `chainContinuity`, so the frame stage generates the first shot's first frame and each shot's last frame; later first frames are supplied by previous video tails during `batch_video_generate`. Manual batch frame generation still keeps the original independent first+last behavior.
- Fixed chain-mode frame generation edge case: if the first shot already has a first frame but is missing a last frame, Auto Run now reuses that existing first frame and only fills the missing last frame instead of regenerating the first frame.
- Fixed remaining first/last frame contact-sheet outputs by changing keyframe image reference strategy: when a shot has multiple character reference images, first/last frame generation no longer passes those image references to the image model and relies on the text character descriptions instead. Single-character shots can still use the image reference. This prevents multi-reference models from reproducing reference sheet/collage layouts.
- Fixed prompt trigger words that still caused first/last frame contact sheets after image refs were removed: when no character image references are passed, first-frame prompts now use a text-only style/appearance lock and omit all character reference-sheet language (`角色设定图`, `4个视角`, `名字印在底部`). Last-frame prompts only mention the first-frame visual anchor and do not describe extra character reference sheets unless character image references are actually passed.
- Current verification for the Auto Run chain mode passed: `npm.cmd run lint -- --quiet`, `tsc --noEmit`, `vitest run src/lib/video/__tests__/ffmpeg.test.ts`, `vitest run src/lib/ai/prompts/__tests__/frame-generate.test.ts`, `npm.cmd run build`.
- Verification passed: `I:\pnpm.exe run lint --quiet`, `I:\pnpm.exe exec tsc --noEmit`, `I:\pnpm.exe exec vitest run` (619 tests), `npm.cmd run build`, and a final `I:\pnpm.exe run build` rerun.

## Completed
- **Ideogram-4 NVFP4 成功运行在 RTX 4080 16GB** ✅: 下载了 ComfyUI master 的 `nodes_ideogram4.py`（提供 `Ideogram4Scheduler`），约 90 秒生成一张 1024×1792 图片。NVFP4 量化（5.1GB DiT）+ Qwen3-VL-8B FP8（9.9GB CPU）+ flux2-VAE（320MB）完美适配 16GB 显存。工作流自动展平了子图定义，ComfyUI v0.22.0 前端成功解析 UUID 子图节点。
- **Session 2026-06-03 — All video/image downloads converted to streaming**: Replaced `Buffer.from(await response.arrayBuffer())` + `fs.writeFileSync` with `pipeline(response.body!, createWriteStream(filepath))` across 16 provider files (8 video + 8 image). Updated 16 test files to mock `createWriteStream` + `pipeline`. Fixed `dashscope-image.test.ts` assertion from `writeFileSync` → `pipeline`. **Files changed**: `agnes-video.ts`, `aivideo-video.ts`, `openai.ts`, `siliconflow-image.ts`, `sensenova-image.ts`, `kling-image.ts`, `kling-video.ts`, `seedance.ts`, `ucloud-seedance.ts`, `framepack-video.ts`, `wan-video.ts`, `dashscope-image.ts`, `comfyui-image.ts`, `comfyui-video.ts`, `asxs-image.ts`, `omnigen-image.ts`. lint ✅ tsc ✅ build ✅
- **Session 2026-06-01 — 生产构建 DB 修复 + Agnes 免费 API 验证 + 日志审查**: 
  - **生产 standalone 构建修复**: `scripts/copy-env-to-standalone.mjs` 现在同时复制 `drizzle/` 迁移文件夹 + `data/` 数据库到 `.next/standalone/`，并把 `DATABASE_URL` 从绝对路径重写为相对路径；`src/instrumentation.ts` 在生产模式下自动用 `dotenv` 加载 `.env`（独立服务器不会自动加载）。根因：`SqliteError: no such table: projects` — 缺少迁移文件 + .env 未加载导致创建空数据库。
  - **Agnes 免费 API 验证**: `GET /v1/models` ✅ (列出 5 个模型)，但文字（503 model_not_found）、图片（503）、视频（500 upstream error）全部不可用 — free key 无实际后端通道，需付费 Token Plan（$4/月起）。
  - **项目日志审查**: `prod-server.log` 确认了 DB 错误；`dev-server.log`（2682行）显示最新 25/25 镜头生成成功；`dev-server-err.log`/`dev-server-3001.log` 正常。
- lint ✅ tsc ✅ build ✅

## 2026-06-06 — ComfyUI Windows 优化（OSError [Errno 22] + wandb 冲突修复）
- **Root cause**: ComfyUI `logger.py` `LogInterceptor.__init__` 硬编码 `encoding='utf-8'`，Windows 控制台实际为 GBK(cp936)，导致 Latent 采样时 `tqdm` → `wandb` → `comfyui_manager/prestartup_script.py` → `app/logger.py:66 super().write()` 整条链在 `TextIOWrapper.write()` 层报 `OSError: [Errno 22] Invalid argument`
- **logger.py 修复**: 改回 `encoding = stream.encoding` + `errors='replace'` — GBK 不会引发 OSError，`errors='replace'` 将 GBK 无法编码的字符（emoji 等）替换为 `?`，避免原始 UnicodeEncodeError
- **main.py wandb 关闭**: Windows 平台在 `setup_logger()` 前设置 `WANDB_CONSOLE=off`、`WANDB_SILENT=true`、`WANDB_MODE=disabled`，防止 wandb 自动 hook 控制台输出，消除整条冲突链
- **logger.py 容错**: `LogInterceptor.write()` 增加 `try/except OSError: pass`，即使底层写失败也不崩

## 2026-06-05 Session (续) — HiDream-O1 单元测试 + 角色 Prompt 模板
- **SenseNova Image (`sensenova-ul-fast`) 已验证修复 ✅**: 生图效果良好，当前架构对协议层兼容性正确
- **`buildHiDreamO1Workflow()` 单元测试**: 新增 15 个测试（默认结构、参考图模式节点验证、6 种分辨率映射、3 种 steps 场景、seed 随机性、generateImage hidream-o1 提交流程），全部 53 个测试通过
- **HiDream-O1 角色 Prompt 模板**: 新增 `characterImageHiDreamO1Def`（自然语言四视图转角提示，2×2 网格布局，纯白背景，无 JSON 包装）；注册到 `registry.ts`；`detectImageModelFamily()` 新增 `"hidream"` 类型检测；`character.ts` handler 新增 routing（`hidream` → `character_image_hidream_o1` prompt key + `hidream-o1-comfyui` workflowFamily）
- **角色 Prompt 单元测试**: 新增 `character-image.test.ts`（11 个测试覆盖 HiDream-O1/Ideogram4/Simple 三个 prompt 定义）
- **`detectImageModelFamily` 测试**: 新增 `character-image-detection.test.ts`（6 个测试覆盖全部 6 个 family）
- **Preflight 参考节点修复**: 参考节点（HiDreamO1ReferenceImages, ComfySwitchNode, PrimitiveBoolean, LoadImage）从核心要求中移除，改为 `preflightWorkflow` 的 `extraNodeTypes` 可选参数，仅在需要时检查；`generateImage()` 中 HiDream-O1 分支提前到 preflight 前，根据 `referenceImages` 动态传入 extra 节点
- **`handleSingleCharacterImage` 集成测试**: 新增 `character.test.ts`（7 个测试 — 输入校验 3 条 + HiDream-O1 路由/参考图/错误传播/stale shots 标记），mocks DB/Provider/Prompt/Shot-asset 全链路
- lint ✅ tsc ✅ build ✅

## 2026-06-05 Session (续) — HiDream-O1 Reference Images 支持
- **参考图上传**: `generateImage()` 中 HiDream-O1 分支现在在构建 workflow 前先上传参考图到 ComfyUI server
- **`buildHiDreamO1Workflow()` 参考图分支**: 当 `uploadedReferences` 非空时，自动添加 `LoadImage`（每个参考图一张）、`HiDreamO1ReferenceImages`（连接 CLIPTextEncode 的 positive/negative 和所有参考图）、`ComfySwitchNode`（positive/negative 两条路径切换）、`PrimitiveBoolean(true)`（启用参考图模式）。无参考图时保持当前直连模式。
- **Preflight 扩展**: 新增 4 个可选节点类型（HiDreamO1ReferenceImages, ComfySwitchNode, PrimitiveBoolean, LoadImage）
- **限制**: 参考图必须是本地文件路径（与 Qwen Edit 一致），通过 `uploadImage()` 上传到 ComfyUI input 目录后被 `LoadImage` 引用
- lint ✅ tsc ✅ build ✅

## 2026-06-05 Session (续) — HiDream-O1 Image 集成 ComfyUI Provider
- **HiDream-O1 ComfyUI 工作流集成**: 根据官方模板 `image_hidream_o1.json` 的扁平 API 格式，新增 `buildHiDreamO1Workflow()` 方法（CheckpointLoaderSimple + ModelNoiseScale + BasicScheduler + KSamplerSelect + HiDreamO1PatchSeamSmoothing + CLIPTextEncode + EmptyHiDreamO1LatentImage + SamplerCustom + VAEDecode + SaveImage）
- **模型路由**: `generateImage()` 新增 `isHiDreamO1` 分支，支持 modelId 含 `hidream` 时自动路由；`detectWorkflowFamily()` 新增 `hidream_o1` 文件检测
- **分辨率映射**: 新增 `ratioToHiDreamO1Size()`，按 HiDream-O1 训练分辨率（2048²/2560×1440/2304×1728/1440×2560 等）映射 aspect ratio
- **步骤控制**: `quality === "default"` 用 40 步（原模板默认），否则 20 步 Turbo
- **Preflight**: 新增 `"hidream-o1-comfyui"` 7 个必需节点类型
- **Model List API**: 新增 `hidream-o1-comfyui` 到 ComfyUI Image 模型列表
- lint ✅ tsc ✅ build ✅
- **Session [之前] — Battle prompts registry + 4 provider test files**: Integrated 29 martial-arts shot prompt templates into `registry-battle.ts` (5 categorized slots), registered in `registry.ts` (19 total), appended rule 6 to `shot_split` fidelity rules; wrote 63 tests across `veo.test.ts` (13), `ucloud-seedance.test.ts` (16), `framepack-video.test.ts` (15), `aivideo-video.test.ts` (15). Fixed `vi.clearAllMocks` → `vi.resetAllMocks` to prevent leftover `mockResolvedValueOnce` bleed across tests; used `vi.useFakeTimers` + `advanceTimersByTimeAsync` for poll timing test; used class `function()` expression in `vi.mock` factory for Google GenAI SDK constructor. lint ✅ tsc ✅
- **Session 06/06 下班**: 新写 1 个 wan-video.test.ts（28 tests），累计 16 个 provider test 文件；所有新 provider 的 `generateText`（抛不支持异常）、`generateImage`（t2i/size/认证/错误/写盘）、`generateVideo`（keyframe/reference/text/轮询/错误）全覆盖；支持 7 家 AI 厂商 × 2 大模态（图片+视频）；lint ✅ tsc ✅，`next build` 在 Windows 上因内存超时受阻（`--turbo` bypass）
- **Hermes agent 修复并升级到 v0.15.1**: 根因是旧版 `0.15.1` pip 包的 `hermes_cli` 缺少 `main.py`，加上 `~ermes*` 残余目录干扰。清理残留后从本地源码重装 editable (v0.14.0)，然后运行 `hermes update --yes` 拉取 796 个新 commit，成功升级到 `0.15.1 (2026.5.29)`，状态 `Up to date`
- LongLive 1.0 inference pipeline functional (SDPA fallback, PyTorch 2.12)
- 4-grid batch frame generation button fixed (storyboard/page.tsx)
- Auto Run cascading fixed (needsPrompt includes needsFrame check)
- videoPrompt saved to DB after generation (video-keyframe.ts)
- OpenClaw Gateway running with QQ Bot + YuanBao channels connected
- OpenClaw security hardened (groupPolicy allowlist, plugins.allow whitelist)
- Harness infrastructure: AGENTS.md, .claude/settings.json, PROGRESS.md, setup.ps1/sh
- Dev server restarted (picks up fixed COMFYUI_OUTPUT_DIR from .env)
- Batch 4-grid tail flash trim added (video-keyframe.ts: ffmpeg trim for batch mode)
- `pnpm-lock.yaml` generated, eslint config rewritten (bypasses rushstack/pnpm incompatibility), `.npmrc` created
- **4-grid quality aligned to manual workflow**: frame_idx `[0,90,180,270]` + full LoRA chain (subtitles-remove → restoration → dynamic 0.6 → OmniNFT 0.2 → distilled 0.5) in `ltx-i2v-multiguide.json`
- Completion criteria all pass: lint ✅ tsc ✅ build ✅
- **Phase 1 — 角色库自动沉淀完成**: frame 生成后自动将角色出图追加到 `characters.referenceImageHistory`，用户可浏览历史帧图并设为主要参考图 (`src/lib/pipeline/handlers/frames.ts:33-49`)
- **4-grid 画质优化**: sigma schedule 从 "balanced"（9步）→ "quality"（17步）→ "quality_lite"（13步）；distilled LoRA 强度 0.5 → 0.65，减少运动模糊
- **N+1 dialogue 查询修复**: `/api/projects/[id]` 和 `/api/projects/[id]/episodes/[episodeId]` 两个 GET 端点用 `inArray` + Map 分组替代逐个 shot 的对话查询
- **页面导航性能优化**: layouts 改用轻量模式 (`?exclude=shots`)，不加载 shots/assets/dialogues；storyboard 页按需触发完整数据加载
- **SenseNova 413 修复**: 所有 `generateText`/`generateImage` 调用的图片数组上限统一为 6 张 (`visionFrames`, `sceneFramePaths`, `shotCharRefImages`, Omnigen upload loop)
- **模型提供商架构修复**:
  - `resolveAIProvider`: 非 SenseNova 的 text provider 回退为 OpenAI（继承同 protocol 的 baseUrl/apiKey）
  - `model-store.getModelConfig()`: 添加 `capability` 检查，确保 `defaultTextModel` 只返回 `capability === "text"` 的 provider
  - `ensureDefaultProvider()`: 新增 `isTextCapable()` 验证
  - Emotion-analysis + continuity-check API 路由: 添加 `modelConfig?.text` 存在性校验（400 拦截）
- **Git 分叉修复**: 本地 `master` → `main` 重命名，GitHub 两端 (`main` + `master`) 同步，CNB 同步
- **测试框架**: 配置 vitest 4.1 + 5 test files / 61 tests (model-store, provider-factory, validation, id, utils)
- lint ✅ tsc ✅ (build ⏳ environment timeouts — blocked by resource limits)
- **Agent + 无限画布 (阶段1)**: 基于 `@xyflow/react` 在 Storyboard 页面新增 Canvas 视图模式；点击 Shot 节点调出 Agent Chat 面板；`POST /api/projects/:id/agent/chat` 端点将自然语言指令映射为 pipeline actions
- **审计修复 (7 issues)**: 全部修复
  - Critical: `hasVideo` 类型修正为 `boolean` (!! 转换)
  - Critical: `useCanvasStore.getState()` 改为 zustand selector hook `useCanvasStore(s => s.selectedShotId)` 封装为 `CanvasView` 子组件
  - Critical: camera direction 倒挂解析 → 改用 `parseCameraDirection` + 正则匹配"pan left/zoom in"等
  - Critical: Storyboard Page 嵌入 canvas 结构调整 (消除双重 `viewMode === "kanban"`)
  - High: `INTENT_MAP` 排序提取到模块级常量 `INTENT_MAP_SORTED`，不在每次 `matchIntent` 调用时排序
  - High: agent-chat race condition → `shotIdRef` 跟踪请求时 shot，过期响应自动丢弃
  - High: `chatMessages` 全局数组 → 按 `selectedShotId` 隔离 (`chatMessagesByShotId: Record<string, ChatMessage[]>`)
  - 顺手修复: `<img>` 缺失 `onError` 兜底、页面残留 `{/* unused import */}` 清理
- **四宫格视频提示词 413 修复**: `video-prompt.ts` 在调用文本模型前按总图片体积预算选择 vision frames（最多 6 张且总原图体积约 2.5MB），避免 4 张大 panel base64 后请求体超限；lint ✅ tsc ✅，build 仍因环境资源超时
- **项目加载慢初步修复**: `project-store` 增加 `loadedProjectKey`，Project/Episode layout 与 Storyboard full fetch 会跳过已加载的同 key 请求，减少重复轻量/完整数据拉取；lint ✅ tsc ✅
- **Next root layout + 请求循环修复**: 根 `src/app/layout.tsx` 恢复 `<html>/<body>`，`[locale]/layout.tsx` 改为只包 Provider；`project-store.fetchProject` 增加 `pendingProjectKey` 与同 key 去重，避免 ProjectLayout/EpisodeLayout 互相覆盖导致重复请求/页面 500；lint ✅ tsc ✅；dev server 已重新启动，`/zh` 返回 200
- **四宫格视频提示词只有 Duration 修复**: `video-prompt.ts` 对文本模型空输出增加 fallback prompt，避免 `rawPrompt.trim()` 为空时仍保存 `Duration: Ns`；单张/批量均覆盖；lint ✅ tsc ✅
- **单张生成 episodeId 传递修复**: `ShotCard`/`ShotDrawer` 的单张参考帧、视频提示词、帧、视频生成请求补传 `episodeId`，避免服务端日志 `episodeId=none` 导致 episode 上下文刷新/筛选错位，看起来生成未成功；lint ✅ tsc ✅
- **4-grid 视频时长/去水印修复**: 移除 `video-keyframe.ts` 中 4-grid 视频生成后的 `ffmpeg -t dur-1.5` 裁剪逻辑，解决生成视频总比提示词少约 2 秒；同时将 LTX 模板中的 `ltx2.3-ic-subtitles-remove-general` 与 `ltx2.3-video-restoration-general` 强度从 `0.9` 提到 `1.0`，增强字幕/水印抑制；lint ✅ tsc ✅
- **吸收 Seedance skill 思路优化视频提示词**: 增强 `registry-video.ts` 的 `video_generate_4grid` 模板，加入“导演化改写规则”、时间分段、镜头语言、安全区与四层描述要求；增强 `video-enhance.ts`，将口语化视频描述自动翻译为更专业的电影镜头语言；lint ✅ tsc ✅
- **审计回归修复**: `enhanceVideoPrompt()` 增加 mode 参数，拆分为 `default` 与 `four_grid` 两套 system prompt，避免四格导演化增强误伤普通视频/参考视频链路；`video-keyframe.ts` 的四格调用显式传 `"four_grid"`；lint ✅ tsc ✅
- **风格预设接入 ScriptEditor**: 新增 `src/lib/style-presets.ts`，整理 120 风格为可复用预设；`ScriptEditor` 增加风格下拉与“插入风格”按钮，会把所选风格写入 `Idea` 文本中的 `视觉风格参考：中文 / English` 行，便于脚本生成链路复用；lint ✅ tsc ✅
- **视觉风格参考显式进入生成链路**: `buildScriptGeneratePrompt()` 现在会提取 `视觉风格参考：...` 并以高优先级显式注入 script_generate user prompt；`buildShotSplitPrompt()`/`shots.ts` 也会把该风格作为“最高优先级”约束喂给分镜拆解，确保 startFrame/endFrame/videoScript 持续体现选定风格；lint ✅ tsc ✅
- **风格链路继续下沉到关键帧/参考图**: `keyframe.ts` 和 `ref-image.ts` 现在会优先读取 `视觉风格参考：...`（从 script / idea 中提取），再与剧本里的 `视觉风格 / 色彩基调 / 时代美学 / 氛围情绪 / 画幅比例` 合并，显式传入关键帧提示词和参考图提示词生成；lint ✅ tsc ✅
- **风格链路打通到视频提示词/参考视频**: `video-prompt.ts` 与 `video-reference.ts` 现在也会从 script / idea 中提取 `视觉风格参考：...`；该风格会显式注入 `buildRefVideoPromptRequest()` 和 `buildReferenceVideoPrompt()`，使视频提示词与参考视频提示词保持和上游剧本/分镜同一风格基调；lint ✅ tsc ✅
- **UI 显示当前全局视觉风格**: 新增 `extractVisualStyleReference()` 工具方法；Script 页面与 Storyboard 页面页头会显示当前 `视觉风格参考` 徽标，方便用户随时确认当前项目风格；lint ✅ tsc ✅
- **吸收 lanshu 仓库的模型分流思路**: 新增 `src/lib/ai/video-model-strategy.ts`，可推断视频提示词家族（`ltx` / `wan` / `seedance` / `generic`）；`video-enhance.ts` 现在会按模型家族切换增强 system prompt，让 Wan 更偏稳定单动作、Seedance 更偏分镜散文、LTX 维持现有写法；lint ✅ tsc ✅
- **模型家族分流继续下沉到视频 prompt builder**: `buildRefVideoPromptRequest()` 和 `buildReferenceVideoPrompt()` 现在支持 `family` 参数；`video-prompt.ts` / `video-reference.ts` 会把 `inferVideoPromptFamily(modelConfig)` 传入，使 Wan/Seedance 在原始视频提示词构造阶段就体现差异，而不只是在增强阶段分流；lint ✅ tsc ✅
- **Storyboard 显示当前视频模型家族**: `video-model-strategy.ts` 新增 `getVideoPromptFamilyLabel()`；Storyboard 页头现在会展示当前视频模型策略徽标（如 `LTX 连续镜头` / `Wan 稳定单动作` / `Seedance 分镜散文`），帮助用户理解当前提示词写法偏向；lint ✅ tsc ✅
- **Storyboard 显示模型策略说明**: `video-model-strategy.ts` 新增 `getVideoPromptFamilyHint()`；Storyboard 页头现在在视频模型徽标下方显示一行简短说明（例如“偏连续镜头、时序推进和电影化动作描述”），让模型差异化策略更可感知；lint ✅ tsc ✅
- **Script 页面也显示当前视频模型策略**: `ScriptEditor` 页头现在同步展示当前视频模型家族徽标与简短说明，使用户在写创意/剧本阶段就能理解后续视频提示词偏向（LTX / Wan / Seedance）；lint ✅ tsc ✅
- **修复审计问题并提取专用策略徽标组件**: 审计确认 Script/Storyboard 中原先直接通过 `getModelConfig()` 计算策略存在非响应式风险；现已抽成 `src/components/editor/video-model-strategy-badge.tsx`，通过响应式订阅视频模型状态统一展示策略标签与说明，不改高影响面的 `InlineModelPicker`；lint ✅ tsc ✅
- **风格下拉与当前项目状态同步**: `style-presets.ts` 新增 `findStylePresetIdByReference()`；`ScriptEditor` 现在会根据 `project.idea` 中已有的 `视觉风格参考：...` 自动回填当前风格下拉，避免 UI 停在错误默认值；lint ✅ tsc ✅
- **插入风格时同步回填剧本视觉风格字段**: `ScriptEditor.applyStylePreset()` 现在除了更新 `idea` 的 `视觉风格参考：...`，还会在已有剧本正文中同步替换 `视觉风格：...` 行，确保 UI 选定风格、剧本结构块和下游解析保持一致；lint ✅ tsc ✅
- **风格徽标显示增加 script 回退**: `style-presets.ts` 新增 `extractVisualStyleValue()`；Script 与 Storyboard 页头现在会先读 `idea` 中的 `视觉风格参考：...`，若不存在则回退读取剧本结构块里的 `视觉风格：...`，避免已有剧本项目不显示风格；lint ✅ tsc ✅
- **提取专用 VisualStyleBadge 组件**: 新增 `src/components/editor/visual-style-badge.tsx`，把风格徽标的 idea/script 回退逻辑统一封装，Script 与 Storyboard 页面改为复用该组件，减少重复逻辑并便于后续扩展；lint ✅ tsc ✅
- **抽取统一视觉风格解析工具**: 新增 `src/lib/visual-style.ts`，统一提供 `extractStyleField()`、`extractPrimaryVisualStyleReference()`、`buildVisualStyleContext()`；`keyframe.ts`、`ref-image.ts`、`video-prompt.ts`、`video-reference.ts` 已切换到复用这套工具，去掉重复的风格解析代码；lint ✅ tsc ✅
- **视觉风格参考继续前移到 script_outline**: `visual-style.ts` 新增 `buildVisualStylePromptLead()`；`handleScriptOutlineAction()` 现在会在 outline 阶段就把风格作为显式高优先级上下文注入，无论走绑定 Agent 还是内置 `streamText` 路径，都能更早锁定整体美学方向；lint ✅ tsc ✅
- **Normal 视频路径注入视觉风格 + 模型家族**: `video-keyframe.ts` 中 `buildVideoPrompt()` 调用新增 `visualStyle` 与 `family` 参数，使非四格普通视频的 base prompt 也带上全局风格和模型策略上下文；lint ✅ tsc ✅
- **ComfyUI preflight 校验 + 错误代码标准化**: 新增 `src/lib/comfyui/errors.ts`（标准错误代码枚举 + `ComfyUIError` 接口）和 `src/lib/comfyui/preflight.ts`（`checkComfyUIServer()` / `checkComfyUIModels()` / `preflightWorkflow()`）；在 `ComfyUIVideoProvider` 和 `ComfyUIImageProvider` 的 `generateVideo()`/`generateImage()` 入口插入预检查，`SERVER_UNAVAILABLE` 等常见故障在提交 workflow 前就被捕获；同时给 image provider 补齐了 auth headers 支持；lint ✅ tsc ✅
- **4-grid 视频提示词注入视觉风格 + 模型家族**: `build4GridPrompt()` 的 fallback 模板和 registry 模板现在都支持 `VISUAL_STYLE` 和 `MODEL_FAMILY` 两个额外替换变量；`video-keyframe.ts` 的 single/batch 四格调用点将全局风格和模型家族传入；lint ✅ tsc ✅
- **Agent 脚本生成路径补齐视觉风格指令**: `handleScriptGenerate()` 绑定的 Agent 路径现在和 `handleScriptOutlineAction()` 一样，在 agent prompt 前显式注入 `buildVisualStylePromptLead()`；lint ✅ tsc ✅
- **视频提示词 duration cap 从 10s 提升到 30s**: `buildVideoPrompt()` 和 `buildReferenceVideoPrompt()` 的 prompt 内时长硬帽从 10s 提升到 30s（适配 LTX/Wan 最长 30s 能力）；`buildRefVideoPromptRequest()` 同样提升到 30s，并根据 `family` 参数动态确定上限；lint ✅ tsc ✅
- **视频提示词测试修复 10 个失败**: `buildInterpolationHeader` 在有 `segmentContext` 时跳过 registry 默认值（原先 registry 的通用 `interpolation_header` 覆盖了分段专用 header）；修复因 `detectLanguage` 按脚本文字语言输出标签导致的 10 个断言失败（英文输入输出英文标签，且 output 不含 `视频脚本`/`Video Script` 标签行）；31 tests ✅
- **apiFetch TypeError: Failed to fetch 修复**: 所有 11 个批量操作 handler 的 guard 从 `if (!project) return;` 改为 `if (!project?.id) return;`，防止 store 未加载时 URL 变为 `/api/projects/undefined/generate`；`apiFetch` 增加 URL 包含 `undefined` 的检测和网络层异常的中文错误包装；lint ✅ tsc ✅
- **Duration cap 30s → 10s 还原**: `buildVideoPrompt()`, `buildReferenceVideoPrompt()`, `buildRefVideoPromptRequest()` 的所有时长硬帽统一回退到 10 秒；相关测试同步更新；lint ✅ tsc ✅
- **kling-video.test.ts**: 14 tests — 构造函数（默认值/环境变量/参数覆盖），generateVideo（image2video 关键帧/text2video 引用/JWT Bearer/无 secretKey 直用 ak/400 无引用重试/轮询/提交失败/生成失败/duration v1 映射/duration v3 钳位/HTTP 图片引用）；lint ✅ tsc ✅ build ✅
- **kling-image.test.ts**: 15 tests — 构造函数（默认值/环境变量/参数覆盖），generateText（不支持异常），generateImage（正确body/自定义aspectRatio/JWT Bearer/无secretKey直用/poll轮询/submit HTTP错误/submit错误码/poll HTTP错误/poll失败/无URL/下载写盘）；lint ✅ tsc ✅ build ✅
- **siliconflow-image.test.ts**: 17 tests — 导出 `clampSize`/`resolveImageSize`；构造函数（默认值/env/参数覆盖/尾部斜杠），generateText（不支持异常），generateImage（默认body/model覆盖/aspectRatio/explicit size/img2img引用/HTTP URL引用/Bearer auth/HTTP错误/错误码/无图片/下载失败/下载写盘）；lint ✅ tsc ✅ build ✅
- **dashscope-image.test.ts**: 25 tests — 导出 `getModelFamily`/`resolveSize`/`ModelFamily`；getModelFamily（wan/zimage/qwen默认），resolveSize（explicit优先/wan比率/qwen比率/zimage比率/family默认/未知比率），构造函数（默认值/env/参数覆盖/尾部斜杠），generateText（不支持异常），generateImage（qwen body/wan尺寸/zimage无n/model覆盖/size优先级/Bearer auth/HTTP错误/API错误码/无URL/下载失败/下载写盘）；lint ✅ tsc ✅ build ✅
- **sensenova-image.test.ts**: 21 tests — 导出 `normalizeSenseNovaSize`/`normalizeBaseUrl`；normalizeSenseNovaSize（aspect映射/size映射/回退），normalizeBaseUrl（默认/强制/v1/尾部斜杠），构造函数（默认值/OPENAI_API_KEY/参数覆盖），generateText（不支持异常），generateImage（正确payload/explicit size/Bearer auth/b64_json保存/URL下载/frames目录/HTTP错误/API错误/空响应/无payload/下载失败）；lint ✅ tsc ✅ build ✅
- **hidream-image.test.ts**: 16 tests — 构造函数（默认/参数覆盖/尾部斜杠），generateText（不支持异常），generateImage（t2i模式/edit模式/subject模式/6张限制/size解析/默认2048+seed32/SSE解码写盘/start HTTP错误/无job_id/stream HTTP错误/SSE error事件/stream无结果）；lint ✅ tsc ✅ build ✅
- **omnigen-image.test.ts**: 20 tests — 构造函数（默认/参数覆盖/尾部斜杠），generateText（不支持异常），buildOmnigenPrompt（无ref/含ref/label+role/editBaseImage/dedup/6张限制），parseSSE（data+complete事件/[DONE]/非JSON），generateImage（上传+启动/下载写盘/txt2img免上传/上传失败/启动失败/无event_id/下载失败）；lint ✅ tsc ✅ build ✅
- **wan-video.test.ts**: 28 tests — 构造函数（默认值/环境变量/参数覆盖），buildKeyframeBody（wan2.6 img_url + size/wan2.7 media[] + ratio），buildReferenceBody（wan2.6 img_url/wan2.7 reference_image/上限8张），buildTextBody（非wan2.7 model/wan2.7→t2v），generateVideo（关键帧任务/引用任务/纯文本任务/Bearer auth + X-DashScope-Async/多轮轮询/submit HTTP错误/无task_id/生成FAILED/无video_url/下载写盘）；lint ✅ tsc ✅ build ✅
- **Provider 测试总览**: 16 个 provider test 文件，总计 20 个 test 文件；lint ✅ tsc ✅ (build ⏳ environment timeout — `--turbo` bypasses)
- **集成 Agnes AI 免费 API**: 新增 `agnes-video.ts` video provider（OpenAI-compatible 轮询风格定影模式），注册 `agnes` protocol 到 model-store（Protocol 联合类型）、provider-factory（text/image → OpenAIProvider，video → AgnesVideoProvider）、ai-sdk（复用 createOpenAI）、UI provider-form（DEFAULT_BASE_URLS + 三级 capability 选择）。已验证 API：text（`Agnes-2.0-Flash`）✅ image（`Agnes-Image-2.0-Flash` 返回 URL）✅ video（`POST/GET /v1/video/generations`，提交+轮询+下载）但 free API 不稳定（upstream 500 "division by zero"）。lint ✅ tsc ✅ build ✅
- **Agnes video 测试**: 新增 `agnes-video.test.ts`（18 tests）— 构造函数（默认/env/参数覆盖/尾部斜杠）、generateVideo（纯文本提交/图片base64/firstFrame/initialImage/Bearer认证/多轮轮询→COMPLETED/submit HTTP错误/无task_id/FAILURE错误/FAILED错误/COMPLETED无URL/video_url备选字段/下载失败/写盘验证/alt id字段）。lint ✅ tsc ✅
- **Key Decisions**:
  - `inferProvider()` called with `config: any` to avoid circular import from registry
  - `vi.stubGlobal("fetch", vi.fn(...))` + `vi.unstubAllGlobals()` in `beforeEach` for hermetic fetch stubs
  - Dedicated `generateVideo` test for multi-poll (RUNNING→SUCCEEDED), FAILED, missing video_url, HTTP error, no task_id
  - `as any` casts on test params to bypass restrictive union type narrowing (e.g., `VideoGenerateParams` union requires `initialImage` for all arms)
  - Text-only video generation handled via separate `buildTextBody` method; keyframe/reference each have dedicated builders
  - All helpers exported for direct unit testing (`clampSize`, `resolveImageSize`, `getModelFamily`, `resolveSize`, `normalizeSenseNovaSize`, `normalizeBaseUrl`)
  
## 迁移到 Infinite Canvas
- **决策**: 采用"工作流样板"方式迁移到 `basketikun/infinite-canvas`，不做插件化侵入
- **漫画提示词库**: 创建了 `prompts/manga-reference/prompts.json`（45条提示词，涵盖 7 大类：漫画风格、分镜构图、四格漫画、角色设计、动作场面、效果技法、漫画封面）
- **Go 后端**: 在 `repository/db.go` 注册新分类 `manga-reference`，在 `service/prompt_fetch.go` 添加 fetcher（类 davidwu 的 JSON 格式）
- **构建验证**: Go `go build ./...` ✅, `go vet ./...` ✅; Web `pnpm run build` ✅ (Next.js)
- **下一步**: 创建 GitHub repo `basketikun/manga-prompt-reference`，将 prompts.json 推上去以激活自动同步；之后创建工作流样板

## 2026-06-04 Session — 本地模型对比测试 + 视频生成项目评估
- **batiai/qwen3.6-27b:iq3 (11GB IQ3)**: 下载完成并测试 ✅ 约 3.8 t/s（比 17GB Q4_K_M 的 ~3 t/s 快 ~25%），节省 6GB VRAM，释放更多显存余量。
- **Qwen3.6-35B-A3B-MTP-GGUF (Jackrong/ModelScope)**: 两个 GGUF 下载完成并对比测试 ✅
  - **Q2_K (12.34GB)**: `--spec-draft-n-max 4 --ctx-size 30000 -ngl 99` → **159.8 t/s** 🚀。有 3.7GB VRAM 余量，适合大上下文
  - **Q3_K_S (14.48GB)**: `--spec-draft-n-max 3 --ctx-size 8192 -ngl 99` → **129.0 t/s**。14.48GB 太接近 16GB 上限，30K ctx 会降速到 6.8 t/s
  - **结论**: Q2_K (12.34GB) 是 RTX 4080 16GB 上的最佳选择 — 159.8 t/s + 30K ctx，远超 4060 Ti 的 114 t/s (IQ2_XXS)
  - MTP (speculative decoding) 内嵌在 GGUF 中自动生效，`--spec-draft-n-max=4` 最优
- **Mamoda2.5 (ByteDance) 评估结果 ❌**: 25B MoE DiT (128 experts, Top-8) + Qwen3-VL-8B = ~33B 总参数；即使 4-bit 量化 (~16.5GB) + 128 expert 路由开销 + Wan2.2 VAE 远超 16GB VRAM。**不能在 RTX 4080 本地运行**，需 CNB/L40
- **Stream-R1 (USTC/FrameX.AI) 评估结果 ✅**: 基于 Wan2.1 1.3B 蒸馏，仅需 8.19GB VRAM，RTX 4080 16GB 可轻松运行 (23.1 FPS at 832×480)；GitHub 和 HuggingFace 被 ISP 拦截，暂无法克隆/下载
- **项目结论**: RTX 4080 16GB 本地可用的 AI 视频方案：Stream-R1 (1.3B, 需 ISP 修复)、Wan2.1 1.3B/14B FP8+T5 offload、LTX-Video (0.9B)、ComfyUI 已有

## Blocked
- LongLive 1.0 local inference too slow (~3h per 30-frame video on RTX 4080) — use CNB (L40, Linux, FA2) for production
- **Qwen3.6-35B-A3B NVFP4**: vLLM 0.22.0 加载成功（MarlinNvFp4Kernel + MARLIN MoE backend），模型架构/量化识别正确，但 RTX 4080 16GB VRAM 不够（权重 ~16GB + 中间激活 OOM），需 CNB (L40 48GB) 或下载 GGUF 小模型本地部署
- **Stream-R1 / Mamoda2.5**: GitHub (代码) 和 HuggingFace (模型权重) 均被 ISP 拦截，Nginx 代理不支持 git 协议，等 ISP 修复或手动下载

## Known Issues
- `next build` webpack 模式在 ComfyUI（~21GB）运行时内存不足挂起，改用 `--turbo` 参数即可；`package.json` 已默认带上 `--turbo --no-lint`
- `verify-videos.js` excluded from lint (utility script)
- Vitest fake timer + rejects.toThrow 会产生 unhandled rejection 假阳性（测试本身通过）

## 2026-06-02 Session — Provider 全量审计 + 代码质量修复 + 测试覆盖加固 (+80 tests)
- **Provider 一致性审计完毕**: 20 providers 全部 √，端点/响应与真实 API 对齐，0 response shape 不匹配
- **3 CRITICAL, 5 HIGH, 2 MEDIUM 问题全部修复**:
  - CRITICAL: comfyui-image.ts (6 fetch calls 全部缺 AbortSignal.timeout)
  - CRITICAL: comfyui-video.ts (硬编码 `M:\ComfyUI...\output` → platform-aware；checkpoint 路径反斜杠 → 前斜杠)
  - CRITICAL: ucloud-seedance.ts (缺少 `process.env.UCLOUD_API_KEY` fallback)
  - HIGH: dashscope-image, kling-image, kling-video, seedance, wan-video (全部 fetch 补 timeout)
  - MEDIUM: openai.ts, sensenova-image.ts (补 timeout)
  - 同时修复 ltx-workflows.ts 全部 6 处反斜杠路径
- **`.env.example` 更新**: 新增 `UCLOUD_API_KEY`, `COMFYUI_OUTPUT_DIR`, `COMFYUI_LTX_CHECKPOINT`
- **测试覆盖审计 + 加补**: 发现 4 个关键缺口 (0% 覆盖率) → 全部填补
  - AbortSignal 传播测试: 0% → 89% (17/19 providers)
  - JSON 解析错误测试: 0% → 84% (16/19)
  - 轮询超时/最大重试测试: 0% → 100% (9/9 polling providers)
  - 缺失 API key 验证测试: 0% → 86% (12/14 applicable providers)
  - 网络错误测试: 5% → 84% (16/19)
  - 总计新增 ~80 tests，全部通过
  - 3 unhandled rejections 是已知的 Agnes 假定时器假阳性
- **验证**: lint ✅ tsc ✅ build ✅ 全部 489 tests ✅
- **修复 IMAGEGEN_API_KEY 优先级问题**: `openai.ts` 中 `process.env.IMAGEGEN_API_KEY` 无条件覆盖 `params.apiKey`，导致 Agnes 协议配置的 key 被 ASXS 全局 key 冲掉 → 401。修复为 `params.apiKey` 优先，`IMAGEGEN_*` 仅作 fallback。测试同步更新。lint ✅ tsc ✅ 35/35 ✅

## 2026-06-05 Session — 蚂蚁女王 + Ideogram-4 角色提示词规则 + ComfyUI 扁平 workflow 修复
- **更新 `character-image.ts`**: `ImageModelFamily` 添加 `"ideogram4"` 类型；`detectImageModelFamily()` 支持 detection via `protocol === "ideogram4"` 或 modelId 包含 `ideogram4`/`ideogram-4`
- **新增 `characterImageIdeogram4Def` (registry-character.ts)**: 第七个角色提示词定义，输出结构化 JSON 格式 (`high_level_description`/`style_description`/`compositional_deconstruction`)，支持 `<3D 迪士尼-皮克斯动画风格>` 可编辑 slot
- **注册到 `registry.ts`**: 导入并注册 `characterImageIdeogram4Def`
- **更新 `character.ts` handler**: `handleSingleCharacterImage` 和 `handleBatchCharacterImage` 中 `ideogram4` 模型家族路由到 `"character_image_ideogram4"` 
- **ComfyUI provider 集成**: `ComfyUIImageProvider` 新增 `buildIdeogram4Workflow()`（最小化 15 节点扁平格式）；`generateImage()` 新增 Ideogram-4 分支（提交 → 轮询 → 下载）；workflow 模板 `ideogram4-t2i.json` 复制到 `src/lib/ai/providers/workflows/`
- **`buildIdeogram4Workflow()` 扁平格式修复**: 原实现直接返回带子图定义的 workflow JSON（含 `nodes`/`links`/`definitions/subgraphs`），但 ComfyUI `/prompt` API 只接受扁平 `{ node_id: { class_type, inputs } }` 格式 → 500 "Server got itself in trouble"。已重写为硬编码 15 节点扁平 workflow：CLIPLoader → CLIPTextEncode → ConditioningZeroOut → DualModelGuider（positive/negative），UNETLoader(v2) → CFGOverride → DualModelGuider（model），UNETLoader(uncond) → DualModelGuider（model_negative），RandomNoise + KSamplerSelect + Ideogram4Scheduler + EmptyFlux2LatentImage → SamplerCustomAdvanced → VAEDecode(VAELoader) → SaveImage。跳过 JSON 解析辅助子图（结构化 JSON 直接注入 CLIPTextEncode）。`quality: "default"` 用 20 步，否则 12 步 Turbo。
- **Preflight 支持**: `preflight.ts` 添加 `"ideogram4-comfyui"` 节点类型检查（26 个必需节点类型）
- **生产构建**: `copy-env-to-standalone.mjs` 新增第 4 步——复制 workflows/ 目录到 standalone 目录
- **验证**: lint ✅ tsc ✅ build ✅
- **Session 2026-06-05 — Workflow 路由修复 + 三重降级检测**:
  - **问题**: `isIdeogram4` 始终为 false — `ComfyUIImageProvider.model` 不含 "ideogram4"（model config 的 `modelId` 为 "z-image-turbo-comfyui"），prompt 也不含 `"prompt_generation"`（因 `detectImageModelFamily` 返回 "other" → 默认 free-text builder）→ 落入 Z-Image Turbo → 400
  - **修复方案（三重降级检测）**:
    1. **`WorkflowFamily` 选项** (`types.ts`): `ImageOptions.workflowFamily`，caller 可显式指定 workflow
    2. **Prompt 内容检测** (`comfyui-image.ts:451`): prompt 含 `"prompt_generation"` → Ideogram-4
    3. **Server 端模型自动检测** (`comfyui-image.ts:422-452`): `detectWorkflowFamily()` 查询 `/models`，发现 `ideogram4_nvfp4_mixed.safetensors` → `"ideogram4-comfyui"`。带实例级缓存 + localhost 短路
  - **额外修复**: 构造函数 fallback 移除误用的 `process.env.COMFYUI_BASE_URL`（URL 字符串当 model 名）
  - **检测优先级**: `options.workflowFamily` → model 名 → prompt 内容 → server 模型列表 → 默认 Z-Image Turbo
   - **测试**: 582 tests ✅（新增 localhost 短路 + 缓存后恢复 6 个因 fetch 中断的 comfyui-image.test）
   - lint ✅ tsc ✅

## 2026-06-05 Session (续) — Qwen Edit Dual 自动检测修复 + Z-Image Turbo 路径验证
- **Z-Image Turbo UNET 路径**: 已验证官方模板 `image_z_image_turbo.json` 的 note 说明模型存放于 `diffusion_models/z_image_turbo_bf16.safetensors`（根目录，无 `ZImage/` 子文件夹）。代码中的 `unet_name: "z_image_turbo_bf16.safetensors"` 正确，无需修改。
- **Qwen Edit Dual 自动检测修复**: `detectWorkflowFamily()` 原本只扫描 `diffusion_models` 文件夹，但 Qwen Edit 模型是 checkpoint（位于 `checkpoints` 目录）。已改为同时扫描 `diffusion_models` 和 `checkpoints` 两个目录。
- **构建修复**: 需先清理 `.next` 缓存、关闭残留 `next dev` 进程、使用 `--turbo` flag（与 `package.json` 的 build script 一致）。
- lint ✅ tsc ✅ build ✅

## 2026-06-05 Session (续) — SenseNova 故事板帧 Prompt 重构 (去格子/去文字)
- **问题**: 用户反馈故事板帧图生成（通过 SenseNova `sensenova-ul-fast`）仍然出现格子边框和文字标签
- **修复**: `buildPanelPrompt()` (frames.ts:59-75) 彻底重构：
  - 移除了 `"生成四宫格分镜中的 PANEL X，作为一张高质量图像。"`（触发模型输出网格/漫画分格）
  - 移除了所有 `=== 场景描述 ===`/`=== 当前面板画面 ===`/`=== 角色描述 ===` 节标题
  - 改为纯平铺格式，第一行即为质量约束（"电影级动画场景渲染，丰富细节，电影布光，完整环境背景。不要格子边框，不要分格线，不要出现任何文字标签。"）
  - 结尾行从"画面应像漫画/分镜的单个 panel，而不是拼贴图"改为"保持角色、服装、光线、画风连续性。"
  - 新格式与 `characterImageSimpleDef`（已验证 SenseNova 工作正常）格式一致
- **registry-frame.ts**: 在 `frame_generate_first`/`frame_generate_last`/`scene_frame_generate` 的首行追加反约束（"不要格子边框，不要漫画分格线，不要出现任何文字标签"）
- **验证**: lint ✅ tsc ✅ build ✅ (编译 10.3s)
- **API 测试受阻**: ASXS 代理 (`gpt-4o-mini`/`gpt-4o`) 和 Agnes API 均 503，无法用 Vision 自动检验 SenseNova 出图效果
- **下一步**: 用户重启 dev server 后实际测试故事板帧图生成 SenseNova 效果
## 2026-06-05 Session (续) — SenseNova API timeout 180s→300s
- **问题**: Batch 4-grid 生成时 shot 5 在 192.4s 超时。根因：`sensenova-image.ts:124` 的 `AbortSignal.timeout(180_000)` 不足以覆盖 4 张 panel（每张 ~45s）
- **修复**: 180s→300s（与 `api-fetch.ts` 的 300s 一致）
- **验证**: lint ✅ tsc ✅ build ✅

## 2026-06-05 Session (续) — 角色参考图历史三重优化
- **问题**: 每生成一帧分镜图都追加到该 shot **所有角色**的 `referenceImageHistory`，角色卡历史图杂乱
- **三重优化** (`frames.ts:33-51`):
  1. **按角色名匹配**: `appendFrameToCharacterHistory` 新增 `matchContext` 参数，只有角色名出现在帧描述文本中才追加（跳过无关角色）
  2. **只追首帧**: 移除 last frame 的追加（2处 call site），4grid 模式保持只追 panel[0]
  3. **历史上限 20**: 超过 20 张时自动删除最早的，防止无限增长
- **验证**: lint ✅ tsc ✅ build ✅ 619 tests ✅
- **实测验证** ✅: 通过 `agnes-image-2.0-flash` 用新 prompt 格式生成测试图，再经 `agnes-2.0-flash` vision 分析确认：`grid:false text:false type:scene` — 无格子边框、无文字、单张场景图。新格式有效。

## LoomVideo 记录 — 阿里全能视频生成+编辑模型 (2026-06)
- **论文**: [arxiv.org/pdf/2606.06042](https://arxiv.org/pdf/2606.06042)
- **开源**: [github.com/MSALab-PKU/LoomVideo](https://github.com/MSALab-PKU/LoomVideo)
- **架构**: 5B DiT + 8B Qwen3-VL（去掉 T5，用 Qwen 做多模态条件输入）
- **三大创新**:
  1. **Deepstack**: Qwen3-VL 每层特征一对一注入 DiT 对应层（而非只取最后一层）
  2. **Scale-and-Add**: 隐空间直接数学运算替代 Token 拼接，编辑提速 5.41×（核心）
  3. **Negative Temporal RoPE**: 参考图负编号、视频帧正编号，区分素材与生成内容
- **性能**: 480×832×97 帧，文生 132s / 编辑 166s（消费级 GPU 可行）
- **局限**: 上限 480p、偏向电商服饰、高动态镜头易畸变
- **接入评估**: RTX 4080 16GB 可跑，需写独立推理脚本或等 ComfyUI 节点

## Session 2026-06-06 — 全部 5 个 LTX 模板补齐 Singularity LoRA + NAGuidance，Windows ComfyUI OSError 修复
### ComfyUI Windows 控制台 OSError 修复
- **根因**: `ComfyUI/app/logger.py` LogInterceptor 硬编码 `encoding='utf-8'`，Windows 控制台实际为 GBK(cp936)。`tqdm` → `wandb` → `comfyui_manager/prestartup_script.py` → `app/logger.py:66` 整条链在 `TextIOWrapper.write()` 报 `OSError: [Errno 22] Invalid argument`
- **修复层 1** (`logger.py`): `encoding='utf-8'` → `encoding=stream.encoding` + `errors='replace'`
- **修复层 2** (`logger.py`): write/flush 包 `try/except OSError: pass`
- **修复层 3** (`main.py`): `setup_logger()` 前设 `WANDB_CONSOLE=off / WANDB_SILENT=true / WANDB_MODE=disabled`
- **启动验证**: ComfyUI (PID 5844, 端口 8188) 正常运行，零 OSError、零 UnicodeError

### `ltx-workflows.ts` 优化
- 对比实际工作流 `video_ltx2_3_i2v (1).json`，补齐 3 个缺失 LoRA（Singularity-LTX-2.3_OmniCine_V1 strength=1.0 / subtitles-remove strength=1.0 / restoration strength=1.0）→ 共 4 LoRA 堆叠（+ distilled strength=0.5），插入 NAGuidance 节点（nag_scale=5, nag_alpha=0.5, nag_tau=1.5），更新 camera control 接线，合并负向提示词

### 全部 5 个模板补齐 Singularity LoRA + NAGuidance
- **`ltx-i2v-pro.json`**: 新增 `320:326` Singularity + `320:329` NAGuidance，更新 2 个 CFGGuider 模型引用，合并负向提示词
- **`ltx-i2v-api.json`**: 新增 `320:326/327/328` 三 LoRA + `320:329` NAGuidance，更新 CFGGuider 模型引用
- **`ltx-i2v-4grid-baseline-simple.json`**: 新增 `377` Singularity（紧凑格式）
- **`ltx-i2v-4grid-baseline.json`**: 新增 `376` Singularity
- **`ltx-i2v-multiguide.json`**: 新增 `378` Singularity（5 LoRA 堆叠 + NAGuidance 最复杂模板）
- **链完整性**: 全部 5 个模板验证通过 ✅ — Singularity 均为 checkpoint 后第一 LoRA，NAGuidance 均为 CFGGuider 前最后节点

### Verification
- lint ✅ tsc ✅

## Session 2026-06-06 (续) — 管线端到端验证 + Camera LoRA 对齐官方命名
### Camera LoRA 命名与官方对齐
- 对照 `github.com/Lightricks/LTX-2` 官方仓库列出的 9 个 Camera LoRA（dolly-in/out/left/right, jib-up/down, static），与 `CAMERA_LORA_MAP` 完全一致 ✅
- 项目额外的 pan/tilt/zoom/roll/orbit LoRA 为社区扩展，未在官方仓库中但兼容同一架构

### Camera LoRA 接线修复
- `addCameraLoRANode` 在 `buildLTXi2vT2vWorkflow`（非 pro）和 `buildLTXProWorkflow`（模板 pro）中均正确插入于 distilled LoRA（`320:285`）之后、NAGuidance（`320:329`）之前
- Camera LoRA 激活时链：`Checkpoint → Singularity → SubtitleRemove → VideoRestore → Distilled → Camera → NAG → CFG`
- Camera LoRA 未激活时链：`Checkpoint → Singularity → SubtitleRemove → VideoRestore → Distilled → NAG → CFG`
- `addCameraLoRANode` 参数名 `cfgGuiderIds` → `downstreamNodeIds` 消除语义误导

### Model name 更新
- `models/list/route.ts`: `"LTX Video 2.3 图生视频 Pro (3LoRA双采样)"` → `"LTX Video 2.3 图生视频 Pro (4LoRA+NAG双采样)"`

### 端到端验证
- JSON 模板替换后解析 ✅（5/5 — ltx-i2v-pro/ltx-i2v-api/4grid-baseline/4grid-baseline-simple/multiguide）
- 节点引用完整性检查 ✅（全部模板零断链）
- ComfyUI 实战提交流程验证 ✅：`POST /prompt` 接受 ltx-i2v-pro 工作流（prompt_id=`e790a4fe-...`），返回 200 — 说明 ComfyUI 识别 NAGuidance/所有 LoRAs、连接有效、结构正确
- Dev server `http://localhost:3000` ✅，ComfyUI `http://127.0.0.1:8188` ✅
- lint ✅ tsc ✅
- **下一阶段**: 在浏览器中实际跑一次 `ltx-i2v-pro`（需要一张参考图 + shot 数据），或切换 `HiDream-O1` 测试单帧生成质量

## Session 2026-06-06 (续) — Mano-P 本地 VLA 集成 + Windows-MCP-Enhanced 端到端验证

### Mano-P 启动 & 验证
- 系统 Python（`C:\Users\zjwji\...\Python313\python.exe`，torch 2.6.0+cu124）启动 `app.py`，加载 `Qwen3VLForConditionalGeneration` from `I:\AIs\Mano-P\models\Mininglamp\Mano-P\fp16`
- 双 shard 加载 ~10s，VRAM ~9.9 GB，监听 `127.0.0.1:7861`
- 健康检查 `GET /api/manop/health` → `{"model_loaded":true,"status":"ok"}`
- `.venv-win` 中 `torch 2.12.0+cpu` 不可用（CUDA 不可用），确定系统 Python 为唯一可行路径

### Mano-P 推理性能优化
- 原始 1080p 全屏截图推理 ~25s（Qwen3VL 将大图分片为大量视觉 token）
- 添加运行时 resize（`max_image_width: 1280`）：解码 JPEG → `Image.LANCZOS` 等比缩放 → 重新编码 JPEG → 推理降至 **~1.7s**
- 配置项 `mano-p.parameters.max_image_width` 默认 1280，在 vla_client 的 `_call_api()` 中实现

### 系统提示词适配
- Mano-P 端点为纯用户消息（Flask server 使用 `apply_chat_template`，不含 system role），系统提示词在 vla_client 中前置到 task text
- 初始长格式提示词（含完整 action schema 描述）→ 模型以中文自然语言回复，非 JSON
- 迭代优化：极简提示词 `"Output ONLY valid JSON, nothing else. Example: {\"action_type\":\"FINISH\"}"` → 模型输出正确 `{"action_type":"FINISH"}`

### 端到端 Agent 测试
- `WindowsGUIAgent` + `mano-p` provider：截图 → resize 1280px → 含提示词的 task → `POST /api/manop/infer` → JSON 解析 → 动作执行
- **Test 1 (FINISH)**: 9.9s → 迭代后 **3.1s**，`{"action_type":"FINISH"}` 正确返回 ✅
- **Test 2 (MOVE)**: 初始返回 FINISH（跳过动作）→ 改进提示词（极简 JSON 示例 + 明确动作列表）后正确输出 `{"action_type":"MOVE","x":...,"y":...}` ✅（但坐标推断不准：高 DPI 降采样截图下模型像素级定位差）
- 16 单元测试全部通过 ✅

### 关键修复 — Prompt Engineering 迭代
| 版本 | 问题 | 修复 |
|------|------|------|
| 长格式提示词 + action schema | 模型输出中文自然语言而非 JSON | 极简 prompt + JSON 示例 |
| 仅 FINISH/FAIL 示例 | 模型对所有任务输出 FINISH | 增加 MOVE/CLICK/TYPE/PRESS 多动作示例 |
| `element_id` 未支持 | 模型自定义 `target: [x,y)` 格式 → JSON 解析失败 | 提示词标注 `element_id` 为坐标替代方案 |
| 元素上下文追加在 task 后 | 模型误认为要交互元素、忽略 FINISH | 改为 `=== 参考 ===` + `=== Task ===` 分离结构 |

### Hybrid 架构：Snapshot 元素树 + VLA 坐标注入
- 问题：Mano-P 降采样 1280px 后无法精确输出像素坐标（输出 `x:1000` 而非 `x:100`）
- 方案：agent 在截图时一并调用 `Desktop.get_state(use_ui_tree=True)`，提取 `interactive_nodes` 作为元素上下文
- 实现：
  - `_get_cached_screenshot()` 同步抓取 `tree_state.interactive_nodes`（一次调用，免额外遍历）
  - `_format_element_context()` → 格式化为 `id=N: "label" (control_type) [x,y]` 文本（~1700 chars）
  - 注入 VLA 提示词，声明 `use element_id for precise coordinates`
  - 模型输出 `{"action_type":"CLICK","element_id":3}` → `_resolve_element_id()` 从缓存元素树解析出实际坐标
- 效果：含元素上下文的 FINISH 测试 **4.9s**（无上下文 3.1s，~1.8s 开销来自 UI 树遍历）
- 单元测试覆盖：`test_resolve_element_id_from_cached_tree` ✅、`test_resolve_element_id_skipped_when_missing` ✅

### MOVE 停止条件改进
- 原代码仅匹配 `"only moves the mouse"` 精确子串 → 扩展为 `move_phrases = ('move the mouse', 'move cursor', 'move the cursor', 'only moves the mouse')`
- MOVE e2e 测试：迭代次数从 3→1（5.4s 完成）

### 已知局限
- Qwen3VL-4B 坐标推断不准：高 DPI 降采样截图下像素级定位能力差，`element_id` 方案可绕开此问题但需要模型学会使用 `element_id`
- 当前不做 use-case 时可保持 Mano-P 服务器运行（~9.9 GB VRAM）；需要时可重启

### Real-World Click via `element_id` ✅
- 测试：在真实桌面上通过 `element_id` 点击系统托盘 Realtek 音频图标
- **模型输出**: `{"action_type":"CLICK","element_id":2}` ✅（正确使用 element_id 而非猜测像素坐标）
- **坐标解析**: `_resolve_element_id()` 从缓存的 `_last_element_tree` 中查到 `id=2` → `[2470, 1416]` ✅
- **验证**: `validate_action()` 已更新为接受 `element_id` 作为 x/y 替代 ✅
- **停止条件**: `click_phrases` 匹配 "click on it" → 1 次迭代完成 ✅
- **延迟优化**:
  - 原始：42s（144 元素注入 → 模型处理大量无关上下文）
  - 优化：**5.2s**（-88%），过滤只保留 25 个相关控件（Button/Edit/Hyperlink 等常见类型、剔除空名/超长名元素）
  - 方法：`_format_element_context()` 增加 `relevant_types` 白名单 + 25 元素上限 + 名字长度 < 60
- **新增单元测试**: `test_should_stop_after_click_for_click_task` ✅（共 17 测）

### 关键改进
- `utils.py validate_action()`: `coord_actions` 中 `element_id` 可替代 `x`/`y`
- `gui_agent.py _resolve_element_id()`: 新增 task 文本回退解析 `element_id=N`（即使模型未输出 element_id 字段也能工作）
- `gui_agent.py _should_stop_after_action()`: 新增 `click_phrases` 点击停止条件
- 测试框架：mock `infer_action` 增加 `element_context=""` 参数兼容

### JSON 自修复（模型输出格式容错）
- Mano-P (Qwen3VL-4B) 生成 JSON 时有 token 错误（遗漏 key、多余括号/方括号）
- `_extract_json_block()`: 三阶段修复策略
  1. 通用清理：去掉数值后的 `)`, `]`, 重复 `}`
  2. 补 key：`"x":<n>,<m>` → `"x":<n>,"y":<m>`（遗漏 "y":）
  3. 最终兜底：截取首个完整 `{...}` 块
- `infer_action()`: JSON 解析失败时自动重试 1 次，追加错误提示到 task 文本
- 验证：多种格式错误均能修复
  - `{"x":158,931}` → `{"x":158,"y":931}` ✅
  - `{"y":492)}` → `{"y":492}` ✅
  - `{"x":500,499]}}` → `{"x":500,"y":499}` ✅

### AIComicBuilder 项目全面测试 ✅
- **Dev Server**: PID 38036, port 3000, 运行正常
- **API 端点** (4/5 通过):
  - ✅ `GET /api/projects` → 200 `[]`
  - ✅ `GET /api/prompt-templates` → 200 `[]`
  - ✅ `GET /api/prompt-presets` → 200
  - ✅ `GET /api/agents` → 200
  - ⚠️ `POST /api/models/list` → 502 (需正确请求体)
- **前端页面**:
  - ⚠️ `/` → 500 Internal Server Error
  - ❌ `/zh` → 404
  - ⚠️ `/en` → 500
  - ✅ API JSON 直接访问正常
- **DOM 提取** (`use_dom=True`):
  - ✅ 从 Chrome 提取 `dom_informative_nodes` (~10 条文本)
  - ✅ `dom_node` → `ScrollElementNode` (含 bbox/center)
  - ❌ Chrome `--remote-debugging-port=9222` 从 MCP session 无法启用
- **GUI Agent (Mano-P)**:
  - ✅ 单步点击 5.2s（element_id）
  - ❌ 多步推理不可靠（卡在同一动作循环）
  - ✅ 桌面导航成功（`Desktop.click/type` → Chrome 地址栏 → 页面跳转）

### 已知问题
- Qwen3VL-4B 输出 JSON 有 token 级错误（需修复层兜底）
- Chrome 远程调试端口不可用 → `use_dom` 只返回文本摘要（~10 条），无完整 DOM 树
- 多步推理超出 4B 模型能力，建议单步任务 + Python 编排
- API `/api/models/list` 需 POST body `{protocol, capability, baseUrl?, apiKey?}`

## Next Steps
- Fix Chrome remote debugging → enable full DOM tree → proper web UI testing
- Fix root page 500 SSR error (app frontend bug)
- Generate test project via API then test full storyboard flow
- For AIComicBuilder mainline: implement HiDream-O1 ComfyUI workflow, LTX Video 4-grid
- When ASXS quota resets: benchmark GPT-5.5 vs Mano-P on same GUI tasks
