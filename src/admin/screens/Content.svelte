<script lang="ts">
  import { api, errorText } from '../api';

  interface Props {
    name: string;
    onPick: (name: string) => void;
  }
  interface FieldSpec {
    type: 'string' | 'text' | 'int' | 'float' | 'bool' | 'json' | 'enum' | 'bilingual' | 'pairs' | 'list';
    values: string[] | null;
  }
  interface Spec {
    labelColumn: string;
    fields: Record<string, FieldSpec>;
  }

  let { name, onPick }: Props = $props();

  const collections = [
    { id: 'posts', label: 'المقالات' },
    { id: 'services', label: 'الخدمات' },
    { id: 'skills', label: 'المهارات' },
    { id: 'learning', label: 'ما أتعلمه' },
    { id: 'experience', label: 'الخبرة' },
    { id: 'credentials', label: 'الشهادات' },
    { id: 'socials', label: 'روابط التواصل' },
  ];

  let items = $state<Record<string, any>[]>([]);
  let spec = $state<Spec | null>(null);
  let editing = $state<Record<string, any> | null>(null);
  let editingId = $state<number | null>(null);
  let form = $state<Record<string, any>>({});
  let error = $state('');
  let notice = $state('');
  let saving = $state(false);
  let preview = $state<Record<string, string>>({});

  const hidden = new Set(['id', 'createdAt', 'updatedAt', 'views', 'syncedAt']);

  async function load() {
    error = '';
    try {
      const data = await api<{ items: Record<string, any>[]; spec: Spec }>('GET', `/collection/${name}`);
      items = data.items;
      spec = data.spec;
    } catch (cause) {
      error = errorText(cause);
    }
  }

  // Load whenever the selected collection changes.
  $effect(() => {
    const current = name;
    void current;
    editing = null;
    items = [];
    load();
  });

  function fieldsFor(s: Spec | null) {
    if (!s) return [];
    return Object.entries(s.fields).filter(([key]) => !hidden.has(key));
  }

  function blankForm(s: Spec) {
    const out: Record<string, any> = {};
    for (const [key, field] of Object.entries(s.fields)) {
      if (field.type === 'bool') out[key] = false;
      else if (field.type === 'int' || field.type === 'float') out[key] = 0;
      else if (field.type === 'bilingual') out[key] = { ar: '', en: '' };
      else if (field.type === 'list') out[key] = [];
      else if (field.type === 'pairs' || field.type === 'json') out[key] = [];
      else out[key] = field.values ? field.values[0] : '';
    }
    return out;
  }

  function startNew() {
    if (!spec) return;
    editingId = null;
    form = blankForm(spec);
    editing = form;
    preview = {};
    notice = '';
  }

  function startEdit(item: Record<string, any>) {
    if (!spec) return;
    editingId = Number(item.id);
    const out: Record<string, any> = {};
    for (const [key, field] of Object.entries(spec.fields)) {
      const value = item[key];
      if (field.type === 'list') out[key] = Array.isArray(value) ? value.join(', ') : '';
      else if (field.type === 'pairs' || field.type === 'json') out[key] = JSON.stringify(value ?? (field.type === 'pairs' ? [] : {}), null, 2);
      else if (field.type === 'bilingual') out[key] = { ar: value?.ar ?? '', en: value?.en ?? '' };
      else if (field.type === 'bool') out[key] = Boolean(value);
      else out[key] = value ?? (field.type === 'int' || field.type === 'float' ? 0 : '');
    }
    form = out;
    editing = out;
    preview = {};
    notice = '';
  }

  function serialize(): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (!spec) return body;
    for (const [key, field] of Object.entries(spec.fields)) {
      if (hidden.has(key)) continue;
      const value = form[key];
      if (field.type === 'list') body[key] = String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
      else if (field.type === 'pairs' || field.type === 'json') {
        try {
          body[key] = JSON.parse(String(value || (field.type === 'pairs' ? '[]' : '{}')));
        } catch {
          throw new Error(`الحقل ${key} ليس JSON صحيحاً.`);
        }
      } else if (field.type === 'int' || field.type === 'float') body[key] = Number(value) || 0;
      else body[key] = value;
    }
    return body;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    notice = '';
    saving = true;
    try {
      const body = serialize();
      if (editingId === null) {
        await api('POST', `/collection/${name}`, body);
        notice = 'تمت الإضافة.';
      } else {
        await api('PATCH', `/collection/${name}/${editingId}`, body);
        notice = 'تم الحفظ.';
      }
      editing = null;
      editingId = null;
      await load();
    } catch (cause) {
      error = cause instanceof Error && !(cause as { status?: number }).status ? cause.message : errorText(cause);
    } finally {
      saving = false;
    }
  }

  async function remove(item: Record<string, any>) {
    if (!spec) return;
    if (!confirm(`حذف «${item[spec.labelColumn] ?? item.id}»؟`)) return;
    try {
      await api('DELETE', `/collection/${name}/${item.id}`);
      await load();
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function previewMarkdown(key: string) {
    try {
      const result = await api<{ html: string }>('POST', '/markdown', { text: String(form[key] ?? '') });
      preview = { ...preview, [key]: result.html };
    } catch (cause) {
      error = errorText(cause);
    }
  }

  function label(item: Record<string, any>) {
    if (!spec) return '';
    const value = item[spec.labelColumn];
    if (value && typeof value === 'object') return value.ar || value.en || '';
    return String(value ?? item.id);
  }

  function inputType(key: string) {
    return /url|link|email|phone|whatsapp|handle|slug/i.test(key) ? 'url' : 'text';
  }
</script>

<h1 class="adm-h">المحتوى</h1>
<p class="adm-sub">كل حقل له نسختان: عربية وإنجليزية. الحقول الفارغة لا تُعرض في الموقع.</p>

<div class="adm-grid" role="tablist" aria-label="أنواع المحتوى" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));margin-bottom:16px">
  {#each collections as c (c.id)}
    <button class="adm-btn small" role="tab" aria-selected={name === c.id} aria-pressed={name === c.id} onclick={() => onPick(c.id)}>{c.label}</button>
  {/each}
</div>

{#if error}<p class="adm-error" role="alert">{error}</p>{/if}
{#if notice}<p class="adm-ok" role="status">{notice}</p>{/if}

{#if editing && spec}
  <section class="adm-card" aria-label="نموذج التحرير">
    <h2 class="adm-h" style="font-size:17px">{editingId === null ? 'إضافة جديدة' : 'تحرير'}</h2>
    <form onsubmit={save}>
      {#each fieldsFor(spec) as [key, field] (key)}
        {#if field.type === 'bool'}
          <label class="adm-check" style="margin-bottom:12px"><input type="checkbox" bind:checked={form[key]} /> {key}</label>
        {:else if field.type === 'enum'}
          <label class="adm-field"><span>{key}</span>
            <select class="adm-input" bind:value={form[key]}>
              {#each field.values ?? [] as option (option)}<option value={option}>{option}</option>{/each}
            </select>
          </label>
        {:else if field.type === 'bilingual'}
          <div class="adm-split">
            <label class="adm-field"><span>{key} (عربي)</span><input class="adm-input" bind:value={form[key].ar} /></label>
            <label class="adm-field"><span>{key} (English)</span><input class="adm-input ltr" bind:value={form[key].en} /></label>
          </div>
        {:else if field.type === 'int' || field.type === 'float'}
          <label class="adm-field"><span>{key}</span><input class="adm-input ltr" type="number" step={field.type === 'float' ? 'any' : '1'} bind:value={form[key]} /></label>
        {:else if field.type === 'text' && /markdown/i.test(key)}
          <div class="adm-field">
            <span>{key}</span>
            <textarea class="adm-input ltr" style="min-height:260px" bind:value={form[key]}></textarea>
            <div><button type="button" class="adm-btn small" onclick={() => previewMarkdown(key)}>معاينة</button></div>
            {#if preview[key]}
              <div class="adm-md-preview md">{@html preview[key]}</div>
            {/if}
          </div>
        {:else if field.type === 'text'}
          <label class="adm-field"><span>{key}</span><textarea class="adm-input" bind:value={form[key]}></textarea></label>
        {:else if field.type === 'list'}
          <label class="adm-field"><span>{key}</span><input class="adm-input" bind:value={form[key]} /><small>افصل بين العناصر بفاصلة.</small></label>
        {:else if field.type === 'pairs' || field.type === 'json'}
          <label class="adm-field"><span>{key} (JSON)</span><textarea class="adm-input ltr" bind:value={form[key]}></textarea></label>
        {:else}
          <label class="adm-field"><span>{key}</span><input class="adm-input {inputType(key) === 'url' ? 'ltr' : ''}" type={inputType(key)} bind:value={form[key]} /></label>
        {/if}
      {/each}
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="adm-btn primary" type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        <button class="adm-btn" type="button" onclick={() => (editing = null)}>إلغاء</button>
      </div>
    </form>
  </section>
{/if}

<section class="adm-card">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px">
    <h2 class="adm-h" style="font-size:17px;margin:0">{collections.find((c) => c.id === name)?.label}</h2>
    <button class="adm-btn primary small" onclick={startNew}>إضافة</button>
  </div>
  {#if items.length === 0}<p class="adm-sub">لا توجد عناصر بعد.</p>{/if}
  {#each items as item (item.id)}
    <div class="adm-row">
      <div class="grow"><strong>{label(item)}</strong></div>
      <button class="adm-btn small" onclick={() => startEdit(item)}>تحرير</button>
      <button class="adm-btn small danger" onclick={() => remove(item)}>حذف</button>
    </div>
  {/each}
</section>
