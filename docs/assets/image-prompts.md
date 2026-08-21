# 桃屁屁素材生成约束

所有桌宠角色素材均以 `桃屁屁_绿色方案3_草地绿.png` 作为角色参考图，通过参考图生图生成，不使用 HTML、CSS、SVG 或程序绘制角色。

## 固定约束

- 严格保持参考图的肥圆身体比例、桃子轮廓、叶片、气球嘴、五官和配色。
- 腿长、腿粗和落点严格匹配参考图；不得擅自加长或缩短。
- 固定正面略俯视镜头、柔和 3D 黏土/充气玩具质感与一致光照。
- 单个完整角色居中，四肢与叶片不得裁切。
- 输出透明背景 PNG，不含文字、道具外的装饰、边框或第二个角色。
- 每个动作只改变姿态、表情和必要道具，不修改角色身材比例。

## 动作集合

待机、开心反馈、挥手、喝水、伸展、上厕所、睡觉、休息眼睛、膨胀一级、膨胀二级、膨胀三级、爆炸瞬间、爆炸后瘪气。

## 本轮 ImageGen 动作表提示词

### 低频待机四帧

> 严格使用两张参考图中的桃屁屁角色身份和造型。生成一张横向四格、固定正面镜头的动画动作表：同一个肥圆桃子身体、草地绿叶片和气球嘴、参考图长度的极短黑色环形腿、圆润的三指小手，3D 漫射哑光材质，桃粉珊瑚色明亮柔和。四帧依次为自然站立、轻轻闭眼并微抬一只手和一只脚、回到自然站立、另一只手与另一只脚做极小动作；动作安静、低频、不跳跃，角色大小、位置、光线、视角完全一致。单个完整角色居中，头顶、手、脚全部保留，不要文字、道具、地面、投影或额外角色；干净透明背景，四格边界清楚。

### 护眼超时四帧

> 严格使用两张参考图中的桃屁屁角色身份、肥圆身体比例、草地绿叶片、气球嘴、极短环形腿和圆润三指小手。生成一张横向四格、固定正面镜头的渐进护眼警示动作表，3D 漫射哑光材质与明亮桃粉珊瑚配色保持一致。第一帧眼睛疲惫微红；第二帧揉眼，眼周更红；第三帧双眼明显发红并出现夸张但可爱的细小干裂纹；第四帧红眼干裂最明显、双手提醒用户休息。身体不得破裂或变形，四帧角色大小、位置、光线和视角完全一致。手不是棍状线条，末端必须有圆润三指；头顶、手、短腿全部保留，不要文字、地面、阴影、道具或额外角色；干净透明背景。

### 统计页“活动一下”拉伸人物

最终透明素材：`assets/dashboard/activity-stretch.png`。ImageGen 原始输出归档于 `assets/dashboard/source/activity-stretch-imagegen.png`，透明背景经过逐像素抠图和边缘归一化处理。

> Use case: stylized-concept. Asset type: single dashboard action object for 桃桃小屋, replacing the existing 起身 icon. Input images: the water, stand and toilet dashboard assets are strict art-direction references for palette, premium 3D diffuse matte material, softness, camera angle and object density; do not reuse their subjects. Primary request: create one adorable gender-neutral person clearly doing a gentle full-body side stretch, one arm curved overhead and the other supporting the waist, feet planted, healthy movement instantly readable at small icon size. Style/medium: refined minimal 3D illustration, premium soft-touch frosted matte clay, diffuse material, restrained handcrafted warmth, low AI feel, rounded but not childish. Composition/framing: single complete centered figure, fixed front view with the same slight top-down angle as the references, compact silhouette, generous safe margin, all hands and feet fully visible. Lighting/mood: soft natural studio light, subtle ambient occlusion only. Color palette: peach pink clothing, cream skin and details, leaf-green accents matching the references. Constraints: genuinely transparent background; no text; no letters; no numbers; no border; no platform; no ground; no cast shadow; no props; no extra person; no cropped limbs; no photorealism; no glossy plastic.
