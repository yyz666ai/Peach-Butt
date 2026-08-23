# 桃屁屁状态视觉 QA

## 验收范围

本轮在 Apple Silicon macOS 上运行实际打包的 `桃屁屁.app`，使用隔离的内存数据库进入各视觉状态，不读取或写入用户正式数据。桌宠截图采用 `160 × 240` 逻辑窗口的 Retina 像素；全屏提醒截图来自真实透明置顶提醒窗口。

## 桌宠状态

| 状态 | 截图 | 检查结果 |
| --- | --- | --- |
| 待机 | `states/pet-idle-160x240@2x.png` | 低频微动作，完整短腿，主体居中。 |
| 专注 | `states/pet-focus-160x240@2x.png` | 完整短环腿、笔记本和双手；无椅座横轨。 |
| 活动 | `states/pet-activity-160x240@2x.png` | 拉伸姿势完整，未裁脚。 |
| 喝水 | `states/pet-water-prompt-160x240@2x.png` | 干裂与水瓶清楚，主体未缩放。 |
| 上厕所 | `states/pet-toilet-160x240@2x.png` | 桃子和马桶完整进入画布。 |
| 护眼 | `states/pet-eye-strain-160x240@2x.png` | 红眼、干裂提示清楚，无白色脚环残影。 |
| 睡觉 | `states/pet-sleep-160x240@2x.png` | 长休状态稳定，循环首尾已交叉淡化。 |
| 压力 | `states/pet-pressure-160x240@2x.png` | 变红膨胀，无底部椅座横线。 |
| 瘪气 | `states/pet-deflated-160x240@2x.png` | 爆炸后形态明确且不误显示正常站姿。 |
| 恢复 | `states/pet-recovering-160x240@2x.png` | 喝水恢复动作与瘪气锁定语义一致。 |
| 变身 | `states/pet-transform-160x240@2x.png` | 旋风完整进入画布，过渡不改变媒体槽尺寸。 |
| 打招呼 | `states/pet-greeting-160x240@2x.png` | 手脚完整、透明边缘干净；仅明确点击触发。 |

汇总图：`states/pet-state-contact-sheet.png`。

## 全屏状态

| 状态 | 截图 | 检查结果 |
| --- | --- | --- |
| 休息到点 | `states/rest-due-fullscreen@2x.png` | 桃屁屁与动态大字明显，提示不依赖宠物底部倒计时。 |
| 爆炸 | `states/explosion-fullscreen@2x.png` | 爆裂短片充满主要视觉区，包含“快去休息啦”与 5 分钟恢复说明。 |

## 响应式统计页

- `states/dashboard-960x650@2x.png`
- `states/dashboard-1050x760@2x.png`
- `states/dashboard-1400x800@2x.png`
- `states/dashboard-settings-960x650@2x.png`

三档窗口中能量数字、真实进度条、三项摘要、趋势线和四项行为均由容器自动排布；没有文字与图片重叠、标签出框或固定宽度折线。设置层在最小窗口内可滚动并保持焦点约束。

## 结论

macOS 视觉状态验收通过。Windows 共用渲染层并有平台状态纯函数测试，但原生 DPI、任务栏、托盘和安装包仍需 Windows 10/11 实机发布验收。
