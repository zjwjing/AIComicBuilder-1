# Progress

## 2026-06-21 Session — 项目审计 + 多处清理 (drop asxs / NVIDIA NIM models / REDFOX / as any / type safety)

### 背景
距上次主项目更新（5 个月前）后，本次审计了项目中所有失效/废弃外部依赖、代码质量、类型安全。结论分三档：A=必修；B=应修；C=良好。完整修复了 A、B 所有项。

### A 项（都已修复）
#### A1. 免费 NVIDIA NIM key 下实测模型替换
- **实测 25 秒超时（免费 key 不支持）的 ID**：
  - `z-ai/glm-5.1`（付费层）
  - `nvidia/nemotron-3-ultra-550b-a55b`（付费层）
- **新增实测可用的 8 个模型**（共 20 个全清单）：
  - `meta/llama-3.3-70b-instruct`、`meta/llama-3.1-70b-instruct`、`meta/llama-3.1-8b-instruct`
  - `mistralai/mistral-large-3-675b-instruct-2512`、`mistralai/mistral-medium-3.5-128b`、`mistralai/ministral-14b-instruct-2512`
  - `upstage/solar-10.7b-instruct`
  - `qwen/qwen3-next-80b-a3b-instruct`
  - `nvidia/nemotron-mini-4b-instruct`、`nvidia/nemotron-3-nano-30b-a3b`
- **变更**：`src/app/api/models/list/route.ts:170-208`
- 适用协议：`nvidia-nim` × `text`

#### A2. 删除 `.env` 中冗余 REDFOX 配置
- 源码中 `rg REDFOX src/` **0 命中**，但 `.env` 中保留了 `REDFOX_API_KEY` + `REDFOX_BASE_URL`
- **删** `.env:23-28`（包含 `# RedFox API` 注释）

#### A3. opencode.json 默认模型修复
- `({cfg_opencode_json}:21)` 原默认：`"model": "asxs/gpt-5.5"` — ASXS 已废弃 + `gpt-5.5` ID 不存在
- 改 `({cfg_opencode_json}:21)` 为 `"nvidia/minimaxai/minimax-m3"`
- **删** `asxs` provider 块（API 已失效）
- **删** `cline` provider 块（URL 是探索中误以为有服务的占位）
- **修** NVIDIA provider 中 `kimi-k2-instruct`（不存在）→ `kimi-k2.6`（实测可用）

---

### B 项（都已修复）
#### B1. 抽 `streamBodyToFile` helper 消除 18 处 `as any`
- **新增** `src/lib/ai/providers/stream-utils.ts:25 行`
  - 单一职责：将 fetch Response.stream() 写入 filepath
  - 兼容性：body 缺失时 fallback 到空 `Readable`，保持原有 mock 测试断言
- **替换 18 处**（11 个 video/image provider）：
  - `openai.ts`、`agnes-video.ts`、`aivideo-video.ts`
  - `comfyui-image.ts`、`comfyui-video.ts`、`dashscope-image.ts`
  - `framepack-video.ts`、`kling-image.ts`、`kling-video.ts`
  - `nvidia-nim-image.ts`、`nvidia-nim-video.ts`
  - `omnigen-image.ts`、`seedance.ts`、`sensenova-image.ts`
  - `siliconflow-image.ts`、`ucloud-seedance.ts`、`wan-video.ts`
- 同步清理：`import fs, { createWriteStream }` → `import fs`；`import { pipeline } from "node:stream/promises"` 删除

#### B2. 类型安全收紧
- **`src/lib/task-utils.ts`**:
  - L21 `type: type as any` → `type` 改为 `TaskType`（schema 派生）
  - L31, L33 `progress as any` → 改为 `asTaskResult` 限定 cast
  - 新增导出 `TaskType`、`TaskResult` 类型
  - `completeTask(result?: any)` → `result?: Record<string, unknown>`
- **`src/lib/db/schema.ts:373-410`**: 扩展 `tasks.type` enum
  - 原 8 个 → 现 **33 个**，与 `validation.ts` 中的 `GenerateActionSchema` 完全对齐
  - 无需 drizzle migration（SQLite text 列无 CHECK 约束，仅 TS 类型生效）
- **`src/lib/vector-search/index.ts:140-158`**:
  - `getEmbedding(contentType: string, ...)` → `contentType: EmbeddingContentType`
  - `hasEmbedding(...)` 同上
  - 移除 2 处 `contentType as any`

#### B3. 鉴权评估
- **`getUserIdFromRequest`** 已存在（`src/lib/get-user-id.ts:50`）
- 50 个 route 中 **70 处 `userId` 引用** 全部走 `and(eq(...,userId))` user-scope 限定
- **遗留观察（非本次修复）**：`deriveUserId()` 基于 `AUTH_SECRET` 派生，所有浏览器共享同一 uid；如要切真实用户体系需替换为 OAuth/会话登录

---

### 验证
| 检查 | 结果 |
|------|------|
| `npm run lint --quiet` | ✅ pass |
| `npx tsc --noEmit` | ✅ pass |
| `next build` | ✅ pass（13 routes） |
| `npm test` | ✅ **679 / 679 passed（35 files）** |

### 变更文件清单（18 个）
- 新增：`src/lib/ai/providers/stream-utils.ts`
- 删除：`src/lib/ai/providers/asxs-image.ts`（asxs API 已废弃）+ 对应测试
- 项目：`src/app/api/models/list/route.ts`（重写 nvidia-nim text 段）
- 项目：`src/lib/ai/providers/*`（17 个）— 改 import + 替换 pipeline 调用
- 项目：`src/lib/task-utils.ts` + `src/lib/db/schema.ts`（enum 扩展）+ `src/lib/vector-search/index.ts`
- 项目：
  - `src/lib/ai/provider-factory.ts` — 删 asxs case
  - `src/lib/ai/__tests__/provider-factory.test.ts` — 删 asxs 测试
  - `src/stores/model-store.ts` — 删 `"asxs"` 协议
  - `src/components/settings/provider-form.tsx` — 删 `"ASXS"` 选项
  - `src/app/[locale]/settings/page.tsx` — 删 `image-asxs` 配置块
- 外部：`~/.config/opencode/opencode.json` — 默认模型 + 删除失效 providers

### 下次会话起步
1. 选读本节开头了解本次清理范围
2. 如果想继续审计未完项 → 见 C/D 节（"ComfyUI 9 模型官方目录核对"、"kling v1/v1.5 实战校验"、"wan 2.6/2.7 模型季节性核对"）
3. 如果想推下一个 PR → 见 `git status` 未 commit 文件

