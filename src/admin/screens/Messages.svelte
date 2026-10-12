<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorText } from '../api';

  interface Message {
    id: number;
    name: string;
    email: string;
    subject: string | null;
    body: string;
    status: 'new' | 'read' | 'archived' | 'spam';
    locale: string | null;
    createdAt: number;
    createdAtIso?: string;
  }

  let messages = $state<Message[]>([]);
  let counts = $state<Record<string, number>>({});
  let filter = $state<'all' | 'new' | 'read' | 'archived' | 'spam'>('new');
  let error = $state('');

  async function load() {
    error = '';
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      const data = await api<{ messages: Message[]; counts: { status: string; count: number }[] }>('GET', `/messages${query}`);
      messages = data.messages;
      counts = Object.fromEntries(data.counts.map((c) => [c.status, c.count]));
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function setStatus(message: Message, status: Message['status']) {
    try {
      await api('PATCH', `/messages/${message.id}`, { status });
      await load();
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function remove(message: Message) {
    if (!confirm('حذف هذه الرسالة نهائياً؟')) return;
    try {
      await api('DELETE', `/messages/${message.id}`);
      await load();
    } catch (cause) {
      error = errorText(cause);
    }
  }

  onMount(load);
</script>

<h1 class="adm-h">الرسائل</h1>
<p class="adm-sub">رسائل نموذج التواصل وطلبات العمل. تُحفظ هنا فقط ولا ترسل إلى بريد خارجي.</p>

{#if error}<p class="adm-error" role="alert">{error}</p>{/if}

<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
  {#each ['new', 'read', 'archived', 'spam', 'all'] as f (f)}
    <button class="adm-btn small" aria-pressed={filter === f} onclick={() => { filter = f as typeof filter; load(); }}>
      {f === 'new' ? 'جديدة' : f === 'read' ? 'مقروءة' : f === 'archived' ? 'أرشيف' : f === 'spam' ? 'مزعجة' : 'الكل'}
      {#if f !== 'all' && counts[f]}({counts[f]}){/if}
    </button>
  {/each}
  <a class="adm-btn small" href="/api/admin/messages.csv">تصدير CSV</a>
</div>

<div class="adm-card">
  {#if messages.length === 0}<p class="adm-sub">لا توجد رسائل في هذا القسم.</p>{/if}
  {#each messages as m (m.id)}
    <article class="adm-row" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between">
        <strong>{m.name}</strong>
        <small class="ltr">{m.createdAtIso ? new Date(m.createdAtIso).toLocaleString('en-GB', { timeZone: 'Asia/Aden' }) : ''}</small>
      </div>
      <small class="ltr" style="white-space:normal">{m.email}{m.subject ? ` · ${m.subject}` : ''}</small>
      <p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0">{m.body}</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        {#if m.status !== 'read'}<button class="adm-btn small" onclick={() => setStatus(m, 'read')}>مقروءة</button>{/if}
        {#if m.status !== 'archived'}<button class="adm-btn small" onclick={() => setStatus(m, 'archived')}>أرشفة</button>{/if}
        {#if m.status !== 'spam'}<button class="adm-btn small" onclick={() => setStatus(m, 'spam')}>مزعجة</button>{/if}
        <a class="adm-btn small" href={`mailto:${m.email}`}>رد</a>
        <button class="adm-btn small danger" onclick={() => remove(m)}>حذف</button>
      </div>
    </article>
  {/each}
</div>
