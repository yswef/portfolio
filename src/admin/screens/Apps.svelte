<script lang="ts">
  import { onMount } from 'svelte';
  import { api, errorText } from '../api';

  interface AppRow {
    id: number;
    slug: string;
    name: string;
    visible: boolean;
    featured: boolean;
    autoCreated: boolean;
    currentVersion: string | null;
    pricingMode: 'free' | 'paid' | 'donation';
    priceLabel: string | null;
    priceLabelAr: string | null;
    pricingDetails: string | null;
    pricingDetailsAr: string | null;
    paymentUrl: string | null;
    paymentMethod: string | null;
    [key: string]: unknown;
  }
  interface AssetRow {
    id: number;
    app_id: number;
    file_name: string;
    release_tag: string;
    kind: string;
    size_bytes: number | null;
    download_url: string | null;
    is_current: number;
    visible: number;
    label: string | null;
  }

  let apps = $state<AppRow[]>([]);
  let assets = $state<AssetRow[]>([]);
  let error = $state('');
  let notice = $state('');
  let savingId = $state<number | null>(null);

  const kinds = ['installer', 'portable', 'checksum', 'source', 'other'];

  async function load() {
    try {
      const data = await api<{ apps: AppRow[]; assets: AssetRow[] }>('GET', '/apps');
      apps = data.apps.map((a) => ({ ...a, visible: Boolean(a.visible), featured: Boolean(a.featured) }));
      assets = data.assets;
    } catch (cause) {
      error = errorText(cause);
    }
  }

  function assetsOf(appId: number) {
    return assets.filter((a) => a.app_id === appId && a.is_current);
  }

  async function saveApp(app: AppRow) {
    savingId = app.id;
    error = '';
    notice = '';
    const body = {
      visible: app.visible,
      featured: app.featured,
      nameAr: app.nameAr ?? '',
      taglineAr: app.taglineAr ?? '',
      pricingMode: app.pricingMode,
      priceLabel: app.priceLabel ?? '',
      priceLabelAr: app.priceLabelAr ?? '',
      pricingDetails: app.pricingDetails ?? '',
      pricingDetailsAr: app.pricingDetailsAr ?? '',
      paymentUrl: app.paymentUrl ?? '',
      paymentMethod: app.paymentMethod ?? '',
      requirements: app.requirements ?? '',
      requirementsAr: app.requirementsAr ?? '',
      licenseNote: app.licenseNote ?? '',
      licenseNoteAr: app.licenseNoteAr ?? '',
    };
    try {
      await api('PATCH', `/collection/apps/${app.id}`, body);
      notice = `تم حفظ ${app.name}.`;
    } catch (cause) {
      error = errorText(cause);
    } finally {
      savingId = null;
    }
  }

  async function patchAsset(asset: AssetRow, body: Record<string, unknown>) {
    error = '';
    try {
      await api('PATCH', `/assets/${asset.id}`, body);
      assets = assets.map((a) => (a.id === asset.id ? { ...a, ...mapAsset(body) } : a));
    } catch (cause) {
      error = errorText(cause);
    }
  }

  function mapAsset(body: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    if ('visible' in body) out.visible = body.visible ? 1 : 0;
    if ('kind' in body) out.kind = body.kind;
    return out;
  }

  async function dismiss(app: AppRow) {
    if (!confirm(`إخفاء ${app.name} من صفحة التطبيقات؟ يمكن إعادته لاحقاً من إعدادات المشروع.`)) return;
    try {
      await api('POST', `/apps/${app.id}/dismiss`, {});
      await load();
    } catch (cause) {
      error = errorText(cause);
    }
  }

  function fmtSize(bytes: number | null) {
    if (!bytes) return '';
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }

  onMount(load);
</script>

<h1 class="adm-h">التطبيقات والأسعار</h1>
<p class="adm-sub">كل إصدار يحتوي على ملفات تُنشأ صفحة تنزيل تلقائياً. حدّد هنا السعر وطريقة الدفع لكل تطبيق.</p>

