# 托盘、视频格式与增量升级实施计划

## 任务 1：写回归测试并复现当前失败

1. 在主进程 logo 资源测试中加入托盘 PNG Data URL 的格式断言。
2. 在 server 集成测试中生成小型 WMV2/WMAV2 文件，并断言媒体端点能返回 fMP4。
3. 先运行定向测试，保存当前托盘资源缺失和 WMV `500` 的失败证据。

## 任务 2：修复托盘资源

1. 将现有生成的 32px 橙色 PNG 以内嵌 Data URL 形式加入共享 branding 资源。
2. 让 `Tray` 使用 PNG，保留窗口/任务栏 SVG。
3. 运行 logo 单测，并用真实 Electron 主进程确认 SVG 是空图、PNG 是非空 32×32 图。

## 任务 3：修复容器/编码兼容性

1. 把 remux 会话的 FFmpeg 子进程抽象为可重试的 attempt。
2. 首次使用 `-c copy`；只有在没有输出且进程失败时启动 H.264/AAC fragmented MP4 回退。
3. 保留连接复用、首段历史重放、背压、超时、取消和并发槽位语义。
4. 运行 server 定向测试，确认 WMV、MKV、坏文件及并发场景。

## 任务 4：验证默认语言与增量数据

1. 保留现有 provider 默认中文和用户偏好测试。
2. 运行全新用户目录打包 smoke，确认首屏为中文。
3. 运行便携升级/回滚测试，确认完整 `Data` 哈希不变，并确认构建文件不含 `Data`。

## 任务 5：全量验证与交付

1. 运行 typecheck、core/renderer/portable tests、定向及完整 E2E。
2. 构建 Windows portable 包，运行真实打包程序 smoke。
3. 只提交本次相关的源码、测试和设计文档；检查工作树，推送到当前 fork 分支。
