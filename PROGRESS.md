# Progress

## Completed
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

## In Progress
- "quality" (17步) 加载太慢 → 改用 "quality_lite" (13步) 作为平衡方案

## 迁移到 Infinite Canvas
- **决策**: 采用"工作流样板"方式迁移到 `basketikun/infinite-canvas`，不做插件化侵入
- **漫画提示词库**: 创建了 `prompts/manga-reference/prompts.json`（45条提示词，涵盖 7 大类：漫画风格、分镜构图、四格漫画、角色设计、动作场面、效果技法、漫画封面）
- **Go 后端**: 在 `repository/db.go` 注册新分类 `manga-reference`，在 `service/prompt_fetch.go` 添加 fetcher（类 davidwu 的 JSON 格式）
- **构建验证**: Go `go build ./...` ✅, `go vet ./...` ✅; Web `pnpm run build` ✅ (Next.js)
- **下一步**: 创建 GitHub repo `basketikun/manga-prompt-reference`，将 prompts.json 推上去以激活自动同步；之后创建工作流样板

## Blocked
- LongLive 1.0 local inference too slow (~3h per 30-frame video on RTX 4080) — use CNB (L40, Linux, FA2) for production

## Known Issues
- No test framework configured
- `verify-videos.js` excluded from lint (utility script)
