# 桃屁屁

桃屁屁是一款面向程序员的本地健康陪伴桌宠。它常驻桌面并置顶显示，用番茄钟、生活提醒、健康分和“久坐气球爆炸”帮助用户建立更健康的工作节奏。

## MVP 功能

- macOS / Windows 通用的透明置顶桌宠，可拖动、点击互动。
- 25/5 分钟番茄钟（可在设置中修改）；专注结束后点击桃屁屁确认开始休息。
- 喝水、起身活动、上厕所、休息眼睛四类独立提醒，可设置开关和间隔。
- 键鼠持续活跃会累积压力，桃屁屁逐级膨胀；达到上限会爆炸并扣健康分。
- 离开键鼠 3 分钟会被识别为有效休息；完成健康行为可缓解压力、恢复分数。
- 本地统计屏幕活跃时间、番茄、休息、爆炸和健康行为，展示最近 7 天趋势。
- 数据仅存放在本机 SQLite 数据库，不上传服务器。

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
npm run typecheck
npm test
npm run build
```

角色资产位于 `assets/generated/final`。角色均使用参考图生成；界面没有通过 HTML/CSS 绘制桃屁屁本体。
