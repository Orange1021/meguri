# 便携式本地视频库阶段 0 审计

**日期：** 2026-10-01
**仓库：** `D:\Projects\PortableVideoLibrary`
**分支：** `feat/portable-video-library-v2`
**基线提交：** `854a482`
**基线远端：** `origin=https://github.com/Orange1021/meguri.git`，`upstream=https://github.com/zabuton-app/meguri.git`

## 审计结论

Meguri 已经具备可复用的桌面媒体库骨架：Electron Main/Preload/Renderer 隔离、类型化并校验的 IPC、按工作区扫描、增量大小/mtime 比较、采样内容哈希、移动/改名跟踪、SQLite WAL/FTS5、FFmpeg/ffprobe、缩略图、标签、历史、集合和 Windows portable 打包均已存在。

当前实现仍是“安装在本机、数据放 Electron userData 的多媒体浏览器”，不是“程序与 Data 分离、换盘符后保持身份和用户数据的便携视频库”。主要风险不在 UI，而在持久化位置、数据库迁移/备份、逻辑身份、冲突判定和外部播放器适配。

## 当前架构与能力

| 领域 | 当前实现 | 对本项目的判断 |
| --- | --- | --- |
| Renderer/Main 边界 | `electron/preload.ts` 仅暴露白名单 IPC；`shared/ipc/*` 提供 Zod 输入和类型；Renderer 不直接访问 Node | 可复用，作为安全边界保留 |
| Main/Core | `electron/core/*` 负责 DB、工作区、扫描、媒体、查询、日志和本地 HTTP server | 可复用，后续按领域增加服务/适配器 |
| 工作区 | `electron/core/workspaces.ts` 用规范化绝对根路径和 `pathHash` 作为工作区 ID；每个根有独立 Core/SQLite | 需要增加便携 locator、稳定 workspace 记录和相对路径 |
| 配置/数据位置 | `electron/core/appConfig.ts` 将 `config.json` 写入 `app.getPath("userData")`；`electron/core/paths.ts` 将 DB/缩略图写入 `<userData>/roots/<pathHash>` | P0 缺口：必须迁移到可解析的 `Data` |
| 数据库 | `electron/core/db.ts` 使用 SQLite WAL、`foreign_keys=ON`、FTS5；表包括 `scan_roots`、`files`、`file_meta`、`meta_tags`、`play_history`、`scene_bookmarks`、`settings` | SQL/查询可以复用；迁移机制需要版本、checksum、备份和恢复状态 |
| 迁移 | 当前为 `CREATE IF NOT EXISTS`、`ALTER TABLE` 探测和表重建，没有 `schema_migrations`、`user_version` 或迁移前快照 | P0 缺口 |
| 扫描 | `electron/core/scan.ts` 枚举媒体，比较相对路径/size/mtime，新增/变化项做首尾各 1 MiB 采样 SHA-256；`jobs.ts` 负责 ffprobe、FFmpeg、缩略图和自动标签 | 扫描编排和并发模型可复用；需要改为 quick-v1、scan_run/issue、冲突和恢复队列 |
| 现有身份 | `files.id` 是 SQLite 整数；用户元数据绑定 `meta_key=content_hash` 或根内相对路径回退值 | 不满足稳定 UUID `video_id`；阶段 2 需要双轨迁移 |
| 移动/改名 | `syncFiles()` 用 `(content_hash,size)` 找候选并取第一个未见旧路径；同路径变化会更新原 `files` 行 | 不满足多候选冲突、不自动继承替换内容身份的要求 |
| 缺失/删除 | 扫描将未见文件标记 `deleted_at`；UI 另有从索引删除操作 | 需要 missing 状态、30 天保留、确认清理和问题记录 |
| 派生资产 | 每个 `files.id` 下保存单个 WebP 缩略图；支持手动帧偏移、内嵌封面和自动缩略图 | 不满足 Cover/4×4 Sheet/manual asset source 与版本化队列 |
| 标签 | `tags` 有 namespace，`meta_tags.source` 区分 manual/auto-meta；自动标签可按规则集回填 | 可复用字典和 FTS 同步；需要视频级标签、来源、批量和 AND/OR AST 设计 |
| 播放列表 | 用户集合写入 `userData/config.json`，智能集合保存在 Renderer `localStorage` 的 `meguri.smartCollections.v1`；内置播放和系统外部打开已存在 | 不满足持久化 static/smart playlist、M3U8、PotPlayer 配置 |
| 外部进程 | `electron/ipc/shell.ts` 使用 Electron `shell.openPath` 或平台默认打开，不拼接 shell 命令 | 安全边界可复用；PotPlayer 需新增参数数组适配器 |
| 打包 | `package.json` 已配置 `nsis`、`portable`、`appx`，并将 better-sqlite3/FFmpeg/ffprobe `asarUnpack` | 构建基础可复用；运行时仍依赖 `userData`，便携数据尚未实现 |

