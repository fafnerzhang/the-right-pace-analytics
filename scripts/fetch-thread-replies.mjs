#!/usr/bin/env node
/**
 * Threads reply snapshot fetcher — for GitHub Actions
 * 記錄「我回覆別人貼文」的當下成效（GET /me/replies + 每則 reply insights）
 * Token via env: THREADS_ACCESS_TOKEN
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir    = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(__dir, '..');
const SNAP_CSV    = resolve(ROOT, 'threads/reply-metrics.csv'); // 快照：只存會變的數字
const REPLIES_CSV = resolve(ROOT, 'threads/replies.csv');       // metadata：一筆/回覆
const CONFIG_PATH = resolve(ROOT, 'threads/config.json');

const SNAP_COLS = ['reply_id', 'measured_at', 'hours_since', 'views', 'likes', 'replies', 'reposts', 'quotes'];
const META_COLS = ['reply_id', 'root_post_id', 'replied_to_id', 'reply_permalink', 'reply_time', 'text'];

function loadConfig() {
  const def = { fetch_limit: 50, max_age_days: 3, min_interval_minutes: 25 };
  try { return { ...def, ...(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')).replies || {}) }; }
  catch { return def; }
}
const CFG = loadConfig();
const FETCH_LIMIT    = CFG.fetch_limit;
const MAX_AGE_DAYS   = CFG.max_age_days;
const MIN_INTERVAL_M = CFG.min_interval_minutes;

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

async function listReplies(userId) {
  // list 端點不會回 replied_to / root_post → 用 getParents() 逐則補
  const d = await api(`/${userId}/replies`, {
    fields: 'id,text,timestamp,permalink,is_reply',
    limit: FETCH_LIMIT,
  });
  return d.data ?? [];
}

async function getParents(replyId) {
  try {
    const d = await api(`/${replyId}`, { fields: 'replied_to,root_post' });
    return { replied_to: idOf(d.replied_to), root_post: idOf(d.root_post) };
  } catch (err) {
    console.warn(`  ⚠️  ${replyId} parents: ${err.message}`);
    return { replied_to: '', root_post: '' };
  }
}

async function getInsights(replyId) {
  try {
    const d = await api(`/${replyId}/insights`, { metric: 'views,likes,replies,reposts,quotes' });
    const r = {};
    for (const item of d.data ?? []) r[item.name] = item.values?.[0]?.value ?? item.total_value?.value ?? 0;
    return r;
  } catch (err) {
    console.warn(`  ⚠️  ${replyId}: ${err.message}`);
    return {};
  }
}

const idOf = (v) => (v && typeof v === 'object' ? v.id : v) ?? '';

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
  const arr = rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
  const headers = arr[0] || [];
  return { headers, rows: arr.slice(1).map(cells => Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]))) };
}
const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function writeCSV(path, headers, rows) {
  writeFileSync(path, [headers.join(','), ...rows.map(r => headers.map(h => q(r[h])).join(','))].join('\n') + '\n', 'utf8');
}
function readRows(path) {
  return existsSync(path) ? parseCSV(readFileSync(path, 'utf8')).rows : [];
}

const hoursSince = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 3_600_000);
function recentlyRecorded(rows, id) {
  const cutoff = Date.now() - MIN_INTERVAL_M * 60_000;
  return rows.some(r => r.reply_id === id && r.measured_at && new Date(r.measured_at).getTime() > cutoff);
}

(async () => {
  if (!process.env.THREADS_ACCESS_TOKEN) { console.error('❌  THREADS_ACCESS_TOKEN not set'); process.exit(1); }
  console.log('🧵  Threads replies fetch\n');

  const userId  = await getUserId();
  const replies = await listReplies(userId);
  const snaps    = readRows(SNAP_CSV);
  const metaById = new Map(readRows(REPLIES_CSV).map(r => [r.reply_id, r]));

  const nowIso  = new Date().toISOString().slice(0, 16);
  const maxAgeH = MAX_AGE_DAYS * 24;
  const newSnaps = [];
  let metaChanged = false;

  for (const reply of replies) {
    const elapsed = hoursSince(reply.timestamp);
    if (elapsed > maxAgeH) continue;
    if (recentlyRecorded(snaps, reply.id)) { console.log(`  ✓   ${reply.id.slice(-8)} (${elapsed}h): skip`); continue; }

    console.log(`  📡  reply ${reply.id.slice(-8)} (${elapsed}h)`);
    const par = await getParents(reply.id);
    const m = await getInsights(reply.id);
    const v = m.views || 1;
    const eng = ((((m.likes||0)+(m.replies||0)+(m.reposts||0)+(m.quotes||0))/v)*100).toFixed(2);
    console.log(`       views=${m.views} likes=${m.likes} eng=${eng}%`);

    const meta = metaById.get(reply.id);
    if (!meta) {
      metaById.set(reply.id, {
        reply_id: reply.id, root_post_id: par.root_post, replied_to_id: par.replied_to,
        reply_permalink: reply.permalink ?? '', reply_time: reply.timestamp ?? '',
        text: (reply.text || '').slice(0, 80).replace(/\n/g, ' ').trim(),
      });
      metaChanged = true;
    } else if ((!meta.root_post_id && par.root_post) || (!meta.replied_to_id && par.replied_to)) {
      meta.root_post_id = meta.root_post_id || par.root_post;
      meta.replied_to_id = meta.replied_to_id || par.replied_to;
      metaChanged = true;
    }

    newSnaps.push({
      reply_id: reply.id, measured_at: nowIso, hours_since: String(elapsed),
      views: String(m.views ?? ''), likes: String(m.likes ?? ''), replies: String(m.replies ?? ''),
      reposts: String(m.reposts ?? ''), quotes: String(m.quotes ?? ''),
    });
  }

  if (!newSnaps.length) { console.log('  沒有新資料。'); process.exit(0); }
  if (metaChanged) writeCSV(REPLIES_CSV, META_COLS, [...metaById.values()]);
  writeCSV(SNAP_CSV, SNAP_COLS, [...snaps, ...newSnaps]);
  console.log(`\n  ✅  寫入 ${newSnaps.length} 筆快照`);
})().catch(err => { console.error('❌ ', err.message); process.exit(1); });
