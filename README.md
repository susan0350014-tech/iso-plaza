# iso-plaza 小廣場

在 Claude 聊天視窗旁開一個常駐面板：45 度等角視角的小廣場。Claude 工作時，小角色會依照工具呼叫走去工作室、圖書館或休息區；點下方的名牌可以看到角色的工作回報。

## 安裝

在 Claude Code 終端機的提示列輸入：

```
/plugin install iso-plaza --marketplace susan0350014-tech/iso-plaza
```

詢問是否加入 marketplace 時輸入 `y`，再選擇安裝範圍。

或從 shell 安裝：

```
claude plugin install iso-plaza --marketplace susan0350014-tech/iso-plaza
```

## 檔案結構

```
.claude-plugin/plugin.json   mod 名稱與版本
hooks/hooks.json             指向 register.tsx
hooks/register.tsx           進入點：掛 hooks、開面板、畫面板
hooks/state.ts               角色狀態轉換（換狀態 → 規劃走路）
hooks/describe.ts            工具呼叫 → 「編輯了 src/main.js」這類說明
hooks/iso.ts                 等角座標換算、格子尋路、走路進度
hooks/scene.ts               組出整張廣場 SVG（內建幾何圖形與 sprite 嵌入）
hooks/card.tsx               名牌按鈕、回報卡
hooks/config.ts              讀 assets/config.json 與 sprite 檔
assets/config.json           所有可調設定與素材對應
assets/characters/…          角色 sprite
types/index.d.ts             $.state 的型別
tests/plaza.test.tsx         測試
```

## 指令

- `/plaza`：重新打開面板
- `/plaza reload`：改了 `assets/` 之後重新讀取素材（不必重開工作階段）

## 鏡頭操作

在廣場上直接用滑鼠操作（桌面版）：

- 滾輪：以游標位置為中心縮放
- 按住左鍵拖曳：移動畫面
- 點角色：打開或關閉它的回報卡
- 雙擊：放大；右鍵：縮小

面板下方另有按鈕：＋ －、「跟著 Claude」（鏡頭自動跟著角色走）、「全景」。
拖曳或縮放後鏡頭會停止跟隨，按「跟著 Claude」恢復。預設放大倍率在 `config.json` 的 `cameraZoom`。

技術說明：面板的 SVG 本身收不到滑鼠，所以上面疊了一層透明的感應層（`hooks/pointer.tsx`），
把滑鼠動作換算成相對位置傳給 `register.tsx` 處理；滾輪則是攔截面板的捲動事件（`ui.scroll`）。

## 換素材（sprite 規則）

**格式**：SVG（向量圖）。面板用 SVG 畫，整張場景上限約 13 萬字元，所以 sprite 盡量精簡（建議每張 20 KB 以內）。PNG 目前不支援。

**sprite sheet**：同一段動畫的每一格**橫向排成一列**，每格大小相同。

| 用途 | 建議單格尺寸 | 錨點 `anchor`（對齊到格子中心的點） |
|---|---|---|
| 角色 | 48 × 64 | 腳底中央，例如 `[24, 60]` |
| 地板 | 64 × 32（一個菱形） | 菱形中心 `[32, 16]` |
| 建築 | 依實際大小 | 底部占地範圍的中心 |
| 裝飾（樹、長椅…） | 依實際大小 | 底部中央 |

**命名規則**：`<角色或物件>-<狀態>.svg`，例如：

```
assets/characters/claude-idle.svg     閒置
assets/characters/claude-walk.svg     走路
assets/characters/claude-typing.svg   打字（寫檔／編輯）
assets/characters/claude-reading.svg  看書（讀檔／搜尋）
assets/characters/claude-bashing.svg  敲敲打打（執行指令）
assets/characters/claude-waiting.svg  等你回覆（不含「！」泡泡也可以，泡泡另外畫）
assets/characters/claude-resting.svg  休息
assets/characters/claude-thinking.svg 思考
assets/buildings/studio.svg、library.svg
assets/tiles/floor.svg
```

**在 config.json 指定**（`null` 表示用內建幾何圖形）：

```json
"typing": {
  "file": "characters/claude-typing.svg",
  "frames": 4,
  "frameWidth": 48,
  "frameHeight": 64,
  "fps": 8,
  "anchor": [24, 60]
}
```

角色面向左邊時會自動水平翻轉，所以只需要畫朝右的版本。sprite 裡的 `id` 會自動加前綴，多張 sprite 用相同 id 也不會互相衝突。

## 其他可調設定（config.json）

- `grid`：格數與菱形大小
- `walk.msPerTile`：走一格要幾毫秒
- `buildings` / `decorations`：位置（格子座標 `[x, y]`，左上角 `[0,0]` 是畫面最上方那格）、顏色、門開在哪一面
- `spots`：各狀態要走去的格子
- `wanderTiles`、`restChance`：閒置時散步的地點，以及去休息的機率
- `toolStates`：哪個工具對應哪個狀態（沒列到的工具用 `defaultToolState`）
