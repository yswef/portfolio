<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorText } from '../api';
  import ObjectForm from '../ui/ObjectForm.svelte';

  const groups = [
    { key: 'profile', label: 'الملف الشخصي', hint: 'الاسم والمسمى والمدينة وطرق التواصل. الحقول الفارغة لا تظهر في الموقع.' },
    { key: 'seo', label: 'محركات البحث', hint: 'عنوان الموقع الوصفي، وصفه، وأكواد التحقق من محركات البحث.' },
    { key: 'home', label: 'الصفحة الرئيسية', hint: 'النص الترحيبي وأقسام الصفحة الرئيسية.' },
    { key: 'contact', label: 'التواصل', hint: 'نصوص نموذج التواصل وما يظهر بعد الإرسال.' },
    { key: 'publishing', label: 'النشر', hint: 'إعدادات النشر والمحتوى المعروض.' },
  ] as const;

  let values = $state<Record<string, Record<string, unknown>>>({});
  let error = $state('');
  let notice = $state('');
  let busy = $state('');
  let open = $state<string>('profile');

  async function load() {
    try {
      const data = await api<{ settings: { key: string; value: unknown }[] }>('GET', '/settings');
      const next: Record<string, Record<string, unknown>> = {};
      for (const row of data.settings) {
        next[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : (row.value as Record<string, unknown>);
      }
      values = next;
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function save(key: string, next: Record<string, unknown>) {
    busy = key;
    error = '';
    notice = '';
    try {
      await api('PUT', `/settings/${key}`, next);
      values = { ...values, [key]: next };
      notice = 'تم الحفظ.';
    } catch (cause) {
      error = errorText(cause);
    } finally {
      busy = '';
    }
  }

  onMount(load);
</script>

<h1 class="adm-h">الإعدادات</h1>
<p class="adm-sub">كل قسم يُحفظ على حدة. الحقول العربية والإنجليزية متجاورة.</p>

{#if error}<p class="adm-error" role="alert">{error}</p>{/if}
{#if notice}<p class="adm-ok" role="status">{notice}</p>{/if}

{#each groups as group (group.key)}
  <section class="adm-card">
    <button class="adm-btn" style="width:100%;text-align:start;justify-content:space-between;display:flex" aria-expanded={open === group.key} onclick={() => (open = open === group.key ? '' : group.key)}>
      <span>{group.label}</span><span aria-hidden="true">{open === group.key ? '−' : '+'}</span>
    </button>
    {#if open === group.key}
      <p class="adm-sub" style="margin-top:12px">{group.hint}</p>
      {#if values[group.key]}
        <ObjectForm value={values[group.key]!} busy={busy === group.key} onSave={(next) => save(group.key, next)} />
      {:else}
        <p class="adm-sub">جارٍ التحميل…</p>
      {/if}
    {/if}
  </section>
{/each}
