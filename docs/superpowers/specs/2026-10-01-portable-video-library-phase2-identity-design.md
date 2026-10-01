# 便携式本地视频库阶段 2.1：稳定身份与增量索引设计

- 日期：2026-10-01
- 状态：已获用户确认，待实施
- 分支：`feat/portable-video-library-v2`
- 关联：`docs/superpowers/specs/2026-10-01-portable-video-library-design.md`
- 前置版本：阶段 1 `87138bc`

## 1. 目标

阶段 2.1 只建立“稳定逻辑身份 + 可追踪增量扫描”的最小闭环：

1. 为媒体建立与物理路径无关的 UUID `video_id`。
2. 使用带算法和版本的 `quick-v1` 指纹识别移动、改名、内容替换和重复副本。
3. 把扫描运行状态、单文件失败和身份冲突持久化到 SQLite。
4. 保持当前列表、搜索、标签、历史、集合和播放接口不变。
5. 让旧数据库能够安全升级，并允许未来继续引入 `video_files`、资产和播放列表领域模型。

阶段 2.1 不试图一次性完成所有后续领域。封面/Sheet 资产、表达式播放列表、PotPlayer/M3U8 适配和完整的 `files` 到 `video_files` 规范化分别留在后续阶段。

## 2. 现状与约束

当前数据库将每个物理文件存放在 `files` 表中，`files.id` 是 SQLite 整数主键；当前 `content_hash` 是首尾各 1 MiB 的采样哈希，`meta_key` 使用内容哈希或工作区内相对路径回退值。扫描移动候选按 `(content_hash, size)` 查询并取第一个候选。

这些机制可以继续作为兼容层，但不能直接充当新的逻辑身份：

- 路径和盘符变化不应改变媒体身份。
- 采样哈希只能作为候选证据，不能在多候选时静默选择第一条。
- 内容被替换时，不能把新内容继续挂在旧的逻辑身份上。
- 旧的 `file_meta`、标签、历史和 FTS 依赖现有 `files`/`meta_key`，不能在本阶段整体重写。
- Windows 下 SQLite 迁移、文件扫描和临时文件写入必须保持可恢复、可重试和可验证。

## 3. 方案选择

### 方案 A：立即完成全量规范化

新增 `videos`、`video_files`、`media_metadata`，并同步改造所有查询、IPC、Renderer、集合和历史引用。

优点是最终模型最干净；缺点是改动面最大，会同时触碰已稳定的跨工作区查询、用户元数据和播放链路，回滚成本高。本阶段不采用。

### 方案 B：兼容桥接（选定）

新增稳定身份和扫描领域表，在现有 `files` 上增加可空的 `video_id` 兼容字段。扫描服务负责在一个事务中维护二者；现有查询继续读取 `files`，新身份服务通过 `video_id` 和指纹表工作。

优点是可以先验证身份决策、冲突和恢复行为，不需要重写现有 UI；缺点是阶段性存在旧模型和新模型并存，需要明确所有写入必须经过身份服务或兼容事务。

### 方案 C：只建立影子身份账本

只新增 `videos` 和 `fingerprints`，暂时不绑定 `files`。

该方案风险最低，但不能真正解决移动、替换和冲突处理，无法形成可验收的增量索引闭环，因此不采用。

## 4. 数据模型

### 4.1 `videos`：逻辑媒体身份

```sql
videos (
  video_id     TEXT PRIMARY KEY,              -- RFC 4122 UUID v4
  kind         TEXT NOT NULL CHECK (kind IN ('video','image','audio')),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','missing')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  missing_at   INTEGER
)
```

`video_id` 由 `crypto.randomUUID()` 生成，不由路径、盘符或文件名派生。一个逻辑媒体可以对应多个物理副本；只有在所有物理文件都不可见时才转为 `missing`。

阶段 2.1 不自动合并已经存在的多个逻辑身份。迁移会为旧 `files` 行一对一生成身份，避免在升级时凭不完整证据重绑用户数据。

### 4.2 `files.video_id`：兼容投影

现有 `files` 增加：

```sql
video_id TEXT
```

并建立 `idx_files_video_id`。新数据库在基础 DDL 中包含该列；旧数据库通过版本化迁移补齐。迁移完成后，现有行必须有值，新写入行也必须在同一事务中完成绑定；数据库层暂不加 `NOT NULL`，以便兼容历史表重建和失败恢复。

本阶段不重复创建 `video_files` 表：现有 `files` 已经承担物理文件记录，新增重复映射会制造两个来源的真相。后续完整规范化时，`files.video_id` 将迁移为 `video_files` 的兼容投影，并保留旧查询的过渡期。

### 4.3 `fingerprints`：文件级当前指纹

