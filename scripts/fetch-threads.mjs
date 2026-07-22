#!/usr/bin/env node
/**
 * Threads snapshot fetcher — for GitHub Actions
 * Token via env: THREADS_ACCESS_TOKEN
 * CSV output:    threads/thread-metrics.csv (relative to analytics repo root)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir   = dirname(fileURLToPath(import.meta.url));
const ROOT     = resolve(__dir, '..');
const CSV_PATH = resolve(ROOT, 'threads/thread-metrics.csv');

const SNAPSHOTS    = [24, 72, 168];
const FETCH_LIMIT  = 50;
const MAX_AGE_DAYS = 10;

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
    console.warn(`  ⚠️  ${postId} insights failed: ${err.message}`);
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

function writeCSV(headers, rows) {
  const lines = [headers.join(','), ...rows.map(r => rowToCSV(headers, r))];
  writeFileSync(CSV_PATH, lines.join('\n') + '\n', 'utf8');
}

// ── helpers ───────────────────────────────────────────────────────────────────
function hoursSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
}

function autoSlug(post) {
  const date = new Date(post.timestamp).toISOString().slice(0, 10).replace(/-/g, '');
  return `${date}-${post.id.slice(-8)}`;
}

function neededSnaps(postTimestamp, existingHours) {
  const elapsed = hoursSince(postTimestamp);
  return SNAPSHOTS.filter(s => elapsed >= s && !existingHours.has(s));
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  if (!process.env.THREADS_ACCESS_TOKEN) {
    console.error('❌  THREADS_ACCESS_TOKEN not set');
    process.exit(1);
  }

  console.log('🧵  Threads snapshot fetch\n');

  const userId = await getUserId();
  const posts  = await listPosts(userId);
  const { headers, rows } = parseCSV(readFileSync(CSV_PATH, 'utf8'));

  const snapshotsByPostId = new Map();
  const slugByPostId      = new Map();
  for (const r of rows) {
    if (r.post_id && r.thread_slug) slugByPostId.set(r.post_id, r.thread_slug);
    if (!r.post_id || !r.measured_at || !r.hours_since) continue;
    if (!snapshotsByPostId.has(r.post_id)) snapshotsByPostId.set(r.post_id, new Set());
    snapshotsByPostId.get(r.post_id).add(Number(r.hours_since));
  }

  const newRows  = [];
  const maxAgeH  = MAX_AGE_DAYS * 24;

  for (const post of posts) {
    if (hoursSince(post.timestamp) > maxAgeH) break;

    const existingH = snapshotsByPostId.get(post.id) ?? new Set();
    const needed    = neededSnaps(post.timestamp, existingH);
    if (!needed.length) continue;

    const slug     = slugByPostId.get(post.id) ?? autoSlug(post);
    const postDate = post.timestamp.slice(0, 10);

    const hasSeedRow = rows.some(r => r.post_id === post.id)
                    || newRows.some(r => r.post_id === post.id && !r.measured_at);
    if (!hasSeedRow) {
      newRows.push({
        post_id: post.id, thread_slug: slug, blog_slug: '', post_date: postDate,
        category: '', measured_at: '', hours_since: '',
        views: '', likes: '', replies: '', reposts: '', quotes: '',
        follows: '', link_clicks: '',
        notes: `auto; ${(post.text ?? '').slice(0, 40).replace(/\n/g, ' ')}`,
      });
    }

    for (const snap of needed) {
      console.log(`  📡  ${slug} T+${snap}h`);
      const m   = await getInsights(post.id);
      const v   = m.views || 1;
      const eng = ((((m.likes||0)+(m.replies||0)+(m.reposts||0)+(m.quotes||0))/v)*100).toFixed(2);
      console.log(`       views=${m.views} likes=${m.likes} eng=${eng}%`);

      newRows.push({
        post_id: post.id, thread_slug: slug, blog_slug: '', post_date: postDate,
        category: '',
        measured_at: new Date().toISOString().slice(0, 10),
        hours_since: String(snap),
        views: String(m.views ?? ''), likes: String(m.likes ?? ''),
        replies: String(m.replies ?? ''), reposts: String(m.reposts ?? ''),
        quotes: String(m.quotes ?? ''), follows: '', link_clicks: '',
        notes: `api_auto; ${snap}h snapshot`,
      });

      if (!snapshotsByPostId.has(post.id)) snapshotsByPostId.set(post.id, new Set());
      snapshotsByPostId.get(post.id).add(snap);
    }
  }

  if (!newRows.length) {
    console.log('  沒有新的快照需要寫入。');
    process.exit(0);
  }

  writeCSV(headers, [...rows, ...newRows]);
  console.log(`\n  ✅  寫入 ${newRows.length} 列 → ${CSV_PATH}`);
})().catch(err => {
  console.error('❌ ', err.message);
  process.exit(1);
});
