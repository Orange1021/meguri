# 橙映便携布局、诊断与品牌统一实施计划

## 1. 先写失败测试

- portable path：直接 exe 目录和 `App/` 目录都解析到同一个便携根目录。
- peek：右边缘拖拽、右键增宽/左键减宽，并增加真实 DOM 布局验收。
- scan：失败事件携带错误详情和日志路径。
- jobs：ffmpeg/ffprobe 失败写入 `scan_issues`。

## 2. 实现

- 修正便携根目录解析。
- 反转 Home flex sibling 顺序，调整 peek 边框、拖拽手柄和方向键。
- 为媒体处理增加可选诊断回调，并在扫描事务中记录结构化问题。
- 扩展 IPC 扫描事件，添加打开日志目录入口。
- 集中可见产品名为“橙映”，设置 ASCII 可执行文件名 `OrangeView.exe`，更新窗口、托盘、脚本、文档和打包资源配置。

## 3. 验证与独立审查

- 运行聚焦测试，修复回归。
- 运行完整 typecheck、核心/renderer/E2E、build 和 portable dist。
- 对打包目录和图标资源做静态检查。
- 重新派发独立 code review，逐条处理 Critical/Important 反馈。
