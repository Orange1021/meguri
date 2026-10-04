# 橙映项目：AI 接手说明

这份文档给下一位 AI 使用。只记录当前有效的项目事实、约定和入口；不要把它当作完整需求文档。

## 1. 项目是什么

橙映（源码包名仍是 `meguri`）是一个 Electron 桌面端的本地媒体库：递归扫描用户目录，建立 SQLite 索引，提供搜索、标签、评分、列表/网格浏览、播放和缩略图/封面查看。数据默认只保存在本地，不上传云端。

技术栈：Electron 42、Node/TypeScript、React 19、electron-vite、SQLite（`better-sqlite3`）、内置 `ffmpeg/ffprobe`。

## 2. 当前仓库基线

- 本地仓库：`D:\\Projects\\PortableVideoLibrary`（其他环境请以实际工作区为准）
- 当前分支：`main`；后续正常开发继续使用 `main`
- 当前远程：`https://github.com/Orange1021/meguri.git`
- 本文档创建时的基线提交：`c616bae`
- `package.json` 的版本仍为 `0.8.0`，产品名为 `橙映`，Windows 内部可执行文件名为 `OrangeView`
- `package.json` 中的上游仓库/徽章仍有 `zabuton-app/meguri` 字样；除非用户明确要求，不要在无关任务中顺手改名

开始任何工作前先执行：

```powershell
git status --short --branch
git log -5 --oneline --decorate
```

## 3. 必须保持的产品约定

### Windows 便携版

最终交付目录必须是根目录下的 `橙映/`，并且只包含：

```text
橙映/
├─ 橙映.exe
├─ Data/
└─ Media/
```

用户移动到硬盘时复制整个 `橙映/` 目录，不是只复制 EXE。`Data/` 保存配置、SQLite 数据库、日志和生成的资源；`Media/` 是可选的便携媒体根目录。

不要把版本号、平台名后缀加到最终文件名上；不要把 `Data` 放进 `release/`，也不要把 `Data`、`Media` 或本地 EXE 提交到 Git。它们已被 `.gitignore` 排除。

### 媒体索引和封面

- 只有视频生成 WebP 索引图；图片不再生成第二张“图片缩略图”，直接使用原图作为封面并可点击查看。
- 音频保留播放和元数据；有内嵌封面时显示内嵌封面，没有时显示类型图标。
- 手动设置的视频封面必须跨重启保留，扫描不能覆盖它。
- 扫描、删除文件、缩略图生成和播放问题优先看 `Data/logs/main.log`，以及数据库中的 `scan_runs`、`scan_issues`。

### 视频行和封面预览

- 视频行中的“查看封面”按钮只打开封面，不启动播放。
- 同一行其他点击区域继续播放视频。
- `CoverPreviewDialog` 使用适应比例显示；支持 Ctrl+滚轮缩放、鼠标拖动和方向键平移。
- 封面预览的缩放/平移是临时状态，不跨视频保存；它和全局内容缩放是两套机制。

## 4. 代码地图

- `src/`：React renderer；首页、媒体列表、详情页、播放器和设置
- `src/components/CoverPreviewButton.tsx`：查看封面入口
- `src/components/CoverPreviewDialog.tsx`：封面查看、缩放、平移
- `src/components/MediaList.tsx`：列表行和播放/查看封面行为
- `src/routes/MediaDetail/VideoPlayer.tsx`：视频播放、进度和控制栏
- `electron/`：Electron 主进程、IPC、扫描任务、媒体服务器和数据库逻辑
- `electron/core/jobs.ts`：扫描任务和进度
- `electron/core/media.ts`：ffprobe 元数据、视频缩略图和媒体处理
- `electron/core/server.ts`：本地媒体 HTTP 服务
- `scripts/build-portable.mjs`：生成便携版目录
- `scripts/portable-smoke.mjs`：启动便携 EXE、替换 EXE、确认 Data 保留
- `docs/`：架构、构建、媒体管线和用户文档

要了解 renderer 结构，先读 `docs/renderer.md`；要了解扫描/缩略图，先读 `docs/media-pipeline.md`；要了解打包，先读 `docs/build-and-ci.md`。

## 5. 常用命令

首次准备环境：

```powershell
npm install
```

开发和检查：

```powershell
npm run dev
npm run typecheck
npm run build
```

测试：

```powershell
npm run test:core
npm run test:renderer
npm run test:renderer -- src/components/__tests__/CoverPreviewDialog.test.tsx
npm run test:portable-upgrade
npm run test:portable-smoke
```

打包便携版：

```powershell
npm run dist:portable
npm run test:portable-smoke
```

`dist:portable` 会重新构建并调用 electron-builder，最后把唯一的 Windows 便携 EXE 复制为 `橙映/橙映.exe`，然后删除临时目录 `.portable-build/`。打包过程可能较慢，不要因暂时没有输出就立即终止。

## 6. 后续 AI 的工作方式

### 6.1 文件读取范围（硬性）

- **只能读本项目工作区 `D:\Projects\PortableVideoLibrary` 下的文件。**
- 不要读取 D 盘其他位置、系统盘（C 盘）或其他磁盘上的任何文件；不要浏览、列举或索引用户的个人媒体、文档、桌面文件。
- 需要理解"磁盘上有什么"时，通过项目代码、配置和日志定位，不要用 AI 直接遍历用户磁盘。

### 6.2 每次修改的固定流程（硬性，不可跳过）

任何一次修改（功能、bug 修复、重构、文档变更）完成后，按顺序执行以下步骤，**全部通过才算完成**：

1. **测试**：运行相关测试，并至少运行 `npm run test:core` 和 `npm run test:renderer`。
2. **静态检查与构建**：`npm run typecheck` 和 `npm run build`。
3. **打包 EXE**：`npm run dist:portable`，产出唯一的 `橙映/橙映.exe`，并保持 `橙映/` 只含 `橙映.exe` + `Data/` + `Media/` 的约定结构。
4. **便携版冒烟测试**：`npm run test:portable-smoke`（确认替换 EXE 后 `Data/` 保留）。
5. **提交并推送**：按仓库约定写 **英文** conventional commit（`<type>: <summary>`，`<type>` 取 `feat` / `fix` / `docs` / `chore` / `ci` / `build`，见 `CONTRIBUTING.md` 与现有历史），并 `git push` 到 `origin/main`。

任何一步失败都要停下来定位原因，**不要带着失败或红色的状态继续打包或推送**；也不要跳过打包步骤直接提交。

### 6.3 其他约定

- 先读本文件，再按任务读取对应的 `docs/` 文档和源码入口。
- 先复现问题并定位原因，再修改；功能或 bug 修复要补针对性测试。
- 不要删除或重建用户的 `Data/`、`Media/`，不要把本地媒体或数据库加入提交。
- 面向用户用中文、直白说明；避免未经要求的大范围重构和改变现有便携目录约定。
