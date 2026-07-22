# 貼文成效分析（Analytics）

目的：追蹤 Threads / IG 貼文的原始指標，長期觀察演算法與受眾偏好 —— 哪類主題、哪種鉤子、哪種類型（迷思／觀念／指南）表現最好。

- 資料檔：[`threads/thread-metrics.csv`](./threads/thread-metrics.csv)、[`instagram/ig-metrics.csv`](./instagram/ig-metrics.csv)
- 貼文對應：[`../docs/CONTENT-INDEX.md`](../docs/CONTENT-INDEX.md)

---

## Threads（自動化）

### 機制

GitHub Actions（[`../.github/workflows/fetch-snapshots.yml`](../.github/workflows/fetch-snapshots.yml)）每 30 分鐘自動執行一次：

1. 呼叫 Threads API 取得最近 50 篇貼文
2. 對 7 天內、且上次快照超過 25 分鐘的貼文，各呼叫 insights API
3. 新增一列到 `threads/thread-metrics.csv`，自動 commit & push

**每次執行 API calls：** 1（list posts）+ N（insights，每篇 1 call）
**每日上限用量：** ~384 calls / 48,000 可用 ＜ 1%

### 欄位說明

| 欄位 | 說明 | 來源 |
|------|------|------|
| `post_id` | Threads 數字 post ID | 自動 |
| `thread_slug` | `YYYYMMDD-{id後8碼}`（CSV 已存在時沿用舊值） | 自動 |
| `blog_slug` | 對應部落格文章 slug | **手動補填** |
| `post_date` | 發文日 YYYY-MM-DD | 自動 |
| `category` | 類型（迷思/觀念/指南/反直覺/哲學/品牌） | **手動補填** |
| `measured_at` | 快照時間 YYYY-MM-DDTHH:MM | 自動 |
| `hours_since` | 發文至快照的小時數 | 自動 |
| `views` | 瀏覽數 | 自動（Threads API） |
| `likes` `replies` `reposts` `quotes` | 互動數 | 自動（Threads API） |
| `follows` | 帶來追蹤數 | 手動補填（API 暫不支援） |
| `link_clicks` | 連結點擊 | 手動補填（API 暫不支援） |
| `notes` | 貼文前 40 字（自動）＋ 人工備註 | 混合 |

### 快照節奏

採用**連續時間序列**，非固定節點。每篇貼文在 7 天內每 30 分鐘留一筆，`hours_since` 記錄當下實際經過時數。分析時可自行篩選 `hours_since` 接近 24 / 72 / 168 的列做跨篇比較。

### 手動維護事項

- `blog_slug`：貼文有對應文章時補填
- `category`：分類標籤（影響分析維度）
- `thread_slug`：若想用語意 slug 取代自動產生的，直接改 CSV；後續執行會沿用

---

## IG（手動）

IG Insights 無公開 API，需人工填寫。

### 快照節奏

每篇貼文記錄 **3 個時間點**：

| 快照 | 發文後 | 為什麼 |
|------|--------|--------|
| T+24h | 24 小時 | 早期速度 = 演算法初推訊號 |
| T+72h | 3 天 | 主要觸及大致定型 |
| T+7d | 7 天 | 長尾收斂 |

一篇貼文 = CSV 裡 3 列（同一 `post_id`，不同 `hours_since`）。填當下累計值，非區間增量。

### 欄位說明（`instagram/ig-metrics.csv`）

| 欄位 | 說明 | 來源 |
|------|------|------|
| `post_id` | 排程編號（對 CONTENT-INDEX） | 手動 |
| `ig_slug` | carousel slug | 手動 |
| `blog_slug` | 來源文章 | 手動 |
| `post_date` | 發文日 YYYY-MM-DD | 手動 |
| `category` | 類型（迷思/觀念/指南/反直覺/哲學/品牌） | 手動 |
| `measured_at` | 記錄日 YYYY-MM-DD | 手動 |
| `hours_since` | 24 / 72 / 168 | 手動 |
| `reach` | 觸及帳號數 | Insights |
| `impressions` | 曝光次數 | Insights |
| `likes` `comments` `shares` `saves` | 互動 | Insights |
| `profile_visits` | 個人檔案點擊 | Insights |
| `follows` | 此貼文帶來的追蹤 | Insights |
| `link_clicks` | bio/連結點擊 | Insights |
| `notes` | 備註（鉤子變化、置頂、投放等） | 手動 |

### 填寫流程

1. 發文當天：CSV 加一列，`hours_since` 填 24，其餘數字待填
2. T+24h / T+72h / T+7d：各補一列，填當下累計數字
3. 週末回顧：用公式比對，結論記到 `notes` 或 CONTENT-INDEX

---

## 衍生指標（判讀用）

用 T+72h 或 T+7d 的列計算，跨貼文比較：

**IG（saves 與 shares 是最重要演算法信號）**
- `save_rate = saves / reach`（最重要）
- `share_rate = shares / reach`
- `engagement = (likes+comments+saves+shares) / reach`
- `follow_rate = follows / reach`
- `profile_rate = profile_visits / reach`

**Threads**
- `engagement = (likes+replies+reposts+quotes) / views`
- `amplification = (reposts+quotes) / views`
- `follow_rate = follows / views`

**觀察重點**
- 比 `category`：哪類 save_rate 最高？→ 未來配比往那邊調
- 比 T+24h 觸及占 T+7d 的比例：越高 = 演算法初推越強 = 鉤子/封面有效
- 比 `blog_slug` 主題：哪個主題受眾最買單？→ 回饋部落格選題
