# 便携式本地视频库设计说明

**日期：** 2026-10-01
**代码基线：** `zabuton-app/meguri`，commit `854a482`
**Fork：** `Orange1021/meguri`
**当前范围：** 阶段 0 审计与阶段 1 设计；阶段 1 功能实现必须在阶段 0 结果确认后开始。

## 目标

将 Meguri 增量改造成可随移动硬盘携带的 Windows 本地视频库。程序目录与用户数据目录分离，媒体路径优先保存为工作区相对路径；换盘符、升级 App 目录或恢复数据库时，`video_id`、标签、封面、播放历史和播放列表不因物理路径变化而丢失。

V1 面向 Windows 10/11，离线运行，复用现有 Electron、Node.js、TypeScript、React、better-sqlite3、FFmpeg 和 ffprobe 体系。原始媒体默认只读；应用内改名或移动必须显式触发、可恢复且不会静默覆盖目标文件。

## 路线选择

### 采用 Fork 后增量改造

`D:\Projects\PortableVideoLibrary` 使用 `origin=https://github.com/Orange1021/meguri.git`，`upstream=https://github.com/zabuton-app/meguri.git`。长期功能分支为 `feat/portable-video-library-v1`。

采用该路线的原因：上游已经具备严格的 Renderer/Main 隔离、类型化 IPC、工作区扫描、增量哈希、FFmpeg/ffprobe、SQLite WAL、标签、历史、播放列表和 Windows portable 打包基础。保留这些边界可以把风险集中到数据位置、身份模型、迁移和恢复，而不是重写成熟的媒体处理链。

不采用“外层启动器”：它无法真正统一工作区身份、数据库和扫描状态。
不采用“从零开发”：它会重复建设上游已有的扫描、媒体服务、UI 和测试体系。

## 目标架构

### 进程与模块边界

- Renderer 只使用 `window.api`，不直接访问 Node、文件系统、SQLite、FFmpeg 或 `child_process`。
- Preload 继续以 `shared/ipc/channelNames.ts` 和 `shared/ipc/channels.ts` 为白名单与类型来源，主进程对所有输入执行 Zod 校验。
- Main/Core 增加可单测的领域服务和适配器：`PortablePathResolver`、`WorkspaceService`、`MigrationService`、`BackupService`、后续的 `IdentityService`、`ScanService`、`AssetService`、`PlaylistService` 和 `PlayerAdapter`。
- 文件系统、SQLite、FFmpeg/ffprobe 和播放器进程通过适配器注入，核心决策逻辑不依赖真实硬盘、PotPlayer 或大体积媒体。

### 便携目录

发布包使用如下布局：

```text
PortableVideoLibrary/
├─ App/
│  ├─ PortableVideoLibrary.exe
│  ├─ resources/
│  ├─ ffmpeg/
│  └─ VERSION
├─ Data/
│  ├─ config.json
│  ├─ library.sqlite
│  ├─ assets/<video_id>/
│  ├─ playlists/
│  ├─ backups/
│  ├─ logs/
│  └─ temp/
├─ Media/
└─ Launch.cmd
```

运行时从可执行文件位置解析便携根目录；测试和开发可注入临时根目录。`Data` 不存在时显示恢复/初始化状态，不允许静默回退到 Electron `userData` 创建第二份数据库。保存同盘媒体时优先写工作区相对路径；真正的外部媒体必须明确标记为 `non_portable`。

### 数据模型演进

阶段 1 先建立安全的版本化迁移和备份边界，同时兼容当前的 `scan_roots`、`files`、`file_meta`、`meta_tags`、`play_history`、`scene_bookmarks`、`settings` 和 FTS5 数据。稳定逻辑身份和新领域表在阶段 2 引入，避免把“迁移位置”和“重建身份”混成一个不可回滚的大提交。

目标领域模型为：

```text
workspaces
videos
video_files
fingerprints
media_metadata
assets
tags
video_tags
playlists
playlist_items
playback_history
scan_runs
scan_issues
schema_migrations
```

`video_id` 是 UUID 逻辑身份；路径、盘符和文件名只是 `video_files` 的物理位置。指纹包含 `algorithm` 与 `version`，V1 的 `quick-v1` 由大小、规范化时长、首尾 4 MiB 哈希和主要流签名组成；小文件直接做全文件哈希。弱证据、多个候选或重复副本都进入问题队列，不自动合并。

### 扫描与派生资产

扫描分为枚举、快速比较、探测/指纹、身份判定、SQLite 事务提交和派生任务。索引记录先可见，封面和 4×4 Sheet 由持久化任务异步生成；单文件 FFmpeg/ffprobe 失败只影响该文件。文件缺失先标记 `missing`，默认保留 30 天，用户确认后再清理。

资产路径使用 `video_id`，并记录 `source` 与 `generation_version`。来源优先级为 `manual > embedded > sidecar > auto`，自动重建绝不覆盖 manual；临时帧和最终 WebP 使用临时文件加原子替换。

### 播放与外部播放器

内置播放器继续处理 Chromium 稳定支持的 MP4。AVI/WMV 至少完成索引、元数据和视觉资产；外部播放通过 `PlayerAdapter` 调用 PotPlayer。M3U8 使用 UTF-8、`#EXTM3U`、`#EXTINF` 和运行时绝对路径，每次按当前盘符重新生成；外部进程只接受参数数组，不拼接 shell 命令。

## 失败处理与安全约束

1. 迁移开始前创建 SQLite 一致性备份和配置快照，写入临时文件后校验并原子改名。
2. 每个迁移步骤包含版本、checksum 和事务边界；迁移失败停止主界面写入，并提供从最近备份恢复的入口。
3. 所有应用内文件操作先验证源存在、目标可写、目标不冲突且目标仍在允许的工作区范围内；跨卷移动使用临时目标、大小/哈希校验和原子改名。
4. 外接盘拔出、FFmpeg 超时、数据库锁、进程中断和单文件损坏都必须留下稳定错误码/问题记录，不得让扫描整体静默成功。
5. 日志记录任务编号、路径摘要、错误码和耗时，不记录媒体内容；测试覆盖中文、空格、长路径、UNC、盘符变化、重复文件和恢复中断。

## 阶段 0 退出条件

阶段 0 的交付物是：

- 当前仓库架构和能力审计；
- 本方案与上游现状的差距矩阵；
- 需要修改/新增的模块清单；
- 迁移、兼容和基线测试风险；
- 可独立验证的阶段 1 实施计划；
- `typecheck`、unit、E2E 和 Windows portable 构建的真实结果。

在这些结果得到确认前，不进入阶段 1 功能实现。
