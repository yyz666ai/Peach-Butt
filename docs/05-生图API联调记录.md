# 生图 API 联调记录（gpt-image-2）

> 本文记录 OpenClaw API（gpt-image-2）文生图 / 图生图在本机的联调结果与可复用调用方式。
> ⚠️ **API Key 不要写进任何文档/仓库**，统一从环境变量 `OPENCLAW_API_KEY` 读取，放进 `.env`（已 gitignore）。

---

## 1. 联调结论

| 项目 | 结果 |
|---|---|
| 文生图 `/v1/images/generations` | ✅ 通过（HTTP 200，返回 `b64_json`） |
| 图生图 `/v1/images/edits` | ✅ 通过（HTTP 200，返回 `b64_json`） |
| 鉴权 | ✅ 正常（`Authorization: Bearer <key>`） |
| 返回格式 | 永远 base64 PNG，无 URL；需自行解码存盘 |

**踩坑记录**：图生图第一次请求遇到 `curl (92) HTTP/2 stream ... PROTOCOL_ERROR`（HTTP/2 长连接被断流）。**加 `--http1.1` 强制 HTTP/1.1 后立即成功**。文生图未遇到该问题，但建议两个端点都统一加 `--http1.1` 更稳。

---

## 2. 环境准备

```bash
export OPENCLAW_API_KEY="你的key"
# 或写入 .env（不要提交到 git）
```

---

## 3. 文生图（text-to-image）

- 端点：`POST https://openclaw-api.com/v1/images/generations`
- 请求体：`application/json`
- 关键参数：`model`（gpt-image-2）、`prompt`、`n`（1-10）、`size`（1024x1024 / 1024x1536 / 1536x1024 / auto）、`quality`（low/medium/high/auto）
- ⚠️ `quality` 只接受 low/medium/high/auto，传 `standard` 会 400。

```bash
curl -sS --http1.1 "https://openclaw-api.com/v1/images/generations" \
  -H "Authorization: Bearer $OPENCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -o gen.json --max-time 600 \
  -d '{
    "model": "gpt-image-2",
    "prompt": "你的画面描述",
    "n": 1,
    "size": "1024x1024",
    "quality": "low"
  }'

# 解码
python3 -c "import json,base64;d=json.load(open('gen.json'));open('gen.png','wb').write(base64.b64decode(d['data'][0]['b64_json']))"
```

**质量与耗时（文档值）**：

| quality | 耗时 | 输出 token | 适用 |
|---|---|---|---|
| low / auto | 22-33s | ~196 | 快速预览、批量 |
| medium | ~82s | ~1756 | 细节更丰富 |
| high | ~208s | ~7024 | 最高质量、最慢 |

**本次实测**：`quality=low`，HTTP 200，输出 PNG 1254×1254，`usage`：input 63 / output 272 / total 335 token。

---

## 4. 图生图（image-to-image，角色一致性用）

- 端点：`POST https://openclaw-api.com/v1/images/edits`
- 请求体：`multipart/form-data`（用 `-F`，**不要**手动加 `Content-Type`）
- 必传 `image[]` 参考图；PNG/JPEG/WebP，单张 ≤ 5MB，最多 3 张
- ⚠️ edits 端点**不接受 `quality` 参数**，传了会 400 `Unknown parameter: 'quality'`

```bash
curl -sS --http1.1 "https://openclaw-api.com/v1/images/edits" \
  -H "Authorization: Bearer $OPENCLAW_API_KEY" \
  -o edit.json --max-time 600 \
  -F "model=gpt-image-2" \
  -F "prompt=keep this exact cute peach-butt balloon mascot character design and colors, redraw as: full body standing pose with both little arms raised up cheering happily, big smile, simple flat cute cartoon style, solid pure white background, no text" \
  -F "image[]=@桃屁屁_绿色方案3_草地绿.png;type=image/png" \
  -F "n=1" \
  -F "size=1024x1024"

# 解码（同文生图）
python3 -c "import json,base64;d=json.load(open('edit.json'));open('edit.png','wb').write(base64.b64decode(d['data'][0]['b64_json']))"
```

**本次实测**：HTTP 200，输出 PNG 1254×1254，`usage`：input 2458（image_tokens 2390）/ output 1056 / total 3514 token。

> 多张参考图：重复 `-F "image[]=@xxx.png;type=image/png"` 即可。

---

## 5. 返回结构

```json
{
  "created": 1778749135,
  "data": [ { "b64_json": "iVBORw0KGgo..." } ],
  "usage": {
    "total_tokens": 3514,
    "input_tokens": 2458,
    "output_tokens": 1056,
    "input_tokens_details": { "text_tokens": 68, "image_tokens": 2390 }
  }
}
```

- 成功必有 `data[0].b64_json`。
- 失败会返回 `error` 字段，先看 `error` 再解码。

---

## 6. 怎么用在「桃屁屁」上（推荐用法）

1. **锁定角色形象**：用参考图走 edits，生成「三视图 + 表情集」角色设定集，作为所有后续生成的基准参考。
2. **产出关键帧**：每个动作先出 1 张静帧（图生图），确认姿势/表情/配色一致。
3. **转视频**：把静帧或角色设定集交给即梦当参考图，生成动作视频（绿幕背景）。
4. **抠图打包**：视频抽帧 → 抠绿 → 透明序列 → 精灵表/APNG（见《03-素材处理方案.md》）。
5. **提示词模板**：见《04-交互设计与提示词.md》，统一角色描述防漂移。

---

## 7. 本机已生成产物

| 文件 | 说明 |
|---|---|
| `assets/generated/桃屁屁_文生图测试_low.png` | 文生图连通性测试（low 档） |
| `assets/generated/桃屁屁_图生图_欢呼pose.png` | 用参考图做的角色一致性测试（欢呼 pose） |

> 后续正式生成时建议统一放到 `assets/generated/`，用 `quality=high` 出终稿、`low` 出草稿。
