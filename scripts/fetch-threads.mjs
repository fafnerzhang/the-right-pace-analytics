#!/usr/bin/env node
/**
 * Threads snapshot fetcher — for GitHub Actions
 * 每次執行記錄當下所有近期貼文的指標
 * Token via env: THREADS_ACCESS_TOKEN
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir   = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(__dir, '..');
const SNAP_CSV  = resolve(ROOT, 'threads/thread-metrics.csv'); // 快照：只存會變的數字
const POSTS_CSV = resolve(ROOT, 'threads/posts.csv');          // metadata：一筆/貼文
const CONFIG_PATH = resolve(ROOT, 'threads/config.json');

const SNAP_COLS  = ['post_id', 'measured_at', 'hours_since', 'views', 'likes', 'replies', 'reposts', 'quotes', 'follows', 'link_clicks'];
const POSTS_COLS = ['post_id', 'thread_slug', 'blog_slug', 'post_date', 'category', 'notes'];

function loadConfig() {
  const def = { fetch_limit: 50, max_age_days: 7, min_interval_minutes: 25 };
  try { return { ...def, ...(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).posts || {}) }; }
  catch { return def; }
}
const CFG = loadConfig();
const FETCH_LIMIT    = CFG.fetch_limit;
const MAX_AGE_DAYS   = CFG.max_age_days;
const MIN_INTERVAL_M = CFG.min_interval_minutes;

// ── Threads API ───────────────────────────────────────────────────────────────
const BASE = 'https://graph.threads.net/v1.0';

async function api(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('access_token', process.env.THREADS_ACCESS_TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res  = await fetch(url.toString());
  const json = await res.json();
  if (json.error) throw new Error(`API: ${json.error.message} (${json.error.code})`);
  return json;
}

async function getUserId() {
  if (process.env.THREADS_USER_ID) return process.env.THREADS_USER_ID;
  const d = await api('/me', { fields: 'id,username' });
  console.log(`  @${d.username} (${d.id})`);
  return d.id;
}

async function listPosts(userId) {
  const d = await api(`/${userId}/threads`, {
    fields: 'id,text,timestamp,permalink',
    limit: FETCH_LIMIT,
  });
  return d.data ?? [];
}

async function getInsights(postId) {
  try {
    const d = await api(`/${postId}/insights`, { metric: 'views,likes,replies,reposts,quotes' });
    const r = {};
    for (const item of d.data ?? []) {
      r[item.name] = item.values?.[0]?.value ?? item.total_value?.value ?? 0;
    }
    return r;
  } catch (err) {
    console.warn(`  ⚠️  ${postId}: ${err.message}`);
    return {};
  }
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function parseCSV(raw) {
  const lines = raw.trim().split('\n').filter(Boolean);
  const headers = lines[0].split(',');
  return {
    headers,
    rows: lines.slice(1).map(line => {
      const cols = [];
      let cur = '', inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
        cur += ch;
      }
      cols.push(cur);
      return Object.fromEntries(headers.map((h, i) => [h, (cols[i] ?? '').trim()]));
    }),
  };
}

function rowToCSV(headers, row) {
  return headers.map(h => {
    const v = String(row[h] ?? '');
    return v.includes(',') || v.includes('"') || v.includes('\n')
      ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');
}

function writeCSV(path, headers, rows) {
  const lines = [headers.join(','), ...rows.map(r => rowToCSV(headers, r))];
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

function readRows(path) {
  return existsSync(path) ? parseCSV(readFileSync(path, 'utf8')).rows : [];
}

// ── helpers ───────────────────────────────────────────────────────────────────
function hoursSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
}

function autoSlug(post) {
  const date = new Date(post.timestamp).toISOString().slice(0, 10).replace(/-/g, '');
  return `${date}-${post.id.slice(-8)}`;
}

function recentlyRecorded(rows, postId) {
  const cutoff = Date.now() - MIN_INTERVAL_M * 60_000;
  return rows.some(r => {
    if (r.post_id !== postId || !r.measured_at) return false;
    const t = new Date(r.measured_at).getTime();
    return !isNaN(t) && t > cutoff;
  });
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  if (!process.env.THREADS_ACCESS_TOKEN) {
    console.error('❌  THREADS_ACCESS_TOKEN not set');
    process.exit(1);
  }

  console.log('🧵  Threads fetch\n');

  const userId = await getUserId();
  const posts  = await listPosts(userId);
  const snaps    = readRows(SNAP_CSV);
  const metaById = new Map(readRows(POSTS_CSV).map(r => [r.post_id, r]));

  const nowIso  = new Date().toISOString().slice(0, 16);
  const maxAgeH = MAX_AGE_DAYS * 24;
  const newSnaps = [];
  let metaChanged = false;

  for (const post of posts) {
    const elapsed = hoursSince(post.timestamp);
    if (elapsed > maxAgeH) break;

    if (recentlyRecorded(snaps, post.id)) {
      console.log(`  ✓   ${post.id.slice(-8)} (${elapsed}h): skip`);
      continue;
    }

    let meta = metaById.get(post.id);
    if (!meta) {
      meta = { post_id: post.id, thread_slug: autoSlug(post), blog_slug: '', post_date: post.timestamp.slice(0, 10),
               category: '', notes: (post.text || '').slice(0, 40).replace(/\n/g, ' ').trim() };
      metaById.set(post.id, meta); metaChanged = true;
    }

    console.log(`  📡  ${meta.thread_slug} (${elapsed}h)`);
    const m = await getInsights(post.id);
    const v   = m.views || 1;
    const eng = ((((m.likes||0)+(m.replies||0)+(m.reposts||0)+(m.quotes||0))/v)*100).toFixed(2);
    console.log(`       views=${m.views} likes=${m.likes} eng=${eng}%`);

    newSnaps.push({
      post_id: post.id, measured_at: nowIso, hours_since: String(elapsed),
      views: String(m.views ?? ''), likes: String(m.likes ?? ''), replies: String(m.replies ?? ''),
      reposts: String(m.reposts ?? ''), quotes: String(m.quotes ?? ''), follows: '', link_clicks: '',
    });
  }

  if (!newSnaps.length) { console.log('  沒有新資料。'); process.exit(0); }

  if (metaChanged) writeCSV(POSTS_CSV, POSTS_COLS, [...metaById.values()]);
  writeCSV(SNAP_CSV, SNAP_COLS, [...snaps, ...newSnaps]);
  console.log(`\n  ✅  寫入 ${newSnaps.length} 筆快照`);
})().catch(err => {
  console.error('❌ ', err.message);
  process.exit(1);
});
