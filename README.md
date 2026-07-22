# 貼文成效分析（Analytics）

目的：在**固定時間點**填入 IG / Thread 的原始數字，長期觀察演算法與受眾偏好 —— 哪類主題、哪種鉤子、哪種類型（迷思／觀念／指南）表現最好。

- 資料檔：[`ig-metrics.csv`](./ig-metrics.csv)、[`thread-metrics.csv`](./thread-metrics.csv)
- 貼文對應：[`../docs/CONTENT-INDEX.md`](../docs/CONTENT-INDEX.md)（`post_id` 對應 IG-CONTENT-PLAN 的排程編號）

---

## 什麼時間記錄（snapshot 節奏）

每篇貼文記錄 **3 個時間點**，用 `hours_since` 標示：

| 快照 | 發文後 | 為什麼 |
|------|--------|--------|
| T+24h | 24 小時 | 早期速度 = 演算法初期推播的最強訊號 |
| T+72h | 3 天 | 主要觸及大致定型 |
| T+7d | 7 天 | 長尾（saves/分享帶來的延遲觸及）收斂 |

一篇貼文 = CSV 裡 3 列（同一 `post_id`，不同 `hours_since`）。填「當下累計值」，不是區間增量。

---

## 記錄什麼指標（原始欄位）

只填**平台給的原始數字**，比率交給公式算（見下）。缺的欄位留空。

### IG carousel（`ig-metrics.csv`）
| 欄位 | 說明 | 來源 |
|------|------|------|
| `post_id` | 排程編號（對 CONTENT-INDEX） | — |
| `ig_slug` | carousel slug | — |
| `blog_slug` | 來源文章 | — |
| `post_date` | 發文日 YYYY-MM-DD | — |
| `category` | 類型（迷思/觀念/指南/反直覺/哲學/品牌） | — |
| `measured_at` | 記錄日 YYYY-MM-DD | — |
| `hours_since` | 24 / 72 / 168 | — |
| `reach` | 觸及帳號數 | Insights |
| `impressions` | 曝光次數 | Insights |
| `likes` | 讚 | — |
| `comments` | 留言 | — |
| `shares` | 分享 | — |
| `saves` | 儲存 | — |
| `profile_visits` | 個人檔案點擊 | Insights |
| `follows` | 此貼文帶來的追蹤 | Insights |
| `link_clicks` | bio/連結點擊 | Insights |
| `notes` | 備註（鉤子變化、置頂、投放等） | — |

### Thread（`thread-metrics.csv`）
| 欄位 | 說明 |
|------|------|
| `post_id` `thread_slug` `blog_slug` `post_date` `category` `measured_at` `hours_since` | 同 IG（`category` = 迷思/觀念/指南/反直覺/哲學/品牌） |
| `views` | 瀏覽 |
| `likes` `replies` `reposts` `quotes` | 互動 |
| `follows` | 帶來追蹤 |
| `link_clicks` | 連結點擊 |
| `notes` | 備註 |

---

## 怎麼判讀（衍生指標）

用 T+72h 或 T+7d 的列算，跨貼文比較：

**IG（saves 與 shares 是 IG 演算法最看重的信號）**
- 儲存率 `save_rate = saves / reach` ← 最重要，代表「值得留存」
- 分享率 `share_rate = shares / reach` ← 代表「值得傳出去」
- 互動率 `engagement = (likes+comments+saves+shares) / reach`
- 追蹤轉換 `follow_rate = follows / reach`
- 檔案轉換 `profile_rate = profile_visits / reach`

**Thread**
- 互動率 `engagement = (likes+replies+reposts+quotes) / views`
- 擴散 `amplification = (reposts+quotes) / views`
- 追蹤轉換 `follow_rate = follows / views`

**觀察重點**
- 比 `category`：哪類（迷思/觀念/指南）save_rate 最高？→ 未來配比往那邊調
- 比 T+24h 觸及占 T+7d 的比例：越高＝演算法初推越強＝鉤子/封面有效
- 比 `blog_slug` 主題：哪個主題受眾最買單？→ 回饋部落格選題

---

## 填寫流程

1. 發文當天：在對應 CSV 加一列（`hours_since` 先留 24，其餘數字待填）
2. T+24h / T+72h / T+7d：各補一列，填當下累計數字
3. 週末回顧：用上面公式比對，把結論記到 `notes` 或 CONTENT-INDEX

> CSV 用逗號分隔，字串含逗號時用雙引號包起來。可用試算表開啟後另存回 CSV。
