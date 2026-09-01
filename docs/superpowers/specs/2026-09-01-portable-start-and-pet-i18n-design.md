# 桃屁屁免安装启动与完整双语设计

## 目标

让 macOS 与 Windows 用户从同一份源码目录启动桃屁屁，不需要安装 `.app`、`.dmg` 或 `.exe`；同时保证语言切换为 English 后，宠物气泡、提醒、菜单、系统通知和全屏提示全部使用英文。

## 范围

### 本次实现

- 提供统一的 `npm start` 命令：先构建生产代码，再用 Electron 启动。
- macOS 与 Windows 使用相同的四步流程：安装 Node.js 22 LTS、下载源码、`npm install`、`npm start`。
- README 中文和英文部分首先展示免安装快速启动、更新和常见问题。
- 排查并消除宠物交互链路中的硬编码中文。
- 保存语言设置后，立即以新语言重新计算宠物当前气泡，而不是继续展示切换前缓存的文案。
- 为英文待机、打招呼、专注、休息队列、恢复、全屏提醒、菜单和系统通知补充自动测试。

### 本次不实现

- 不创建或上传 `.dmg`、`.app`、`.exe`、NSIS 安装包或 GitHub Release。
- 不处理 Apple 公证、Windows 代码签名或自动更新。
- 不改变现有动画、计分、番茄、休息和统计业务规则。

## 启动架构

`npm start` 是唯一面向普通源码用户的启动入口：

1. `electron-vite build` 生成主进程、预加载和界面生产代码。
2. Electron 从 `package.json` 的 `main` 入口启动 `out/main/index.js`。
3. 首次运行时，原生依赖由当前操作系统的 `npm install` 安装，因此同一源码方案同时适用于 macOS 和 Windows。
4. 应用仍将 SQLite 数据保存在 Electron 的本机用户数据目录，不向仓库写入个人数据。

开发者继续使用 `npm run dev`；普通用户使用 `npm start`，避免开发服务器、热更新和调试输出。

## 语言数据流

`settings.language` 是唯一语言来源。主进程运行时、菜单、通知、全屏接管和渲染器都读取同一个字段，并通过 `t(language, key, params)` 获取文案。

运行时不再根据中文字符串判断状态，也不再新建中文常量作为用户可见内容。保存新语言时会清理旧的临时气泡覆盖，让当前状态立即重新生成对应语言的文案。已有的计时、动画和状态保持不变。

## 错误处理

- 未执行 `npm install` 时，README 明确提示先安装依赖。
- Node.js 版本不符合要求时，通过 `engines.node` 和 `prestart` 检查给出清晰错误。
- 未知翻译键仍沿用现有回退规则，但测试要求所有宠物可见文案都存在中英文键。
- Windows 与 macOS 不使用平台专属 shell 语法，所有启动逻辑放在 Node/npm 脚本中。

## 测试与验收

- 单元测试证明 English 设置下的待机、打招呼、专注、休息、恢复与交互气泡不包含中文。
- 静态契约测试证明菜单、通知和全屏预览不再引用硬编码中文文案。
- `npm start` 在 Mac 上从生产构建启动真实 Electron 进程。
- `npm test`、`npm run typecheck`、`npm run build`、素材与视频检查全部通过。
- README 的 Mac 和 Windows 快速启动命令完全一致，并明确这是免安装源码运行方案。
