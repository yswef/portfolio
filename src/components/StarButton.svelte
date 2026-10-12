<script lang="ts">
  /**
   * "Support me with a star".
   *
   * Two paths, both requiring a deliberate click:
   *   1. no OAuth configured → the repository page opens in a new tab, where the
   *      visitor stars it themselves;
   *   2. OAuth configured → the visitor signs in with GitHub, sees an explicit
   *      consent line, and only then a single star request is sent.
   *
   * A star is never added without that click: there is no background request and
   * no automatic action on page load.
   */
  export let repo: string;
  export let stars: number | null = null;
  export let locale: 'ar' | 'en' = 'ar';
  export let oauthEnabled = false;
  export let labels: {
    star: string;
    starWithGithub: string;
    openRepo: string;
    consent: string;
  };

  let token: string | null = null;
  let consent = false;
  let state: 'idle' | 'working' | 'done' | 'error' = 'idle';
  let message = '';

  const repoUrl = `https://github.com/${repo}`;

  $: if (typeof window !== 'undefined' && oauthEnabled) {
    const params = new URLSearchParams(window.location.search);
    const returned = params.get('star_token');
    const returnedRepo = params.get('star_repo');
    if (returned && returnedRepo === repo) {
      token = returned;
      message = locale === 'ar' ? 'تم ربط حسابك. أكّد الموافقة ثم اضغط لتحويل النجمة.' : 'Account linked. Confirm consent and press to send the star.';
      const url = new URL(window.location.href);
      url.searchParams.delete('star_token');
      url.searchParams.delete('star_repo');
      history.replaceState({}, '', url.toString());
    }
  }

  async function connect() {
    if (!repo) return;
    const started = `${window.location.pathname}${window.location.search}`;
    sessionStorage.setItem('pf.star.return', started);
    const callback = new URL('/api/star/oauth/callback', window.location.origin);
    const start = new URL('/api/star/oauth/start', window.location.origin);
    start.searchParams.set('repo', repo);
    start.searchParams.set('redirect', callback.pathname);
    window.location.href = start.toString();
  }

  async function send() {
    if (!token || !consent) return;
    state = 'working';
    try {
      const response = await fetch('/api/star', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo, token, consent: true }),
      });
      const data = (await response.json()) as { ok?: boolean; starred?: boolean; error?: string };
      if (response.ok && data.starred) {
        state = 'done';
        message = locale === 'ar' ? 'شكراً، أُضيفت النجمة.' : 'Thank you, the star was added.';
        stars = (stars ?? 0) + 1;
        token = null;
        return;
      }
      state = 'error';
      message =
        data.error === 'token_expired'
          ? locale === 'ar'
            ? 'انتهت صلاحية الربط، أعد المحاولة.'
            : 'The link expired, try again.'
          : locale === 'ar'
            ? 'تعذّر إضافة النجمة.'
            : 'Could not add the star.';
    } catch {
      state = 'error';
      message = locale === 'ar' ? 'تعذّر الاتصال.' : 'Connection failed.';
    }
  }
</script>

<div class="panel panel--tight stack-sm" data-tilt>
  <div class="row" style="justify-content:space-between">
    <span class="mono small muted">{repo}</span>
    {#if stars !== null}
      <span class="chip">★ <b>{stars}</b></span>
    {/if}
  </div>

  {#if oauthEnabled}
    <label class="row small" style="gap:0.5rem; align-items:flex-start">
      <input type="checkbox" bind:checked={consent} />
      <span>{labels.consent}</span>
    </label>
    <div class="row">
      {#if !token}
        <button class="btn btn--sm" type="button" on:click={connect}>{labels.starWithGithub}</button>
      {/if}
      <button class="btn btn--sm btn--primary" type="button" disabled={!token || !consent || state === 'working'} on:click={send}>
        {labels.star}
      </button>
      <a class="btn btn--sm btn--ghost" href={repoUrl} target="_blank" rel="noopener">{labels.openRepo}</a>
    </div>
  {:else}
    <a class="btn btn--sm btn--primary" href={repoUrl} target="_blank" rel="noopener">{labels.star}</a>
  {/if}

  {#if message}
    <p class="hint" aria-live="polite">{message}</p>
  {/if}
</div>
