# 视频播放与便携资源回归修复设计

## 背景

当前便携版有三类回归：部分 AVI 被把不兼容的编码直接封装进 MP4，Chromium 报 MEDIA_ERR_SRC_NOT_SUPPORTED；便携目录从 release 移到根目录后，数据库中的缩略图绝对路径仍指向旧目录；播放器全屏后，画面模式菜单仍通过 Portal 挂在 document.body，全屏子树之外。

启动日志还显示派生封面和联系表生成使用以 .tmp 结尾的 FFmpeg 输出文件名，FFmpeg 无法判断 WebP 输出格式。

## 目标

1. 根据实际视频和音频流编码决定是否转成 H.264/AAC；兼容流继续使用无损封装。
2. 启动数据库时修复移动便携目录造成的内部缩略图路径；缺失文件重新进入扫描。
3. 让派生 WebP 的 FFmpeg 临时文件保留 .webp 扩展名。
4. 全屏时把画面模式菜单挂到播放器全屏节点内，普通模式不改变。
5. 每个根因有回归测试，并重新打包、启动验证、推送 main。

不改变原始媒体、不提交 Data/Media、不改变按视频保存画面模式的语义。

## 设计

### 播放编码

保留现有 Fragmented MP4 流式服务。读取 ffprobe 的视频和音频流：视频不是 H.264、H.264 像素格式不是 yuv420p/yuvj420p，或音频不是 AAC 时，直接进入现有 H.264/AAC 转码路径；未知元数据继续保留旧 fallback。

### 缩略图路径

缩略图标准位置由当前 Data 目录和文件 ID 推导为 thumbs/<id>.webp。Core.init 打开数据库后执行幂等修复：标准文件存在则更新旧路径；标准文件和旧路径都不存在则清除路径并设为 pending。只使用当前 Data 目录下的标准路径，不信任旧数据库路径。

### 资产与全屏菜单

派生 WebP 临时文件末尾保留 .webp，再原子 rename。共享 DropdownMenuContent 增加可选 Portal 容器；播放器全屏时传入播放器包装节点，退出全屏恢复 body Portal。

## 验证

覆盖 AVI MPEG-4/AC-3、兼容 H.264/AAC、缩略图旧目录迁移与幂等、缺失缩略图重试、WebP 临时扩展名、全屏菜单 DOM 归属；最后运行 npm test、npm run typecheck、npm run dist:portable，并做便携 EXE 启动冒烟测试。

