export default {
  async scheduled(event, env, ctx) {
    const res = await fetch(
      'https://api.github.com/repos/fafnerzhang/the-right-pace-analytics/actions/workflows/fetch-snapshots.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_PAT}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'the-right-pace-analytics',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );
    console.log(`dispatch ${new Date().toISOString()}: HTTP ${res.status}`);
    if (!res.ok) {
      const body = await res.text();
      console.error(`dispatch failed: ${body}`);
    }
  },
};