{#if error}<p class="adm-error" role="alert">{error}</p>{/if}
{#if notice}<p class="adm-ok" role="status">{notice}</p>{/if}

{#if apps.length === 0}
  <div class="adm-card"><p class="adm-sub">لا توجد تطبيقات بعد. تُنشأ تلقائياً عند نشر إصدار في مشروع فيه ملفات.</p></div>
{/if}

{#each apps as app (app.id)}
  <section class="adm-card">
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
      <h2 class="adm-h" style="font-size:18px;margin:0">{app.name} <small class="ltr adm-sub">{app.currentVersion ?? ''}</small></h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label class="adm-check"><input type="checkbox" bind:checked={app.visible} /> ظاهر</label>
        <label class="adm-check"><input type="checkbox" bind:checked={app.featured} /> مميز</label>
      </div>
    </div>

    <div class="adm-split" style="margin-top:12px">
      <label class="adm-field">
        <span>الاسم بالعربية</span>
        <input class="adm-input" bind:value={app.nameAr} />
      </label>
      <label class="adm-field">
        <span>نمط التسعير</span>
        <select class="adm-input" bind:value={app.pricingMode}>
          <option value="free">مجاني</option>
          <option value="paid">مدفوع</option>
          <option value="donation">دعم اختياري</option>
        </select>
      </label>
      <label class="adm-field">
        <span>السعر (English)</span>
        <input class="adm-input" bind:value={app.priceLabel} />
      </label>
      <label class="adm-field">
        <span>السعر (عربي)</span>
        <input class="adm-input" bind:value={app.priceLabelAr} />
      </label>
      <label class="adm-field">
        <span>رابط الدفع</span>
        <input class="adm-input ltr" type="url" inputmode="url" bind:value={app.paymentUrl} placeholder="https://" />
      </label>
      <label class="adm-field">
        <span>طريقة الدفع</span>
        <input class="adm-input" bind:value={app.paymentMethod} />
      </label>
      <label class="adm-field">
        <span>تفاصيل الدفع (English)</span>
        <textarea class="adm-input" bind:value={app.pricingDetails}></textarea>
      </label>
      <label class="adm-field">
        <span>تفاصيل الدفع (عربي)</span>
        <textarea class="adm-input" bind:value={app.pricingDetailsAr}></textarea>
      </label>
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:10px">
      <button class="adm-btn primary" onclick={() => saveApp(app)} disabled={savingId === app.id}>{savingId === app.id ? 'جارٍ الحفظ…' : 'حفظ'}</button>
      {#if app.autoCreated}
        <button class="adm-btn danger" onclick={() => dismiss(app)}>إخفاء نهائياً</button>
      {/if}
    </div>

    <h3 style="font-size:15px;margin:18px 0 6px">الملفات في الإصدار الحالي</h3>
    {#if assetsOf(app.id).length === 0}
      <p class="adm-sub">لا توجد ملفات في الإصدار الحالي.</p>
    {/if}
    {#each assetsOf(app.id) as asset (asset.id)}
      <div class="adm-row">
        <div class="grow">
          <strong class="ltr" style="display:block;overflow-wrap:anywhere">{asset.file_name}</strong>
          <small class="ltr">{asset.release_tag} · {fmtSize(asset.size_bytes)}</small>
        </div>
        <label class="adm-field" style="margin:0;min-width:130px">
          <span>النوع</span>
          <select class="adm-input" value={asset.kind} onchange={(e) => patchAsset(asset, { kind: e.currentTarget.value })}>
            {#each kinds as k (k)}<option value={k}>{k}</option>{/each}
          </select>
        </label>
        <label class="adm-check"><input type="checkbox" checked={!!asset.visible} onchange={(e) => patchAsset(asset, { visible: e.currentTarget.checked })} /> ظاهر للزوار</label>
      </div>
    {/each}
  </section>
{/each}
