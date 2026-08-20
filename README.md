# 桃屁屁

桃屁屁是一款面向程序员的本地健康陪伴桌宠。它常驻桌面并置顶显示，用番茄钟、生活提醒、健康分和“久坐气球爆炸”帮助用户建立更健康的工作节奏。

## 当前 MVP

- macOS / Windows 通用的透明置顶桌宠，可拖动、点击互动。
- 25/5 分钟番茄钟；专注结束后点击桃屁屁确认开始休息。
- 喝水、起身活动、上厕所、休息眼睛四类独立提醒，可设置开关和间隔。
- 键鼠持续活跃会累积压力，桃屁屁逐渐变红和膨胀；达到上限会全屏爆炸并扣健康分。
- 离开键鼠 3 分钟会被识别为有效休息；完成健康行为可缓解压力、恢复分数。
- 健康能量每天从 50 分开始，健康行为与有效休息加分，忽略提醒和爆炸扣分。
- 本地统计屏幕活跃时间、番茄、休息、爆炸和健康行为，桃桃小屋展示最近 7 天趋势。
- 数据仅存放在本机 SQLite 数据库，不上传服务器。

## 视频动作与交互

用户提供的 5 段固定镜头动画已整理为挥手、专注敲电脑、睡觉、厕所和压力/爆炸动作。原始 MP4 位于 `assets/video/source`，应用使用的透明 VP9 WebM 位于 `assets/video/generated`。

- 待机不持续晃动；启动或合格悬停时问候只播放一次。
- 专注动作播放一次后停在稳定工作帧；睡觉只循环低动作片段，倒计时不常驻宠物底部。
- macOS 从菜单栏查看倒计时；Windows 从任务栏进度和托盘查看；专注时悬停宠物也会用气泡说出剩余时间。
- 宠物可单独缩放，操作菜单保持固定可读大小。

新增动作视频时，请按 [视频资产工作流](docs/video-asset-workflow.md) 完成抽帧、`rembg` 去背、尺寸/锚点归一、裁尾帧、VP9 Alpha 编码和验收。完整产品规则见 [Proposal / PRD](docs/sdd/proposal.md)、[Design](docs/sdd/design.md) 和 [任务清单](docs/sdd/tasks.md)。

## 桃桃小屋图像素材

统计页的 3D 漫射风房间、能量弧、健康道具、便签、计时器和桃子节点均为独立生成图片，位于 `assets/dashboard`，清单在 `assets/dashboard/manifest.json`。页面以用户选中的桃桃小屋设计稿为参考；角色或 3D 道具不使用 HTML/CSS/SVG 仿造。

## 在 Mac 上运行

```bash
npm install
npm run dev
```

构建可直接运行的应用：

```bash
npm run dist:mac
```

产物位于 `release/mac-arm64/桃屁屁.app` 或 `release/mac/桃屁屁.app`。首次运行未签名开发版时，可在 Finder 中右键应用并选择“打开”。

## 在 Windows 上运行

在 Windows 10/11 的 PowerShell 中安装 Node.js 20 或更高版本，然后进入项目目录：

```powershell
npm install
npm run dev
```

生成安装程序：

```powershell
npm run dist:win
```

NSIS 安装包会输出到 `release`。Windows 安装包应当在 Windows 机器或 Windows CI 上构建；macOS 无法可靠完成 Windows 原生依赖打包。未签名测试版可能触发 SmartScreen，正式发布前应配置代码签名证书。

## 检查

```bash
npm run assets:check
npm run videos:check
npm run typecheck
npm test
npm run build
```

角色资产位于 `assets/generated/final`。角色均使用参考图生成；界面没有通过 HTML/CSS 绘制桃屁屁本体。视频生成环境仅供素材制作，应用使用已经生成的 WebM，最终用户无需安装 `rembg`。