```sql
fingerprints (
  id                INTEGER PRIMARY KEY,
  file_id           INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  algorithm         TEXT NOT NULL,             -- 'quick'
  version           TEXT NOT NULL,             -- 'v1'
  fingerprint_key   TEXT NOT NULL,
  size              INTEGER NOT NULL,
  duration_ms       INTEGER,
  first_hash        TEXT,
  last_hash         TEXT,
  full_hash         TEXT,
  stream_signature  TEXT NOT NULL,
  computed_at       INTEGER NOT NULL,
  UNIQUE (file_id, algorithm, version)
)
```

`fingerprints` 保存每个物理文件和算法版本的当前结果；文件内容改变时更新同一算法版本的记录，不删除逻辑身份。`fingerprint_key` 是按下述规范化字段生成的 SHA-256，用于候选检索；明细字段保留用于诊断和未来算法升级。

索引：

- `idx_fingerprints_key`：`(algorithm, version, fingerprint_key)`。
- `idx_fingerprints_file`：`(file_id, algorithm, version)`，由唯一约束提供。

### 4.4 `scan_runs`：扫描运行记录

```sql
scan_runs (
  run_id       TEXT PRIMARY KEY,              -- UUID v4
  root_id      INTEGER NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
  status       TEXT NOT NULL
               CHECK (status IN ('running','completed','aborted','failed')),
  phase        TEXT,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER,
  stats_json   TEXT,
  error_code   TEXT,
  error_detail TEXT
)
```

`completed` 允许同时存在 `scan_issues`，表示扫描流程完成但部分文件需要人工处理。进程中断或用户取消必须留下 `aborted`；未捕获异常必须留下 `failed`，不能静默伪装成成功。

### 4.5 `scan_issues`：持久化问题队列

```sql
scan_issues (
  id                       INTEGER PRIMARY KEY,
  run_id                   TEXT NOT NULL REFERENCES scan_runs(run_id) ON DELETE CASCADE,
  file_id                  INTEGER REFERENCES files(id) ON DELETE SET NULL,
  issue_type               TEXT NOT NULL,
  severity                 TEXT NOT NULL CHECK (severity IN ('warning','error')),
  status                   TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','resolved','ignored')),
  candidate_video_ids_json TEXT,
  details_json             TEXT,
  created_at               INTEGER NOT NULL,
  resolved_at              INTEGER
)
```

第一版 `issue_type` 至少支持：

- `ambiguous_identity`：存在多个高相似候选，禁止自动选择。
- `duplicate_candidate`：发现可能重复副本，但已有多个逻辑身份，禁止自动合并。
- `fingerprint_failed`：读取指纹所需的文件内容失败。
- `probe_failed`：ffprobe/媒体探测失败，无法形成足够强的流签名。
- `file_missing`：物理文件不再存在，供后续缺失保留策略使用。

候选身份和诊断字段统一存为 JSON；写入前由领域类型校验，读取失败时保留原始文本并报告错误，不让问题队列读取阻塞主扫描。

## 5. `quick-v1` 指纹规范

现有 `files.content_hash` 继续保持原语义，避免改变 `meta_key` 和旧重复查询。本阶段新建独立的 `quick-v1`，两者不混用。

### 5.1 字节证据

- 采样窗口固定为 4 MiB。
- 文件大小小于等于 8 MiB 时计算全文件 SHA-256，写入 `full_hash`；首尾字段可以复用同一全文件摘要，但 `fingerprint_key` 以 `full_hash` 为主。
- 大文件分别计算首 4 MiB 和末 4 MiB SHA-256，写入 `first_hash`、`last_hash`；`full_hash` 为 NULL。
- 所有读取使用异步文件句柄；读到的大小必须与扫描阶段的 stat 结果一致，否则本次指纹作废并记录问题。

### 5.2 媒体证据

- `duration_ms = round(max(duration, 0) * 1000)`；未知时为 NULL。
- `stream_signature` 使用稳定 JSON，字段顺序固定，至少包含 `kind`、`codec`、`width`、`height`、`fps_milli`；未知字段显式写 NULL。
- 扩展名和绝对路径不进入指纹，因此改名、换盘符和常规路径迁移不会改变候选结果。
- 流签名来自现有媒体探测结果；探测失败时允许保存字节证据，但身份决策按弱证据规则处理。

### 5.3 `fingerprint_key`

按固定字段顺序构造数组并使用 JSON 编码，避免分隔符歧义：

```text
[
  "quick-v1",
  size,
  duration_ms,
  first_hash,
  last_hash,
  full_hash,
  stream_signature
]
```

对该 JSON 的 UTF-8 字节计算 SHA-256 得到 `fingerprint_key`。所有算法常量集中在 `fingerprint.ts`，禁止在扫描、查询和测试中重复定义。

## 6. 身份决策规则

`identity.ts` 提供不依赖 SQLite 和文件系统的纯决策函数；数据库写入由 `scanService.ts` 在事务中执行。

