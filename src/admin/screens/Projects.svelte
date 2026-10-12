<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorText } from '../api';

  let projects = $state<any[]>([]);
  let query = $state('');
  let selected = $state(new Set<number>());
  let error = $state('');
  let notice = $state('');
  let loading = $state(true);

  const docModes = [
    { value: 'readme', label: 'README' },
    { value: 'single', label: 'ملف HTML واحد' },
    { value: 'multi', label: 'مجلد وثائق' },
    { value: 'none', label: 'بدون وثائق' },
  ];

  async function load() {
    loading = true;
    try {
      const data = await api<{ projects: any[] }>('GET', `/projects${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      projects = data.projects;
    } catch (cause) {
      error = errorText(cause);
    } finally {
      loading = false;
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    error = '';
    try {
      await api('PATCH', `/projects/${id}`, body);
      projects = projects.map((p) => (p.id === id ? { ...p, ...body } : p));
    } catch (cause) {
      error = errorText(cause);
      await load();
    }
  }

  async function bulk(action: string, value?: unknown) {
    if (!selected.size) return;
    error = '';
    try {
      await api('POST', '/projects/bulk', { ids: [...selected], action, value });
      notice = 'تم تطبيق الإجراء على المحدد.';
      selected = new Set();
      await load();
    } catch (cause) {
      error = errorText(cause);
    }
  }

  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  onMount(load);
</script>

<h1 class="adm-h">المشاريع</h1>
<p class="adm-sub">المشاريع تُجلب من GitHub تلقائياً. هنا تتحكم في ما يظهر وترتيبه وطريقة عرض وثائقه.</p>

{#if error}<p class="adm-error" role="alert">{error}</p>{/if}
{#if notice}<p class="adm-ok" role="status">{notice}</p>{/if}

<div class="adm-card" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
  <input class="adm-input" style="flex:1 1 200px" type="search" placeholder="بحث بالاسم أو الوصف" bind:value={query} onchange={load} aria-label="بحث في المشاريع" />
  <span class="adm-sub" style="margin:0">المحدد: {selected.size}</span>
  <button class="adm-btn small" disabled={!selected.size} onclick={() => bulk('show')}>إظهار</button>
  <button class="adm-btn small" disabled={!selected.size} onclick={() => bulk('hide')}>إخفاء</button>
  <button class="adm-btn small" disabled={!selected.size} onclick={() => bulk('feature')}>تمييز</button>
</div>

{#if loading}
  <p class="adm-sub">جارٍ التحميل…</p>
{:else if projects.length === 0}
  <div class="adm-card"><p class="adm-sub">لا توجد مشاريع بعد. ستظهر بعد أول مزامنة مع GitHub.</p></div>
{/if}

<div class="adm-card">
  {#each projects as p (p.id)}
    <div class="adm-row">
      <label class="adm-check" style="min-width:44px">
        <input type="checkbox" checked={selected.has(p.id)} onchange={() => toggleSelect(p.id)} aria-label={`تحديد ${p.name}`} />
      </label>
      <div class="grow">
        <strong class="ltr" style="display:block">{p.name}</strong>
        <small class="ltr">{p.fullName ?? ''} · ★ {p.stars ?? 0}</small>
      </div>
      <label class="adm-check"><input type="checkbox" checked={!!p.visible} onchange={(e) => patch(p.id, { visible: e.currentTarget.checked })} /> ظاهر</label>
      <label class="adm-check"><input type="checkbox" checked={!!p.featured} onchange={(e) => patch(p.id, { featured: e.currentTarget.checked })} /> مميز</label>
      <label class="adm-field" style="margin:0;min-width:90px">
        <span>الترتيب</span>
        <input class="adm-input ltr" type="number" value={p.sortOrder ?? 0} min="-9999" max="9999"
          onchange={(e) => patch(p.id, { sortOrder: Number(e.currentTarget.value) })} />
      </label>
      <label class="adm-field" style="margin:0;min-width:160px">
        <span>عرض الوثائق</span>
        <select class="adm-input" value={p.docMode ?? 'readme'} onchange={(e) => patch(p.id, { docMode: e.currentTarget.value })}>
          {#each docModes as mode (mode.value)}
            <option value={mode.value}>{mode.label}</option>
          {/each}
        </select>
      </label>
    </div>
  {/each}
</div>
