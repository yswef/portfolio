<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorText } from '../api';

  interface PageRow {
    slug: string;
    title: string;
    title_ar: string | null;
    visibility: 'private' | 'public';
    file_count: number;
    total_bytes: number;
    views: number;
    visible: number;
    updated_at: number | null;
  }

  let pages = $state<PageRow[]>([]);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  let mode = $state<'single' | 'multi' | 'zip'>('single');
  let slug = $state('');
  let title = $state('');
  let titleAr = $state('');
  let summary = $state('');
  let summaryAr = $state('');
  let visibility = $state<'private' | 'public'>('private');
  let entry = $state('index.html');
  let picked = $state<FileList | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  const MAX_FILE_BYTES = 1.5 * 1024 * 1024;

  async function load() {
    try {
      pages = (await api<{ pages: PageRow[] }>('GET', '/pages')).pages;
    } catch (cause) {
      error = errorText(cause);
    }
  }

  function toBase64(bytes: Uint8Array) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function readFiles(list: FileList) {
    const out: { path: string; text?: string; base64?: string }[] = [];
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE_BYTES && !file.name.toLowerCase().endsWith('.zip')) {
        throw new Error(`الملف ${file.name} أكبر من 1.5 MB.`);
      }
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const isZip = file.name.toLowerCase().endsWith('.zip');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isZip) {
        out.push({ path: file.name, base64: toBase64(bytes) });
      } else if (/\.(html?|css|js|json|txt|md|svg|xml)$/i.test(file.name)) {
        out.push({ path, text: new TextDecoder().decode(bytes) });
      } else {
        out.push({ path, base64: toBase64(bytes) });
      }
    }
    return out;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    notice = '';
    if (!picked || picked.length === 0) {
      error = 'اختر ملفاً واحداً على الأقل.';
      return;
    }
    busy = true;
    try {
      const files = await readFiles(picked);
      const result = await api<{ written: number }>('POST', '/pages', {
        slug: slug.trim() || undefined,
        title: title.trim(),
        titleAr: titleAr.trim(),
        summary: summary.trim(),
        summaryAr: summaryAr.trim(),
        visibility,
        entry: entry.trim() || undefined,
        source: mode === 'zip' ? 'zip' : 'upload',
        files,
      });
      notice = `تم رفع ${result.written} ملف. الصفحة خاصة حتى تغيّر ظهورها.`;
      slug = title = titleAr = summary = summaryAr = '';
      picked = null;
      if (fileInput) fileInput.value = '';
      await load();
    } catch (cause) {
      error = cause instanceof Error && !(cause as { status?: number }).status ? cause.message : errorText(cause);
    } finally {
      busy = false;
    }
  }

  async function setVisibility(page: PageRow, next: 'private' | 'public') {
    error = '';
    try {
      await api('PATCH', `/pages/${page.slug}`, { visibility: next });
      await load();
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function remove(page: PageRow) {
    if (!confirm(`حذف الصفحة «${page.title}» وكل ملفاتها؟ لا يمكن التراجع.`)) return;
    try {
      await api('DELETE', `/pages/${page.slug}`);
      await load();
    } catch (cause) {
      error = errorText(cause);
    }
  }

  function kb(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }

  onMount(load);
</script>

<h1 class="adm-h">الصفحات التعليمية</h1>
<p class="adm-sub">صفحات خاصة بك افتراضياً. تُعرض داخل إطار معزول مع سياسة أمان صارمة. الصفحة العامة تظهر فقط عند تغيير ظهورها إلى عام.</p>

{#if error}<p class="adm-error" role="alert">{error}</p>{/if}
{#if notice}<p class="adm-ok" role="status">{notice}</p>{/if}

<section class="adm-card">
  <h2 class="adm-h" style="font-size:17px">رفع صفحة جديدة</h2>
  <div class="adm-grid" role="radiogroup" aria-label="طريقة الرفع" style="margin-bottom:14px">
    <button type="button" class="adm-btn" aria-pressed={mode === 'single'} onclick={() => (mode = 'single')}>ملف HTML واحد</button>
    <button type="button" class="adm-btn" aria-pressed={mode === 'multi'} onclick={() => (mode = 'multi')}>عدة ملفات</button>
    <button type="button" class="adm-btn" aria-pressed={mode === 'zip'} onclick={() => (mode = 'zip')}>ملف مضغوط ZIP</button>
  </div>

  <form onsubmit={create}>
    <div class="adm-split">
      <label class="adm-field"><span>العنوان (English)</span><input class="adm-input" bind:value={title} required maxlength="200" /></label>
      <label class="adm-field"><span>العنوان (عربي)</span><input class="adm-input" bind:value={titleAr} maxlength="200" /></label>
      <label class="adm-field"><span>الوصف (English)</span><textarea class="adm-input" bind:value={summary} maxlength="600"></textarea></label>
      <label class="adm-field"><span>الوصف (عربي)</span><textarea class="adm-input" bind:value={summaryAr} maxlength="600"></textarea></label>
      <label class="adm-field"><span>المعرّف في الرابط (اختياري)</span><input class="adm-input ltr" bind:value={slug} pattern="[a-z0-9-]{'{'}2,80{'}'}" /><small>حروف إنجليزية صغيرة وأرقام وشرطات.</small></label>
      <label class="adm-field"><span>الملف الرئيسي</span><input class="adm-input ltr" bind:value={entry} placeholder="index.html" /></label>
    </div>
    <label class="adm-field">
      <span>الملفات</span>
      <input bind:this={fileInput} class="adm-input" type="file" multiple={mode !== 'single'} accept={mode === 'zip' ? '.zip' : '.html,.htm,.css,.js,.json,.png,.jpg,.jpeg,.webp,.svg,.woff2,.txt,.md'}
        onchange={(e) => (picked = e.currentTarget.files)} />
      <small>{mode === 'single' ? 'ملف HTML واحد.' : mode === 'multi' ? 'اختر عدة ملفات باسم مشترك، أو مجلداً كاملاً من المتصفح.' : 'يُفك الضغط تلقائياً مع الحفاظ على المجلدات.'} الحد: 1.5 MB للملف الواحد.</small>
    </label>
    <label class="adm-field">
      <span>الظهور</span>
      <select class="adm-input" bind:value={visibility}>
        <option value="private">خاصة (أنت فقط)</option>
        <option value="public">عامة</option>
      </select>
    </label>
    <button class="adm-btn primary" type="submit" disabled={busy}>{busy ? 'جارٍ الرفع…' : 'رفع الصفحة'}</button>
  </form>
</section>

<section class="adm-card">
  <h2 class="adm-h" style="font-size:17px">الصفحات المرفوعة</h2>
  {#if pages.length === 0}<p class="adm-sub">لا توجد صفحات بعد.</p>{/if}
  {#each pages as page (page.slug)}
    <div class="adm-row">
      <div class="grow">
        <strong>{page.title}</strong>
        <small class="ltr">/p/{page.slug}/ · {page.file_count} ملف · {kb(page.total_bytes ?? 0)} · {page.views ?? 0} مشاهدة</small>
      </div>
      <span class={`adm-tag ${page.visibility === 'public' ? 'on' : 'warn'}`}>{page.visibility === 'public' ? 'عامة' : 'خاصة'}</span>
      <button class="adm-btn small" onclick={() => setVisibility(page, page.visibility === 'public' ? 'private' : 'public')}>
        {page.visibility === 'public' ? 'جعلها خاصة' : 'جعلها عامة'}
      </button>
      <a class="adm-btn small" href={`/p/${page.slug}/`} target="_blank" rel="noopener">فتح</a>
      <button class="adm-btn small danger" onclick={() => remove(page)}>حذف</button>
    </div>
  {/each}
</section>