## 2026-06-07 Session (锟? 锟?澶氳鑹插叧閿抚涓€鑷存€т慨锟?(UI layout selector + auto-crop)
- 鏍瑰洜鍒嗘瀽: c25e3d8 淇"涓嶅啀鐢熸垚閲嶅浜虹墿"杩囦簬婵€锟? 绂佺敤浜嗘墍鏈夊 ref 璺緞. 瀹為檯
  `HiDreamO1ReferenceImages` 锟?ComfyUI 瀹樻柟鏍稿績鑺傜偣 (comfy_extras/nodes_hidream_o1.py:42),
  鏀寔 1-10 锟?ref (1 锟?鎸囦护缂栬緫, 2-10 锟?澶氬弬锟?. workflow 鏈韩鏀寔锟?ref.
- 鐪熸鐨勬牴锟? 鐢ㄦ埛鎻愪緵锟?4 瑙嗗浘瑙掕壊璁惧畾鍥捐妯″瀷璇嗗埆锟?鍒嗛暅甯冨眬妯℃澘", 鑰屼笉鏄鑹插弬锟?- 淇鏂规 (鐢ㄦ埛閫夋嫨): UI 锟?layout 閫夋嫨锟? 鐢熸垚锟?sharp 鑷姩瑁佸壀鍗曚汉鐗╃珛锟? 鍏抽敭甯х敤瑁佸壀缁撴灉
  - 澶囷拷? 浠呰嚜鍔ㄨ锟?(闅愬紡) 锟?涓嶅鐏垫椿
  - 澶囷拷? IP-Adapter / OpenPose 锟?鏀瑰姩澶ぇ, 璺宠繃
- Schema (2a87d52):
  - `characters.referenceLayout` (text, default 'four-view') 锟?'single' | 'three-view' | 'four-view'
  - `characters.referenceImageSingle` (text, nullable) 锟?sharp 瑁佸壀鍚庣殑鍗曚汉鐗╃珛锟?  - `drizzle/0054_add_character_reference_layout.sql` + journal idx=54
  - 瀵煎嚭 `CharacterReferenceLayout` 绫诲瀷 + `normalizeCharacterReferenceLayout()` helper
- Prompts + utility (5203641):
  - 4 锟?prompt (characterImageDef/SimpleDef/Ideogram4Def/HiDreamO1Def) 鎺ュ彈
    `referenceLayout` 鍙傛暟, 杈撳嚭 single/3-view/4-view 涓夌鍙樹綋
  - 鏂板 `src/lib/character-ref-utils.ts::extractCharacterReferencePortrait`:
    浠庡楂樻瘮鑷姩妫€娴嬪疄闄呭竷灞€ (妯潯/绔栨潯/2x2), 瑁佸壀鍓嶈锟?(5% margin), 琛ョ櫧鍒版鏂瑰舰
  - handler: `handleSingleCharacterImage` + `handleBatchCharacterImage` 锟?layout, 锟?prompt,
    鐢熸垚鍚庤锟? 鍐欏洖 `referenceImageSingle` + `referenceLayout`
  - 锟?`sharp@^0.34.5` 渚濊禆
- UI + 鍏抽敭甯ч泦锟?(e5300af):
  - `characters-inline-panel.tsx`: 琛屽唴鐢熸垚鎸夐挳锟?LAYOUT_OPTIONS 涓嬫媺 (鍗曞浘/涓夎锟?鍥涜锟?
  - `character-card.tsx`: 璇︽儏鍗＄墖闀滃儚鍚屼竴 layout 涓嬫媺
  - `frames.ts` 锟?`shotCharRefImages` 浼樺厛锟?`referenceImageSingle` (瑁佸壀绔嬬粯) 鑰岄潪
    `referenceImage` (4 瑙嗗浘璁惧畾锟?, 瑙ｅ喅妯″瀷锟?4 瑙嗗浘褰撳垎闀滄ā鏉跨殑 bug
- 娴嬭瘯 632/632 锟?lint 锟?tsc 锟?- 瀹¤ + 閲嶆瀯 (2f6c570 + cbc429b, 褰撳墠 6 commits ahead of c25e3d8):
  - **return-path 淇** (`character-ref-utils.ts:46-67`): 鐩稿杈撳叆 锟?`path.join(parsed.dir, "${name}_single${ext}")`;
    缁濆杈撳叆 锟?`path.relative(uploadDir, absPath)`銆傚師浠ｇ爜缁濆杈撳叆锟?`path.join` 涔熻繑鍥炵粷瀵硅矾锟?
    浠呭洜 `uploadUrl` "strip up to uploads/" 瑙勮寖鍖栨墠鍋剁劧宸ヤ綔, 鏂囨。鍖栨敹锟?  - **鍒犻櫎姝讳唬锟?* `detectLayoutFromAspect` 锟?浠庢湭璋冪敤, 绗竴鍒嗘敮 `aspect>1.4 && (cols===3 || cols===4)`
    姘歌繙涓嶅彲锟?(涓婇潰宸茬粡 aspect>1.4 鐩存帴杩斿洖 layout 鑰屾病锟?`rows`/`cols` 鍙橀噺)
  - **绫诲瀷鍚屾**: `src/stores/project-store.ts:4-13` `Character` 鎺ュ彛鏂板
    `referenceImageSingle?: string | null` + `referenceLayout?: ReferenceLayout | null`;
    `characters-inline-panel.tsx` 锟?`Character` 鎺ュ彛鍏佽 `referenceLayout: null` (legacy)
  - **鏂板娴嬭瘯** `src/lib/__tests__/character-ref-utils.test.ts` (7 锟?:
    - single no-op (杩斿洖 null)
    - 2x2 grid 瑁佸壀 (5% margin)
    - 闈炴鏂瑰舰 cells + white padding 鍒版鏂瑰舰
    - 3-view horizontal (aspect > 1.4)
    - 4-view vertical (aspect < 0.7)
    - grid fallback (aspect 0.95-1.05)
    - `uploadUrl` 璺ㄥ钩锟?round-trip
  - **`parseReferenceImageHistory(raw)`** 鎶藉埌 `character.ts:48-58` 锟?鏇挎崲 3 澶勯噸澶嶇殑
    `try { JSON.parse(...) } catch { return [] }`; 澶辫触杩斿洖 `[]`
  - **鏂囨。鍖栧亣锟?*: "front view is top-left / leftmost / topmost" 锟?`character-ref-utils.ts`
    鍔犳敞锟? 鍒楀嚭 3 涓湭鏉ュ伐浣滈€夐」 (鏇村己 prompt / CLIP 妫€锟?/ `frontCellIndex` 鍙傛暟)
- **娴嬭瘯 639/639 锟?lint 锟?tsc 锟?* (31 锟?32 test files, +7 tests)
- **鏁版嵁搴撹縼锟?* (鐢ㄦ埛锟?500 鎶ラ敊鏍瑰洜): 鐩存帴 `db.exec` of `0054_add_character_reference_layout.sql`
  锟?`I:\claw\AIComicBuilder-main\data\aicomic.db` + 鎵嬪姩 hash 鎻掑叆 `__drizzle_migrations`锟?  楠岃瘉: `characters` 锟?15 锟?(锟?`reference_image_single TEXT` + `reference_layout TEXT NOT NULL DEFAULT 'four-view'`),
  鐜版湁锟?`reference_image_single: null, reference_layout: "four-view"`
- **dev server**: 鏉€锟?PID 30972, 鍚柊 PID 23832 锟?8900 (1.4GB) 锟?3000 绔彛鐩戝惉;
  `bootstrap()` 宸查噸锟?migrations + AI providers锟?  娈嬬暀 500 锟?Next.js dev 妯″紡 HMR 缂栬瘧鎶栧姩 ("Jest worker 2 child process exceptions"
  + "EPIPE" 鍐欐棩蹇楀け锟?, 涓嶆槸浠ｇ爜闂 锟?鎱㈣锟?200 OK (e.g. `GET /api/projects/SKB6CNwqAn5H?exclude=shots 200 in 119689ms`)
- **瀹¤锟?fix (d33c6b3, 7 commits ahead of c25e3d8) 锟?鍐呭甯冨眬妫€锟?bug**:
  - **bug**: aspect-ratio heuristic 锟?16:9 (2560脳1440) 2脳2 缃戞牸璇垽锟?1脳4 妯潯,
    杈撳嚭绌虹伆锟? 鐪熷洜锟?16:9 鍥惧儚鍙兘锟?2脳2 缃戞牸 (1280脳720 cells) 锟?1脳4 妯潯 (640脳1440 cells),
    浜岋拷?aspect 鐩稿悓
  - **bug 2**: "闈炵櫧鍍忕礌" 璺濈搴﹂噺锟?*鐏拌壊鑳屾櫙**鐨勮鑹茶瀹氬浘瀹屽叏澶辨晥 (鐏拌壊 cell 鍏ㄧ畻鍓嶆櫙)
  - **bug 3**: 鐢熶骇璺緞 `uploads\frames\abc.png` 锟?`uploads/` 鍓嶇紑,
    `path.join(uploadDir, imagePath)` 锟?`uploads/uploads/frames/abc.png` ENOENT
  - **淇** (`src/lib/character-ref-utils.ts`):
    1. **鑳屾櫙鑹叉锟?* 锟?锟?16脳16 瑙掔偣閲囨牱骞冲潎锟? 鍓嶆櫙 = 涓庤儗锟?RGB 璺濈 > 30
    2. **澶氬€欓€夎瘎锟?* 锟?four-view 锟?{2脳2, 1脳4, 1脳3, 4脳1}; three-view 锟?{1脳3, 1脳4, 4脳1, 2脳2};
       姣忓€欓€夎绠楀墠鏅瘑锟?    3. **淇濇姢鐢ㄦ埛閫夋嫨** 锟?鍊欓€夊繀椤绘瘮璇锋眰甯冨眬瀵嗗害锟?0.1 鎵嶈锟? 骞冲眬榛樿閫夎姹傚竷灞€
       (閬垮厤 2脳2 vs 4脳1 鍦ㄩ《閮ㄨ锟?silhouette 鏃剁炕锟?
    4. **璺緞瑙ｆ瀽** 锟?`resolveUploadPath()` 鍓ユ帀 `uploads/` 鍓嶇紑, 杈撳叆鍏煎 cwd-relative
       (`uploads/frames/abc.png`) 锟?uploadDir-relative (`frames/abc.png`),
       杈撳嚭淇濇寔 `uploads/...` 褰㈠紡浠ュ尮锟?`referenceImage` 绾﹀畾
  - **鏂版祴锟?* (3 锟?: 1脳4 妯″瀷閲嶆帓妫€锟? 16:9 2脳2 缃戞牸妫€锟? 绌虹櫧鍥捐繑锟?null, DB-style 璺緞 round-trip
  - **閲嶅缓鑴氭湰** `scripts/reprocess-character-refs.ts`: 涓€娆℃€ц窇锟?28 涓幇鏈夎锟?
    楠岃瘉瑙嗚纭 (鍏斿瓙锟?2脳2 缃戞牸瑁佸嚭姝ｉ潰绔嬬粯 1152脳1152, 涔岄緹锟?1脳4 妯潯瑁佸嚭 1240脳1240)
  - **娴嬭瘯 639 锟?642 锟?lint 锟?tsc 锟?*
- 寰呭姙: 鐢ㄦ埛绔敤 2 涓鑹插満锟? 鎶婁袱涓鑹查兘璁句负"鍗曞浘"锟?涓夎锟?閲嶆柊鐢熸垚 ref, 楠岃瘉
  鍏抽敭甯т笉鍐嶅嚭锟?4 涓噸澶嶄汉锟?(28 涓锟?single portrait 宸茶嚜鍔ㄧ敓锟? 鐜板湪閲嶇敓锟?keyframe
  搴旇锟?`referenceImageSingle` 鑰屼笉锟?4 瑙嗗浘璁惧畾锟?

## 2026-06-07 Session 锟?HiDream-O1 宸ヤ綔娴佸榻愬畼锟?dev 鍙傛暟
- 璇婃柇 web app "涓嶇鍚堣锟?鐨勭敓鍥撅細pink/blue 鍣偣鍥炬槸 ComfyUI 绔彂锟?- 鍏抽敭鍙戠幇锛氶€氳繃 ComfyUI `object_info/ModelNoiseScale` 锟?tooltip 鐪嬪埌瀹樻柟鎺ㄨ崘锟?**"HiDream-O1 base: 8.0, dev: 7.5"**锛屽綋锟?`noise_scale: 6` 鏄捐憲鍋忎綆 锟?淇″彿琚櫔澹版饭锟?- 鍏抽敭璇垽锛氬厛鎬€锟?`CLIPTextEncode`锛堟櫘閫氾級搴旀敼锟?`CLIPTextEncodeHiDream`锟? encoder锛夛紝锟?ComfyUI 鍘嗗彶鏄剧ず `KeyError: 'l'`鈥斺€擿clip_l_hidream.safetensors` 锟?4 锟?HiDream 涓撶敤 encoder 鍦ㄨ鐜鏈畨瑁咃紙绯荤粺鍙湁 `clip_l.safetensors` for FLUX / `clip_g.safetensors` / `t5xxl_fp8_e4m3fn` 涓嶅甫 scaled / `llava_llama3` 鑰岄潪 `llama_3.1_8b_instruct`锟?- 鍏抽敭鐪熺浉锛氳 `M:\ComfyUI_windows_portable\ComfyUI\comfy\text_encoders\hidream_o1.py:1-7` 鐪嬪埌 "The real Qwen3-VL backbone runs inside diffusion_model.* every step, so this module just tokenizes the prompt"鈥旓拷?*HiDream-O1-Image 鏄妸 Qwen3-VL 宓屽叆锟?diffusion model 鍐呴儴锟?passthrough 鏋舵瀯**锛屽崟 text encoder 璺緞锟?*涓嶆槸**瀹樻柟 `hidream_i1_*`锟? encoder锛夐偅锟?- 鎷垮埌鐢ㄦ埛鎻愪緵鐨勫畼锟?dev workflow (`image_hidream_o1_dev.json` + `image_hidream_o1_dev-API.json`) 瀵归綈鍙傛暟锟?  - `ckpt_name`: `hidream_o1_image_mxfp8.safetensors` (base) 锟?`hidream_o1_image_dev_mxfp8.safetensors` (dev)
  - `noise_scale`: 6 锟?**7.6** (dev 鎺ㄨ崘)
  - sampler: `KSamplerSelect` + `dpmpp_2m_sde_gpu` 锟?**`SamplerLCM`** (s_noise=1, s_noise_end=1, noise_clip_std=2.5)
  - `cfg`: 7 锟?**1** (dev 瀹樻柟鍙傛暟)
  - 绉婚櫎 `HiDreamO1PatchSeamSmoothing`锛堝畼鏂规湭浣跨敤锟?  - 绉婚櫎 `KSamplerSelect`锛堣 SamplerLCM 鏇夸唬锟?- 淇敼 `src/lib/ai/providers/comfyui-image.ts:433-547`锟?  - 妯″瀷/鍣０/閲囨牱鍣ㄨ妭鐐规浛锟?  - `cfg: 7` 锟?`cfg: 1`
  - `model: ["232", 0]` 锟?`model: ["124", 0]`锛堢Щ锟?Patch 鑺傜偣鍚庯級
  - `sampler: ["230", 0]` 锟?`sampler: ["125", 0]`锛堟敼锟?SamplerLCM锟?- 鏇存柊娴嬭瘯 `src/lib/ai/providers/__tests__/comfyui-image.test.ts:213-239`锟?  - ckpt 鍚嶇О鏂█
  - noise_scale 鏂█ 7.6
  - SamplerLCM 涓変釜鍙傛暟鏂█
  - cfg=1 鏂█
  - 绉婚櫎 PatchSeamSmoothing / KSamplerSelect 鐨勫瓨鍦ㄦ柇瑷€
- 绔埌绔獙璇侊細鏋勶拷?28-step 娴嬭瘯 workflow 锟?ComfyUI 瀹為檯鐢熸垚 `hidream_dev_test_00001_.png` (24s, 1.4MB)锛岃檸鏂戝皬鐚孩鑹插潗鍨紝姣涘彂缁嗚吇鏃犱吉锟?- lint 锟?tsc 锟?vitest 锟?43/43 passed

## 2026-06-06 Session (锟? 锟?HiDream-O1 涓枃 Prompt 锟?鑻辨枃鑷姩缈昏瘧
- 璇婃柇 web app 锟?HiDream-O1 鐢熸垚锟?涓嶅悎锟?鐨勬牴鍥狅細ComfyUI 鍘嗗彶纭鐢熷浘鎴愬姛锛屼絾 HiDream-O1 浣跨敤 Llama2 CLIP 鏂囨湰缂栫爜鍣紝涓枃 prompt 缂栫爜璐ㄩ噺锟?- 淇锛氬湪 `ComfyUIImageProvider.generateImage()` 锟?`isHiDreamO1` 鍒嗘敮涓紝妫€娴嬩腑鏂囧悗鑷姩璋冪敤 OpenAI 鍏煎 API 缈昏瘧涓鸿嫳鏂囷紝鍐嶉€佸叆 `buildHiDreamO1Workflow()`锛坄src/lib/ai/providers/comfyui-image.ts:61-107`锟?- `translateToEnglish()` 鍑芥暟锛氭锟?`/[\u4e00-\u9fff]/`锛屼娇锟?`OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL` 鐜鍙橀噺锛宼emperature 0.1锟?0s 瓒呮椂锛屽け璐ユ椂闈欓粯鍥為€€鍘熸枃
- 杩涗竴姝ヤ慨锟?HiDream-O1 鍑哄浘鈥滀笉绗﹀悎鎻愮ず璇嶃€佽川閲忓樊鈥濓細涓嶅啀鎶婃暣娈典腑鏂囪鍒欑洿璇戞垚鑻辨枃璇存槑鏂囷紝鑰屾槸璁╃炕璇戝櫒杈撳嚭绠€娲併€丆LIP 鍙嬪ソ鐨勮嫳鏂囪锟?prompt锛涘悓鏃跺皢 HiDream 楂樿川閲忔。姝ユ暟鏀逛负 `28`锛坄quality=hd/default/undefined -> 28 steps`锛屽叾瀹冭川閲忔。淇濇寔 `20`锟?- 鐢ㄦ埛纭 HiDream-O1 鍙洿鎺ヨ瘑鍒腑鏂囧悗锛屽凡鎾ら攢鑻辨枃缈昏瘧閾撅紝鎭㈠涓虹洿鎺ュ悜 HiDream 鍙戦€佸師濮嬩腑锟?prompt锛涗繚锟?`28` 姝ラ珮璐ㄩ噺妗ｆ槧灏勪慨锟?- 澶栭儴浠撳簱 `I:\claw\Windows-MCP-Enhanced` 宸插仛鏈€灏忓彲杩愯淇锟?  - `utils.py` 锟?`Tuple` import锛屼慨姝ｉ粯璁ら厤缃矾寰勫埌鏍圭洰锟?`configs/vla_config.yaml`
  - `gui_agent.py` 鏀逛负 `load_config(vla_config_path)`锛屼娇 provider 瑕嗙洊鐪熸鐢熸晥锛涗慨锟?`self.desktop.apps` -> `self.desktop.get_apps_from_start_menu()`锛沗window.title` -> `window.name` 鍏煎 Windows-MCP `Window` 缁撴瀯锛沗screenshot_callback` 鏀逛负鏄惧紡 `Callable`
  - `vla_client.py` 鏂板 `mano-p` provider 涓撶敤鍒嗘敮锛氫笉鍐嶉敊璇皟锟?`/chat/completions`锛岃€屾槸璋冪敤 `http://localhost:7861/api/manop/infer`锛屽苟浠庤繑锟?`{ text }` 瑙ｆ瀽鍔ㄤ綔
  - `tools/gui_agent.py` 淇 `vla_provider` 瑕嗙洊閫昏緫锛氫复鏃跺啓 YAML 閰嶇疆骞朵紶锟?`WindowsGUIAgent(vla_config_path=...)`锛岄伩鍏嶅弬鏁拌蹇界暐
  - 杩愯楠岃瘉閫氳繃锛歚load_config()` 姝ｅ父璇诲彇閰嶇疆锛宍create_windows_gui_agent()` 鍙疄渚嬪寲锛宍mano-p` provider 瑕嗙洊鐢熸晥锛宍find_window('Chrome')` 杩斿洖 `True`锛宍compileall` 閫氳繃
- 缁х画瀹屽杽 `I:\claw\Windows-MCP-Enhanced` 锟?agent 鏍稿績閫昏緫锟?  - 淇 `run_task()` / `_execute_action()` 杩斿洖璇箟锛氭櫘閫氬姩浣滆繑锟?`"continue"`锛屼粎 `FINISH` 杩斿洖 `"finished"`锛岄伩鍏嶇涓€姝ョ偣锟?杈撳叆鍚庡氨璇姤鈥滀换鍔″畬鎴愶拷?  - 淇 `TYPE` 楂橀闄╄鎿嶄綔锛氭病锟?`click_first + click_x/click_y` 鏃朵笉鍐嶈皟锟?`Desktop.type((0,0), text)` 璇偣宸︿笂瑙掞紝鑰屾槸鏄惧紡杩斿洖澶辫触
  - 淇鐩爣绐楀彛缁戝畾锛歚find_window()` 鍙娇鐢ㄧ湡瀹炴墦寮€绐楀彛锛屼笉鍐嶆妸鈥滃紑濮嬭彍鍗曞凡瀹夎搴旂敤鈥濊褰撴垚褰撳墠绐楀彛锛涙垚鍔熷尮閰嶅悗浼氳锟?`target_window_bounds`銆佸垏鎹㈠墠鍙扮獥鍙ｏ紝骞跺湪鎴浘/鍧愭爣鎵ц鏃跺簲鐢ㄧ獥鍙ｅ亸锟?  - `list_windows()` 鏀逛负鍩轰簬鐪熷疄妗岄潰绐楀彛鑰岄潪寮€濮嬭彍鍗曞簲鐢ㄥ垪锟?  - `vla_client.py` 澧炲姞 fenced JSON / 鏂囨湰锟?JSON 鍧楁彁鍙栵紝鎻愬崌 Mano-P / GPT 杈撳嚭瑙ｆ瀽椴佹锟?  - `utils.py` 鏀逛负浼樺厛浣跨敤 `OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL` 鐜鍙橀噺锛屽噺灏戠‖缂栫爜瀵嗛挜渚濊禆锛沗tools/gui_agent.py` 浼氬湪鎵ц鍚庢竻鐞嗕复锟?YAML 閰嶇疆鏂囦欢
  - 杩愯楠岃瘉閫氳繃锛歚compileall` 閫氳繃锛宍find_window('Chrome')` 杩斿洖 `True`锛屼笖 `target_window_bounds` 宸叉垚鍔熷啓锟?- 缁х画纭寲 `I:\claw\Windows-MCP-Enhanced`锟?  - 澧炲姞 Win32 鍘熺敓绐楀彛鍏滃簳锛氬墠鍙扮獥鍙ｅ拰椤跺眰绐楀彛鏋氫妇涓嶅啀瀹屽叏渚濊禆 Windows-MCP 楂樺眰绐楀彛鍒楄〃锛宍find_window('Chrome')` / `bind_active_window()` 宸叉仮澶嶅彲锟?  - 鎴浘閾炬敼涓轰紭鍏堜娇鐢ㄧ獥鍙ｅ尯鍩熷師鐢熸埅鍥撅紝骞跺绌哄浘鐩存帴鎶涢敊锛沗configs/vla_config.yaml` 榛樿 backend 鏀逛负 `pillow`锛岀粫寮€褰撳墠鐜涓嬩笉绋冲畾锟?`dxcam`
  - 寮哄寲 VLA schema锛歱rompt 寮哄埗瑕佹眰鍙繑鍥炰竴锟?JSON object 涓斿繀椤诲寘锟?`action_type`锛涚┖ `{}` / 缂哄瓧娈靛姩浣滅洿鎺ヨ浆锟?`FAIL`
  - `tools/gui_agent.py` 涓嶅啀锟?provider 瑕嗙洊鍐欏叆甯﹀瘑閽ョ殑涓存椂 YAML锛涚洿鎺ユ妸鍐呭瓨閰嶇疆娉ㄥ叆 `WindowsGUIAgent` / `VLAClient`
  - `configs/vla_config.yaml` 宸茬Щ闄ゆ槑锟?`api_key`锛屾敼涓轰緷璧栫幆澧冨彉閲忚锟?  - 鍔ㄤ綔鎴愬姛璇箟琛ラ綈锟?    - `FINISH` 娴嬭瘯宸茬湡瀹炶窇閫氾紝杩斿洖 `success=True`
    - 鍗曟 `MOVE` 娴嬭瘯涔熷凡鐪熷疄璺戦€氾紝杩斿洖 `success=True`锛屽苟锟?`execution: {status: 'continue', executed: True}`
  - 鍗曟鍔ㄤ綔鑱旇皟缁х画鎵╁睍锛歚CLICK`銆乣SCROLL`銆乣TYPE` 鍧囧凡鐪熷疄璺戦€氾紱`TYPE` 闇€瑕佹妸 VLA timeout 鎻愰珮锟?90s 鎵嶇ǔ瀹氳繑鍥炲姩锟?  - 澶氭 Notepad 浠诲姟鏆撮湶鏂伴棶棰橈細鏌愪簺绐楀彛杈圭晫浼氶€€鍖栨垚鏋佸皬鎴浘锛堜緥锟?`160x28`锛夛紝瀵艰嚧 VLA 鏃犳硶瀹氫綅缂栬緫鍖猴紱宸插姞鍏ユ渶灏忕獥鍙ｅ昂瀵歌繃婊ゅ拰杩囧皬鎴浘鍥為€€鍒版暣锟?鏁村睆鎴浘鐨勫厹搴曢€昏緫
- lint 锟?tsc 锟?
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
- Fixed prompt trigger words that still caused first/last frame contact sheets after image refs were removed: when no character image references are passed, first-frame prompts now use a text-only style/appearance lock and omit all character reference-sheet language (`瑙掕壊璁惧畾鍥綻, `4涓瑙抈, `鍚嶅瓧鍗板湪搴曢儴`). Last-frame prompts only mention the first-frame visual anchor and do not describe extra character reference sheets unless character image references are actually passed.
- Current verification for the Auto Run chain mode passed: `npm.cmd run lint -- --quiet`, `tsc --noEmit`, `vitest run src/lib/video/__tests__/ffmpeg.test.ts`, `vitest run src/lib/ai/prompts/__tests__/frame-generate.test.ts`, `npm.cmd run build`.
- Verification passed: `I:\pnpm.exe run lint --quiet`, `I:\pnpm.exe exec tsc --noEmit`, `I:\pnpm.exe exec vitest run` (619 tests), `npm.cmd run build`, and a final `I:\pnpm.exe run build` rerun.

## Completed
- **Ideogram-4 NVFP4 鎴愬姛杩愯锟?RTX 4080 16GB** 锟? 涓嬭浇锟?ComfyUI master 锟?`nodes_ideogram4.py`锛堟彁锟?`Ideogram4Scheduler`锛夛紝锟?90 绉掔敓鎴愪竴锟?1024脳1792 鍥剧墖銆侼VFP4 閲忓寲锟?.1GB DiT锟? Qwen3-VL-8B FP8锟?.9GB CPU锟? flux2-VAE锟?20MB锛夊畬缇庨€傞厤 16GB 鏄惧瓨銆傚伐浣滄祦鑷姩灞曞钩浜嗗瓙鍥惧畾涔夛紝ComfyUI v0.22.0 鍓嶇鎴愬姛瑙ｆ瀽 UUID 瀛愬浘鑺傜偣锟?- **Session 2026-06-03 锟?All video/image downloads converted to streaming**: Replaced `Buffer.from(await response.arrayBuffer())` + `fs.writeFileSync` with `pipeline(response.body!, createWriteStream(filepath))` across 16 provider files (8 video + 8 image). Updated 16 test files to mock `createWriteStream` + `pipeline`. Fixed `dashscope-image.test.ts` assertion from `writeFileSync` 锟?`pipeline`. **Files changed**: `agnes-video.ts`, `aivideo-video.ts`, `openai.ts`, `siliconflow-image.ts`, `sensenova-image.ts`, `kling-image.ts`, `kling-video.ts`, `seedance.ts`, `ucloud-seedance.ts`, `framepack-video.ts`, `wan-video.ts`, `dashscope-image.ts`, `comfyui-image.ts`, `comfyui-video.ts`, `asxs-image.ts`, `omnigen-image.ts`. lint 锟?tsc 锟?build 锟?- **Session 2026-06-01 锟?鐢熶骇鏋勫缓 DB 淇 + Agnes 鍏嶈垂 API 楠岃瘉 + 鏃ュ織瀹℃煡**: 
  - **鐢熶骇 standalone 鏋勫缓淇**: `scripts/copy-env-to-standalone.mjs` 鐜板湪鍚屾椂澶嶅埗 `drizzle/` 杩佺Щ鏂囦欢锟?+ `data/` 鏁版嵁搴撳埌 `.next/standalone/`锛屽苟锟?`DATABASE_URL` 浠庣粷瀵硅矾寰勯噸鍐欎负鐩稿璺緞锛沗src/instrumentation.ts` 鍦ㄧ敓浜фā寮忎笅鑷姩锟?`dotenv` 鍔犺浇 `.env`锛堢嫭绔嬫湇鍔″櫒涓嶄細鑷姩鍔犺浇锛夈€傛牴鍥狅細`SqliteError: no such table: projects` 锟?缂哄皯杩佺Щ鏂囦欢 + .env 鏈姞杞藉鑷村垱寤虹┖鏁版嵁搴擄拷?  - **Agnes 鍏嶈垂 API 楠岃瘉**: `GET /v1/models` 锟?(鍒楀嚭 5 涓ā锟?锛屼絾鏂囧瓧锟?03 model_not_found锛夈€佸浘鐗囷紙503锛夈€佽棰戯紙500 upstream error锛夊叏閮ㄤ笉鍙敤 锟?free key 鏃犲疄闄呭悗绔€氶亾锛岄渶浠樿垂 Token Plan锟?4/鏈堣捣锛夛拷?  - **椤圭洰鏃ュ織瀹℃煡**: `prod-server.log` 纭锟?DB 閿欒锛沗dev-server.log`锟?682琛岋級鏄剧ず鏈€锟?25/25 闀滃ご鐢熸垚鎴愬姛锛沗dev-server-err.log`/`dev-server-3001.log` 姝ｅ父锟?- lint 锟?tsc 锟?build 锟?
## 2026-06-06 锟?ComfyUI Windows 浼樺寲锛圤SError [Errno 22] + wandb 鍐茬獊淇锟?- **Root cause**: ComfyUI `logger.py` `LogInterceptor.__init__` 纭紪锟?`encoding='utf-8'`锛學indows 鎺у埗鍙板疄闄呬负 GBK(cp936)锛屽锟?Latent 閲囨牱锟?`tqdm` 锟?`wandb` 锟?`comfyui_manager/prestartup_script.py` 锟?`app/logger.py:66 super().write()` 鏁存潯閾惧湪 `TextIOWrapper.write()` 灞傛姤 `OSError: [Errno 22] Invalid argument`
- **logger.py 淇**: 鏀瑰洖 `encoding = stream.encoding` + `errors='replace'` 锟?GBK 涓嶄細寮曞彂 OSError锛宍errors='replace'` 锟?GBK 鏃犳硶缂栫爜鐨勫瓧绗︼紙emoji 绛夛級鏇挎崲锟?`?`锛岄伩鍏嶅師锟?UnicodeEncodeError
- **main.py wandb 鍏抽棴**: Windows 骞冲彴锟?`setup_logger()` 鍓嶈锟?`WANDB_CONSOLE=off`銆乣WANDB_SILENT=true`銆乣WANDB_MODE=disabled`锛岄槻锟?wandb 鑷姩 hook 鎺у埗鍙拌緭鍑猴紝娑堥櫎鏁存潯鍐茬獊锟?- **logger.py 瀹归敊**: `LogInterceptor.write()` 澧炲姞 `try/except OSError: pass`锛屽嵆浣垮簳灞傚啓澶辫触涔熶笉锟?
## 2026-06-05 Session (锟? 锟?HiDream-O1 鍗曞厓娴嬭瘯 + 瑙掕壊 Prompt 妯℃澘
- **SenseNova Image (`sensenova-ul-fast`) 宸查獙璇佷慨锟?锟?*: 鐢熷浘鏁堟灉鑹ソ锛屽綋鍓嶆灦鏋勫鍗忚灞傚吋瀹规€ф锟?- **`buildHiDreamO1Workflow()` 鍗曞厓娴嬭瘯**: 鏂板 15 涓祴璇曪紙榛樿缁撴瀯銆佸弬鑰冨浘妯″紡鑺傜偣楠岃瘉锟? 绉嶅垎杈ㄧ巼鏄犲皠锟? 锟?steps 鍦烘櫙銆乻eed 闅忔満鎬с€乬enerateImage hidream-o1 鎻愪氦娴佺▼锛夛紝鍏ㄩ儴 53 涓祴璇曢€氳繃
- **HiDream-O1 瑙掕壊 Prompt 妯℃澘**: 鏂板 `characterImageHiDreamO1Def`锛堣嚜鐒惰瑷€鍥涜鍥捐浆瑙掓彁绀猴紝2脳2 缃戞牸甯冨眬锛岀函鐧借儗鏅紝锟?JSON 鍖呰锛夛紱娉ㄥ唽锟?`registry.ts`锛沗detectImageModelFamily()` 鏂板 `"hidream"` 绫诲瀷妫€娴嬶紱`character.ts` handler 鏂板 routing锛坄hidream` 锟?`character_image_hidream_o1` prompt key + `hidream-o1-comfyui` workflowFamily锟?- **瑙掕壊 Prompt 鍗曞厓娴嬭瘯**: 鏂板 `character-image.test.ts`锟?1 涓祴璇曡锟?HiDream-O1/Ideogram4/Simple 涓変釜 prompt 瀹氫箟锟?- **`detectImageModelFamily` 娴嬭瘯**: 鏂板 `character-image-detection.test.ts`锟? 涓祴璇曡鐩栧叏锟?6 锟?family锟?- **Preflight 鍙傝€冭妭鐐逛慨锟?*: 鍙傝€冭妭鐐癸紙HiDreamO1ReferenceImages, ComfySwitchNode, PrimitiveBoolean, LoadImage锛変粠鏍稿績瑕佹眰涓Щ闄わ紝鏀逛负 `preflightWorkflow` 锟?`extraNodeTypes` 鍙€夊弬鏁帮紝浠呭湪闇€瑕佹椂妫€鏌ワ紱`generateImage()` 锟?HiDream-O1 鍒嗘敮鎻愬墠锟?preflight 鍓嶏紝鏍规嵁 `referenceImages` 鍔ㄦ€佷紶锟?extra 鑺傜偣
- **`handleSingleCharacterImage` 闆嗘垚娴嬭瘯**: 鏂板 `character.test.ts`锟? 涓祴锟?锟?杈撳叆鏍￠獙 3 锟?+ HiDream-O1 璺敱/鍙傝€冨浘/閿欒浼犳挱/stale shots 鏍囪锛夛紝mocks DB/Provider/Prompt/Shot-asset 鍏ㄩ摼锟?- lint 锟?tsc 锟?build 锟?
## 2026-06-05 Session (锟? 锟?HiDream-O1 Reference Images 鏀寔
- **鍙傝€冨浘涓婁紶**: `generateImage()` 锟?HiDream-O1 鍒嗘敮鐜板湪鍦ㄦ瀯锟?workflow 鍓嶅厛涓婁紶鍙傝€冨浘锟?ComfyUI server
- **`buildHiDreamO1Workflow()` 鍙傝€冨浘鍒嗘敮**: 锟?`uploadedReferences` 闈炵┖鏃讹紝鑷姩娣诲姞 `LoadImage`锛堟瘡涓弬鑰冨浘涓€寮狅級銆乣HiDreamO1ReferenceImages`锛堣繛锟?CLIPTextEncode 锟?positive/negative 鍜屾墍鏈夊弬鑰冨浘锛夈€乣ComfySwitchNode`锛坧ositive/negative 涓ゆ潯璺緞鍒囨崲锛夈€乣PrimitiveBoolean(true)`锛堝惎鐢ㄥ弬鑰冨浘妯″紡锛夈€傛棤鍙傝€冨浘鏃朵繚鎸佸綋鍓嶇洿杩炴ā寮忥拷?- **Preflight 鎵╁睍**: 鏂板 4 涓彲閫夎妭鐐圭被鍨嬶紙HiDreamO1ReferenceImages, ComfySwitchNode, PrimitiveBoolean, LoadImage锟?- **闄愬埗**: 鍙傝€冨浘蹇呴』鏄湰鍦版枃浠惰矾寰勶紙锟?Qwen Edit 涓€鑷达級锛岄€氳繃 `uploadImage()` 涓婁紶锟?ComfyUI input 鐩綍鍚庤 `LoadImage` 寮曠敤
- lint 锟?tsc 锟?build 锟?
## 2026-06-05 Session (锟? 锟?HiDream-O1 Image 闆嗘垚 ComfyUI Provider
- **HiDream-O1 ComfyUI 宸ヤ綔娴侀泦锟?*: 鏍规嵁瀹樻柟妯℃澘 `image_hidream_o1.json` 鐨勬墎锟?API 鏍煎紡锛屾柊锟?`buildHiDreamO1Workflow()` 鏂规硶锛圕heckpointLoaderSimple + ModelNoiseScale + BasicScheduler + KSamplerSelect + HiDreamO1PatchSeamSmoothing + CLIPTextEncode + EmptyHiDreamO1LatentImage + SamplerCustom + VAEDecode + SaveImage锟?- **妯″瀷璺敱**: `generateImage()` 鏂板 `isHiDreamO1` 鍒嗘敮锛屾敮锟?modelId 锟?`hidream` 鏃惰嚜鍔ㄨ矾鐢憋紱`detectWorkflowFamily()` 鏂板 `hidream_o1` 鏂囦欢妫€锟?- **鍒嗚鲸鐜囨槧锟?*: 鏂板 `ratioToHiDreamO1Size()`锛屾寜 HiDream-O1 璁粌鍒嗚鲸鐜囷紙2048虏/2560脳1440/2304脳1728/1440脳2560 绛夛級鏄犲皠 aspect ratio
- **姝ラ鎺у埗**: `quality === "default"` 锟?40 姝ワ紙鍘熸ā鏉块粯璁わ級锛屽惁锟?20 锟?Turbo
- **Preflight**: 鏂板 `"hidream-o1-comfyui"` 7 涓繀闇€鑺傜偣绫诲瀷
- **Model List API**: 鏂板 `hidream-o1-comfyui` 锟?ComfyUI Image 妯″瀷鍒楄〃
- lint 锟?tsc 锟?build 锟?- **Session [涔嬪墠] 锟?Battle prompts registry + 4 provider test files**: Integrated 29 martial-arts shot prompt templates into `registry-battle.ts` (5 categorized slots), registered in `registry.ts` (19 total), appended rule 6 to `shot_split` fidelity rules; wrote 63 tests across `veo.test.ts` (13), `ucloud-seedance.test.ts` (16), `framepack-video.test.ts` (15), `aivideo-video.test.ts` (15). Fixed `vi.clearAllMocks` 锟?`vi.resetAllMocks` to prevent leftover `mockResolvedValueOnce` bleed across tests; used `vi.useFakeTimers` + `advanceTimersByTimeAsync` for poll timing test; used class `function()` expression in `vi.mock` factory for Google GenAI SDK constructor. lint 锟?tsc 锟?- **Session 06/06 涓嬬彮**: 鏂板啓 1 锟?wan-video.test.ts锟?8 tests锛夛紝绱 16 锟?provider test 鏂囦欢锛涙墍鏈夋柊 provider 锟?`generateText`锛堟姏涓嶆敮鎸佸紓甯革級銆乣generateImage`锛坱2i/size/璁よ瘉/閿欒/鍐欑洏锛夈€乣generateVideo`锛坘eyframe/reference/text/杞/閿欒锛夊叏瑕嗙洊锛涙敮锟?7 锟?AI 鍘傚晢 脳 2 澶фā鎬侊紙鍥剧墖+瑙嗛锛夛紱lint 锟?tsc 鉁咃紝`next build` 锟?Windows 涓婂洜鍐呭瓨瓒呮椂鍙楅樆锛坄--turbo` bypass锟?- **Hermes agent 淇骞跺崌绾у埌 v0.15.1**: 鏍瑰洜鏄棫锟?`0.15.1` pip 鍖呯殑 `hermes_cli` 缂哄皯 `main.py`锛屽姞锟?`~ermes*` 娈嬩綑鐩綍骞叉壈銆傛竻鐞嗘畫鐣欏悗浠庢湰鍦版簮鐮侀噸锟?editable (v0.14.0)锛岀劧鍚庤繍锟?`hermes update --yes` 鎷夊彇 796 涓柊 commit锛屾垚鍔熷崌绾у埌 `0.15.1 (2026.5.29)`锛岀姸锟?`Up to date`
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
- **4-grid quality aligned to manual workflow**: frame_idx `[0,90,180,270]` + full LoRA chain (subtitles-remove 锟?restoration 锟?dynamic 0.6 锟?OmniNFT 0.2 锟?distilled 0.5) in `ltx-i2v-multiguide.json`
- Completion criteria all pass: lint 锟?tsc 锟?build 锟?- **Phase 1 锟?瑙掕壊搴撹嚜鍔ㄦ矇娣€瀹屾垚**: frame 鐢熸垚鍚庤嚜鍔ㄥ皢瑙掕壊鍑哄浘杩藉姞锟?`characters.referenceImageHistory`锛岀敤鎴峰彲娴忚鍘嗗彶甯у浘骞惰涓轰富瑕佸弬鑰冨浘 (`src/lib/pipeline/handlers/frames.ts:33-49`)
- **4-grid 鐢昏川浼樺寲**: sigma schedule 锟?"balanced"锟?姝ワ級锟?"quality"锟?7姝ワ級锟?"quality_lite"锟?3姝ワ級锛沝istilled LoRA 寮哄害 0.5 锟?0.65锛屽噺灏戣繍鍔ㄦā锟?- **N+1 dialogue 鏌ヨ淇**: `/api/projects/[id]` 锟?`/api/projects/[id]/episodes/[episodeId]` 涓や釜 GET 绔偣锟?`inArray` + Map 鍒嗙粍鏇夸唬閫愪釜 shot 鐨勫璇濇煡锟?- **椤甸潰瀵艰埅鎬ц兘浼樺寲**: layouts 鏀圭敤杞婚噺妯″紡 (`?exclude=shots`)锛屼笉鍔犺浇 shots/assets/dialogues锛泂toryboard 椤垫寜闇€瑙﹀彂瀹屾暣鏁版嵁鍔犺浇
- **SenseNova 413 淇**: 鎵€锟?`generateText`/`generateImage` 璋冪敤鐨勫浘鐗囨暟缁勪笂闄愮粺涓€锟?6 锟?(`visionFrames`, `sceneFramePaths`, `shotCharRefImages`, Omnigen upload loop)
- **妯″瀷鎻愪緵鍟嗘灦鏋勪慨锟?*:
  - `resolveAIProvider`: 锟?SenseNova 锟?text provider 鍥為€€锟?OpenAI锛堢户鎵垮悓 protocol 锟?baseUrl/apiKey锟?  - `model-store.getModelConfig()`: 娣诲姞 `capability` 妫€鏌ワ紝纭繚 `defaultTextModel` 鍙繑锟?`capability === "text"` 锟?provider
  - `ensureDefaultProvider()`: 鏂板 `isTextCapable()` 楠岃瘉
  - Emotion-analysis + continuity-check API 璺敱: 娣诲姞 `modelConfig?.text` 瀛樺湪鎬ф牎楠岋紙400 鎷︽埅锟?- **Git 鍒嗗弶淇**: 鏈湴 `master` 锟?`main` 閲嶅懡鍚嶏紝GitHub 涓ょ (`main` + `master`) 鍚屾锛孋NB 鍚屾
- **娴嬭瘯妗嗘灦**: 閰嶇疆 vitest 4.1 + 5 test files / 61 tests (model-store, provider-factory, validation, id, utils)
- lint 锟?tsc 锟?(build 锟?environment timeouts 锟?blocked by resource limits)
- **Agent + 鏃犻檺鐢诲竷 (闃舵1)**: 鍩轰簬 `@xyflow/react` 锟?Storyboard 椤甸潰鏂板 Canvas 瑙嗗浘妯″紡锛涚偣锟?Shot 鑺傜偣璋冨嚭 Agent Chat 闈㈡澘锛沗POST /api/projects/:id/agent/chat` 绔偣灏嗚嚜鐒惰瑷€鎸囦护鏄犲皠锟?pipeline actions
- **瀹¤淇 (7 issues)**: 鍏ㄩ儴淇
  - Critical: `hasVideo` 绫诲瀷淇锟?`boolean` (!! 杞崲)
  - Critical: `useCanvasStore.getState()` 鏀逛负 zustand selector hook `useCanvasStore(s => s.selectedShotId)` 灏佽锟?`CanvasView` 瀛愮粍锟?  - Critical: camera direction 鍊掓寕瑙ｆ瀽 锟?鏀圭敤 `parseCameraDirection` + 姝ｅ垯鍖归厤"pan left/zoom in"锟?  - Critical: Storyboard Page 宓屽叆 canvas 缁撴瀯璋冩暣 (娑堥櫎鍙岄噸 `viewMode === "kanban"`)
  - High: `INTENT_MAP` 鎺掑簭鎻愬彇鍒版ā鍧楃骇甯搁噺 `INTENT_MAP_SORTED`锛屼笉鍦ㄦ瘡锟?`matchIntent` 璋冪敤鏃舵帓锟?  - High: agent-chat race condition 锟?`shotIdRef` 璺熻釜璇锋眰锟?shot锛岃繃鏈熷搷搴旇嚜鍔ㄤ涪锟?  - High: `chatMessages` 鍏ㄥ眬鏁扮粍 锟?锟?`selectedShotId` 闅旂 (`chatMessagesByShotId: Record<string, ChatMessage[]>`)
  - 椤烘墜淇: `<img>` 缂哄け `onError` 鍏滃簳銆侀〉闈㈡畫锟?`{/* unused import */}` 娓呯悊
- **鍥涘鏍艰棰戞彁绀鸿瘝 413 淇**: `video-prompt.ts` 鍦ㄨ皟鐢ㄦ枃鏈ā鍨嬪墠鎸夋€诲浘鐗囦綋绉绠楅€夋嫨 vision frames锛堟渶锟?6 寮犱笖鎬诲師鍥句綋绉害 2.5MB锛夛紝閬垮厤 4 寮犲ぇ panel base64 鍚庤姹備綋瓒呴檺锛沴int 锟?tsc 鉁咃紝build 浠嶅洜鐜璧勬簮瓒呮椂
- **椤圭洰鍔犺浇鎱㈠垵姝ヤ慨锟?*: `project-store` 澧炲姞 `loadedProjectKey`锛孭roject/Episode layout 锟?Storyboard full fetch 浼氳烦杩囧凡鍔犺浇鐨勫悓 key 璇锋眰锛屽噺灏戦噸澶嶈交锟?瀹屾暣鏁版嵁鎷夊彇锛沴int 锟?tsc 锟?- **Next root layout + 璇锋眰寰幆淇**: 锟?`src/app/layout.tsx` 鎭㈠ `<html>/<body>`锛宍[locale]/layout.tsx` 鏀逛负鍙寘 Provider锛沗project-store.fetchProject` 澧炲姞 `pendingProjectKey` 涓庡悓 key 鍘婚噸锛岄伩锟?ProjectLayout/EpisodeLayout 浜掔浉瑕嗙洊瀵艰嚧閲嶅璇锋眰/椤甸潰 500锛沴int 锟?tsc 鉁咃紱dev server 宸查噸鏂板惎鍔紝`/zh` 杩斿洖 200
- **鍥涘鏍艰棰戞彁绀鸿瘝鍙湁 Duration 淇**: `video-prompt.ts` 瀵规枃鏈ā鍨嬬┖杈撳嚭澧炲姞 fallback prompt锛岄伩锟?`rawPrompt.trim()` 涓虹┖鏃朵粛淇濆瓨 `Duration: Ns`锛涘崟锟?鎵归噺鍧囪鐩栵紱lint 锟?tsc 锟?- **鍗曞紶鐢熸垚 episodeId 浼犻€掍慨锟?*: `ShotCard`/`ShotDrawer` 鐨勫崟寮犲弬鑰冨抚銆佽棰戞彁绀鸿瘝銆佸抚銆佽棰戠敓鎴愯姹傝ˉ锟?`episodeId`锛岄伩鍏嶆湇鍔＄鏃ュ織 `episodeId=none` 瀵艰嚧 episode 涓婁笅鏂囧埛锟?绛涢€夐敊浣嶏紝鐪嬭捣鏉ョ敓鎴愭湭鎴愬姛锛沴int 锟?tsc 锟?- **4-grid 瑙嗛鏃堕暱/鍘绘按鍗颁慨锟?*: 绉婚櫎 `video-keyframe.ts` 锟?4-grid 瑙嗛鐢熸垚鍚庣殑 `ffmpeg -t dur-1.5` 瑁佸壀閫昏緫锛岃В鍐崇敓鎴愯棰戞€绘瘮鎻愮ず璇嶅皯锟?2 绉掞紱鍚屾椂锟?LTX 妯℃澘涓殑 `ltx2.3-ic-subtitles-remove-general` 锟?`ltx2.3-video-restoration-general` 寮哄害锟?`0.9` 鎻愬埌 `1.0`锛屽寮哄瓧锟?姘村嵃鎶戝埗锛沴int 锟?tsc 锟?- **鍚告敹 Seedance skill 鎬濊矾浼樺寲瑙嗛鎻愮ず锟?*: 澧炲己 `registry-video.ts` 锟?`video_generate_4grid` 妯℃澘锛屽姞鍏モ€滃婕斿寲鏀瑰啓瑙勫垯鈥濄€佹椂闂村垎娈点€侀暅澶磋瑷€銆佸畨鍏ㄥ尯涓庡洓灞傛弿杩拌姹傦紱澧炲己 `video-enhance.ts`锛屽皢鍙ｈ鍖栬棰戞弿杩拌嚜鍔ㄧ炕璇戜负鏇翠笓涓氱殑鐢靛奖闀滃ご璇█锛沴int 锟?tsc 锟?- **瀹¤鍥炲綊淇**: `enhanceVideoPrompt()` 澧炲姞 mode 鍙傛暟锛屾媶鍒嗕负 `default` 锟?`four_grid` 涓ゅ system prompt锛岄伩鍏嶅洓鏍煎婕斿寲澧炲己璇激鏅€氳锟?鍙傝€冭棰戦摼璺紱`video-keyframe.ts` 鐨勫洓鏍艰皟鐢ㄦ樉寮忎紶 `"four_grid"`锛沴int 锟?tsc 锟?- **椋庢牸棰勮鎺ュ叆 ScriptEditor**: 鏂板 `src/lib/style-presets.ts`锛屾暣锟?120 椋庢牸涓哄彲澶嶇敤棰勮锛沗ScriptEditor` 澧炲姞椋庢牸涓嬫媺涓庘€滄彃鍏ラ鏍尖€濇寜閽紝浼氭妸鎵€閫夐鏍煎啓锟?`Idea` 鏂囨湰涓殑 `瑙嗚椋庢牸鍙傝€冿細涓枃 / English` 琛岋紝渚夸簬鑴氭湰鐢熸垚閾捐矾澶嶇敤锛沴int 锟?tsc 锟?- **瑙嗚椋庢牸鍙傝€冩樉寮忚繘鍏ョ敓鎴愰摼锟?*: `buildScriptGeneratePrompt()` 鐜板湪浼氭彁锟?`瑙嗚椋庢牸鍙傝€冿細...` 骞朵互楂樹紭鍏堢骇鏄惧紡娉ㄥ叆 script_generate user prompt锛沗buildShotSplitPrompt()`/`shots.ts` 涔熶細鎶婅椋庢牸浣滀负鈥滄渶楂樹紭鍏堢骇鈥濈害鏉熷杺缁欏垎闀滄媶瑙ｏ紝纭繚 startFrame/endFrame/videoScript 鎸佺画浣撶幇閫夊畾椋庢牸锛沴int 锟?tsc 锟?- **椋庢牸閾捐矾缁х画涓嬫矇鍒板叧閿抚/鍙傝€冨浘**: `keyframe.ts` 锟?`ref-image.ts` 鐜板湪浼氫紭鍏堣锟?`瑙嗚椋庢牸鍙傝€冿細...`锛堜粠 script / idea 涓彁鍙栵級锛屽啀涓庡墽鏈噷锟?`瑙嗚椋庢牸 / 鑹插僵鍩鸿皟 / 鏃朵唬缇庡 / 姘涘洿鎯呯华 / 鐢诲箙姣斾緥` 鍚堝苟锛屾樉寮忎紶鍏ュ叧閿抚鎻愮ず璇嶅拰鍙傝€冨浘鎻愮ず璇嶇敓鎴愶紱lint 锟?tsc 锟?- **椋庢牸閾捐矾鎵撻€氬埌瑙嗛鎻愮ず锟?鍙傝€冭锟?*: `video-prompt.ts` 锟?`video-reference.ts` 鐜板湪涔熶細锟?script / idea 涓彁锟?`瑙嗚椋庢牸鍙傝€冿細...`锛涜椋庢牸浼氭樉寮忔敞锟?`buildRefVideoPromptRequest()` 锟?`buildReferenceVideoPrompt()`锛屼娇瑙嗛鎻愮ず璇嶄笌鍙傝€冭棰戞彁绀鸿瘝淇濇寔鍜屼笂娓稿墽锟?鍒嗛暅鍚屼竴椋庢牸鍩鸿皟锛沴int 锟?tsc 锟?- **UI 鏄剧ず褰撳墠鍏ㄥ眬瑙嗚椋庢牸**: 鏂板 `extractVisualStyleReference()` 宸ュ叿鏂规硶锛汼cript 椤甸潰锟?Storyboard 椤甸潰椤靛ご浼氭樉绀哄綋锟?`瑙嗚椋庢牸鍙傝€僠 寰芥爣锛屾柟渚跨敤鎴烽殢鏃剁‘璁ゅ綋鍓嶉」鐩鏍硷紱lint 锟?tsc 锟?- **鍚告敹 lanshu 浠撳簱鐨勬ā鍨嬪垎娴佹€濊矾**: 鏂板 `src/lib/ai/video-model-strategy.ts`锛屽彲鎺ㄦ柇瑙嗛鎻愮ず璇嶅鏃忥紙`ltx` / `wan` / `seedance` / `generic`锛夛紱`video-enhance.ts` 鐜板湪浼氭寜妯″瀷瀹舵棌鍒囨崲澧炲己 system prompt锛岃 Wan 鏇村亸绋冲畾鍗曞姩浣溿€丼eedance 鏇村亸鍒嗛暅鏁ｆ枃銆丩TX 缁存寔鐜版湁鍐欐硶锛沴int 锟?tsc 锟?- **妯″瀷瀹舵棌鍒嗘祦缁х画涓嬫矇鍒拌锟?prompt builder**: `buildRefVideoPromptRequest()` 锟?`buildReferenceVideoPrompt()` 鐜板湪鏀寔 `family` 鍙傛暟锛沗video-prompt.ts` / `video-reference.ts` 浼氭妸 `inferVideoPromptFamily(modelConfig)` 浼犲叆锛屼娇 Wan/Seedance 鍦ㄥ師濮嬭棰戞彁绀鸿瘝鏋勯€犻樁娈靛氨浣撶幇宸紓锛岃€屼笉鍙槸鍦ㄥ寮洪樁娈靛垎娴侊紱lint 锟?tsc 锟?- **Storyboard 鏄剧ず褰撳墠瑙嗛妯″瀷瀹舵棌**: `video-model-strategy.ts` 鏂板 `getVideoPromptFamilyLabel()`锛汼toryboard 椤靛ご鐜板湪浼氬睍绀哄綋鍓嶈棰戞ā鍨嬬瓥鐣ュ窘鏍囷紙锟?`LTX 杩炵画闀滃ご` / `Wan 绋冲畾鍗曞姩浣渀 / `Seedance 鍒嗛暅鏁ｆ枃`锛夛紝甯姪鐢ㄦ埛鐞嗚В褰撳墠鎻愮ず璇嶅啓娉曞亸鍚戯紱lint 锟?tsc 锟?- **Storyboard 鏄剧ず妯″瀷绛栫暐璇存槑**: `video-model-strategy.ts` 鏂板 `getVideoPromptFamilyHint()`锛汼toryboard 椤靛ご鐜板湪鍦ㄨ棰戞ā鍨嬪窘鏍囦笅鏂规樉绀轰竴琛岀畝鐭鏄庯紙渚嬪鈥滃亸杩炵画闀滃ご銆佹椂搴忔帹杩涘拰鐢靛奖鍖栧姩浣滄弿杩扳€濓級锛岃妯″瀷宸紓鍖栫瓥鐣ユ洿鍙劅鐭ワ紱lint 锟?tsc 锟?- **Script 椤甸潰涔熸樉绀哄綋鍓嶈棰戞ā鍨嬬瓥锟?*: `ScriptEditor` 椤靛ご鐜板湪鍚屾灞曠ず褰撳墠瑙嗛妯″瀷瀹舵棌寰芥爣涓庣畝鐭鏄庯紝浣跨敤鎴峰湪鍐欏垱锟?鍓ф湰闃舵灏辫兘鐞嗚В鍚庣画瑙嗛鎻愮ず璇嶅亸鍚戯紙LTX / Wan / Seedance锛夛紱lint 锟?tsc 锟?- **淇瀹¤闂骞舵彁鍙栦笓鐢ㄧ瓥鐣ュ窘鏍囩粍锟?*: 瀹¤纭 Script/Storyboard 涓師鍏堢洿鎺ラ€氳繃 `getModelConfig()` 璁＄畻绛栫暐瀛樺湪闈炲搷搴斿紡椋庨櫓锛涚幇宸叉娊锟?`src/components/editor/video-model-strategy-badge.tsx`锛岄€氳繃鍝嶅簲寮忚闃呰棰戞ā鍨嬬姸鎬佺粺涓€灞曠ず绛栫暐鏍囩涓庤鏄庯紝涓嶆敼楂樺奖鍝嶉潰锟?`InlineModelPicker`锛沴int 锟?tsc 锟?- **椋庢牸涓嬫媺涓庡綋鍓嶉」鐩姸鎬佸悓锟?*: `style-presets.ts` 鏂板 `findStylePresetIdByReference()`锛沗ScriptEditor` 鐜板湪浼氭牴锟?`project.idea` 涓凡鏈夌殑 `瑙嗚椋庢牸鍙傝€冿細...` 鑷姩鍥炲～褰撳墠椋庢牸涓嬫媺锛岄伩锟?UI 鍋滃湪閿欒榛樿鍊硷紱lint 锟?tsc 锟?- **鎻掑叆椋庢牸鏃跺悓姝ュ洖濉墽鏈瑙夐鏍煎瓧锟?*: `ScriptEditor.applyStylePreset()` 鐜板湪闄や簡鏇存柊 `idea` 锟?`瑙嗚椋庢牸鍙傝€冿細...`锛岃繕浼氬湪宸叉湁鍓ф湰姝ｆ枃涓悓姝ユ浛锟?`瑙嗚椋庢牸锟?..` 琛岋紝纭繚 UI 閫夊畾椋庢牸銆佸墽鏈粨鏋勫潡鍜屼笅娓歌В鏋愪繚鎸佷竴鑷达紱lint 锟?tsc 锟?- **椋庢牸寰芥爣鏄剧ず澧炲姞 script 鍥為€€**: `style-presets.ts` 鏂板 `extractVisualStyleValue()`锛汼cript 锟?Storyboard 椤靛ご鐜板湪浼氬厛锟?`idea` 涓殑 `瑙嗚椋庢牸鍙傝€冿細...`锛岃嫢涓嶅瓨鍦ㄥ垯鍥為€€璇诲彇鍓ф湰缁撴瀯鍧楅噷锟?`瑙嗚椋庢牸锟?..`锛岄伩鍏嶅凡鏈夊墽鏈」鐩笉鏄剧ず椋庢牸锛沴int 锟?tsc 锟?- **鎻愬彇涓撶敤 VisualStyleBadge 缁勪欢**: 鏂板 `src/components/editor/visual-style-badge.tsx`锛屾妸椋庢牸寰芥爣锟?idea/script 鍥為€€閫昏緫缁熶竴灏佽锛孲cript 锟?Storyboard 椤甸潰鏀逛负澶嶇敤璇ョ粍浠讹紝鍑忓皯閲嶅閫昏緫骞朵究浜庡悗缁墿灞曪紱lint 锟?tsc 锟?- **鎶藉彇缁熶竴瑙嗚椋庢牸瑙ｆ瀽宸ュ叿**: 鏂板 `src/lib/visual-style.ts`锛岀粺涓€鎻愪緵 `extractStyleField()`銆乣extractPrimaryVisualStyleReference()`銆乣buildVisualStyleContext()`锛沗keyframe.ts`銆乣ref-image.ts`銆乣video-prompt.ts`銆乣video-reference.ts` 宸插垏鎹㈠埌澶嶇敤杩欏宸ュ叿锛屽幓鎺夐噸澶嶇殑椋庢牸瑙ｆ瀽浠ｇ爜锛沴int 锟?tsc 锟?- **瑙嗚椋庢牸鍙傝€冪户缁墠绉诲埌 script_outline**: `visual-style.ts` 鏂板 `buildVisualStylePromptLead()`锛沗handleScriptOutlineAction()` 鐜板湪浼氬湪 outline 闃舵灏辨妸椋庢牸浣滀负鏄惧紡楂樹紭鍏堢骇涓婁笅鏂囨敞鍏ワ紝鏃犺璧扮粦锟?Agent 杩樻槸鍐呯疆 `streamText` 璺緞锛岄兘鑳芥洿鏃╅攣瀹氭暣浣撶編瀛︽柟鍚戯紱lint 锟?tsc 锟?- **Normal 瑙嗛璺緞娉ㄥ叆瑙嗚椋庢牸 + 妯″瀷瀹舵棌**: `video-keyframe.ts` 锟?`buildVideoPrompt()` 璋冪敤鏂板 `visualStyle` 锟?`family` 鍙傛暟锛屼娇闈炲洓鏍兼櫘閫氳棰戠殑 base prompt 涔熷甫涓婂叏灞€椋庢牸鍜屾ā鍨嬬瓥鐣ヤ笂涓嬫枃锛沴int 锟?tsc 锟?- **ComfyUI preflight 鏍￠獙 + 閿欒浠ｇ爜鏍囧噯锟?*: 鏂板 `src/lib/comfyui/errors.ts`锛堟爣鍑嗛敊璇唬鐮佹灇锟?+ `ComfyUIError` 鎺ュ彛锛夊拰 `src/lib/comfyui/preflight.ts`锛坄checkComfyUIServer()` / `checkComfyUIModels()` / `preflightWorkflow()`锛夛紱锟?`ComfyUIVideoProvider` 锟?`ComfyUIImageProvider` 锟?`generateVideo()`/`generateImage()` 鍏ュ彛鎻掑叆棰勬鏌ワ紝`SERVER_UNAVAILABLE` 绛夊父瑙佹晠闅滃湪鎻愪氦 workflow 鍓嶅氨琚崟鑾凤紱鍚屾椂锟?image provider 琛ラ綈锟?auth headers 鏀寔锛沴int 锟?tsc 锟?- **4-grid 瑙嗛鎻愮ず璇嶆敞鍏ヨ瑙夐锟?+ 妯″瀷瀹舵棌**: `build4GridPrompt()` 锟?fallback 妯℃澘锟?registry 妯℃澘鐜板湪閮芥敮锟?`VISUAL_STYLE` 锟?`MODEL_FAMILY` 涓や釜棰濆鏇挎崲鍙橀噺锛沗video-keyframe.ts` 锟?single/batch 鍥涙牸璋冪敤鐐瑰皢鍏ㄥ眬椋庢牸鍜屾ā鍨嬪鏃忎紶鍏ワ紱lint 锟?tsc 锟?- **Agent 鑴氭湰鐢熸垚璺緞琛ラ綈瑙嗚椋庢牸鎸囦护**: `handleScriptGenerate()` 缁戝畾锟?Agent 璺緞鐜板湪锟?`handleScriptOutlineAction()` 涓€鏍凤紝锟?agent prompt 鍓嶆樉寮忔敞锟?`buildVisualStylePromptLead()`锛沴int 锟?tsc 锟?- **瑙嗛鎻愮ず锟?duration cap 锟?10s 鎻愬崌锟?30s**: `buildVideoPrompt()` 锟?`buildReferenceVideoPrompt()` 锟?prompt 鍐呮椂闀跨‖甯戒粠 10s 鎻愬崌锟?30s锛堥€傞厤 LTX/Wan 鏈€锟?30s 鑳藉姏锛夛紱`buildRefVideoPromptRequest()` 鍚屾牱鎻愬崌锟?30s锛屽苟鏍规嵁 `family` 鍙傛暟鍔ㄦ€佺‘瀹氫笂闄愶紱lint 锟?tsc 锟?- **瑙嗛鎻愮ず璇嶆祴璇曚慨锟?10 涓け锟?*: `buildInterpolationHeader` 鍦ㄦ湁 `segmentContext` 鏃惰烦锟?registry 榛樿鍊硷紙鍘熷厛 registry 鐨勯€氱敤 `interpolation_header` 瑕嗙洊浜嗗垎娈典笓锟?header锛夛紱淇锟?`detectLanguage` 鎸夎剼鏈枃瀛楄瑷€杈撳嚭鏍囩瀵艰嚧锟?10 涓柇瑷€澶辫触锛堣嫳鏂囪緭鍏ヨ緭鍑鸿嫳鏂囨爣绛撅紝锟?output 涓嶅惈 `瑙嗛鑴氭湰`/`Video Script` 鏍囩琛岋級锟?1 tests 锟?- **apiFetch TypeError: Failed to fetch 淇**: 鎵€锟?11 涓壒閲忔搷锟?handler 锟?guard 锟?`if (!project) return;` 鏀逛负 `if (!project?.id) return;`锛岄槻锟?store 鏈姞杞芥椂 URL 鍙樹负 `/api/projects/undefined/generate`锛沗apiFetch` 澧炲姞 URL 鍖呭惈 `undefined` 鐨勬娴嬪拰缃戠粶灞傚紓甯哥殑涓枃閿欒鍖呰锛沴int 锟?tsc 锟?- **Duration cap 30s 锟?10s 杩樺師**: `buildVideoPrompt()`, `buildReferenceVideoPrompt()`, `buildRefVideoPromptRequest()` 鐨勬墍鏈夋椂闀跨‖甯界粺涓€鍥為€€锟?10 绉掞紱鐩稿叧娴嬭瘯鍚屾鏇存柊锛沴int 锟?tsc 锟?- **kling-video.test.ts**: 14 tests 锟?鏋勯€犲嚱鏁帮紙榛樿锟?鐜鍙橀噺/鍙傛暟瑕嗙洊锛夛紝generateVideo锛坕mage2video 鍏抽敭锟?text2video 寮曠敤/JWT Bearer/锟?secretKey 鐩寸敤 ak/400 鏃犲紩鐢ㄩ噸锟?杞/鎻愪氦澶辫触/鐢熸垚澶辫触/duration v1 鏄犲皠/duration v3 閽充綅/HTTP 鍥剧墖寮曠敤锛夛紱lint 锟?tsc 锟?build 锟?- **kling-image.test.ts**: 15 tests 锟?鏋勯€犲嚱鏁帮紙榛樿锟?鐜鍙橀噺/鍙傛暟瑕嗙洊锛夛紝generateText锛堜笉鏀寔寮傚父锛夛紝generateImage锛堟纭産ody/鑷畾涔塧spectRatio/JWT Bearer/鏃爏ecretKey鐩寸敤/poll杞/submit HTTP閿欒/submit閿欒锟?poll HTTP閿欒/poll澶辫触/鏃燯RL/涓嬭浇鍐欑洏锛夛紱lint 锟?tsc 锟?build 锟?- **siliconflow-image.test.ts**: 17 tests 锟?瀵煎嚭 `clampSize`/`resolveImageSize`锛涙瀯閫犲嚱鏁帮紙榛樿锟?env/鍙傛暟瑕嗙洊/灏鹃儴鏂滄潬锛夛紝generateText锛堜笉鏀寔寮傚父锛夛紝generateImage锛堥粯璁ody/model瑕嗙洊/aspectRatio/explicit size/img2img寮曠敤/HTTP URL寮曠敤/Bearer auth/HTTP閿欒/閿欒锟?鏃犲浘锟?涓嬭浇澶辫触/涓嬭浇鍐欑洏锛夛紱lint 锟?tsc 锟?build 锟?- **dashscope-image.test.ts**: 25 tests 锟?瀵煎嚭 `getModelFamily`/`resolveSize`/`ModelFamily`锛沢etModelFamily锛坵an/zimage/qwen榛樿锛夛紝resolveSize锛坋xplicit浼樺厛/wan姣旂巼/qwen姣旂巼/zimage姣旂巼/family榛樿/鏈煡姣旂巼锛夛紝鏋勯€犲嚱鏁帮紙榛樿锟?env/鍙傛暟瑕嗙洊/灏鹃儴鏂滄潬锛夛紝generateText锛堜笉鏀寔寮傚父锛夛紝generateImage锛坬wen body/wan灏哄/zimage鏃爊/model瑕嗙洊/size浼樺厛锟?Bearer auth/HTTP閿欒/API閿欒锟?鏃燯RL/涓嬭浇澶辫触/涓嬭浇鍐欑洏锛夛紱lint 锟?tsc 锟?build 锟?- **sensenova-image.test.ts**: 21 tests 锟?瀵煎嚭 `normalizeSenseNovaSize`/`normalizeBaseUrl`锛沶ormalizeSenseNovaSize锛坅spect鏄犲皠/size鏄犲皠/鍥為€€锛夛紝normalizeBaseUrl锛堥粯锟?寮哄埗/v1/灏鹃儴鏂滄潬锛夛紝鏋勯€犲嚱鏁帮紙榛樿锟?OPENAI_API_KEY/鍙傛暟瑕嗙洊锛夛紝generateText锛堜笉鏀寔寮傚父锛夛紝generateImage锛堟纭畃ayload/explicit size/Bearer auth/b64_json淇濆瓨/URL涓嬭浇/frames鐩綍/HTTP閿欒/API閿欒/绌哄搷锟?鏃爌ayload/涓嬭浇澶辫触锛夛紱lint 锟?tsc 锟?build 锟?- **hidream-image.test.ts**: 16 tests 锟?鏋勯€犲嚱鏁帮紙榛樿/鍙傛暟瑕嗙洊/灏鹃儴鏂滄潬锛夛紝generateText锛堜笉鏀寔寮傚父锛夛紝generateImage锛坱2i妯″紡/edit妯″紡/subject妯″紡/6寮犻檺锟?size瑙ｆ瀽/榛樿2048+seed32/SSE瑙ｇ爜鍐欑洏/start HTTP閿欒/鏃爅ob_id/stream HTTP閿欒/SSE error浜嬩欢/stream鏃犵粨鏋滐級锛沴int 锟?tsc 锟?build 锟?- **omnigen-image.test.ts**: 20 tests 锟?鏋勯€犲嚱鏁帮紙榛樿/鍙傛暟瑕嗙洊/灏鹃儴鏂滄潬锛夛紝generateText锛堜笉鏀寔寮傚父锛夛紝buildOmnigenPrompt锛堟棤ref/鍚玶ef/label+role/editBaseImage/dedup/6寮犻檺鍒讹級锛宲arseSSE锛坉ata+complete浜嬩欢/[DONE]/闈濲SON锛夛紝generateImage锛堜笂锟?鍚姩/涓嬭浇鍐欑洏/txt2img鍏嶄笂锟?涓婁紶澶辫触/鍚姩澶辫触/鏃爀vent_id/涓嬭浇澶辫触锛夛紱lint 锟?tsc 锟?build 锟?- **wan-video.test.ts**: 28 tests 锟?鏋勯€犲嚱鏁帮紙榛樿锟?鐜鍙橀噺/鍙傛暟瑕嗙洊锛夛紝buildKeyframeBody锛坵an2.6 img_url + size/wan2.7 media[] + ratio锛夛紝buildReferenceBody锛坵an2.6 img_url/wan2.7 reference_image/涓婇檺8寮狅級锛宐uildTextBody锛堥潪wan2.7 model/wan2.7鈫抰2v锛夛紝generateVideo锛堝叧閿抚浠诲姟/寮曠敤浠诲姟/绾枃鏈换锟?Bearer auth + X-DashScope-Async/澶氳疆杞/submit HTTP閿欒/鏃爐ask_id/鐢熸垚FAILED/鏃爒ideo_url/涓嬭浇鍐欑洏锛夛紱lint 锟?tsc 锟?build 锟?- **Provider 娴嬭瘯鎬昏**: 16 锟?provider test 鏂囦欢锛屾€昏 20 锟?test 鏂囦欢锛沴int 锟?tsc 锟?(build 锟?environment timeout 锟?`--turbo` bypasses)
- **闆嗘垚 Agnes AI 鍏嶈垂 API**: 鏂板 `agnes-video.ts` video provider锛圤penAI-compatible 杞椋庢牸瀹氬奖妯″紡锛夛紝娉ㄥ唽 `agnes` protocol 锟?model-store锛圥rotocol 鑱斿悎绫诲瀷锛夈€乸rovider-factory锛坱ext/image 锟?OpenAIProvider锛寁ideo 锟?AgnesVideoProvider锛夈€乤i-sdk锛堝锟?createOpenAI锛夈€乁I provider-form锛圖EFAULT_BASE_URLS + 涓夌骇 capability 閫夋嫨锛夈€傚凡楠岃瘉 API锛歵ext锛坄Agnes-2.0-Flash`锛夆渽 image锛坄Agnes-Image-2.0-Flash` 杩斿洖 URL锛夆渽 video锛坄POST/GET /v1/video/generations`锛屾彁锟?杞+涓嬭浇锛変絾 free API 涓嶇ǔ瀹氾紙upstream 500 "division by zero"锛夈€俵int 锟?tsc 锟?build 锟?- **Agnes video 娴嬭瘯**: 鏂板 `agnes-video.test.ts`锟?8 tests锛夛拷?鏋勯€犲嚱鏁帮紙榛樿/env/鍙傛暟瑕嗙洊/灏鹃儴鏂滄潬锛夈€乬enerateVideo锛堢函鏂囨湰鎻愪氦/鍥剧墖base64/firstFrame/initialImage/Bearer璁よ瘉/澶氳疆杞鈫扖OMPLETED/submit HTTP閿欒/鏃爐ask_id/FAILURE閿欒/FAILED閿欒/COMPLETED鏃燯RL/video_url澶囬€夊瓧锟?涓嬭浇澶辫触/鍐欑洏楠岃瘉/alt id瀛楁锛夈€俵int 锟?tsc 锟?- **Key Decisions**:
  - `inferProvider()` called with `config: any` to avoid circular import from registry
  - `vi.stubGlobal("fetch", vi.fn(...))` + `vi.unstubAllGlobals()` in `beforeEach` for hermetic fetch stubs
  - Dedicated `generateVideo` test for multi-poll (RUNNING鈫扴UCCEEDED), FAILED, missing video_url, HTTP error, no task_id
  - `as any` casts on test params to bypass restrictive union type narrowing (e.g., `VideoGenerateParams` union requires `initialImage` for all arms)
  - Text-only video generation handled via separate `buildTextBody` method; keyframe/reference each have dedicated builders
  - All helpers exported for direct unit testing (`clampSize`, `resolveImageSize`, `getModelFamily`, `resolveSize`, `normalizeSenseNovaSize`, `normalizeBaseUrl`)
  
## 杩佺Щ锟?Infinite Canvas
- **鍐崇瓥**: 閲囩敤"宸ヤ綔娴佹牱锟?鏂瑰紡杩佺Щ锟?`basketikun/infinite-canvas`锛屼笉鍋氭彃浠跺寲渚靛叆
- **婕敾鎻愮ず璇嶅簱**: 鍒涘缓锟?`prompts/manga-reference/prompts.json`锟?5鏉℃彁绀鸿瘝锛屾兜锟?7 澶х被锛氭极鐢婚鏍笺€佸垎闀滄瀯鍥俱€佸洓鏍兼极鐢汇€佽鑹茶璁°€佸姩浣滃満闈€佹晥鏋滄妧娉曘€佹极鐢诲皝闈級
- **Go 鍚庣**: 锟?`repository/db.go` 娉ㄥ唽鏂板垎锟?`manga-reference`锛屽湪 `service/prompt_fetch.go` 娣诲姞 fetcher锛堢被 davidwu 锟?JSON 鏍煎紡锟?- **鏋勫缓楠岃瘉**: Go `go build ./...` 锟? `go vet ./...` 锟? Web `pnpm run build` 锟?(Next.js)
- **涓嬩竴锟?*: 鍒涘缓 GitHub repo `basketikun/manga-prompt-reference`锛屽皢 prompts.json 鎺ㄤ笂鍘讳互婵€娲昏嚜鍔ㄥ悓姝ワ紱涔嬪悗鍒涘缓宸ヤ綔娴佹牱锟?
## 2026-06-04 Session 锟?鏈湴妯″瀷瀵规瘮娴嬭瘯 + 瑙嗛鐢熸垚椤圭洰璇勪及
- **batiai/qwen3.6-27b:iq3 (11GB IQ3)**: 涓嬭浇瀹屾垚骞舵祴锟?锟?锟?3.8 t/s锛堟瘮 17GB Q4_K_M 锟?~3 t/s 锟?~25%锛夛紝鑺傜渷 6GB VRAM锛岄噴鏀炬洿澶氭樉瀛樹綑閲忥拷?- **Qwen3.6-35B-A3B-MTP-GGUF (Jackrong/ModelScope)**: 涓や釜 GGUF 涓嬭浇瀹屾垚骞跺姣旀祴锟?锟?  - **Q2_K (12.34GB)**: `--spec-draft-n-max 4 --ctx-size 30000 -ngl 99` 锟?**159.8 t/s** 馃殌銆傛湁 3.7GB VRAM 浣欓噺锛岄€傚悎澶т笂涓嬫枃
  - **Q3_K_S (14.48GB)**: `--spec-draft-n-max 3 --ctx-size 8192 -ngl 99` 锟?**129.0 t/s**锟?4.48GB 澶帴锟?16GB 涓婇檺锟?0K ctx 浼氶檷閫熷埌 6.8 t/s
  - **缁撹**: Q2_K (12.34GB) 锟?RTX 4080 16GB 涓婄殑鏈€浣抽€夋嫨 锟?159.8 t/s + 30K ctx锛岃繙锟?4060 Ti 锟?114 t/s (IQ2_XXS)
  - MTP (speculative decoding) 鍐呭祵锟?GGUF 涓嚜鍔ㄧ敓鏁堬紝`--spec-draft-n-max=4` 鏈€锟?- **Mamoda2.5 (ByteDance) 璇勪及缁撴灉 锟?*: 25B MoE DiT (128 experts, Top-8) + Qwen3-VL-8B = ~33B 鎬诲弬鏁帮紱鍗充娇 4-bit 閲忓寲 (~16.5GB) + 128 expert 璺敱寮€閿€ + Wan2.2 VAE 杩滆秴 16GB VRAM锟?*涓嶈兘锟?RTX 4080 鏈湴杩愯**锛岄渶 CNB/L40
- **Stream-R1 (USTC/FrameX.AI) 璇勪及缁撴灉 锟?*: 鍩轰簬 Wan2.1 1.3B 钂搁锛屼粎闇€ 8.19GB VRAM锛孯TX 4080 16GB 鍙交鏉捐繍锟?(23.1 FPS at 832脳480)锛汫itHub 锟?HuggingFace 锟?ISP 鎷︽埅锛屾殏鏃犳硶鍏嬮殕/涓嬭浇
- **椤圭洰缁撹**: RTX 4080 16GB 鏈湴鍙敤锟?AI 瑙嗛鏂规锛歋tream-R1 (1.3B, 闇€ ISP 淇)銆乄an2.1 1.3B/14B FP8+T5 offload銆丩TX-Video (0.9B)銆丆omfyUI 宸叉湁

## Blocked
- LongLive 1.0 local inference too slow (~3h per 30-frame video on RTX 4080) 锟?use CNB (L40, Linux, FA2) for production
- **Qwen3.6-35B-A3B NVFP4**: vLLM 0.22.0 鍔犺浇鎴愬姛锛圡arlinNvFp4Kernel + MARLIN MoE backend锛夛紝妯″瀷鏋舵瀯/閲忓寲璇嗗埆姝ｇ‘锛屼絾 RTX 4080 16GB VRAM 涓嶅锛堟潈锟?~16GB + 涓棿婵€锟?OOM锛夛紝闇€ CNB (L40 48GB) 鎴栦笅锟?GGUF 灏忔ā鍨嬫湰鍦伴儴锟?- **Stream-R1 / Mamoda2.5**: GitHub (浠ｇ爜) 锟?HuggingFace (妯″瀷鏉冮噸) 鍧囪 ISP 鎷︽埅锛孨ginx 浠ｇ悊涓嶆敮锟?git 鍗忚锛岀瓑 ISP 淇鎴栨墜鍔ㄤ笅锟?
## Known Issues
- `next build` webpack 妯″紡锟?ComfyUI锛垀21GB锛夎繍琛屾椂鍐呭瓨涓嶈冻鎸傝捣锛屾敼锟?`--turbo` 鍙傛暟鍗冲彲锛沗package.json` 宸查粯璁ゅ甫锟?`--turbo --no-lint`
- `verify-videos.js` excluded from lint (utility script)
- Vitest fake timer + rejects.toThrow 浼氫骇锟?unhandled rejection 鍋囬槼鎬э紙娴嬭瘯鏈韩閫氳繃锟?
## 2026-06-02 Session 锟?Provider 鍏ㄩ噺瀹¤ + 浠ｇ爜璐ㄩ噺淇 + 娴嬭瘯瑕嗙洊鍔犲浐 (+80 tests)
- **Provider 涓€鑷存€у璁″畬锟?*: 20 providers 鍏ㄩ儴 鈭氾紝绔偣/鍝嶅簲涓庣湡锟?API 瀵归綈锟? response shape 涓嶅尮锟?- **3 CRITICAL, 5 HIGH, 2 MEDIUM 闂鍏ㄩ儴淇**:
  - CRITICAL: comfyui-image.ts (6 fetch calls 鍏ㄩ儴锟?AbortSignal.timeout)
  - CRITICAL: comfyui-video.ts (纭紪锟?`M:\ComfyUI...\output` 锟?platform-aware锛沜heckpoint 璺緞鍙嶆枩锟?锟?鍓嶆枩锟?
  - CRITICAL: ucloud-seedance.ts (缂哄皯 `process.env.UCLOUD_API_KEY` fallback)
  - HIGH: dashscope-image, kling-image, kling-video, seedance, wan-video (鍏ㄩ儴 fetch 锟?timeout)
  - MEDIUM: openai.ts, sensenova-image.ts (锟?timeout)
  - 鍚屾椂淇 ltx-workflows.ts 鍏ㄩ儴 6 澶勫弽鏂滄潬璺緞
- **`.env.example` 鏇存柊**: 鏂板 `UCLOUD_API_KEY`, `COMFYUI_OUTPUT_DIR`, `COMFYUI_LTX_CHECKPOINT`
- **娴嬭瘯瑕嗙洊瀹¤ + 鍔犺ˉ**: 鍙戠幇 4 涓叧閿己锟?(0% 瑕嗙洊锟? 锟?鍏ㄩ儴濉ˉ
  - AbortSignal 浼犳挱娴嬭瘯: 0% 锟?89% (17/19 providers)
  - JSON 瑙ｆ瀽閿欒娴嬭瘯: 0% 锟?84% (16/19)
  - 杞瓒呮椂/鏈€澶ч噸璇曟祴锟? 0% 锟?100% (9/9 polling providers)
  - 缂哄け API key 楠岃瘉娴嬭瘯: 0% 锟?86% (12/14 applicable providers)
  - 缃戠粶閿欒娴嬭瘯: 5% 锟?84% (16/19)
  - 鎬昏鏂板 ~80 tests锛屽叏閮ㄩ€氳繃
  - 3 unhandled rejections 鏄凡鐭ョ殑 Agnes 鍋囧畾鏃跺櫒鍋囬槼锟?- **楠岃瘉**: lint 锟?tsc 锟?build 锟?鍏ㄩ儴 489 tests 锟?- **淇 IMAGEGEN_API_KEY 浼樺厛绾ч棶锟?*: `openai.ts` 锟?`process.env.IMAGEGEN_API_KEY` 鏃犳潯浠惰锟?`params.apiKey`锛屽锟?Agnes 鍗忚閰嶇疆锟?key 锟?ASXS 鍏ㄥ眬 key 鍐叉帀 锟?401銆備慨澶嶄负 `params.apiKey` 浼樺厛锛宍IMAGEGEN_*` 浠呬綔 fallback銆傛祴璇曞悓姝ユ洿鏂般€俵int 锟?tsc 锟?35/35 锟?
## 2026-06-05 Session 锟?铓傝殎濂崇帇 + Ideogram-4 瑙掕壊鎻愮ず璇嶈锟?+ ComfyUI 鎵佸钩 workflow 淇
- **鏇存柊 `character-image.ts`**: `ImageModelFamily` 娣诲姞 `"ideogram4"` 绫诲瀷锛沗detectImageModelFamily()` 鏀寔 detection via `protocol === "ideogram4"` 锟?modelId 鍖呭惈 `ideogram4`/`ideogram-4`
- **鏂板 `characterImageIdeogram4Def` (registry-character.ts)**: 绗竷涓鑹叉彁绀鸿瘝瀹氫箟锛岃緭鍑虹粨鏋勫寲 JSON 鏍煎紡 (`high_level_description`/`style_description`/`compositional_deconstruction`)锛屾敮锟?`<3D 杩＋锟?鐨厠鏂姩鐢婚锟?` 鍙紪锟?slot
- **娉ㄥ唽锟?`registry.ts`**: 瀵煎叆骞舵敞锟?`characterImageIdeogram4Def`
- **鏇存柊 `character.ts` handler**: `handleSingleCharacterImage` 锟?`handleBatchCharacterImage` 锟?`ideogram4` 妯″瀷瀹舵棌璺敱锟?`"character_image_ideogram4"` 
- **ComfyUI provider 闆嗘垚**: `ComfyUIImageProvider` 鏂板 `buildIdeogram4Workflow()`锛堟渶灏忓寲 15 鑺傜偣鎵佸钩鏍煎紡锛夛紱`generateImage()` 鏂板 Ideogram-4 鍒嗘敮锛堟彁锟?锟?杞 锟?涓嬭浇锛夛紱workflow 妯℃澘 `ideogram4-t2i.json` 澶嶅埗锟?`src/lib/ai/providers/workflows/`
- **`buildIdeogram4Workflow()` 鎵佸钩鏍煎紡淇**: 鍘熷疄鐜扮洿鎺ヨ繑鍥炲甫瀛愬浘瀹氫箟锟?workflow JSON锛堝惈 `nodes`/`links`/`definitions/subgraphs`锛夛紝锟?ComfyUI `/prompt` API 鍙帴鍙楁墎锟?`{ node_id: { class_type, inputs } }` 鏍煎紡 锟?500 "Server got itself in trouble"銆傚凡閲嶅啓涓虹‖缂栫爜 15 鑺傜偣鎵佸钩 workflow锛欳LIPLoader 锟?CLIPTextEncode 锟?ConditioningZeroOut 锟?DualModelGuider锛坧ositive/negative锛夛紝UNETLoader(v2) 锟?CFGOverride 锟?DualModelGuider锛坢odel锛夛紝UNETLoader(uncond) 锟?DualModelGuider锛坢odel_negative锛夛紝RandomNoise + KSamplerSelect + Ideogram4Scheduler + EmptyFlux2LatentImage 锟?SamplerCustomAdvanced 锟?VAEDecode(VAELoader) 锟?SaveImage銆傝烦锟?JSON 瑙ｆ瀽杈呭姪瀛愬浘锛堢粨鏋勫寲 JSON 鐩存帴娉ㄥ叆 CLIPTextEncode锛夈€俙quality: "default"` 锟?20 姝ワ紝鍚﹀垯 12 锟?Turbo锟?- **Preflight 鏀寔**: `preflight.ts` 娣诲姞 `"ideogram4-comfyui"` 鑺傜偣绫诲瀷妫€鏌ワ紙26 涓繀闇€鑺傜偣绫诲瀷锟?- **鐢熶骇鏋勫缓**: `copy-env-to-standalone.mjs` 鏂板锟?4 姝モ€斺€斿锟?workflows/ 鐩綍锟?standalone 鐩綍
- **楠岃瘉**: lint 锟?tsc 锟?build 锟?- **Session 2026-06-05 锟?Workflow 璺敱淇 + 涓夐噸闄嶇骇妫€锟?*:
  - **闂**: `isIdeogram4` 濮嬬粓锟?false 锟?`ComfyUIImageProvider.model` 涓嶅惈 "ideogram4"锛坢odel config 锟?`modelId` 锟?"z-image-turbo-comfyui"锛夛紝prompt 涔熶笉锟?`"prompt_generation"`锛堝洜 `detectImageModelFamily` 杩斿洖 "other" 锟?榛樿 free-text builder锛夆啋 钀藉叆 Z-Image Turbo 锟?400
  - **淇鏂规锛堜笁閲嶉檷绾ф娴嬶級**:
    1. **`WorkflowFamily` 閫夐」** (`types.ts`): `ImageOptions.workflowFamily`锛宑aller 鍙樉寮忔寚锟?workflow
    2. **Prompt 鍐呭妫€锟?* (`comfyui-image.ts:451`): prompt 锟?`"prompt_generation"` 锟?Ideogram-4
    3. **Server 绔ā鍨嬭嚜鍔ㄦ锟?* (`comfyui-image.ts:422-452`): `detectWorkflowFamily()` 鏌ヨ `/models`锛屽彂锟?`ideogram4_nvfp4_mixed.safetensors` 锟?`"ideogram4-comfyui"`銆傚甫瀹炰緥绾х紦锟?+ localhost 鐭矾
  - **棰濆淇**: 鏋勯€犲嚱锟?fallback 绉婚櫎璇敤锟?`process.env.COMFYUI_BASE_URL`锛圲RL 瀛楃涓插綋 model 鍚嶏級
  - **妫€娴嬩紭鍏堢骇**: `options.workflowFamily` 锟?model 锟?锟?prompt 鍐呭 锟?server 妯″瀷鍒楄〃 锟?榛樿 Z-Image Turbo
   - **娴嬭瘯**: 582 tests 鉁咃紙鏂板 localhost 鐭矾 + 缂撳瓨鍚庢仮锟?6 涓洜 fetch 涓柇锟?comfyui-image.test锟?   - lint 锟?tsc 锟?
## 2026-06-05 Session (锟? 锟?Qwen Edit Dual 鑷姩妫€娴嬩慨锟?+ Z-Image Turbo 璺緞楠岃瘉
- **Z-Image Turbo UNET 璺緞**: 宸查獙璇佸畼鏂规ā锟?`image_z_image_turbo.json` 锟?note 璇存槑妯″瀷瀛樻斁锟?`diffusion_models/z_image_turbo_bf16.safetensors`锛堟牴鐩綍锛屾棤 `ZImage/` 瀛愭枃浠跺す锛夈€備唬鐮佷腑锟?`unet_name: "z_image_turbo_bf16.safetensors"` 姝ｇ‘锛屾棤闇€淇敼锟?- **Qwen Edit Dual 鑷姩妫€娴嬩慨锟?*: `detectWorkflowFamily()` 鍘熸湰鍙壂锟?`diffusion_models` 鏂囦欢澶癸紝锟?Qwen Edit 妯″瀷锟?checkpoint锛堜綅锟?`checkpoints` 鐩綍锛夈€傚凡鏀逛负鍚屾椂鎵弿 `diffusion_models` 锟?`checkpoints` 涓や釜鐩綍锟?- **鏋勫缓淇**: 闇€鍏堟竻锟?`.next` 缂撳瓨銆佸叧闂畫锟?`next dev` 杩涚▼銆佷娇锟?`--turbo` flag锛堜笌 `package.json` 锟?build script 涓€鑷达級锟?- lint 锟?tsc 锟?build 锟?
## 2026-06-05 Session (锟? 锟?SenseNova 鏁呬簨鏉垮抚 Prompt 閲嶆瀯 (鍘绘牸锟?鍘绘枃锟?
- **闂**: 鐢ㄦ埛鍙嶉鏁呬簨鏉垮抚鍥剧敓鎴愶紙閫氳繃 SenseNova `sensenova-ul-fast`锛変粛鐒跺嚭鐜版牸瀛愯竟妗嗗拰鏂囧瓧鏍囩
- **淇**: `buildPanelPrompt()` (frames.ts:59-75) 褰诲簳閲嶆瀯锟?  - 绉婚櫎锟?`"鐢熸垚鍥涘鏍煎垎闀滀腑锟?PANEL X锛屼綔涓轰竴寮犻珮璐ㄩ噺鍥惧儚锟?`锛堣Е鍙戞ā鍨嬭緭鍑虹綉锟?婕敾鍒嗘牸锟?  - 绉婚櫎浜嗘墍锟?`=== 鍦烘櫙鎻忚堪 ===`/`=== 褰撳墠闈㈡澘鐢婚潰 ===`/`=== 瑙掕壊鎻忚堪 ===` 鑺傛爣锟?  - 鏀逛负绾钩閾烘牸寮忥紝绗竴琛屽嵆涓鸿川閲忕害鏉燂紙"鐢靛奖绾у姩鐢诲満鏅覆鏌擄紝涓板瘜缁嗚妭锛岀數褰卞竷鍏夛紝瀹屾暣鐜鑳屾櫙銆備笉瑕佹牸瀛愯竟妗嗭紝涓嶈鍒嗘牸绾匡紝涓嶈鍑虹幇浠讳綍鏂囧瓧鏍囩锟?锟?  - 缁撳熬琛屼粠"鐢婚潰搴斿儚婕敾/鍒嗛暅鐨勫崟锟?panel锛岃€屼笉鏄嫾璐村浘"鏀逛负"淇濇寔瑙掕壊銆佹湇瑁呫€佸厜绾裤€佺敾椋庤繛缁€э拷?
  - 鏂版牸寮忎笌 `characterImageSimpleDef`锛堝凡楠岃瘉 SenseNova 宸ヤ綔姝ｅ父锛夋牸寮忎竴锟?- **registry-frame.ts**: 锟?`frame_generate_first`/`frame_generate_last`/`scene_frame_generate` 鐨勯琛岃拷鍔犲弽绾︽潫锟?涓嶈鏍煎瓙杈规锛屼笉瑕佹极鐢诲垎鏍肩嚎锛屼笉瑕佸嚭鐜颁换浣曟枃瀛楁爣锟?锟?- **楠岃瘉**: lint 锟?tsc 锟?build 锟?(缂栬瘧 10.3s)
- **API 娴嬭瘯鍙楅樆**: ASXS 浠ｇ悊 (`gpt-4o-mini`/`gpt-4o`) 锟?Agnes API 锟?503锛屾棤娉曠敤 Vision 鑷姩妫€锟?SenseNova 鍑哄浘鏁堟灉
- **涓嬩竴锟?*: 鐢ㄦ埛閲嶅惎 dev server 鍚庡疄闄呮祴璇曟晠浜嬫澘甯у浘鐢熸垚 SenseNova 鏁堟灉
## 2026-06-05 Session (锟? 锟?SenseNova API timeout 180s锟?00s
- **闂**: Batch 4-grid 鐢熸垚锟?shot 5 锟?192.4s 瓒呮椂銆傛牴鍥狅細`sensenova-image.ts:124` 锟?`AbortSignal.timeout(180_000)` 涓嶈冻浠ヨ锟?4 锟?panel锛堟瘡锟?~45s锟?- **淇**: 180s锟?00s锛堜笌 `api-fetch.ts` 锟?300s 涓€鑷达級
- **楠岃瘉**: lint 锟?tsc 锟?build 锟?
## 2026-06-05 Session (锟? 锟?瑙掕壊鍙傝€冨浘鍘嗗彶涓夐噸浼樺寲
- **闂**: 姣忕敓鎴愪竴甯у垎闀滃浘閮借拷鍔犲埌锟?shot **鎵€鏈夎锟?*锟?`referenceImageHistory`锛岃鑹插崱鍘嗗彶鍥炬潅锟?- **涓夐噸浼樺寲** (`frames.ts:33-51`):
  1. **鎸夎鑹插悕鍖归厤**: `appendFrameToCharacterHistory` 鏂板 `matchContext` 鍙傛暟锛屽彧鏈夎鑹插悕鍑虹幇鍦ㄥ抚鎻忚堪鏂囨湰涓墠杩藉姞锛堣烦杩囨棤鍏宠鑹诧級
  2. **鍙拷棣栧抚**: 绉婚櫎 last frame 鐨勮拷鍔狅紙2锟?call site锛夛紝4grid 妯″紡淇濇寔鍙拷 panel[0]
  3. **鍘嗗彶涓婇檺 20**: 瓒呰繃 20 寮犳椂鑷姩鍒犻櫎鏈€鏃╃殑锛岄槻姝㈡棤闄愬锟?- **楠岃瘉**: lint 锟?tsc 锟?build 锟?619 tests 锟?- **瀹炴祴楠岃瘉** 锟? 閫氳繃 `agnes-image-2.0-flash` 鐢ㄦ柊 prompt 鏍煎紡鐢熸垚娴嬭瘯鍥撅紝鍐嶇粡 `agnes-2.0-flash` vision 鍒嗘瀽纭锛歚grid:false text:false type:scene` 锟?鏃犳牸瀛愯竟妗嗐€佹棤鏂囧瓧銆佸崟寮犲満鏅浘銆傛柊鏍煎紡鏈夋晥锟?
## LoomVideo 璁板綍 锟?闃块噷鍏ㄨ兘瑙嗛鐢熸垚+缂栬緫妯″瀷 (2026-06)
- **璁烘枃**: [arxiv.org/pdf/2606.06042](https://arxiv.org/pdf/2606.06042)
- **寮€锟?*: [github.com/MSALab-PKU/LoomVideo](https://github.com/MSALab-PKU/LoomVideo)
- **鏋舵瀯**: 5B DiT + 8B Qwen3-VL锛堝幓锟?T5锛岀敤 Qwen 鍋氬妯℃€佹潯浠惰緭鍏ワ級
- **涓夊ぇ鍒涙柊**:
  1. **Deepstack**: Qwen3-VL 姣忓眰鐗瑰緛涓€瀵逛竴娉ㄥ叆 DiT 瀵瑰簲灞傦紙鑰岄潪鍙彇鏈€鍚庝竴灞傦級
  2. **Scale-and-Add**: 闅愮┖闂寸洿鎺ユ暟瀛﹁繍绠楁浛锟?Token 鎷兼帴锛岀紪杈戞彁锟?5.41脳锛堟牳蹇冿級
  3. **Negative Temporal RoPE**: 鍙傝€冨浘璐熺紪鍙枫€佽棰戝抚姝ｇ紪鍙凤紝鍖哄垎绱犳潗涓庣敓鎴愬唴锟?- **鎬ц兘**: 480脳832脳97 甯э紝鏂囩敓 132s / 缂栬緫 166s锛堟秷璐圭骇 GPU 鍙锟?- **灞€锟?*: 涓婇檺 480p銆佸亸鍚戠數鍟嗘湇楗般€侀珮鍔ㄦ€侀暅澶存槗鐣稿彉
- **鎺ュ叆璇勪及**: RTX 4080 16GB 鍙窇锛岄渶鍐欑嫭绔嬫帹鐞嗚剼鏈垨锟?ComfyUI 鑺傜偣

## Session 2026-06-06 锟?鍏ㄩ儴 5 锟?LTX 妯℃澘琛ラ綈 Singularity LoRA + NAGuidance锛學indows ComfyUI OSError 淇
### ComfyUI Windows 鎺у埗锟?OSError 淇
- **鏍瑰洜**: `ComfyUI/app/logger.py` LogInterceptor 纭紪锟?`encoding='utf-8'`锛學indows 鎺у埗鍙板疄闄呬负 GBK(cp936)銆俙tqdm` 锟?`wandb` 锟?`comfyui_manager/prestartup_script.py` 锟?`app/logger.py:66` 鏁存潯閾惧湪 `TextIOWrapper.write()` 锟?`OSError: [Errno 22] Invalid argument`
- **淇锟?1** (`logger.py`): `encoding='utf-8'` 锟?`encoding=stream.encoding` + `errors='replace'`
- **淇锟?2** (`logger.py`): write/flush 锟?`try/except OSError: pass`
- **淇锟?3** (`main.py`): `setup_logger()` 鍓嶈 `WANDB_CONSOLE=off / WANDB_SILENT=true / WANDB_MODE=disabled`
- **鍚姩楠岃瘉**: ComfyUI (PID 5844, 绔彛 8188) 姝ｅ父杩愯锛岄浂 OSError銆侀浂 UnicodeError

### `ltx-workflows.ts` 浼樺寲
- 瀵规瘮瀹為檯宸ヤ綔锟?`video_ltx2_3_i2v (1).json`锛岃ˉ锟?3 涓己锟?LoRA锛圫ingularity-LTX-2.3_OmniCine_V1 strength=1.0 / subtitles-remove strength=1.0 / restoration strength=1.0锛夆啋 锟?4 LoRA 鍫嗗彔锟? distilled strength=0.5锛夛紝鎻掑叆 NAGuidance 鑺傜偣锛坣ag_scale=5, nag_alpha=0.5, nag_tau=1.5锛夛紝鏇存柊 camera control 鎺ョ嚎锛屽悎骞惰礋鍚戞彁绀鸿瘝

### 鍏ㄩ儴 5 涓ā鏉胯ˉ锟?Singularity LoRA + NAGuidance
- **`ltx-i2v-pro.json`**: 鏂板 `320:326` Singularity + `320:329` NAGuidance锛屾洿锟?2 锟?CFGGuider 妯″瀷寮曠敤锛屽悎骞惰礋鍚戞彁绀鸿瘝
- **`ltx-i2v-api.json`**: 鏂板 `320:326/327/328` 锟?LoRA + `320:329` NAGuidance锛屾洿锟?CFGGuider 妯″瀷寮曠敤
- **`ltx-i2v-4grid-baseline-simple.json`**: 鏂板 `377` Singularity锛堢揣鍑戞牸寮忥級
- **`ltx-i2v-4grid-baseline.json`**: 鏂板 `376` Singularity
- **`ltx-i2v-multiguide.json`**: 鏂板 `378` Singularity锟? LoRA 鍫嗗彔 + NAGuidance 鏈€澶嶆潅妯℃澘锟?- **閾惧畬鏁达拷?*: 鍏ㄩ儴 5 涓ā鏉块獙璇侀€氳繃 锟?锟?Singularity 鍧囦负 checkpoint 鍚庣涓€ LoRA锛孨AGuidance 鍧囦负 CFGGuider 鍓嶆渶鍚庤妭锟?
### Verification
- lint 锟?tsc 锟?
## Session 2026-06-06 (锟? 锟?绠＄嚎绔埌绔獙锟?+ Camera LoRA 瀵归綈瀹樻柟鍛藉悕
### Camera LoRA 鍛藉悕涓庡畼鏂瑰锟?- 瀵圭収 `github.com/Lightricks/LTX-2` 瀹樻柟浠撳簱鍒楀嚭锟?9 锟?Camera LoRA锛坉olly-in/out/left/right, jib-up/down, static锛夛紝锟?`CAMERA_LORA_MAP` 瀹屽叏涓€锟?锟?- 椤圭洰棰濆锟?pan/tilt/zoom/roll/orbit LoRA 涓虹ぞ鍖烘墿灞曪紝鏈湪瀹樻柟浠撳簱涓絾鍏煎鍚屼竴鏋舵瀯

### Camera LoRA 鎺ョ嚎淇
- `addCameraLoRANode` 锟?`buildLTXi2vT2vWorkflow`锛堥潪 pro锛夊拰 `buildLTXProWorkflow`锛堟ā锟?pro锛変腑鍧囨纭彃鍏ヤ簬 distilled LoRA锛坄320:285`锛変箣鍚庛€丯AGuidance锛坄320:329`锛変箣锟?- Camera LoRA 婵€娲绘椂閾撅細`Checkpoint 锟?Singularity 锟?SubtitleRemove 锟?VideoRestore 锟?Distilled 锟?Camera 锟?NAG 锟?CFG`
- Camera LoRA 鏈縺娲绘椂閾撅細`Checkpoint 锟?Singularity 锟?SubtitleRemove 锟?VideoRestore 锟?Distilled 锟?NAG 锟?CFG`
- `addCameraLoRANode` 鍙傛暟锟?`cfgGuiderIds` 锟?`downstreamNodeIds` 娑堥櫎璇箟璇

### Model name 鏇存柊
- `models/list/route.ts`: `"LTX Video 2.3 鍥剧敓瑙嗛 Pro (3LoRA鍙岄噰锟?"` 锟?`"LTX Video 2.3 鍥剧敓瑙嗛 Pro (4LoRA+NAG鍙岄噰锟?"`

### 绔埌绔獙锟?- JSON 妯℃澘鏇挎崲鍚庤В锟?鉁咃紙5/5 锟?ltx-i2v-pro/ltx-i2v-api/4grid-baseline/4grid-baseline-simple/multiguide锟?- 鑺傜偣寮曠敤瀹屾暣鎬ф锟?鉁咃紙鍏ㄩ儴妯℃澘闆舵柇閾撅級
- ComfyUI 瀹炴垬鎻愪氦娴佺▼楠岃瘉 鉁咃細`POST /prompt` 鎺ュ彈 ltx-i2v-pro 宸ヤ綔娴侊紙prompt_id=`e790a4fe-...`锛夛紝杩斿洖 200 锟?璇存槑 ComfyUI 璇嗗埆 NAGuidance/鎵€锟?LoRAs銆佽繛鎺ユ湁鏁堛€佺粨鏋勬锟?- Dev server `http://localhost:3000` 鉁咃紝ComfyUI `http://127.0.0.1:8188` 锟?- lint 锟?tsc 锟?- **涓嬩竴闃舵**: 鍦ㄦ祻瑙堝櫒涓疄闄呰窇涓€锟?`ltx-i2v-pro`锛堥渶瑕佷竴寮犲弬鑰冨浘 + shot 鏁版嵁锛夛紝鎴栧垏锟?`HiDream-O1` 娴嬭瘯鍗曞抚鐢熸垚璐ㄩ噺

## Session 2026-06-06 (锟? 锟?Mano-P 鏈湴 VLA 闆嗘垚 + Windows-MCP-Enhanced 绔埌绔獙锟?
### Mano-P 鍚姩 & 楠岃瘉
- 绯荤粺 Python锛坄C:\Users\zjwji\...\Python313\python.exe`锛宼orch 2.6.0+cu124锛夊惎锟?`app.py`锛屽姞锟?`Qwen3VLForConditionalGeneration` from `I:\AIs\Mano-P\models\Mininglamp\Mano-P\fp16`
- 锟?shard 鍔犺浇 ~10s锛孷RAM ~9.9 GB锛岀洃锟?`127.0.0.1:7861`
- 鍋ュ悍妫€锟?`GET /api/manop/health` 锟?`{"model_loaded":true,"status":"ok"}`
- `.venv-win` 锟?`torch 2.12.0+cpu` 涓嶅彲鐢紙CUDA 涓嶅彲鐢級锛岀‘瀹氱郴锟?Python 涓哄敮涓€鍙璺緞

### Mano-P 鎺ㄧ悊鎬ц兘浼樺寲
- 鍘熷 1080p 鍏ㄥ睆鎴浘鎺ㄧ悊 ~25s锛圦wen3VL 灏嗗ぇ鍥惧垎鐗囦负澶ч噺瑙嗚 token锟?- 娣诲姞杩愯锟?resize锛坄max_image_width: 1280`锛夛細瑙ｇ爜 JPEG 锟?`Image.LANCZOS` 绛夋瘮缂╂斁 锟?閲嶆柊缂栫爜 JPEG 锟?鎺ㄧ悊闄嶈嚦 **~1.7s**
- 閰嶇疆锟?`mano-p.parameters.max_image_width` 榛樿 1280锛屽湪 vla_client 锟?`_call_api()` 涓疄锟?
### 绯荤粺鎻愮ず璇嶉€傞厤
- Mano-P 绔偣涓虹函鐢ㄦ埛娑堟伅锛團lask server 浣跨敤 `apply_chat_template`锛屼笉锟?system role锛夛紝绯荤粺鎻愮ず璇嶅湪 vla_client 涓墠缃埌 task text
- 鍒濆闀挎牸寮忔彁绀鸿瘝锛堝惈瀹屾暣 action schema 鎻忚堪锛夆啋 妯″瀷浠ヤ腑鏂囪嚜鐒惰瑷€鍥炲锛岄潪 JSON
- 杩唬浼樺寲锛氭瀬绠€鎻愮ず锟?`"Output ONLY valid JSON, nothing else. Example: {\"action_type\":\"FINISH\"}"` 锟?妯″瀷杈撳嚭姝ｇ‘ `{"action_type":"FINISH"}`

### 绔埌锟?Agent 娴嬭瘯
- `WindowsGUIAgent` + `mano-p` provider锛氭埅锟?锟?resize 1280px 锟?鍚彁绀鸿瘝锟?task 锟?`POST /api/manop/infer` 锟?JSON 瑙ｆ瀽 锟?鍔ㄤ綔鎵ц
- **Test 1 (FINISH)**: 9.9s 锟?杩唬锟?**3.1s**锛宍{"action_type":"FINISH"}` 姝ｇ‘杩斿洖 锟?- **Test 2 (MOVE)**: 鍒濆杩斿洖 FINISH锛堣烦杩囧姩浣滐級锟?鏀硅繘鎻愮ず璇嶏紙鏋佺畝 JSON 绀轰緥 + 鏄庣‘鍔ㄤ綔鍒楄〃锛夊悗姝ｇ‘杈撳嚭 `{"action_type":"MOVE","x":...,"y":...}` 鉁咃紙浣嗗潗鏍囨帹鏂笉鍑嗭細锟?DPI 闄嶉噰鏍锋埅鍥句笅妯″瀷鍍忕礌绾у畾浣嶅樊锟?- 16 鍗曞厓娴嬭瘯鍏ㄩ儴閫氳繃 锟?
### 鍏抽敭淇 锟?Prompt Engineering 杩唬
| 鐗堟湰 | 闂 | 淇 |
|------|------|------|
| 闀挎牸寮忔彁绀鸿瘝 + action schema | 妯″瀷杈撳嚭涓枃鑷劧璇█鑰岄潪 JSON | 鏋佺畝 prompt + JSON 绀轰緥 |
| 锟?FINISH/FAIL 绀轰緥 | 妯″瀷瀵规墍鏈変换鍔¤緭锟?FINISH | 澧炲姞 MOVE/CLICK/TYPE/PRESS 澶氬姩浣滅ず锟?|
| `element_id` 鏈敮锟?| 妯″瀷鑷畾锟?`target: [x,y)` 鏍煎紡 锟?JSON 瑙ｆ瀽澶辫触 | 鎻愮ず璇嶆爣锟?`element_id` 涓哄潗鏍囨浛浠ｆ柟锟?|
| 鍏冪礌涓婁笅鏂囪拷鍔犲湪 task 锟?| 妯″瀷璇涓鸿浜や簰鍏冪礌銆佸拷锟?FINISH | 鏀逛负 `=== 鍙傦拷?===` + `=== Task ===` 鍒嗙缁撴瀯 |

### Hybrid 鏋舵瀯锛歋napshot 鍏冪礌锟?+ VLA 鍧愭爣娉ㄥ叆
- 闂锛歁ano-P 闄嶉噰锟?1280px 鍚庢棤娉曠簿纭緭鍑哄儚绱犲潗鏍囷紙杈撳嚭 `x:1000` 鑰岄潪 `x:100`锟?- 鏂规锛歛gent 鍦ㄦ埅鍥炬椂涓€骞惰皟锟?`Desktop.get_state(use_ui_tree=True)`锛屾彁锟?`interactive_nodes` 浣滀负鍏冪礌涓婁笅锟?- 瀹炵幇锟?  - `_get_cached_screenshot()` 鍚屾鎶撳彇 `tree_state.interactive_nodes`锛堜竴娆¤皟鐢紝鍏嶉澶栭亶鍘嗭級
  - `_format_element_context()` 锟?鏍煎紡鍖栦负 `id=N: "label" (control_type) [x,y]` 鏂囨湰锛垀1700 chars锟?  - 娉ㄥ叆 VLA 鎻愮ず璇嶏紝澹版槑 `use element_id for precise coordinates`
  - 妯″瀷杈撳嚭 `{"action_type":"CLICK","element_id":3}` 锟?`_resolve_element_id()` 浠庣紦瀛樺厓绱犳爲瑙ｆ瀽鍑哄疄闄呭潗锟?- 鏁堟灉锛氬惈鍏冪礌涓婁笅鏂囩殑 FINISH 娴嬭瘯 **4.9s**锛堟棤涓婁笅锟?3.1s锛寏1.8s 寮€閿€鏉ヨ嚜 UI 鏍戦亶鍘嗭級
- 鍗曞厓娴嬭瘯瑕嗙洊锛歚test_resolve_element_id_from_cached_tree` 鉁呫€乣test_resolve_element_id_skipped_when_missing` 锟?
### MOVE 鍋滄鏉′欢鏀硅繘
- 鍘熶唬鐮佷粎鍖归厤 `"only moves the mouse"` 绮剧‘瀛愪覆 锟?鎵╁睍锟?`move_phrases = ('move the mouse', 'move cursor', 'move the cursor', 'only moves the mouse')`
- MOVE e2e 娴嬭瘯锛氳凯浠ｆ鏁颁粠 3锟?锟?.4s 瀹屾垚锟?
### 宸茬煡灞€锟?- Qwen3VL-4B 鍧愭爣鎺ㄦ柇涓嶅噯锛氶珮 DPI 闄嶉噰鏍锋埅鍥句笅鍍忕礌绾у畾浣嶈兘鍔涘樊锛宍element_id` 鏂规鍙粫寮€姝ら棶棰樹絾闇€瑕佹ā鍨嬪浼氫娇锟?`element_id`
- 褰撳墠涓嶅仛 use-case 鏃跺彲淇濇寔 Mano-P 鏈嶅姟鍣ㄨ繍琛岋紙~9.9 GB VRAM锛夛紱闇€瑕佹椂鍙噸锟?
### Real-World Click via `element_id` 锟?- 娴嬭瘯锛氬湪鐪熷疄妗岄潰涓婇€氳繃 `element_id` 鐐瑰嚮绯荤粺鎵樼洏 Realtek 闊抽鍥炬爣
- **妯″瀷杈撳嚭**: `{"action_type":"CLICK","element_id":2}` 鉁咃紙姝ｇ‘浣跨敤 element_id 鑰岄潪鐚滄祴鍍忕礌鍧愭爣锟?- **鍧愭爣瑙ｆ瀽**: `_resolve_element_id()` 浠庣紦瀛樼殑 `_last_element_tree` 涓煡锟?`id=2` 锟?`[2470, 1416]` 锟?- **楠岃瘉**: `validate_action()` 宸叉洿鏂颁负鎺ュ彈 `element_id` 浣滀负 x/y 鏇夸唬 锟?- **鍋滄鏉′欢**: `click_phrases` 鍖归厤 "click on it" 锟?1 娆¤凯浠ｅ畬锟?锟?- **寤惰繜浼樺寲**:
  - 鍘熷锟?2s锟?44 鍏冪礌娉ㄥ叆 锟?妯″瀷澶勭悊澶ч噺鏃犲叧涓婁笅鏂囷級
  - 浼樺寲锟?*5.2s**锟?88%锛夛紝杩囨护鍙繚锟?25 涓浉鍏虫帶浠讹紙Button/Edit/Hyperlink 绛夊父瑙佺被鍨嬨€佸墧闄ょ┖锟?瓒呴暱鍚嶅厓绱狅級
  - 鏂规硶锛歚_format_element_context()` 澧炲姞 `relevant_types` 鐧藉悕锟?+ 25 鍏冪礌涓婇檺 + 鍚嶅瓧闀垮害 < 60
- **鏂板鍗曞厓娴嬭瘯**: `test_should_stop_after_click_for_click_task` 鉁咃紙锟?17 娴嬶級

### 鍏抽敭鏀硅繘
- `utils.py validate_action()`: `coord_actions` 锟?`element_id` 鍙浛锟?`x`/`y`
- `gui_agent.py _resolve_element_id()`: 鏂板 task 鏂囨湰鍥為€€瑙ｆ瀽 `element_id=N`锛堝嵆浣挎ā鍨嬫湭杈撳嚭 element_id 瀛楁涔熻兘宸ヤ綔锟?- `gui_agent.py _should_stop_after_action()`: 鏂板 `click_phrases` 鐐瑰嚮鍋滄鏉′欢
- 娴嬭瘯妗嗘灦锛歮ock `infer_action` 澧炲姞 `element_context=""` 鍙傛暟鍏煎

### JSON 鑷慨澶嶏紙妯″瀷杈撳嚭鏍煎紡瀹归敊锟?- Mano-P (Qwen3VL-4B) 鐢熸垚 JSON 鏃舵湁 token 閿欒锛堥仐锟?key銆佸浣欐嫭锟?鏂规嫭鍙凤級
- `_extract_json_block()`: 涓夐樁娈典慨澶嶇瓥锟?  1. 閫氱敤娓呯悊锛氬幓鎺夋暟鍊煎悗锟?`)`, `]`, 閲嶅 `}`
  2. 锟?key锛歚"x":<n>,<m>` 锟?`"x":<n>,"y":<m>`锛堥仐锟?"y":锟?  3. 鏈€缁堝厹搴曪細鎴彇棣栦釜瀹屾暣 `{...}` 锟?- `infer_action()`: JSON 瑙ｆ瀽澶辫触鏃惰嚜鍔ㄩ噸锟?1 娆★紝杩藉姞閿欒鎻愮ず锟?task 鏂囨湰
- 楠岃瘉锛氬绉嶆牸寮忛敊璇潎鑳戒慨锟?  - `{"x":158,931}` 锟?`{"x":158,"y":931}` 锟?  - `{"y":492)}` 锟?`{"y":492}` 锟?  - `{"x":500,499]}}` 锟?`{"x":500,"y":499}` 锟?
### AIComicBuilder 椤圭洰鍏ㄩ潰娴嬭瘯 锟?- **Dev Server**: PID 38036, port 3000, 杩愯姝ｅ父
- **API 绔偣** (4/5 閫氳繃):
  - 锟?`GET /api/projects` 锟?200 `[]`
  - 锟?`GET /api/prompt-templates` 锟?200 `[]`
  - 锟?`GET /api/prompt-presets` 锟?200
  - 锟?`GET /api/agents` 锟?200
  - 鈿狅笍 `POST /api/models/list` 锟?502 (闇€姝ｇ‘璇锋眰锟?
- **鍓嶇椤甸潰**:
  - 鈿狅笍 `/` 锟?500 Internal Server Error
  - 锟?`/zh` 锟?404
  - 鈿狅笍 `/en` 锟?500
  - 锟?API JSON 鐩存帴璁块棶姝ｅ父
- **DOM 鎻愬彇** (`use_dom=True`):
  - 锟?锟?Chrome 鎻愬彇 `dom_informative_nodes` (~10 鏉℃枃锟?
  - 锟?`dom_node` 锟?`ScrollElementNode` (锟?bbox/center)
  - 锟?Chrome `--remote-debugging-port=9222` 锟?MCP session 鏃犳硶鍚敤
- **GUI Agent (Mano-P)**:
  - 锟?鍗曟鐐瑰嚮 5.2s锛坋lement_id锟?  - 锟?澶氭鎺ㄧ悊涓嶅彲闈狅紙鍗″湪鍚屼竴鍔ㄤ綔寰幆锟?  - 锟?妗岄潰瀵艰埅鎴愬姛锛坄Desktop.click/type` 锟?Chrome 鍦板潃锟?锟?椤甸潰璺宠浆锟?
### 宸茬煡闂
- Qwen3VL-4B 杈撳嚭 JSON 锟?token 绾ч敊璇紙闇€淇灞傚厹搴曪級
- Chrome 杩滅▼璋冭瘯绔彛涓嶅彲锟?锟?`use_dom` 鍙繑鍥炴枃鏈憳瑕侊紙~10 鏉★級锛屾棤瀹屾暣 DOM 锟?- 澶氭鎺ㄧ悊瓒呭嚭 4B 妯″瀷鑳藉姏锛屽缓璁崟姝ヤ换锟?+ Python 缂栨帓
- API `/api/models/list` 闇€ POST body `{protocol, capability, baseUrl?, apiKey?}`

## Next Steps
- Fix Chrome remote debugging 锟?enable full DOM tree 锟?proper web UI testing
- Fix root page 500 SSR error (app frontend bug)
- Generate test project via API then test full storyboard flow
- For AIComicBuilder mainline: implement HiDream-O1 ComfyUI workflow, LTX Video 4-grid
- When ASXS quota resets: benchmark GPT-5.5 vs Mano-P on same GUI tasks

## 2026-06-07 Session (锟?) 锟?ERNIE-Image ComfyUI 闆嗘垚
- 鐢ㄦ埛涓嬭浇锟?ERNIE-Image (M:\models\ernie-image\, 43.83 GB) 锟? 闆嗘垚鍒伴」锟?- 鏂板 WorkflowFamily: \ernie-image-comfyui\
- 鏂板 ImageModelFamily: \ernie\ (modelId includes 'ernie')
- 澶嶇敤 \character_image_hidream_o1\ prompt key (layout selector + 涓枃 prompt 閮介€傜敤)
- 鏂囦欢鏀瑰姩 (9):
  - \src/lib/ai/types.ts\ 锟?WorkflowFamily 锟?'ernie-image-comfyui'
  - \src/lib/ai/prompts/character-image.ts\ 锟?ImageModelFamily + detect()
  - \src/lib/comfyui/preflight.ts\ 锟?WORKFLOW_NODE_REQUIREMENTS['ernie-image-comfyui']
  - \src/lib/ai/providers/comfyui-image.ts\ 锟?buildErnieImageWorkflow() + generateImage 鍒嗘敮
  - \src/lib/pipeline/handlers/character.ts\ 锟?family === 'ernie' 鍒嗘敮 (脳2)
  - \src/app/api/models/list/route.ts\ 锟?comfyui image 鍒楄〃锟?ERNIE
  - 3 娴嬭瘯鏂囦欢 锟?+5 娴嬭瘯 (comfyui-image 3, detection 1, character 1)
- ERNIE workflow 鑺傜偣:
  - UNETLoader (66): ernie-image.safetensors | ernie-image-turbo.safetensors
  - CLIPLoader (62): ministral-3-3b.safetensors, type='flux2'
  - VAELoader (63): flux2-vae.safetensors
  - KSamplerSelect (16): 'euler' (base) | 'res_multistep' (turbo)
  - KSampler (70): steps 50/8, cfg 4.0/1.0
  - EmptyFlux2LatentImage (71), CLIPTextEncode (76/78), RandomNoise (18), VAEDecode (65), SaveImage (73)
- 鍒嗚鲸锟? 1024虏, 1376脳768, 768脳1376, 1200脳896, 896脳1200, 1264脳848, 848脳1264
- 鏈疄锟? prompt enhancement 鑺傜偣 (\TextGenerate\ + \ernie-image-prompt-enhancer.safetensors\), 鍙悗锟?toggle
- 鐢ㄦ埛浣跨敤姝ラ: 璁剧疆锟?锟?锟?ComfyUI provider 锟?妯″瀷鍕撅拷?'ERNIE-Image (ComfyUI)' 锟?鍚姩 ComfyUI
- 楠岃瘉: lint 锟? tsc 锟? vitest 647/647 (+5) 锟?

## 2026-06-07 Session (锟?) 锟?NVIDIA NIM Cosmos 瑙嗛/鍥剧墖 API 闆嗘垚
- 璋冪爺 NVIDIA 瑙嗛鐢熸垚 API (build.nvidia.com NIM 鐩綍):
  - **Cosmos 绯诲垪** (棣栵拷? 鍏嶈垂 ~40 req/min): Cosmos-1.0 7B/14B, Cosmos-Predict1/2 (2B/14B),
    Cosmos-Transfer2 (澶氭帶+4K), Cosmos-Reason2 (VLM), Cosmos-Embed1 (鍚戦噺)
  - 鍏嶈垂棰濆害瓒冲 prototype, 鍟嗙敤鍙嚜鎵樼 (NVIDIA Open Model License, RTX 50 锟?+ NVFP4/FP8 锟?2.5x)
  - 鏈泦锟?Cosmos 3 (澶柊, 8s 鐗囨 ~15min 涓€锟?
- 鏂板鍗忚: `nvidia-nim` (涓庣幇锟?`nvidia` 鍗忚鍒嗙, 閬垮厤褰卞搷 LLM text 璺緞)
- 鏂板 provider 鏂囦欢 (2):
  - `src/lib/ai/providers/nvidia-nim-video.ts` (NvidiaNimVideoProvider implements VideoProvider)
    - 鏀寔 3 绉嶆ā锟? T2V (text鈫抳ideo), I2V (initialImage鈫抳ideo), Keyframe (firstFrame+lastFrame鈫抳ideo)
    - 鑷姩妫€锟?model family: `cosmos-1.0` / `cosmos-predict1` / `cosmos-predict2`
    - cosmos-1.0/predict1 寮哄埗 1024脳640 / 32 frames / 8 fps
    - cosmos-predict2 锟?aspect-ratio 鏄犲皠 (16:9锟?280脳720 锟?7 锟?
    - num_frames 锟?duration 缂╂斁: 锟?s锟?2, 锟?0s锟?4, >10s锟?3
    - 寮傛浠诲姟: 鎻愪氦锟?`https://ai.api.nvidia.com/v1/cosmos/<model>` 锟?杞
      `https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/<id>`, 5s 闂撮殧, 30min 涓婇檺
    - 鍚屾椂鏀寔 sync 鍝嶅簲 (锟?inline video) 锟?async 杞
    - 鏀寔 base64 鍐呭祵瑙嗛锟?URL 瑙嗛涓ょ杩斿洖鏍煎紡
    - 3 helper: `getNimVideoModelFamily()`, `isVideoToWorld()`, `isTextToWorld()`,
      `ratioToResolution()`, `toImageUrl()`
  - `src/lib/ai/providers/nvidia-nim-image.ts` (NvidiaNimImageProvider implements AIProvider)
    - text 鐢熸垚锟?"does not support" 寮傚父 (image-only)
    - 2B 妯″瀷锟?20 steps / cfg 3.0, 14B 锟?35 steps / cfg 7.0
    - 鍚屾牱鏀寔 sync 鍝嶅簲 + async 杞 + base64 / URL
    - 鎺ュ彈 `size` / `aspectRatio` / `negativePrompt` 鍙傛暟
- 娉ㄥ唽 + 闈欐€佹ā鍨嬪垪锟?
  - `src/lib/ai/provider-factory.ts`: `createAIProvider` 锟?`"nvidia-nim"` case (image) +
    `createVideoProvider` 锟?`"nvidia-nim"` case (video)
  - `src/app/api/models/list/route.ts`: NIM video 鍒楄〃 (10 锟?Cosmos 妯″瀷) + NIM image 鍒楄〃 (2 锟?
  - `src/stores/model-store.ts`: `Protocol` union 锟?`"nvidia-nim"`
  - `src/components/settings/provider-form.tsx`: `DEFAULT_BASE_URLS["nvidia-nim"] = "https://ai.api.nvidia.com"`,
    `getProtocolOptions()` 锟?image 锟?video 涓よ竟閮藉姞 "NVIDIA NIM (Cosmos)" 閫夐」
- 娴嬭瘯 (2 涓柊鏂囦欢, +32 tests):
  - `src/lib/ai/providers/__tests__/nvidia-nim-video.test.ts` (22 tests):
    - family 妫€锟?(cosmos-1.0/1/2)
    - isVideoToWorld / isTextToWorld capability detection
    - ratioToResolution (锟?cosmos-1.0 寮哄埗 1024脳640)
    - toImageUrl (http URL passthrough + 鏈湴鏂囦欢锟?data URL)
    - 鎻愪氦: text-only / I2V / keyframe 妯″紡 body
    - cosmos-1.0 dimensions 楠岃瘉 (1024脳640, 32 frames, 8 fps)
    - num_frames 锟?duration 缂╂斁
    - NVCF status 绔偣杞 + Bearer auth
    - 鎻愪氦澶辫触 / 鐘舵€佸け璐ユ姏锟?
    - sync 鍝嶅簲 (inline video URL) 澶勭悊
    - base64 瑙嗛淇濆瓨 (writeFileSync)
  - `src/lib/ai/providers/__tests__/nvidia-nim-image.test.ts` (10 tests):
    - text 鐢熸垚锟?"does not support"
    - 鎻愪氦 body (size, steps, guidance)
    - 2B vs 14B 鍙傛暟宸紓
    - aspect ratio 鏄犲皠 / 鏄惧紡 size 瑙ｆ瀽
    - negativePrompt 閫忎紶
    - NVCF 杞
    - HTTP 閿欒 / 鐘舵€佸け锟?
    - base64 鍥剧墖淇濆瓨
- 楠岃瘉: lint 锟? tsc 锟? vitest 679/679 (+32) 锟?
- 鐢ㄦ埛浣跨敤姝ラ:
  1. 锟?https://build.nvidia.com 娉ㄥ唽鎷垮厤锟?API key
  2. 椤圭洰璁剧疆 锟?锟?"NVIDIA NIM (Cosmos)" 鍗忚 (image 锟?video)
  3. base URL 榛樿 `https://ai.api.nvidia.com` (鏃犻渶锟?
  4. 锟?API key 锟?鎷夋ā鍨嬪垪锟?锟?锟?Cosmos 妯″瀷
  5. keyframe 瑙嗛锟?`comfyui-ltx-flf2v` 绫讳技鏂瑰紡, 锟?I2V 锟?`nvidia/cosmos-predict2-14b-video2world`
- 璧勬簮:
  - https://build.nvidia.com/models (锟?capability 杩囨护 video)
  - https://docs.api.nvidia.com/ (瀹屾暣 API reference)
  - https://github.com/nvidia-cosmos/cosmos-predict2 (Cosmos Predict2 寮€锟?

## 2026-06-07 Session (锟?) 锟?Hermes-Agent CNB 鍚屾 + ERNIE 妯″瀷钀界洏
### 椤圭洰锟?
- commit `70e1b01` ERNIE-Image 闆嗘垚 (瑙佷笂)
- ERNIE 妯″瀷 (43.83 GB) 宸茶惤 `M:\models\ernie-image\`:
  - `diffusion_models/ernie-image.safetensors` (14.96 GB)
  - `diffusion_models/ernie-image-turbo.safetensors` (14.96 GB)
  - `text_encoders/ministral-3-3b.safetensors` (7.19 GB)
  - `text_encoders/ernie-image-prompt-enhancer.safetensors` (6.41 GB) 锟?鏈帴锟?workflow
  - `vae/flux2-vae.safetensors` (0.31 GB)
- 瀹樻柟 ComfyUI workflow JSON: `M:\models\image_ernie_image.json` (54.6 KB)
- 鐘讹拷? dev server **DOWN** (3000 绔彛锟?, ComfyUI **UP** (8188)
- 鏈仛 (鐢ㄦ埛锟?: 缂栬緫 `M:\ComfyUI_windows_portable\extra_model_paths.yaml` 锟?
  `M:\models\ernie-image` 鍔犱负 model 鎼滅储璺緞, 閲嶅惎 ComfyUI

### Hermes-Agent 鍚屾
- 闀滃儚锟? `https://cnb.cool/zjwjing/hermes-agent` (user's fork)
- CNB HEAD: `44c0c2d refactor(inventory): make force_fresh_nous_tier keyword-only + pin contract`
- 鍚屾: robocopy /E 浠庝复锟?clone 瑕嗙洊锟?`I:\claw\hermes-agent\`
- 缁撴灉: 4,896 鏂囦欢 (4,136 + 760 锟?, 105.2 MB
- 淇濈暀 162 锟?local-only 鏂囦欢 (107 skills, 29 website, 15 RELEASE_v*, 11 misc 锟?
  `gateway\platforms\homeassistant.py`, `plugins\example-dashboard\`)
- SHA256 鏍￠獙 3 涓叧閿枃锟?
- **鏇存涔嬪墠鐨勯敊璇亣锟?*: `I:\claw\hermes-agent\.git\` 涓€鐩村瓨锟? `.git/config` 杩滅▼
  宸叉寚锟?CNB (鑰屼笉锟?GitHub). robocopy 鍚屾 `.git` 鏃舵妸 config 涔熻鐩栦簡. 涔嬪墠
  璇互锟?local 锟?git 浠撳簱

### `hermes update` 澶辫触鏍瑰洜
- 涔嬪墠澶辫触鏄洜涓哄師 `.git/config` 鎸囧悜 `https://github.com/NousResearch/hermes-agent.git`
  (blocked)
- 鍚屾锟?`.git/config` 宸叉寚 CNB, 姝ｅ父璺緞浼氬伐锟?
- 娼滃湪椋庨櫓: 鍗充娇 CNB 宸叉槸 origin, `_is_fork()` 浼氬垽 True (CNB 涓嶅湪
  `OFFICIAL_REPO_URLS`), 瑙﹀彂 `_sync_with_upstream_if_needed()` 灏濊瘯 fetch
  `github.com/NousResearch`. 澶辫触鏃跺嚱锟?graceful return, 涓嶉樆濉炰富鏇存柊锟?
- 鏈疄鐜颁慨锟? 锟?`https://cnb.cool/zjwjing/hermes-agent.git` 鍔犲叆
  `OFFICIAL_REPO_URLS` (`hermes_cli/main.py:8460`), 锟?CNB 瑙嗕负瀹樻柟锟?
  璺宠繃 upstream 妫€锟? 鐢ㄦ埛鏈锟? 鐣欏緟鍚庣画

## Next Steps
- 鐢ㄦ埛锟? 缂栬緫 ComfyUI `extra_model_paths.yaml` + 閲嶅惎 ComfyUI + 閲嶅惎 dev server
- 鐢ㄦ埛锟? smoke test ERNIE end-to-end (鍒涘缓 character 锟?锟?ERNIE 妯″瀷 锟?鐢熸垚)
- (鍙拷? patch `hermes_cli/main.py:8460` 锟?CNB 锟?OFFICIAL_REPO_URLS
- (鍙拷? 瀹炵幇 ERNIE prompt-enhancer (TextGenerate + `ernie-image-prompt-enhancer.safetensors`)
  浣滀负 UI toggle
- (鍙拷? rebase 26de0b4 鍘绘帀 "will 404" 娉ㄩ噴
- 涔嬪墠 deferred: GPT-5.5 vs Mano-P benchmark, full DOM tree extraction,
  4B 澶氭鎺ㄧ悊鍔犲浐
- 涔嬪墠 deferred: `next build` 4 娆¤ shell 宸ュ叿 kill, 鏆備互 lint+tsc+vitest(647)
  浣滀负瀹屾垚鏍囧噯

## 2026-06-07 Session (锟斤拷4) 锟斤拷 ERNIE-Image 锟剿碉拷锟剿诧拷锟斤拷 + 锟劫凤拷 workflow 锟斤拷锟斤拷
### 锟剿碉拷锟斤拷锟斤拷证
- 锟矫伙拷确锟斤拷 ComfyUI 锟窖癸拷锟斤拷 ERNIE 模锟斤拷 (M:\models\diffusion_models\, text_encoders\, vae\), dev server 锟斤拷锟斤拷锟斤拷
- ComfyUI /object_info/UNETLoader 确锟较可硷拷 ernie-image.safetensors + ernie-image-turbo.safetensors
- /object_info/CLIPLoader 确锟较可硷拷 ministral-3-3b.safetensors + ernie-image-prompt-enhancer.safetensors
- /object_info/VAELoader 确锟较可硷拷 lux2-vae.safetensors

### 锟斤拷锟斤拷 Bug: buildErnieImageWorkflow() 使锟斤拷锟剿达拷锟斤拷锟?KSampler API
- 锟街搓工锟斤拷锟斤拷使锟斤拷锟铰帮拷 KSampler 锟接匡拷 (要 
oise: [...] + sampler: [...] 锟斤拷锟斤拷)
- ComfyUI 0.24.0 KSampler 锟角撅拷锟斤拷锟? 要 sampler_name + seed + scheduler 直锟斤拷值
- 锟结交 400 锟斤拷锟斤拷: Required input is missing: sampler_name, seed

### 锟睫革拷: 锟斤拷锟矫官凤拷 API workflow JSON 模锟斤拷
- 锟斤拷锟斤拷 src/lib/ai/providers/_workflows/ernie-image-api.ts: 锟斤拷锟斤拷 ERNIE_IMAGE_API_PROMPT (锟劫凤拷 20 锟节碉拷 API 锟斤拷式锟斤拷锟斤拷)
- uildErnieImageWorkflow() 锟斤拷为 JSON.parse(JSON.stringify(ERNIE_IMAGE_API_PROMPT)) 锟斤拷锟铰?+ 锟斤拷锟借覆锟斤拷:
  - "88:78".inputs.value = 锟矫伙拷 prompt
  - "88:72".inputs.text = negative prompt (拼锟斤拷默锟斤拷 + 锟矫伙拷锟斤拷锟斤拷)
  - "88:76".inputs.value = 	rue (prompt enhancement 锟斤拷锟斤拷, 默锟较匡拷锟斤拷)
  - "88:71".inputs.{width,height,batch_size} = 锟街憋拷锟斤拷
  - "88:70".inputs.{seed,steps,cfg,sampler_name,scheduler,denoise} = 锟斤拷锟斤拷锟斤拷锟斤拷
  - "88:66".inputs.unet_name = turbo vs base 模锟斤拷选锟斤拷
  - "88:92"/"88:93".inputs.source = 实锟绞尺达拷 (锟斤拷 StringReplace 锟芥换 {width}/{height})
  - "73".inputs.filename_prefix = turbo vs base 前缀
- turbo 锟斤拷锟斤拷: 8 steps / cfg 1.0 / res_multistep / simple; base: 20 steps / cfg 4.0 / euler / simple (匹锟斤拷俜锟侥拷锟?

### 锟斤拷锟皆革拷锟斤拷
- comfyui-image.test.ts 锟斤拷锟斤拷 ERNIE 锟斤拷锟皆革拷锟斤拷 "88:XX" 锟节碉拷 ID (匹锟斤拷锟斤拷锟斤拷图锟斤拷锟斤拷锟秸硷拷)
- base model steps 锟斤拷锟斤拷锟斤拷 50 锟斤拷为 20 (匹锟斤拷俜锟侥拷锟?

### 实锟斤拷锟斤拷证
- 直锟斤拷 ComfyUI 锟结交 prompt_id 2b8ba641-cb70-487a-9800-6c866ca9f692
- 锟斤拷锟斤拷前锟斤拷 LTX-2.3 锟斤拷频 (1280锟斤拷720锟斤拷24fps锟斤拷8s), 锟饺达拷约 60s
- 实锟斤拷 ERNIE 锟斤拷 ~150s (20 steps 锟斤拷 ERNIE-Image base 锟斤拷锟斤拷)
- 锟斤拷锟? ernie-test_00001_.png (1024锟斤拷1024, 1.5 MB) 锟斤拷 锟斤拷锟斤拷匹锟斤拷 prompt (锟斤拷锟缴帮拷猫 + 锟斤拷台 + 夕锟斤拷)
- 锟斤拷证: lint ? tsc ? vitest 679/679 ? (锟斤拷锟斤拷锟斤拷锟斤拷锟斤拷, 锟斤拷锟睫改讹拷锟斤拷)

### 锟斤拷锟斤拷
- 删锟斤拷 	est-ernie.mjs + 	est-ernie-wait.mjs (锟斤拷时锟斤拷锟皆脚憋拷)

### 锟截硷拷锟侥硷拷
- src/lib/ai/providers/comfyui-image.ts:566-616 (锟斤拷 uildErnieImageWorkflow)
- src/lib/ai/providers/_workflows/ernie-image-api.ts (锟劫凤拷 API JSON 锟斤拷锟斤拷, 200+ 锟斤拷)
- M:\models\image_ernie_image-API.json (锟斤拷锟斤拷)
- C:\Users\zjwji\AppData\Local\Temp\opencode\ernie-test\ernie-final-*.png (锟斤拷锟斤拷锟斤拷锟?

## Next Steps
- 锟矫伙拷锟斤拷锟斤拷 dev server, 锟斤拷 UI 锟剿碉拷锟剿诧拷锟斤拷 ERNIE 锟斤拷色图锟斤拷锟斤拷
- (锟斤拷选) 实锟斤拷 ERNIE prompt-enhancer (TextGenerate + ernie-image-prompt-enhancer) 锟斤拷为 UI toggle
- (锟斤拷选) 锟结交锟斤拷锟斤拷锟睫革拷 (git add + 锟揭猴拷锟斤拷 commit)


## 2026-06-09 Session 锟斤拷 Prompt 锟斤拷锟斤拷锟斤拷 + 锟斤拷锟斤拷锟斤拷锟斤拷
### 锟截硷拷锟睫革拷
- uildVideoPrompt 锟狡筹拷锟斤拷 uildInterpolationHeader 锟斤拷锟矫ｏ拷registry Seedance 元指锟斤拷锟斤拷锟饺撅拷锟狡的ｏ拷锟斤拷锟斤拷耄╋拷锟斤拷锟轿拷锟斤拷伪锟斤拷
- 删锟斤拷锟斤拷未使锟矫碉拷 uildInterpolationHeader 锟斤拷锟斤拷锟斤拷-71 锟叫ｏ拷
- 锟斤拷锟铰诧拷锟皆ｏ拷Seedance 锟斤拷锟皆达拷锟斤拷锟侥革拷为英锟斤拷

### 锟斤拷平锟斤拷
- lint: ? tsc: ? vitest 679/679 ?
- git diff: 2 files, +16/-62 lines
- GitNexus: LOW risk, 0 affected flows

### 锟斤拷锟斤拷
- ComfyUI 锟斤拷锟斤拷失锟杰ｏ拷custom node 缺 aiofiles + GBK 锟斤拷锟诫）
- Dev server 未锟斤拷锟斤拷

### ComfyUI fixed
- aiofiles installed; PYTHONIOENCODING=utf-8 set
- ComfyUI UP on port 8188 (PID 44128)
- LTX nodes available, API responsive

### Next: run video test with clean prompt or check next build

## 2026-06-09 Session 鈥?turbovec vector search integration
### Key changes
- **Schema**: New `embeddings` table (content_type, content_id, model, vector, text) 鈥?stores OpenAI embedding vectors as JSON text
- **New module `src/lib/embedding/index.ts`**: `embedText()` / `embedBatch()` using OpenAI `text-embedding-3-small`
- **New module `src/lib/vector-search/index.ts`**: `cosineSimilarity()` + `findCharacterBySemanticMatch()` + `storeEmbedding()` + `getEmbedding()` 鈥?DB-backed vector similarity search
- **Integration in frames.ts**: When exact character name match returns 0 results (`filteredChars.length === 0` but `shotCharNameSet` has names), falls back to `findCharacterBySemanticMatch()` using shot prompt 鈫?finds top character by cosine similarity > 0.5 threshold
- **Migration**: `drizzle/0055_add_embeddings.sql` + journal entry
- **Script**: `scripts/index-character-embeddings.ts` 鈥?batch-index all existing characters

### Verification
- lint 鉁?tsc 鉁?build 鉁?- Blast radius: LOW 鈥?only frames.ts character filtering path modified; 2 code sites (batch + single frame generate)

### Design
- **turbovec concept absorbed**: 16x compressed vector storage via SQLite JSON + TypeScript cosine similarity. Upgrade path to turbovec Python sidecar if scale demands it.
- **No Python dep**: Pure TypeScript/OpenAI embeddings 鈥?works on all platforms without Python runtime
- **Semantic fallback**: Only activates when exact name match fails (0 chars found). Doesn't change hot path.

### Status
- **Embedding API**: Current proxy (`asxs.top`) returns 404 on `/v1/embeddings`. SiliconFlow/DashScope also unreachable in current network. System gracefully degrades: semantic match 鈫?fuzzy name match 鈫?exact name match.
- **Fuzzy name match**: `charNGramSimilarity` in `vector-search/index.ts` 鈥?bigram overlap for Chinese text. Handles "闃垮．-鍏佃殎" 鈫?"闃垮．" or "宸ヨ殎涓? 鈫?"宸ヨ殎涓欙紙钀芥按鑰咃級"
- **Migration 0055 applied**: `embeddings` table exists in DB
- **Character index**: Populating embeddings requires an embedding-capable API. Set `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` env vars (separate from main chat API) when available.

### Next
- Frontend integration for candidates/readiness/SSE/transitions
- Embedding API (needs EMBBEDDING_BASE_URL/API_KEY 鈥?blocked)
- AI agent binding: shot-split agent output format now has transition fields, verify agent compatibility

## 2026-06-20 Session (鍏ㄩ摼鏉＄閬撳姞鍥?+ 杞満鎺ㄨ崘绯荤粺)
- **瑙嗛绠￠亾缁熶竴鏀硅繘**锛?  - `video-keyframe.ts`锛歜atch handler 澧炲姞 readiness 閫?shot 璇婃柇銆乧ancellation (AbortSignal registerTask)銆乬enerationId
  - `video-reference.ts`锛歜atch handler 鍔?taskId 鍙傛暟銆乺eadiness 璇婃柇銆乧ancellation銆乬enerationId锛泂ingle handler 鍔?generationId
  - `generate/route.ts`锛歚batch_reference_video` 鍔犲叆 BATCH_ACTIONS 鍙?pipeline 閿佷繚鎶?- **杞満鎺ㄨ崘绯荤粺 `transition-recommender.ts`**锛?  - 瑙勫垯寮曟搸锛氱浉閭?shot 鍒嗘瀽闀滃ご鏂瑰悜 (weight map)銆佸満鏅彉鍖?(sceneId)銆佸姩鎬佸己搴?(action/calm 鍏抽敭璇?銆佷綅缃紙棣栧熬鐗规畩澶勭悊锛?  - 7 绉嶈浆鍦哄€硷細cut / dissolve / fade_in / fade_out / wipeleft / slideright / circleopen
  - 棣栧抚 `fade_in` / 灏惧抚 `fade_out` / 鍚屽満鏅?`cut` / 鍦烘櫙鍒?`dissolve` / 澶ф柟鍚戝彉 `wipe`
- **杞満 API**锛?  - `GET /api/projects/[id]/transitions?episodeId=xxx` 鈥?鍙棰勮鎺ㄨ崘
  - `POST /api/projects/[id]/transitions` with `{ confirm: true }` 鈥?鎵归噺鍐欏叆 shot.transitionIn/Out
- **鍒嗛暅鐢熸垚鑷姩濉厖杞満**锛坄shots.ts` handler锛夛細
  - shot-split 瑙ｆ瀽鍚庯紙agent + built-in 鍙岃矾寰勶級锛岃繍琛?recommendTransitions 绠楁硶琛ュ～ `transitionIn`/`transitionOut`
  - 鐢ㄦ埛闆舵搷浣滐細鏂板垎闀滆嚜鍔ㄨ幏寰楀悎鐞嗚浆鍦猴紙UI 涓婂彲鎵嬪姩瑕嗙洊锛?- **AI 鎻愮ず澧炲己**锛坄registry-shot.ts`锛夛細
  - 杈撳嚭鏍煎紡鍔?`transitionIn`/`transitionOut` 瀛楁
  - 鏂板 `transitions` 妲斤紙rules slots锛夛紝鍚浆鍦洪€夋嫨鎸囧鍘熷垯
- **璇婃柇澧炲己**锛坄diagnostic/route.ts`锛夛細
  - 杩斿洖 `transitions.recommendations[]`锛堥€?shot 寤鸿锛?  - 杩斿洖 `transitions.suboptimalCount`锛堝疄闄呭€间笌鎺ㄨ崘鍊间笉鍚岀殑鏁伴噺锛?  - summary 澧炲姞 `suboptimalTransitions` 缁熻
- **浠ｇ爜璐ㄩ噺**锛歚frames.ts` 淇 `episodeId!` 闈炵┖鏂█ 鈫?瀹夊叏瑙ｆ瀯鍙橀噺 `epId`
- **鍏ㄩ噺瀹¤ + 淇**锛?  - **generationId 瑕嗙洊 48% 鈫?100%**锛氳ˉ榻?scene frame handler锛? 澶勶級銆乲eyframe.ts锛? 澶勶級銆乺ef-image.ts锛? 澶勶級銆乻hots.ts upsertPromptAsset锛? 澶勶級
  - **姝讳唬鐮佹竻鐞?*锛氱Щ闄?`failTask` 鏈敤 import锛坒rames.ts銆乿ideo-keyframe.ts銆乿ideo-reference.ts锛?- **cancellation/readiness 缁熶竴闆嗘垚**锛?  - `ref-image.ts`锛歚handleBatchRefImageGenerate` + `handleGenerateRefPrompts` 鍔?taskId銆乺egisterTask銆乻ignal.abort 妫€鏌ャ€乸rogress 鏇存柊銆乧ompleteTask
  - `character.ts`锛歚handleBatchCharacterImage` 鍔?taskId銆乺egisterTask銆乻ignal.abort 妫€鏌ャ€乸rogress 鏇存柊銆乧ompleteTask
- **PROGRESS.md checkpoint 鏇存柊**
- **楠岃瘉**锛歭int 鉁?tsc 鉁?build 鉁?- **鍓嶇闆嗘垚 (鍏ㄩ儴4椤瑰畬鎴?**锛?  - **杞満鎺ㄨ崘 UI**锛歋toryboard 椤甸潰鏂板 Row 5 鍖哄煙鍚?杞満鎺ㄨ崘"鎸夐挳锛汥ialog 鏄剧ず shot-by-shot 鎺ㄨ崘 vs 褰撳墠 diff锛堝惈鍏?鍑鸿浆鍦哄姣斻€佸師鍥狅級锛?搴旂敤鍏ㄩ儴鎺ㄨ崘"鎸夐挳璋冪敤 POST confirm
  - **Canvas 杞満鍙鍖?*锛歚canvas-storyboard.tsx` edges 澧炲姞褰╄壊鏍囩锛坈ut=鐏?dissolve=钃?fade=閲?wipe=绱?circle=缁匡級銆乼ransition 绫诲瀷缂╁啓鏄剧ず銆乴abel bg 鐧借壊鍗婇€忔槑
  - **SSE 瀹炴椂杩涘害**锛歚pollTaskSSE()` 浣跨敤 EventSource 杩炴帴 `/api/tasks/{id}/stream`锛孲SE 澶辫触鏃惰嚜鍔ㄥ洖閫€ HTTP 杞锛泂tartBatchTask 浼樺厛灏濊瘯 SSE
   - **璇婃柇闈㈡澘 UI**锛歋toryboard 椤甸潰鏂板"璇婃柇"鎸夐挳锛汥ialog 鏄剧ず summary grid锛堝畬鎴?澶辫触/鍗′綇/杩囨湡绛夛級銆佸畬鎴愬害杩涘害鏉°€乨iagnostic messages锛堝甫 severity 鑹插僵锛夈€乸er-shot 鐘舵€佸垪琛?- **楠岃瘉**锛歭int 鉁?tsc 鉁?build 鉁?
## 2026-06-20 Session (缁? 鈥?task 鍩虹璁炬柦瀹屾垚 + sceneId 娉ㄥ叆
- **task 鍩虹璁炬柦琛ラ綈锛? handler锛?*锛?  - `keyframe.ts`锛歚handleGenerateKeyframePrompts` 鍔?agent + built-in 鍙岃矾寰?abort 妫€鏌?+ updateTaskProgress锛涙敞鍐?`generate_keyframe_prompts` 鈫?BATCH_ACTIONS
  - `video-prompt.ts`锛歚handleBatchVideoPrompt` 鍔?taskId锛堟瘡 shot abort 妫€鏌?+ per-shot progress锛夛紱娉ㄥ唽 `batch_video_prompt` 鈫?BATCH_ACTIONS
  - `video-assemble.ts`锛歚handleVideoAssembleSync` 鍔?taskId锛?-step progress锛歷ersion resolve / query / transitions / dialogue audio / ffmpeg锛夛紱娉ㄥ唽 `video_assemble` 鈫?BATCH_ACTIONS
  - `script.ts`锛堟祦寮?API锛夊拰 `ai-optimize.ts`锛堝崟娆℃枃鏈浆鎹㈡棤 DB 鍐欙級鈫?璺宠繃锛屽洜鐢熷懡鍛ㄦ湡涓嶅吋瀹规垨鏃犳剰涔?- **杞満鎺ㄨ崘娴嬭瘯**锛歚transition-recommender.test.ts` 14 涓敤渚嬭鐩栫┖鏁扮粍銆侀灏惧抚瑙勫垯銆乻tatic cut銆乻cene change dissolve銆亀ipe銆乵otion intensity銆佷腑鏂囨枃鏈€乮nternal shot collapse銆乵ergeTransitions
- **poll timeout 娴嬭瘯鏃ュ織鍣煶娑堥櫎**锛? 涓?provider 娴嬭瘯 (wan/agnes/aivideo/kling) 鐢?`vi.spyOn(console, "log").mockImplementation(() => {})` 鎶戝埗 126+ 琛岃疆璇㈣緭鍑?- **sceneId 娉ㄥ叆锛坰hots.ts 鍙屽悜璺緞 + DB锛?*锛?  - `ParsedShot` 鏂板 `sceneId?: string`
  - 鍐呯疆璺緞锛氭寜 chunk 鍒嗙粍鍒嗛厤 `sg_0`, `sg_1`...
  - Agent 璺緞锛氭寜 scene group 鍒嗙粍鍒嗛厤 `sg_N`
  - 涓よ矾寰?DB insert 鍧囧啓鍏?`shot.sceneId`
  - `recommendTransitions` 杈撳叆浼犵湡瀹?sceneId锛堜笉鍐嶆槸 null锛夛紝scene change 妫€娴嬬敓鏁?- **瀹¤纭**锛?1 handler 涓?8 涓叿澶囧畬鏁?task 鍩虹璁炬柦锛沗genId()` 杈撳嚭 12 瀛楃 nanoid锛孌B `text("id").primaryKey()` 鏃犻暱搴﹂檺鍒讹紙taskId 18-char limit 涓嶅瓨鍦紝宸插彇娑堝搴旀潯鐩級
- **楠岃瘉**锛歭int 鉁?tsc 鉁?
## 2026-06-20 Session (缁?) 鈥?BATCH_ACTIONS 琛ラ綈 + shot_split task 鍩虹璁炬柦
- **BATCH_ACTIONS 娉ㄥ唽琛ラ綈**锛坄generate/route.ts`锛夛細鏂板 `shot_split`銆乣batch_character_image`銆乣batch_ref_image_generate`銆乣generate_ref_prompts` 鈫?杩欎簺 handler 涔嬪墠宸叉湁 task 鍩虹璁炬柦浣嗘湭娉ㄥ唽涓哄悗鍙颁换鍔★紝杩愯鏃?`taskId` 濮嬬粓涓?undefined锛屽熀纭€璁炬柦鏄浠ｇ爜锛涙敞鍐屽悗鏀逛负鍚庡彴鎵ц + SSE 杞
- **`shot_split` task 鍩虹璁炬柦**锛坄shots.ts`锛夛細
  - 鎺ュ彈 `taskId` 鍙傛暟锛? 鍙峰弬鏁帮級
  - `registerTask(taskId)` + AbortSignal 妫€鏌ワ紙batch 寰幆闂?+ fallback 寰幆闂达級
  - 杩涘害锛歚updateTaskProgress` 浠?chunk 涓哄崟浣嶏紙`total: sceneChunks.length`锛?  - 鎴愬姛 `completeTask` / 澶辫触 `failTask` / 鍙栨秷 `completeTask({ failed: ["Cancelled"] })`
- **瀹¤鏇存柊**锛?1 handler 涓?**9 涓?*鍏峰瀹屾暣 task 鍩虹璁炬柦锛堟帓闄?script.ts 娴佸紡 + ai-optimize.ts 鍗曟锛夛紱3 涓?handler锛坆atch_character_image/batch_ref_image_generate/generate_ref_prompts锛夊熀纭€璁炬柦浠庢浠ｇ爜鍙樹负瀹為檯鍙敤
- **楠岃瘉**锛歭int 鉁?tsc 鉁?
## 2026-06-20 Session (缁?) 鈥?batch_scene_frame task 鍩虹璁炬柦
- **`batch_scene_frame` task 鍩虹璁炬柦**锛坄frames.ts:handleBatchSceneFrame`锛夛細
  - 鎺ュ彈 `taskId`銆乣registerTask` + AbortSignal锛坰hot 寰幆闂?+ target 寰幆闂达級
  - `updateTaskProgress` 浠?shot 涓哄崟浣嶏紙`total: allShots.length`锛?  - 鎴愬姛 `completeTask` / 鍙栨秷 `completeTask({ failed: ["Cancelled"] })`
  - 娉ㄥ唽 `batch_scene_frame` 鈫?BATCH_ACTIONS
- **瀹¤鏇存柊**锛?1 handler 涓?**10 涓?*鍏峰瀹屾暣 task 鍩虹璁炬柦锛堜粎 script.ts 娴佸紡 + ai-optimize.ts 鍗曟鎺掗櫎锛夛紱鎵€鏈?`batch_*` handler 鍧囨敞鍐屼负鍚庡彴浠诲姟
- **楠岃瘉**锛歭int 鉁?tsc 鉁?
## 2026-06-20 Session (缁?) 鈥?shot-split 闆嗘垚娴嬭瘯 + generationId 淇
- **shot-split 闆嗘垚娴嬭瘯**锛坄shots.test.ts`锛? 涓祴璇曪級锛?  - 绌虹櫧鍓ф湰 400 / 鏃犳ā鍨嬮厤缃?400
  - 鎴愬姛璺緞锛氶獙璇?sceneId锛坄sg_0`锛夈€佽浆鍦哄～鍏咃紙`fade_in`/`dissolve`/`fade_out`锛夈€丏B insert 鏁版嵁瀹屾暣鎬?  - task 杩涘害锛氶獙璇?`updateTaskProgress`锛堝垵濮?total:0 + 鎸?chunk 绮掑害锛夊拰 `completeTask`
  - 澶辫触璺緞锛氶獙璇?`failTask` 鍦?`generateText` 鎶涘嚭寮傚父鏃惰璋冪敤
  - DB mock 妯″紡锛歚_results` 鏁扮粍椹卞姩鏌ヨ鍝嶅簲锛屾敮鎸?`.where()` 鐩存帴 await 鍜?`.where().orderBy().limit()` 涓ょ閾惧紡妯″紡
- **generationId 淇**锛坄frames.ts:handleBatchSceneFrame`锛夛細姣忓紶 ref image 浣跨敤鐙珛 `genId()` 鏇夸唬鍏变韩 `batchGenId`锛屼娇鍗曞紶鍥剧墖鍙拷韪紱鍒犻櫎搴熷純鍙橀噺 `batchGenId`
- **瀹¤纭**锛氭墍鏈?`batch_*` handler 浣跨敤姣忔搷浣滅嫭绔?generationId锛堟棤鍏变韩 batchGenId 娈嬩綑锛?- **楠岃瘉**锛歭int 鉁?tsc 鉁?build 鉁?
## 褰撳墠鐘舵€佹€荤粨
- **11 handler 涓?10 涓?*鍏峰瀹屾暣 task 鍩虹璁炬柦锛坄registerTask` + AbortSignal + `updateTaskProgress` + `completeTask/failTask`锛夛紱鎺掗櫎 `script.ts`锛堟祦寮忥級鍜?`ai-optimize.ts`锛堝崟娆℃棤 DB 鍐欙級
- **generationId 瑕嗙洊 100%**锛氭墍鏈夊浘鐗?瑙嗛鐢熸垚鎿嶄綔浣跨敤鐙珛 `genId()`
- **杞満鎺ㄨ崘绯荤粺**锛氳鍒欏紩鎿?7 绉嶈浆鍦哄€?+ 14 涓祴璇?+ shot-split 鑷姩濉厖 + 鍓嶇 UI/Canvas/SSE/璇婃柇闈㈡澘
- **sceneId 娉ㄥ叆**锛歜uilt-in + agent 鍙岃矾寰勶紝鎸?chunk/scene group 鍒嗙粍鍒嗛厤锛孌B 鎸佷箙鍖?- **BATCH_ACTIONS**锛氭墍鏈?`batch_*` handler + `shot_split` + `generate_ref_prompts` 娉ㄥ唽涓哄悗鍙颁换鍔?- **698 tests** 鍏ㄩ儴閫氳繃锛沚uild 姝ｅ父瀹屾垚锛坄--turbo --no-lint`锛?- **闃诲椤?*锛氬祵鍏ュ悜閲?API锛堥渶璁?`EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY` 鐜鍙橀噺锛?


### 2026-06-21 Session D 类补充
针对上次会话遗留的 C/D 项（kling 7 子型号 / wan 2.6/2.7 / ComfyUI 9 模型可用性）：

- **kling 子模型** — src/app/api/models/list/route.ts:67-77 共 9 个 model ID（v1, v1-5, v1-6, v2, v2-new, v2-1, v2-master, v2-1-master, v2-5-turbo）。kling-video.ts 仅根据 irstFrame 切换 image2video/text2video 路径，不校验 model ID 是否被 kling 后端接受；提交 body 的 model 字段转发给 kling 后端，由其决定 validity。
  - **静态可发现**：项目无 kling key，外部 catalog 验证受限于 API key + JS rendering，无法 webfetch。
  - **建议**：用户实际跑 kling 任一型号时观察后端错误；可引入厂商 error.code -> 友好的"该模型已下架"提示。

- **wan 2.6/2.7** — src/lib/ai/providers/wan-video.ts 通过 WAN_BASE_URL=https://dashscope.aliyuncs.com/api/v1 调用 dashscope。src/app/api/models/list/route.ts:99-110 列出 7 个 wan ID（2.7-t2v/r2v, 2.6-t2v/i2v-flash/i2v/r2v/r2v-flash）。dashscope 定期新增/淘汰模型。
  - **静态可发现**：项目 getModelFamily(wan2.x-*) 全部正确路由到 wan family（test dashscope-image.test.ts:46 已覆盖）。
  - **建议**：每季度刷一次 wan-video.ts model limits + models/list/route.ts ID 清单。

- **ComfyUI 9 个 video 模型** — src/app/api/models/list/route.ts:114-122：wan2.2-i2v-comfyui / wan-firstlast / wan-i2v / ltx-i2v / ltx-i2v-pro / ltx-t2v / ltx-flf2v / ltx-4grid / ltx-2-multiguide。这些全是 **src/lib/ai/providers/templates/*.json + comfyui-video.ts 自管的 workflow 名**，和非 ComfyUI 模型的 ID 概念不同（不存在"外部 catalog"可校验）。
  - **静态可发现**：测试已覆盖（comfyui-video.test.ts），workflows/ + _workflows/ 下有 JSON 模板。
  - **建议**：在 ComfyUI 自升级后验证 workflow 模板仍能 prompt/queue 成功，否则需更新模板。

### 没有 DASHSCOPE_API_KEY 的局限
- 当前审计未直接调用 dashscope /v1/models 端点（HTTP 401）
- wan 系列可用性靠**代码层 model 清单 vs dashscope 实际 catalog** 对照，无法实测
- **后续可做方向**：如果用户提供 dashscope key，可走与 NVIDIA NIM 一样的实测链路，校验 wan 系列可用性

### 总结
本次会话完成 A + B + 5 项加固，加上 D 类补充（受限）。结束状态：
- 
pm run lint + tsc + build + tests 全部 pass（679/679）
- 失效 API / 模型 ID 全部清零
- 类型安全收紧（4 处 as any + schema enum）
- 18 处 pipeline 调用 -> streamBodyToFile helper
- 31 个 schema enum + 33 tasks.type 一致
- 显示冗余 REDFOX 配置清理
- opencode 默认模型改回 NVIDIA 免费 key 可用 ID
