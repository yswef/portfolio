<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorText } from '../api';

  let summary = $state<any>(null);
  let runs = $state<any[]>([]);
  let busy = $state('');
  let message = $state('');
  let error = $state('');

  async function load() {
    try {
      const [analytics, syncRuns] = await Promise.all([
        api<{ summary: any }>('GET', '/analytics/summary?days=7'),
        api<{ runs: any[] }>('GET', '/sync/runs'),
      ]);
      summary = analytics.summary;
      runs = syncRuns.runs ?? [];
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function sync() {
    busy = 'sync';
    message = '';
    error = '';
    try {
      const result = await api<{ summary: { ok: boolean; reposSeen: number; reposCreated: number; releasesSeen: number; error?: string } }>('POST', '/sync', {});
      message = result.summary.ok
        ? `تمت المزامنة: ${result.summary.reposSeen} مستودع، ${result.summary.reposCreated} جديد، ${result.summary.releasesSeen} إصدار.`
        : `المزامنة لم تكتمل: ${result.summary.error ?? 'سبب غير معروف'}`;
      await load();
    } catch (cause) {
      error = errorText(cause);
    } finally {
      busy = '';
    }
  }

  async function publish() {
    busy = 'publish';
    message = '';
    error = '';
    try {
      const result = await api<{ message: string }>('POST', '/publish', {});
      message = result.message === 'committed' ? 'تم نشر المحتوى. سيُعاد بناء الموقع تلقائياً.' : 'لا توجد تغييرات جديدة للنشر.';
    } catch (cause) {
      error = errorText(cause);
    } finally {
      busy = '';
    }
  }

  onMount(load);
</script>

<h1 class="adm-h">الرئيسية</h1>
<p class="adm-sub">نظرة سريعة على الزوار والمزامنة مع GitHub.</p>

{#if error}<p class="adm-error" role="alert">{error}</p>{/if}
{#if message}<p class="adm-ok" role="status">{message}</p>{/if}

<div class="adm-grid">
  <div class="adm-card adm-stat"><b>{summary?.now?.activeVisitors ?? '—'}</b><span>زوار نشطون الآن</span></div>
  <div class="adm-card adm-stat"><b>{summary?.totals?.visitors ?? '—'}</b><span>زوار آخر 7 أيام</span></div>
  <div class="adm-card adm-stat"><b>{summary?.totals?.pageviews ?? '—'}</b><span>مشاهدات الصفحات</span></div>
  <div class="adm-card adm-stat"><b>{summary?.totals?.downloads ?? '—'}</b><span>تنزيلات التطبيقات</span></div>
</div>

<section class="adm-card">
  <h2 class="adm-h" style="font-size:17px">المزامنة والنشر</h2>
  <p class="adm-sub">المزامنة تعمل تلقائياً كل 15 دقيقة. استخدم الزر عند الحاجة لتحديث فوري.</p>
  <div style="display:flex;flex-wrap:wrap;gap:10px">
    <button class="adm-btn primary" onclick={sync} disabled={busy !== ''}>{busy === 'sync' ? 'جارٍ المزامنة…' : 'مزامنة الآن'}</button>
    <button class="adm-btn" onclick={publish} disabled={busy !== ''}>{busy === 'publish' ? 'جارٍ النشر…' : 'نشر المحتوى'}</button>
  </div>
</section>

<section class="adm-card">
  <h2 class="adm-h" style="font-size:17px">آخر عمليات المزامنة</h2>
  {#if runs.length === 0}
    <p class="adm-sub">لا توجد عمليات بعد.</p>
  {/if}
  {#each runs.slice(0, 10) as run (run.id)}
    <div class="adm-row">
      <div class="grow">
        <span class={`adm-tag ${run.status === 'ok' ? 'on' : 'warn'}`}>{run.status ?? '—'}</span>
        <span class="adm-tag">{run.trigger ?? 'auto'}</span>
        <small>{run.started_at ? new Date(run.started_at * 1000).toLocaleString('ar-SA-u-nu-latn') : ''}</small>
      </div>
      {#if run.error}<small style="color:#e89a88">{run.error}</small>{/if}
    </div>
  {/each}
</section>
