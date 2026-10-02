# 视频播放与便携资源回归修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 修复 AVI 播放、便携缩略图、FFmpeg 派生封面和全屏画面模式菜单回归，并交付已验证的便携版。

**Architecture:** 保留本地媒体服务和 Fragmented MP4 播放架构；播放决策读取实际流编码。Core.init 统一修复内部缩略图路径。下拉菜单增加可选 Portal 容器，播放器全屏时使用全屏包装节点。

**Tech Stack:** Electron 42、TypeScript、React、Radix Dropdown Menu、Vitest、ffmpeg/ffprobe、electron-builder。

---

### Task 1: 媒体兼容性回归测试

**Files:**
- Modify: electron/core/__tests__/mediaPlayback.test.ts
- Modify: electron/core/__tests__/server.test.ts

- [ ] 写出以下失败用例：AVI + MPEG-4 Part 2 视频返回 true；AVI + H.264/yuv420p/AAC 返回 false；H.264 + AC-3 音频返回 true；AVI 服务响应的流编码最终是 H.264/AAC。
- [ ] 运行以下命令确认先红：

~~~text
npm run test:core -- electron/core/__tests__/mediaPlayback.test.ts electron/core/__tests__/server.test.ts
~~~

预期：新断言失败，原因是当前判断只覆盖 MP4-family，AVI 先走 -c copy。

### Task 2: 按实际流编码转码

**Files:**
- Modify: electron/core/mediaPlayback.ts
- Modify: electron/core/server.ts
- Modify: electron/core/__tests__/mediaPlayback.test.ts
- Modify: electron/core/__tests__/server.test.ts

- [ ] 在 RawStream 中读取 codec_name，增加首个音频流查找。
- [ ] 让 shouldTranscodeForPlayback 对所有被 remux 的视频执行：视频 codec 不是 h264、H.264 像素格式非 yuv420p/yuvj420p、或音频 codec 不是 aac 时返回 true；缺少 codec/raw 时保留 false。
- [ ] 在 REMUX_CONTAINERS 分支把该判断作为 forceTranscode 传给 serveRemux；兼容流仍可先 -c copy。
- [ ] 运行 Task 1 命令，预期全部通过。
- [ ] 提交：

~~~text
git add electron/core/mediaPlayback.ts electron/core/server.ts electron/core/__tests__/mediaPlayback.test.ts electron/core/__tests__/server.test.ts
git commit -m "fix: transcode incompatible remux streams"
~~~

### Task 3: 缩略图路径修复回归测试

**Files:**
- Create: electron/core/thumbnailPaths.ts
- Create: electron/core/__tests__/thumbnailPaths.test.ts
- Modify: electron/core/index.ts

- [ ] 测试旧目录中的 thumb_path 在当前 thumbs/<id>.webp 存在时被替换为当前路径。
- [ ] 测试第二次执行不再改变路径。
- [ ] 测试旧路径和标准路径都不存在时变为 NULL/pending。
- [ ] 运行确认先红：

~~~text
npm run test:core -- electron/core/__tests__/thumbnailPaths.test.ts
~~~

### Task 4: 启动时修复便携缩略图

**Files:**
- Create/Modify: electron/core/thumbnailPaths.ts
- Modify: electron/core/index.ts
- Modify: electron/core/__tests__/thumbnailPaths.test.ts

- [ ] 实现 repairThumbnailPaths(db, thumbsDir)：只构造 path.join(thumbsDir, String(id) + ".webp")；标准文件存在则更新，两个位置都不存在则清除路径并设 pending；更新放在 transaction 内。
- [ ] 在 Core.init 的 openDb 后调用 repairThumbnailPaths(db, path.join(dataDir, "thumbs"))。
- [ ] 运行：

~~~text
npm run test:core -- electron/core/__tests__/thumbnailPaths.test.ts electron/core/__tests__/jobsIdentity.test.ts
~~~

预期：通过。
- [ ] 提交：

~~~text
git add electron/core/thumbnailPaths.ts electron/core/index.ts electron/core/__tests__/thumbnailPaths.test.ts
git commit -m "fix: repair moved portable thumbnail paths"
~~~

### Task 5: FFmpeg WebP 临时文件回归测试与修复

**Files:**
- Modify: electron/core/assetService.ts
- Modify: electron/core/__tests__/assets.test.ts

- [ ] 增加 assetTemporaryPath(destination) 测试：传入 cover.webp 后结果最终扩展名是 .webp，且不等于目标路径。
- [ ] 运行确认先红：

~~~text
npm run test:core -- electron/core/__tests__/assets.test.ts
~~~

- [ ] 实现临时路径为 destination + "." + randomUUID() + ".tmp" + path.extname(destination)，并让 generateThumb/generateSheet 使用该路径；手动复制资产的现有临时路径不改变。
- [ ] 运行：

~~~text
npm run test:core -- electron/core/__tests__/assets.test.ts electron/core/__tests__/media.test.ts
~~~

预期：通过。
- [ ] 提交：

~~~text
git add electron/core/assetService.ts electron/core/__tests__/assets.test.ts
git commit -m "fix: preserve ffmpeg asset output extensions"
~~~

### Task 6: 全屏画面模式菜单回归测试与修复

**Files:**
- Modify: src/components/ui/dropdown-menu.tsx
- Modify: src/routes/MediaDetail/VideoPlayer.tsx
- Modify: src/routes/MediaDetail/__tests__/VideoPlayer.test.tsx

- [ ] 测试设置 document.fullscreenElement 为播放器 wrapper，触发 fullscreenchange，打开 player.displayMode，断言菜单节点由 wrapper 包含；先运行：

~~~text
npm run test:renderer -- src/routes/MediaDetail/__tests__/VideoPlayer.test.tsx
~~~

预期：新断言失败，因为 DropdownMenuContent 当前总是 body Portal。
- [ ] 让 DropdownMenuContent 接受 container?: HTMLElement | null 并传给 Radix Portal。
- [ ] 在 VideoPlayer 中传入 container={isFullscreen ? wrapRef.current : undefined}；普通模式保持默认 Portal。
- [ ] 重新运行 Task 6 命令，预期通过。
- [ ] 提交：

~~~text
git add src/components/ui/dropdown-menu.tsx src/routes/MediaDetail/VideoPlayer.tsx src/routes/MediaDetail/__tests__/VideoPlayer.test.tsx
git commit -m "fix: keep player menu visible in fullscreen"
~~~

### Task 7: 完整验证、打包和推送

**Files:**
- Verify: changed source/tests, ignored D:/Projects/PortableVideoLibrary/橙映 output

- [ ] 运行 npm test 和 npm run typecheck，均应退出码 0。
- [ ] 运行 npm run dist:portable，确认橙映目录只有橙映.exe、Data、Media，且 Data/Media 未进入 Git。
- [ ] 启动橙映/橙映.exe，带 --no-sandbox --disable-gpu，确认至少存活五秒后只结束冒烟进程。
- [ ] 检查 git status、git log、git diff origin/main...main --stat，确认全部提交在 main 且没有用户数据。
- [ ] 执行 git push origin main，确认远程 main 指向验证过的提交。

