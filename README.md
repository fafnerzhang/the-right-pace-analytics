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

## 海巡回覆（Outreach）

主動去別人的跑步／健身貼文底下留言互動的紀錄。目的：追蹤「回覆哪類貼文 →
帶來曝光／追蹤」的因果，並完整留存回覆邏輯、回覆時間、對方發文時間。

- 爬蟲：[`../tools/threads-scout/scout.mjs`](../tools/threads-scout/scout.mjs)（Playwright 滑 feed，不經 API）
- 灌檔：[`scripts/ingest-scout.mjs`](./scripts/ingest-scout.mjs)（`latest.json` → 主庫，依 `post_id` 去重併入）
- **單一主庫**：`threads/outreach/reply-log.csv`（唯一資料來源；不再堆 timestamped 檔）
- 暫存：`../tools/threads-scout/out/latest.json`（每次爬蟲覆蓋，ingest 讀它）

### 機制

- **無排程輪替**：每次 `make scout` 手動跑一次、單一 feed、滑到底。scout 覆蓋寫 `latest.json`，
  ingest 依 `post_id` 併進主庫；既有候選會**刷新互動數/分數**，但保留你手填的回覆欄位與 status。
- **時效淘汰**（ingest 每次自動執行，只淘汰 `candidate`；`replied`/`skipped` 永久保留當紀錄）：
  - `purpose=reply`（值得回覆）→ 只留發文 **36 小時**內
  - `purpose=reference`（英文素材）→ 留 **7 天**

### 流程

```
# 一鍵：爬 running feed → 併進主庫（reply，留 36h）
make scout                                   # 可加 FEED= SCROLLS= MIN=

# 追蹤大帳號撈英文素材 → 併進主庫（reference，留 7d）
make scout-accounts ACCOUNTS="handle1,handle2"

# 開面板瀏覽 / 回覆（回覆後就地標 replied、補 reply_angle / reply_text，寫回 CSV）
make scout-dashboard                          # port 3458
```

手動拆步：`node tools/threads-scout/scout.mjs --feed running --headless` → `node analytics/scripts/ingest-scout.mjs --purpose reply`。

`--feed` 可選：`running`（Running Threads tag）、`tri`（Triathlon）、`following`、`foryou`。

### 欄位說明

| 欄位 | 說明 | 來源 |
|------|------|------|
| `scouted_at` | 最近一次爬到這篇的時間 | 自動 |
| `feed` | 來源 feed / 帳號 | 自動 |
| `purpose` | `reply`（值得回覆，留 36h）/ `reference`（英文素材，留 7d） | 自動 |
| `account` | 對方帳號 | 自動 |
| `post_url` | 貼文永久連結 | 自動 |
| `post_id` | 貼文 shortcode（去重鍵） | 自動 |
| `post_time` | **對方發文時間**（ISO UTC） | 自動 |
| `post_age_h` | 最近爬到時貼文已發幾小時 | 自動 |
| `relevance` | 跑步/健身關鍵字加權分數 | 自動 |
| `likes` `replies` `reposts` `shares` | 貼文互動數 | 自動 |
| `topic_hits` | 命中的關鍵字（`;` 分隔） | 自動 |
| `status` | `candidate` → `replied` / `skipped` | **手動維護** |
| `replied_at` | **我實際回覆的時間** | **手動補填** |
| `reply_angle` | **回覆邏輯／切入點**（為什麼回、想帶到什麼） | **手動補填** |
| `reply_text` | 實際回覆內容 | **手動補填** |
| `text` | 完整內文 | 自動 |
| `notes` | 貼文前 40 字（自動）＋ 備註 | 混合 |

### 判讀

- 比 `feed` × `status=replied` 後續有沒有帶追蹤／回訪 → 哪個 feed 的人最容易轉化
- 比 `post_age_h`：回覆「越新的貼文」是否曝光越好（趁貼文還在被推時卡位）
- `reply_angle` 分類後，看哪種切入點（共鳴／糾錯迷思／給課表建議）最有效 → 回饋內容策略、導流到 1:1 教練漏斗

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
