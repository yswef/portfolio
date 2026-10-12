<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorText } from '../api';

  interface Visitor {
    id: number;
    entryPath: string;
    lastPath: string;
    pageviews: number;
    durationSeconds: number;
    countryName: string | null;
    country: string | null;
    city: string | null;
    device: string | null;
    browser: string | null;
    os: string | null;
    referrerHost: string | null;
    sourceType: string | null;
    startedAtIso?: string;
  }

  let days = $state(7);
  let summary = $state<any>(null);
  let visitors = $state<Visitor[]>([]);
  let total = $state(0);
  let offset = $state(0);
  let country = $state('');
  let device = $state('');
  let error = $state('');
  let notice = $state('');
  let openId = $state<number | null>(null);
  let timeline = $state<any[]>([]);

  const PAGE = 50;

  async function load() {
    error = '';
    try {
      const [s, v] = await Promise.all([
        api<{ summary: any }>('GET', `/analytics/summary?days=${days}`),
        api<{ visitors: Visitor[]; total: number }>(
          'GET',
          `/analytics/visitors?days=${days}&limit=${PAGE}&offset=${offset}${country ? `&country=${encodeURIComponent(country)}` : ''}${device ? `&device=${encodeURIComponent(device)}` : ''}`,
        ),
      ]);
      summary = s.summary;
      visitors = v.visitors;
      total = v.total ?? visitors.length;
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function openVisit(visitor: Visitor) {
    if (openId === visitor.id) {
      openId = null;
      return;
    }
    openId = visitor.id;
    try {
      const data = await api<{ timeline: any[] }>('GET', `/analytics/visits/${visitor.id}`);
      timeline = data.timeline ?? [];
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function prune() {
    if (!confirm('حذف السجلات الأقدم من مدة الاحتفاظ؟')) return;
    try {
      const result = await api<{ removed: number }>('POST', '/analytics/prune', {});
      notice = `حُذف ${result.removed} سجل قديم.`;
      await load();
    } catch (cause) {
      error = errorText(cause);
    }
  }

  function maxOf(list: { visitors?: number; pageviews?: number; count?: number; views?: number }[], key: 'visitors' | 'count' | 'views') {
    return Math.max(1, ...list.map((item) => Number(item[key] ?? 0)));
  }

  function fmtDuration(seconds: number) {
    if (!seconds) return '0s';
    return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  }

  onMount(load);
</script>

<h1 class="adm-h">التحليلات</h1>
<p class="adm-sub">تحليلات محلية بلا خدمات خارجية. لا يُحفظ عنوان IP ولا تُسجَّل زيارات البوتات أو زياراتك.</p>

{#if error}<p class="adm-error" role="alert">{error}</p>{/if}
{#if notice}<p class="adm-ok" role="status">{notice}</p>{/if}

<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:end">
  <label class="adm-field" style="margin:0"><span>المدة</span>
    <select class="adm-input" bind:value={days} onchange={load}>
      <option value={1}>24 ساعة</option><option value={7}>7 أيام</option><option value={30}>30 يوماً</option><option value={90}>90 يوماً</option>
    </select>
  </label>
  <label class="adm-field" style="margin:0"><span>الدولة (رمز)</span><input class="adm-input ltr" bind:value={country} onchange={load} maxlength="2" style="width:100px" /></label>
  <label class="adm-field" style="margin:0"><span>الجهاز</span>
    <select class="adm-input" bind:value={device} onchange={load}>
      <option value="">الكل</option><option value="mobile">جوال</option><option value="desktop">حاسوب</option><option value="tablet">جهاز لوحي</option>
    </select>
  </label>
  <button class="adm-btn small" onclick={prune}>تنظيف السجلات القديمة</button>
</div>

{#if summary}
  <div class="adm-grid">
    <div class="adm-card adm-stat"><b>{summary.now?.activeVisitors ?? 0}</b><span>الآن</span></div>
    <div class="adm-card adm-stat"><b>{summary.totals?.visitors ?? 0}</b><span>زوار</span></div>
    <div class="adm-card adm-stat"><b>{summary.totals?.sessions ?? 0}</b><span>جلسات</span></div>
    <div class="adm-card adm-stat"><b>{summary.totals?.pageviews ?? 0}</b><span>مشاهدات</span></div>
    <div class="adm-card adm-stat"><b>{fmtDuration(summary.totals?.avgDuration ?? 0)}</b><span>متوسط المدة</span></div>
    <div class="adm-card adm-stat"><b>{summary.totals?.downloads ?? 0}</b><span>تنزيلات</span></div>
  </div>

  <section class="adm-card" aria-label="الزيارات اليومية">
    <h2 class="adm-h" style="font-size:16px">الزيارات اليومية</h2>
    {#each summary.series ?? [] as point (point.date)}
      <div class="adm-row" style="padding:6px 0">
        <small class="ltr" style="width:90px;flex:0 0 90px">{point.date}</small>
        <div style="flex:1;background:#070a09;height:12px;position:relative" role="img" aria-label={`${point.visitors} زائر`}>
          <div style={`height:100%;width:${(point.visitors / maxOf(summary.series, 'visitors')) * 100}%;background:var(--brass,#dfa74c)`}></div>
        </div>
        <span class="ltr" style="min-width:40px;text-align:end">{point.visitors}</span>
      </div>
    {/each}
  </section>

  <div class="adm-split">
    <section class="adm-card">
      <h2 class="adm-h" style="font-size:16px">أكثر الصفحات</h2>
      {#each summary.topPages ?? [] as p (p.path)}
        <div class="adm-row"><span class="grow ltr">{p.path}</span><span class="ltr">{p.views}</span></div>
      {/each}
    </section>
    <section class="adm-card">
      <h2 class="adm-h" style="font-size:16px">أكثر التطبيقات تنزيلاً</h2>
      {#each summary.topDownloads ?? [] as d (d.slug + d.fileName)}
        <div class="adm-row"><span class="grow ltr">{d.slug}{d.fileName ? ` · ${d.fileName}` : ''}</span><span class="ltr">{d.count}</span></div>
      {:else}
        <p class="adm-sub">لا توجد تنزيلات بعد.</p>
      {/each}
    </section>
    <section class="adm-card">
      <h2 class="adm-h" style="font-size:16px">الدول</h2>
      {#each summary.topCountries ?? [] as c (c.country)}
        <div class="adm-row"><span class="grow">{c.name || c.country}</span><span class="ltr">{c.visitors}</span></div>
      {/each}
    </section>
    <section class="adm-card">
      <h2 class="adm-h" style="font-size:16px">مصادر الزيارة</h2>
      {#each summary.topReferrers ?? [] as r (r.source)}
        <div class="adm-row"><span class="grow ltr">{r.source}</span><span class="adm-tag">{r.type}</span><span class="ltr">{r.visitors}</span></div>
      {/each}
    </section>
  </div>
{/if}

<section class="adm-card">
  <h2 class="adm-h" style="font-size:16px">سجل الزيارات ({total})</h2>
  <div class="adm-table-wrap">
    {#each visitors as v (v.id)}
      <button class="adm-row" style="width:100%;background:none;border-inline:0;border-top:0;color:inherit;text-align:start;cursor:pointer" onclick={() => openVisit(v)} aria-expanded={openId === v.id}>
        <div class="grow">
          <span class="ltr">{v.entryPath}</span>
          <small>{[v.countryName ?? v.country, v.city, v.device, v.browser].filter(Boolean).join(' · ')} · {v.referrerHost ?? 'مباشر'}</small>
        </div>
        <span class="ltr">{v.pageviews} · {fmtDuration(v.durationSeconds)}</span>
      </button>
      {#if openId === v.id}
        <div class="adm-card" style="margin:0 0 10px">
          {#each timeline as step, i (i)}
            <div class="adm-row"><span class="ltr grow">{step.path ?? step.lastPath}</span><small class="ltr">{step.seconds ?? 0}s</small></div>
          {:else}
            <p class="adm-sub">لا توجد تفاصيل إضافية.</p>
          {/each}
        </div>
      {/if}
    {:else}
      <p class="adm-sub">لا توجد زيارات في هذه المدة.</p>
    {/each}
  </div>
  <div style="display:flex;gap:8px;margin-top:12px">
    <button class="adm-btn small" disabled={offset === 0} onclick={() => { offset = Math.max(0, offset - PAGE); load(); }}>السابق</button>
    <button class="adm-btn small" disabled={offset + PAGE >= total} onclick={() => { offset += PAGE; load(); }}>التالي</button>
  </div>
</section>