## 差距矩阵

| 方案要求 | 上游现状 | 差距 | 阶段 |
| --- | --- | --- | --- |
| `App` 与 `Data` 分离 | 程序可生成 portable exe，但 DB/config 仍写 Electron `userData` | 便携包可能出现第二份系统数据，换盘符也无法按包内 Data 恢复 | 1 |
| 同盘媒体相对路径 | `scan_roots.path`、`files.abs_path` 保存绝对路径，root ID 由绝对路径 hash 得到 | 盘符变化会改变工作区身份和路径解析 | 1 |
| 版本化 schema migration | 版本无编号，启动时按当前 DDL/列探测自修复 | 无法可靠判断版本、checksum、失败位置和回滚边界 | 1 |
| 迁移前备份/恢复 | 没有一致性备份服务和恢复入口 | 升级或移动硬盘中断可能只留下部分写入 | 1 |
| 稳定 `workspace_id` | 由规范化绝对路径 hash 派生 | 路径变化导致逻辑身份变化 | 1/2 |
| UUID `video_id` 与物理文件分离 | 已增加 `files.video_id`、`videos` 和事务化身份服务；旧行迁移时一对一生成 UUID | 阶段 2.1 已覆盖复制、替换、缺失、重复候选和冲突记录；跨工作区统一身份仍留待后续规范化 | 2.1 已实现 |
| `quick-v1` fingerprint | 已实现固定 4 MiB 采样、8 MiB 以下全哈希、媒体流签名和版本化 key | 作为当前身份候选证据；更强的内容验证和算法升级留待后续阶段 | 2.1 已实现 |
| 冲突队列 | 移动候选取第一个；没有 `scan_issues` | 多候选/弱证据可能误关联 | 2 |
| 持久化扫描状态 | `scan_runs` 保存阶段、完成/取消/失败状态和错误；`scan_issues` 保存单文件问题与冲突 | 断点恢复和缺失保留策略仍待后续阶段 | 2.1 已实现 |
| Cover/Sheet/manual 资产 | 单缩略图 `thumb_path`，无 source/generation version | 自动重建无法按来源保护人工资产，也没有 4×4 Sheet | 3 |
| 纯标签 AND/OR/NOT | 当前是 tags 数组和可保存 SearchQuery；智能集合在 localStorage | 没有版本化 rule AST、SQLite 播放列表和跨重启统一数据 | 4 |
| M3U8/PotPlayer | 只有内置/系统默认外部打开 | 无当前盘符路径重新生成、播放器发现和顺序验证 | 5 |
| 升级/回退演练 | portable artifact 可构建，没有 App.new/App.previous 和 schema 兼容流程 | 发布无法保证 Data 不变、失败可回退 | 6 |

## 需要修改和新增的模块

### 阶段 1 修改

- `electron/core/paths.ts`：从仅依赖 `app.getPath("userData")` 改为使用可注入的便携布局解析结果。
- `electron/core/appConfig.ts`：配置路径改为 `Data/config.json`，增加旧 `userData` 检测、复制式迁移和配置备份。
- `electron/core/index.ts`、`electron/core/workspaces.ts`：Core 初始化使用 Data 下的数据库/资产路径，保持现有查询 API 兼容。
- `electron/core/db.ts`：引入 `schema_migrations` 和迁移运行器；保留旧表的兼容迁移，不在第一步重写全部领域模型。
- `electron/main.ts`：启动时解析 Portable 根目录，Data 缺失/迁移失败时进入可恢复状态，不静默创建系统 userData 数据库。
- `scripts/run-electron-vitest.mjs`：消除 Windows `ELECTRON_RUN_AS_NODE=1` 的 shell 语法依赖。
- `docs/README.md`、`docs/data-model.md`、`README.md`：更新开发、便携发布、数据位置和恢复说明。

### 阶段 1 新增

- `electron/core/portablePaths.ts`：`PortableLayout`、根目录解析、路径安全和目录初始化。
- `electron/core/migrations.ts`：版本/步骤/checksum、迁移事务、失败状态和兼容性检查。
- `electron/core/backups.ts`：SQLite 一致性快照、配置快照、manifest、临时文件和原子提交。
- `electron/core/portableRecovery.ts`：Data 缺失、迁移失败、备份恢复和旧数据导入结果。
- `electron/core/__tests__/portablePaths.test.ts`、`backups.test.ts`、`migrations.test.ts`：阶段 1 单元/集成测试。
- `e2e/portable-data.spec.ts`：便携目录、Data 保留、重启和迁移失败 UI 流程。

