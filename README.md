# 桃屁屁

桃屁屁是一款面向程序员的本地健康陪伴桌宠。它常驻桌面并置顶显示，用番茄钟、生活提醒、健康分和“久坐气球爆炸”帮助用户建立更健康的工作节奏。

## 当前 MVP

- macOS / Windows 通用的透明置顶桌宠，可拖动、点击互动。
- 可调节专注、短休息、长休息和长休周期；专注结束后必须点击桃屁屁才开始休息。
- 每次休息都会依次提醒喝水、活动一下、上厕所、护眼；悬停桃屁屁可打卡，完成项立即退出本次轮播。
- 连续专注达到设置上限（默认 40 分钟）会累积爆炸压力；未休息时桃屁屁逐渐变红、膨胀，达到上限会全屏爆炸并扣分。
- 爆炸后桃屁屁进入瘪气锁定状态，必须完成至少 5 分钟有效休息才能恢复并重新开始专注。
- 健康能量每天从 0 分开始，不同健康行为按不同权重加分；每日行为计分有防刷上限，总累计不设最高分。
- 本地记录每种状态的持续时长、番茄、休息、爆炸、健康行为和反馈响应时间；桃桃小屋展示最近 7 天趋势。
- 数据仅存放在本机 SQLite 数据库，不上传服务器。

## 视频动作与交互

用户提供的固定镜头动画已整理为待机、挥手、变身、专注敲电脑、活动、喝水、护眼、厕所、睡觉、压力、爆炸和恢复动作。原始 MP4 位于 `assets/video/source`，应用使用的透明 VP9 WebM 位于 `assets/video/generated`。

- 待机只做低幅度眨眼、手脚和表情动作；完整打招呼只在右键选择“打招呼”后播放一次。
- 开始或取消专注会先播放完整旋风变身；专注期间持续循环安静敲电脑，点击宠物只提示保持专注。
- 每次休息按未完成项完整播放活动、喝水、厕所和护眼动作；第 4 个番茄的四项全部完成后才进入睡觉长休。
- 爆炸只播放爆开瞬间，结束后进入瘪气状态；倒计时不常驻宠物底部。
- macOS 从菜单栏查看倒计时；Windows 从任务栏进度和托盘查看；专注时悬停宠物也会用气泡说出剩余时间。
- 默认宠物保持小尺寸；系统右键菜单保持固定可读大小。

新增动作视频时，请按 [视频资产工作流](docs/video-asset-workflow.md) 完成抽帧、`rembg` 去背、尺寸/锚点归一、裁尾帧、VP9 Alpha 编码和验收。完整产品规则见 [Proposal / PRD](docs/sdd/proposal.md)、[Design](docs/sdd/design.md) 和 [任务清单](docs/sdd/tasks.md)。

实机视觉证据见 [状态视觉 QA](docs/qa/state-visual-qa.md) 与 [Product Design 对照验收](docs/qa/design-qa.md)。

## 桃桃小屋图像素材

统计页的 3D 漫射风房间、健康道具、拉伸人物和桃子节点均为独立生成图片，位于 `assets/dashboard`。当前界面聚焦最近 7 天能量、专注、活跃和四项健康行为；更长周期数据继续保存在本地数据库中，暂不在前台展示。角色或 3D 道具不使用 HTML/CSS/SVG 仿造。

## 在 Mac 上运行

```bash
npm install
npm run dev
```

构建可直接运行的应用（需要可访问 Electron 下载源）：

```bash
npm run dist:mac
```

产物位于 `release/mac-arm64/桃屁屁.app` 或 `release/mac/桃屁屁.app`。本机验收构建使用 Apple Silicon arm64；Intel Mac 需另行构建 x64 产物。开发签名版本未公证时，可在 Finder 中右键应用并选择“打开”。

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
