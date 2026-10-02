# 仅视频生成索引图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 保留图片索引和原图打开能力，但让只有视频生成索引图，并清理旧的非视频缩略图与派生任务。

**Architecture:** 在扫描任务中把图片/音频视为“需要元数据但不需要缩略图”的媒体，统一写入 done/NULL。扫描前清理旧的非视频 thumb 引用和当前 Data 下的生成缓存；派生 Cover/Sheet 队列只接受视频，历史非视频任务在处理时安全完成。视频路径保持现有 FFmpeg、缩略图和播放逻辑不变。

**Tech Stack:** Electron 42、TypeScript、better-sqlite3、Vitest、FFmpeg/FFprobe。

---

### Task 1: 缩略图策略回归测试

**Files:**
- Modify: electron/core/__tests__/jobsIdentity.test.ts
- Modify: electron/core/__tests__/scan.test.ts
- Modify: electron/core/__tests__/thumbnailPaths.test.ts

- [ ] **Step 1: 写出图片扫描的失败测试**

在 runScan identity integration 中新增用例：创建 picture.jpg，运行扫描，查询该行，断言 kind='image'、thumb_status='done'、thumb_path=NULL；同时断言 generateThumb 的调用参数中没有 picture.jpg，而既有 clip.mp4 仍然调用一次。

- [ ] **Step 2: 运行测试确认先红**

~~~text
npm run test:core -- electron/core/__tests__/jobsIdentity.test.ts
~~~

预期：新增测试失败，因为当前图片仍进入 generateThumb 并写出缩略图。

- [ ] **Step 3: 写出旧图片缩略图清理的失败测试**

在 thumbnailPaths.test.ts 新增测试：建立图片文件行和当前 thumbs/<id>.webp，将数据库 thumb_path 指向它并写入缓存；调用清理函数后断言数据库为 done/NULL、缓存不存在、原图片仍存在。另测试旧路径在当前 Data 外时只清数据库，不删除该路径指向的文件。

- [ ] **Step 4: 运行清理测试确认先红**

~~~text
npm run test:core -- electron/core/__tests__/thumbnailPaths.test.ts
~~~

预期：新增清理断言失败，因为当前没有非视频缩略图清理函数。

### Task 2: 实现仅视频缩略图扫描策略

**Files:**
- Modify: electron/core/thumbnailPaths.ts
- Modify: electron/core/jobs.ts
- Modify: electron/core/__tests__/jobsIdentity.test.ts
- Modify: electron/core/__tests__/thumbnailPaths.test.ts

- [ ] **Step 1: 实现安全的非视频缓存清理**

在 thumbnailPaths.ts 增加 clearNonVideoThumbnailPaths(db, thumbsDir): Promise<void>：查询存活且 kind != 'video' 的非空路径；在事务中统一写 thumb_path=NULL, thumb_status='done'；只对 path.resolve(thumbsDir) 下、文件名严格为 <id>.webp 的路径执行 fs.promises.rm(..., { force: true })，其他旧路径不删除。

- [ ] **Step 2: 在扫描阶段调用清理并跳过非视频 FFmpeg**

在 runScan 的 syncFiles 完成后、读取 pending 前调用清理函数。保留图片的 extractMeta、指纹、FTS 和自动标签流程；在 processOne 中对 kind === 'image' 写入 skipThumb 结果并直接返回，不执行 generateThumb。保留音频元数据和探测失败错误处理，但音频成功探测后统一 skipThumb，不调用 coverArtStreamIndex 或 generateThumb。计数时把跳过缩略图的图片/无封面音频排除出“全部缩略图失败”的判断。

- [ ] **Step 3: 运行核心回归测试确认通过**

~~~text
npm run test:core -- electron/core/__tests__/jobsIdentity.test.ts electron/core/__tests__/scan.test.ts electron/core/__tests__/thumbnailPaths.test.ts
~~~

预期：图片不再调用 FFmpeg，视频测试仍通过，旧非视频缓存清理测试通过。

- [ ] **Step 4: 提交扫描策略**

~~~text
git add electron/core/thumbnailPaths.ts electron/core/jobs.ts electron/core/__tests__/jobsIdentity.test.ts electron/core/__tests__/scan.test.ts electron/core/__tests__/thumbnailPaths.test.ts
git commit -m "fix: generate thumbnails only for videos"
~~~

### Task 3: 限制自动派生资产为视频

**Files:**
- Modify: electron/core/assetService.ts
- Modify: electron/core/__tests__/assets.test.ts
- Modify: electron/core/__tests__/jobsIdentity.test.ts

- [ ] **Step 1: 写出派生任务的失败测试**

使用真实内存 SQLite 数据库插入 videos 行，调用 queueDerivedAssets：图片和音频的 asset_tasks 数量必须为 0，视频必须同时有 cover/auto 和 sheet/auto。再为图片建立历史 asset_tasks 和文件行，运行 processPendingAssetTasks，断言任务完成且 generateThumb 未收到图片路径。

- [ ] **Step 2: 运行测试确认先红**

~~~text
npm run test:core -- electron/core/__tests__/assets.test.ts electron/core/__tests__/jobsIdentity.test.ts
~~~

预期：当前 queueDerivedAssets 会为图片/音频插入 Cover 任务，历史图片任务也会进入 FFmpeg。

- [ ] **Step 3: 实现视频限定**

让 queueDerivedAssets 在 input.kind !== 'video' 时立即返回；让 generateTask 在读取文件后、检查 sidecar 前遇到非视频直接返回；processPendingAssetTasks 继续把该任务标记为 completed，从而升级旧队列但不生成图片。

- [ ] **Step 4: 运行核心资产测试确认通过**

~~~text
npm run test:core -- electron/core/__tests__/assets.test.ts electron/core/__tests__/jobsIdentity.test.ts electron/core/__tests__/media.test.ts
~~~

预期：视频派生资产和既有媒体工具测试通过，图片/音频没有自动资产任务。

- [ ] **Step 5: 提交资产策略**

~~~text
git add electron/core/assetService.ts electron/core/__tests__/assets.test.ts electron/core/__tests__/jobsIdentity.test.ts
git commit -m "fix: limit derived media assets to videos"
~~~

### Task 4: 全量验证和便携版交付

**Files:**
- Verify: electron/core, src, 橙映 ignored portable output

- [ ] **Step 1: 运行完整测试和类型检查**

~~~text
npm test
npm run typecheck
npx prettier --check electron/core/thumbnailPaths.ts electron/core/jobs.ts electron/core/assetService.ts electron/core/__tests__/jobsIdentity.test.ts electron/core/__tests__/scan.test.ts electron/core/__tests__/thumbnailPaths.test.ts electron/core/__tests__/assets.test.ts
git diff --check
~~~

所有命令都应退出码为 0；测试中的既有 jsdom HTMLMediaElement/HTMLCanvasElement 未实现提示不视为失败。

- [ ] **Step 2: 构建便携版**

~~~text
npm run dist:portable
~~~

确认 橙映\橙映.exe、橙映\Data、橙映\Media 存在，release 不存在，git status 不出现用户数据。

- [ ] **Step 3: 启动冒烟验证**

启动 橙映\橙映.exe --no-sandbox --disable-gpu，确认进程至少存活 5 秒后只停止本次冒烟进程；不修改源媒体。

- [ ] **Step 4: 推送 main**

~~~text
git status --short --branch
git push origin main
git rev-parse HEAD
git rev-parse origin/main
~~~

确认工作区干净且本地、远程 main 指向相同提交，且提交中没有 Data/Media。