1. **同一物理行未变化**：保留现有 `video_id`，只刷新 `last_seen_at`。
2. **同一物理行内容变化**：不能继续沿用旧 `video_id`。若新指纹命中唯一且高置信度的其他逻辑身份，则绑定到该身份；否则创建新的 `video_id`，旧身份在没有其他文件时转为 `missing`。
3. **新物理行或明确的改名候选**：唯一且高置信度命中时复用候选的 `video_id`；没有候选时创建新的 `video_id`。
4. **多个候选**：不取第一条，不自动合并；创建/保留当前物理行的新身份，并写入 `ambiguous_identity` 或 `duplicate_candidate`。
5. **弱证据**：缺少必要流签名、文件读不完整或只命中旧采样哈希时，不自动绑定到已有身份；写入问题队列供后续重试或人工处理。
6. **多个副本**：当只有一个已确认的逻辑身份候选时，多个物理文件可以共享一个 `video_id`；若候选属于多个不同逻辑身份，保持身份分离并记录冲突。
7. **旧数据库首次升级**：迁移只做一对一身份初始化，不做批量去重；后续扫描使用新指纹逐条处理。

旧 `content_hash` 只负责提供快速预候选，最终是否移动、复用或替换必须经过 `quick-v1` 和上述决策函数确认。`syncFiles()` 不得再对多个移动候选静默 `find()` 第一条。

## 7. 扫描编排

阶段 2.1 的扫描链路调整为：

1. 在 `walk()` 前创建 `scan_runs(status='running')`。
2. 复用现有枚举和增量 stat；对新文件、内容变化文件和没有新指纹的旧行准备指纹任务。
3. 复用现有媒体探测结果，补齐 `duration_ms` 和 `stream_signature`。
4. 在单个数据库事务中写入/更新 `fingerprints`、创建或复用 `videos`、更新 `files.video_id`，并记录冲突。
5. 继续执行现有 FTS、缩略图、自动标签和元数据流程；不改变现有 IPC DTO。
6. 正常结束时将运行标记为 `completed`；取消或 AbortSignal 标记为 `aborted`；异常路径标记为 `failed` 并保留错误码。
7. 未完成的扫描不得执行“未见文件软删除”步骤；这保持当前中断恢复语义。

所有单文件读取、探测和指纹错误都进入 `scan_issues` 后继续处理其他文件；只有数据库迁移、数据库写入或整体扫描编排失败才使 `scan_run` 进入 `failed`。

## 8. 迁移与兼容性

- 在现有 checksummed migration registry 中增加一个连续版本，例如 `video-identity-v1`。
- 迁移顺序：创建新表和索引；补齐 `files.video_id`；为现有文件行一对一生成 UUID；依据 `deleted_at` 初始化 `videos.status`；最后写入迁移记录。
- 迁移不访问媒体文件、不调用 ffprobe、不生成缩略图，保证事务短且在 Windows 上可回滚。
- 迁移必须可重复打开；中途失败时新表、字段和身份初始化不能留下半完成状态。
- `openDbReadonly()` 只在主连接完成迁移后打开，保持现有查询 worker 约束。
- `clearIndex()` 的重建流程必须保留逻辑身份和扫描问题的设计语义，不能在阶段 2.1 中误删 `videos`；若某个物理行被重建，需要通过指纹重新绑定，而不是用整数 `files.id` 作为身份。

## 9. 测试与验收

### 单元和核心测试

- `quick-v1`：小文件全哈希、大文件首尾 4 MiB、大小变化、元数据规范化、流签名字段顺序和算法版本隔离。
- 身份决策：未变化、唯一候选、内容替换、无候选、多候选、弱证据、多个副本和旧身份不自动合并。
- 迁移：新库、阶段 1 旧库、重复打开、迁移失败回滚、旧行一对一 UUID 初始化。
- 扫描状态：完成、取消、异常、单文件失败后继续，以及问题记录的候选集合。
- 现有 `scan.test.ts` 回归：插入、未变化、改名、替换、删除、音视频扩展名重分类。

### 集成和 Windows 验收

- 全部 Electron 核心、Renderer 和 E2E 回归测试通过。
- 阶段 1 的 typecheck、build、Windows portable 打包继续通过。
- 在临时 portable Data 目录中完成迁移、关闭、重启和再次扫描；确认程序目录不产生用户数据库。
- 人为中断扫描后重新启动，确认 `scan_runs` 可识别、未见文件不会被错误删除，后续扫描可继续收敛。

## 10. 后续演进

阶段 2.1 稳定后再考虑：

1. 将 `files` 物理记录迁移到正式 `video_files`，逐步切换查询和元数据引用。
2. 建立以 `video_id` 为根的 Cover/Sheet 资产任务队列。
3. 将标签表达式、播放列表和播放历史统一迁移到逻辑身份。
4. 接入 PotPlayer/M3U8 外部播放适配器。

这些工作不得在阶段 2.1 中通过临时字段或跨领域大迁移提前混入。
