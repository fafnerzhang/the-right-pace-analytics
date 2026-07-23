#!/usr/bin/env node
/**
 * Ingest Threads Scout → outreach reply-log（單一主庫）
 *
 * 把 tools/threads-scout/out/latest.json 併進 analytics 的海巡回覆總帳（單一 CSV）。
 * - 依 post_id 去重；既有候選會刷新互動數/分數/內文，但保留你手填的回覆欄位與 status
 * - 依時效自動淘汰過期 candidate：reply 保留 36 小時、reference 保留 7 天
 *   （已回覆 replied / 略過 skipped 的列永久保留，當作完整紀錄）
 *
 * 用法：
 *   node analytics/scripts/ingest-scout.mjs                       # 吃 out/latest.json，purpose=reply
 *   node analytics/scripts/ingest-scout.mjs --purpose reference   # 英文素材
 *   node analytics/scripts/ingest-scout.mjs <某個.json> --feed running --purpose reply
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');                    // analytics/
const REPO  = resolve(ROOT, '..');                     // repo root
const OUT_DIR  = resolve(ROOT, 'threads/outreach');
const CSV_PATH = resolve(OUT_DIR, 'reply-log.csv');
const DEFAULT_JSON = resolve(REPO, 'tools/threads-scout/out/latest.json');

// 時效視窗（小時）
const RETENTION_H = { reply: 36, reference: 7 * 24 };

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const VALUE_FLAGS = ['feed', 'purpose'];
const optVal = (name, def) => { const i = argv.indexOf(`--${name}`); return i !== -1 ? argv[i + 1] : def; };
// 位置參數（json 路徑）：排除 --flag 及其緊接的值
const flagValueIdx = new Set();
VALUE_FLAGS.forEach(f => { const i = argv.indexOf(`--${f}`); if (i !== -1) flagValueIdx.add(i + 1); });
const jsonArg = argv.find((a, i) => !a.startsWith('--') && !flagValueIdx.has(i));
const FEED    = optVal('feed', null);                  // 覆寫 feed 標籤（否則用每篇的 feedLabel）
const PURPOSE = optVal('purpose', 'reply');            // reply | reference
const jsonPath = jsonArg ? resolve(process.cwd(), jsonArg) : DEFAULT_JSON;
if (!existsSync(jsonPath)) { console.error(`❌ 找不到爬蟲結果：${jsonPath}\n   先跑：node tools/threads-scout/scout.mjs ...`); process.exit(1); }

// ── CSV parse / stringify（支援引號內逗號與換行）───────────────────────────────
const COLS = [
  'scouted_at', 'feed', 'purpose', 'account', 'post_url', 'post_id', 'post_time',
  'post_age_h', 'relevance', 'likes', 'replies', 'reposts', 'shares',
  'topic_hits', 'status', 'replied_at', 'reply_angle', 'reply_text', 'text', 'notes',
];
function parseCSV(raw) {
  const rows = []; let f = '', row = [], inQ = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQ) {
      if (c === '"' && raw[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') inQ = false;
      else f += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c === '\r') { /* skip */ }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}
const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// ── 載入既有主庫（成物件，post_id 為鍵）─────────────────────────────────────────
const db = new Map(); // post_id -> row object
if (existsSync(CSV_PATH)) {
  const arr = parseCSV(readFileSync(CSV_PATH, 'utf8'));
  const headers = arr[0] || [];
  for (const cells of arr.slice(1)) {
    const o = Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
    if (o.post_id) db.set(o.post_id, o);
  }
}

// ── 讀爬蟲結果（新格式 {scouted_at, posts} 或舊格式 array）──────────────────────
const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
const posts = Array.isArray(parsed) ? parsed : (parsed.posts || []);
const scoutedAt = (parsed && parsed.scouted_at)
  || new Date(statSync(jsonPath).mtime).toISOString().slice(0, 19);
const nowMs = Date.now();
const ageOf = (postTime) => {
  const t = Date.parse(postTime); return Number.isFinite(t) ? ((nowMs - t) / 3.6e6) : NaN;
};

let added = 0, updated = 0;
for (const r of posts) {
  const id = r.postId;
  if (!id) continue;
  const ageH = ageOf(r.timestamp);
  const metrics = {
    scouted_at: scoutedAt,
    feed: FEED || r.feedLabel || '',
    account: r.author,
    post_url: r.permalink,
    post_id: id,
    post_time: r.timestamp || '',
    post_age_h: Number.isFinite(ageH) ? ageH.toFixed(1) : '',
    relevance: r.score ?? '',
    likes: r.likes ?? 0, replies: r.replies ?? 0, reposts: r.reposts ?? 0, shares: r.shares ?? 0,
    topic_hits: (r.hits || []).join(';'),
    text: (r.text || '').trim(),
    notes: (r.text || '').replace(/\s+/g, ' ').trim().slice(0, 40),
  };
  if (db.has(id)) {
    // 更新指標，保留 purpose / status / 手填回覆欄位
    const ex = db.get(id);
    Object.assign(ex, metrics);
    updated++;
  } else {
    db.set(id, {
      ...metrics, purpose: PURPOSE, status: 'candidate',
      replied_at: '', reply_angle: '', reply_text: '',
    });
    added++;
  }
}

// ── 時效淘汰：過期的 candidate 丟掉（replied / skipped 永久保留）───────────────────
let pruned = 0;
for (const [id, o] of [...db]) {
  if (o.status !== 'candidate') continue;               // 已處理的當紀錄，不動
  const limit = RETENTION_H[o.purpose] ?? RETENTION_H.reply;
  const ageH = ageOf(o.post_time);
  if (Number.isFinite(ageH) && ageH > limit) { db.delete(id); pruned++; }
}

// ── 寫回（依 purpose、分數、時間排序，方便閱讀）──────────────────────────────────
const rows = [...db.values()].sort((a, b) =>
  (a.purpose || '').localeCompare(b.purpose || '') ||
  (+b.relevance || 0) - (+a.relevance || 0) ||
  (b.post_time || '').localeCompare(a.post_time || ''));
const out = [COLS.join(',')];
for (const o of rows) out.push(COLS.map(h => q(o[h])).join(','));
writeFileSync(CSV_PATH, out.join('\n') + '\n', 'utf8');

console.log(`✅ 併進主庫 reply-log.csv（purpose=${PURPOSE}）`);
console.log(`   scouted_at=${scoutedAt}`);
console.log(`   新增 ${added}｜更新 ${updated}｜淘汰過期 candidate ${pruned}`);
console.log(`   目前主庫共 ${rows.length} 列（reply≤36h、reference≤7d 的 candidate + 所有已處理紀錄）`);
console.log(`   CSV：${CSV_PATH}`);
