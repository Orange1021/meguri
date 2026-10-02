# 托盘图标、广泛格式播放与增量升级设计

## 1. 目标

本次维护解决五个用户可见问题：

1. 解释仓库既有 lint 基线及其对实际使用的影响；
2. 修复 Windows 通知区域隐藏图标为空白的问题；
3. 让内置播放器覆盖 WMV、AVI 等 Chromium 不能直接解复用的常见视频容器；
4. 保证程序升级只替换可变更的程序部分，不重建或清空已有 `Data`；
5. 在没有保存语言偏好的新用户目录中默认使用简体中文。

## 2. 现状证据

- Electron 主进程把共享 SVG Data URL 交给 `nativeImage`。在 Windows 主进程中该图像返回 `0×0`，所以 `Tray` 在通知区域显示为空白；同一图标的 PNG 可以正常解码为 `32×32`。
- Renderer 使用 Chromium `<video>`。服务器对 `mkv/avi/wmv/flv/ts` 调用 FFmpeg，并使用 `-c copy` 输出 fragmented MP4。真实 WMV2 输入无法把 WMV2 编码写入 MP4，FFmpeg 返回失败；用 H.264/AAC 转码可以生成有效 fMP4。
- `I18nProvider` 在没有 `meguri.lang` 时已经返回 `zh-CN`，并保留有效的用户选择。全新用户目录 smoke 必须覆盖这个运行时行为。
- 便携升级服务只交换 `App`、`App.new` 和 `App.previous`，`Data`/`Media` 在事务外保持原位；升级和回滚测试对完整 `Data` 树做哈希校验。

## 3. 设计

### 3.1 Windows 托盘图标

使用由现有橙色 SVG 生成的 32px PNG Data URL 作为托盘专用资源。窗口图标继续使用现有共享 SVG，避免改变已经正常工作的任务栏链路。托盘资源必须满足 PNG 签名和 Electron `nativeImage` 非空/尺寸检查，并通过打包后 Windows smoke。

### 3.2 视频播放

保留当前 Chromium `<video>` UI、Range 播放和时间点 seek 协议。

对需要 FFmpeg 的容器先尝试无损 `-c copy` remux，以保留 MKV 等兼容编码的低 CPU 路径；如果 FFmpeg 在尚未输出任何媒体字节前失败，则在同一个请求/会话中回退到 H.264（`libx264`）与 AAC 转码，输出相同的 fragmented MP4。转码路径只选择首个视频流和首个音频流，排除不能放入 MP4 的附加数据流。

这样播放器本身仍是 Chromium，但输入格式由内置 FFmpeg 解码能力扩展；不要求用户额外安装 VLC 或 PotPlayer。外部打开和 PotPlayer 播放列表功能继续保留为兜底/独立能力。

### 3.3 增量升级与数据安全

不改变 `Data` 的解析路径、数据库身份或资产目录。程序构建产物不包含仓库 `Data`；目录式便携升级仍通过 `App.new` 原子替换 `App`，保留 `App.previous` 回滚。数据库 schema 迁移继续由启动时的备份前迁移链路负责，不在程序更新时复制或重建用户数据库。

### 3.4 语言默认值

无保存偏好时使用 `zh-CN`；已有有效偏好继续有效，避免更新覆盖用户主动选择。测试覆盖 provider 默认值和全新打包运行时的 `<html lang>`/首屏中文文本。

## 4. 非目标

- 本次不清理与功能无关的 84 个 lint error 和 2 个 warning；它们作为历史质量债单独记录。
- 本次不把所有视频预转码落盘，不修改原始媒体，不在 `Data` 中生成新的媒体副本。
- 不引入新的桌面播放器依赖；PotPlayer 仅作为已有的外部播放能力。

## 5. 验收标准

- Windows 托盘 PNG 在 Electron `nativeImage` 中非空且为 32×32，打包程序启动后托盘资源 smoke 通过。
- WMV2 回归测试返回 200、`Content-Type: video/mp4`，并且响应包含 `ftyp`；已有 MKV remux、坏文件 500、并发会话和 seek 行为不回归。
- 全新用户目录运行时语言为 `zh-CN`，已保存语言仍可恢复。
- `npm test`、定向 E2E、便携升级哈希测试和 Windows portable 构建通过。
- 现有 `Data` 内容在激活和回滚前后字节级哈希不变。