### 阶段 2.1 已实现与后续预留

- 已实现：`electron/core/identity.ts`、`fingerprint.ts`、`scanService.ts`、`queries/identity.ts`，以及 `videos`、`fingerprints`、`scan_runs`、`scan_issues` 和 `files.video_id` 的 checksummed migration。
- 已实现：扫描运行阶段记录、`quick-v1` 指纹、唯一强证据复用、多候选冲突队列、内容替换隔离、旧行首次收敛和重建后的逻辑身份恢复。
- 阶段 3–5 仍预留：Cover/Sheet/manual 资产、表达式播放列表和 M3U8/PotPlayer 外部播放适配；本阶段不提前引入 `video_files` 大迁移。

## 迁移与兼容风险

1. **旧数据位置不一致。** 旧版使用系统 `userData`，新版使用包内 `Data`；迁移必须复制并校验，保留原位置直到新库成功打开。
2. **旧工作区是绝对路径。** 只有根目录位于便携根目录的媒体才能安全转换为相对路径；外部根保留绝对路径并标记 `non_portable`。
3. **路径 hash 变化。** 旧 `<userData>/roots/<hash>` 目录不能仅按新路径重新计算后丢弃，必须建立旧 hash 到新 workspace 记录的映射。
4. **版本无编号。** 首次迁移要通过结构探测生成基线版本，之后所有新迁移必须记录 checksum；无法识别的 schema 停止写入。
5. **WAL 文件。** 复制数据库时必须使用 SQLite 一致性快照或 checkpoint，不能只复制 `db.sqlite` 而忽略 `-wal`/`-shm`。
6. **用户配置写入竞争。** `config.json` 更新需要临时文件、flush/rename 和损坏文件保留，不能覆盖最后一份可恢复配置。
7. **Electron 启动时机。** `app.getPath("userData")` 可能在 `app.ready` 前被调用；路径服务必须区分可测试的纯函数和 Electron 生命周期依赖。
8. **Windows 权限/路径。** 测试要覆盖中文、空格、长路径、UNC、盘符变化和只读目录；不能把 POSIX `/` 直接作为 Windows 断言。
9. **失败恢复状态。** 迁移失败时主窗口需要显示可行动作，不能继续打开旧/新两份数据库，也不能自动删除旧备份。

## 基线测试与构建结果

环境：Windows，Node `v24.15.0`，npm `11.5.2`，Electron `42.11.0`，依赖通过 `npm ci` 安装；`npm ci` 成功并报告 0 个漏洞。

| 命令 | 结果 | 真实输出摘要 |
| --- | --- | --- |
| `npm run typecheck` | 通过，exit 0 | `tsc --noEmit` 对 renderer、electron、e2e 三个 tsconfig 均通过 |
| `npm test` | 失败，exit 1 | `test:core` 在 Windows shell 中把 `ELECTRON_RUN_AS_NODE=1` 当成命令，尚未进入测试 |
| 等价 Windows core 命令 | 失败，exit 1 | 30 个文件：26 通过；539 个测试：495 通过、26 跳过、18 失败。失败集中在 Windows 路径分隔符、symlink `EPERM`、HEIF fixture 和 server 清理异常 |
| `npm run test:renderer` | 通过，exit 0 | 92 个文件、1447 个测试全部通过；jsdom 输出大量 HTMLMediaElement/Canvas 未实现警告 |
| `npm run test:e2e` | 失败，exit 1 | 76 个用例：75 通过、1 失败。`e2e/workspace.spec.ts:16` 等待 `e2e/fixtures/media` 文本 30 秒超时；生产构建部分成功 |
| `npm run dist -- --win portable` | 通过，exit 0 | 生成 `release/Meguri-0.8.0-win32-x64.exe`，141,312,024 bytes；已核验 better-sqlite3、FFmpeg、ffprobe 均在 unpacked 资源中 |
| `npm run lint` | 失败，exit 1 | 83 个问题：81 errors、2 warnings；主要来自既有测试 mock 的 unsafe any、React hooks lint 规则、未 await Promise 和 demo 工具 |

E2E 失败的 trace 已由 Playwright 保存在被忽略的 `test-results/workspace-Workspace-shows-workspace-path-in-header/trace.zip`，没有修改生产源码；构建和测试产物目录均被 `.gitignore` 忽略。本次新增的阶段 0 文档是审计交付物。

## 阶段 1 进入条件

阶段 1 开始前需要确认本报告和设计说明；确认后按 `docs/superpowers/plans/2026-10-01-portable-video-library-v1.md` 中的 TDD 顺序执行。阶段 1 完成必须重新运行 typecheck、core、renderer、E2E、portable smoke，并提供迁移前后 Data 清单和恢复演练结果。
