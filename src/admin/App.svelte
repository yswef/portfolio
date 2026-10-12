<script lang="ts">
  import { onMount } from 'svelte';
  import './admin.css';
  import { api, errorText, setCsrf } from './api';
  import Login from './screens/Login.svelte';
  import Dashboard from './screens/Dashboard.svelte';
  import Projects from './screens/Projects.svelte';
  import Apps from './screens/Apps.svelte';
  import Pages from './screens/Pages.svelte';
  import Content from './screens/Content.svelte';
  import Messages from './screens/Messages.svelte';
  import Analytics from './screens/Analytics.svelte';
  import Settings from './screens/Settings.svelte';
  import Security from './screens/Security.svelte';

  type Stage = 'loading' | 'signed-out' | 'half' | 'full';

  const sections = [
    { id: 'dashboard', label: 'الرئيسية' },
    { id: 'projects', label: 'المشاريع' },
    { id: 'apps', label: 'التطبيقات' },
    { id: 'pages', label: 'الصفحات' },
    { id: 'content', label: 'المحتوى' },
    { id: 'messages', label: 'الرسائل' },
    { id: 'analytics', label: 'التحليلات' },
    { id: 'settings', label: 'الإعدادات' },
    { id: 'security', label: 'الأمان' },
  ] as const;

  let stage = $state<Stage>('loading');
  let username = $state('');
  let totpEnabled = $state(true);
  let route = $state('dashboard');
  let contentName = $state('posts');
  let fatal = $state('');

  function readRoute() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [head, sub] = hash.split('/');
    route = sections.some((s) => s.id === head) ? head : 'dashboard';
    if (head === 'content' && sub) contentName = sub;
  }

  async function refresh() {
    try {
      const me = await api<{ stage: string; csrfToken: string | null; user: { username: string; totpEnabled: boolean } | null }>('GET', '/me');
      username = me.user?.username ?? '';
      totpEnabled = me.user?.totpEnabled ?? true;
      setCsrf(me.csrfToken);
      stage = me.stage === 'full' ? 'full' : me.stage === 'half' ? 'half' : 'signed-out';
    } catch {
      setCsrf(null);
      stage = 'signed-out';
    }
  }

  onMount(() => {
    readRoute();
    window.addEventListener('hashchange', readRoute);
    refresh();
    return () => window.removeEventListener('hashchange', readRoute);
  });

  function onLoggedIn(detail: { csrfToken: string; username: string }) {
    fatal = '';
    setCsrf(detail.csrfToken);
    username = detail.username;
    stage = 'full';
  }

  async function signOut() {
    try {
      await api('POST', '/logout', {});
    } finally {
      setCsrf(null);
      stage = 'signed-out';
    }
  }

  function go(id: string) {
    location.hash = `#/${id}`;
  }

  // Keep the session fresh while the panel is open and report a lost session.
  $effect(() => {
    if (stage !== 'full') return;
    const timer = setInterval(async () => {
      try {
        await api('GET', '/me');
      } catch (error) {
        fatal = errorText(error);
        setCsrf(null);
        stage = 'signed-out';
      }
    }, 5 * 60_000);
    return () => clearInterval(timer);
  });
</script>

{#if stage === 'loading'}
  <div class="adm-login"><p class="adm-sub">جارٍ التحميل…</p></div>
{:else if stage !== 'full'}
  <Login {stage} {totpEnabled} initialNotice={fatal} onSuccess={onLoggedIn} onStage={(s) => (stage = s)} />
{:else}
  <div class="adm">
    <header class="adm-head">
      <span class="adm-brand">YSWEF / CONTROL</span>
      <span class="adm-sub" style="margin:0">{username}</span>
      <button class="adm-btn small" onclick={signOut}>خروج</button>
    </header>
    <nav class="adm-nav" aria-label="أقسام اللوحة">
      {#each sections as s (s.id)}
        <a href={`#/${s.id}`} aria-current={route === s.id ? 'page' : undefined}>{s.label}</a>
      {/each}
    </nav>
    <main class="adm-main">
      {#if route === 'dashboard'}
        <Dashboard />
      {:else if route === 'projects'}
        <Projects />
      {:else if route === 'apps'}
        <Apps />
      {:else if route === 'pages'}
        <Pages />
      {:else if route === 'content'}
        <Content name={contentName} onPick={(n) => go(`content/${n}`)} />
      {:else if route === 'messages'}
        <Messages />
      {:else if route === 'analytics'}
        <Analytics />
      {:else if route === 'settings'}
        <Settings />
      {:else if route === 'security'}
        <Security {totpEnabled} />
      {/if}
    </main>
  </div>
{/if}
