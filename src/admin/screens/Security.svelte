<script lang="ts">
  import { api, errorText } from '../api';

  interface Props {
    totpEnabled: boolean;
    forced?: boolean;
    currentUsername?: string;
    onPasswordChanged?: () => void;
  }
  let { totpEnabled, forced = false, currentUsername = '', onPasswordChanged }: Props = $props();

  let currentPassword = $state('');
  let newPassword = $state('');
  let newUsername = $state('');
  let setup = $state<{ totpSecret: string; otpauthUrl: string } | null>(null);
  let code = $state('');
  let codes = $state<string[]>([]);
  let error = $state('');
  let notice = $state('');
  let enabled = $state(false);

  $effect(() => {
    enabled = totpEnabled;
  });

  async function changePassword(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    notice = '';
    try {
      await api('POST', '/password', { currentPassword, newPassword, newUsername: newUsername.trim() });
      currentPassword = newPassword = '';
      notice = 'تم تغيير بيانات الدخول.';
      onPasswordChanged?.();
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function startSetup() {
    error = '';
    try {
      setup = await api('POST', '/2fa/setup', {});
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function confirmSetup(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      const result = await api<{ recoveryCodes: string[] }>('POST', '/2fa/enable', { code: code.replace(/\s+/g, '') });
      codes = result.recoveryCodes ?? [];
      enabled = true;
      setup = null;
      code = '';
      notice = 'تم تفعيل التحقق بخطوتين. احفظ رموز الاسترداد الآن.';
    } catch (cause) {
      error = errorText(cause);
    }
  }

  async function disable(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    if (!confirm('تعطيل التحقق بخطوتين؟ سيقل الأمان بشكل كبير.')) return;
    try {
      await api('POST', '/2fa/disable', { code: code.replace(/\s+/g, ''), password: currentPassword });
      enabled = false;
      notice = 'تم تعطيل التحقق بخطوتين.';
    } catch (cause) {
      error = errorText(cause);
    }
  }
</script>

<h1 class="adm-h">{forced ? 'غيّر بيانات الدخول الافتراضية' : 'الأمان'}</h1>
<p class="adm-sub">
  {forced
    ? 'الحساب يستخدم البيانات الافتراضية. اختر اسم مستخدم وكلمة مرور جديدين للمتابعة.'
    : 'كلمة المرور ورمز التحقق من التطبيق ورموز الاسترداد.'}
</p>

{#if error}<p class="adm-error" role="alert">{error}</p>{/if}
{#if notice}<p class="adm-ok" role="status">{notice}</p>{/if}

<section class="adm-card">
  <h2 class="adm-h" style="font-size:17px">كلمة المرور واسم المستخدم</h2>
  <form onsubmit={changePassword} autocomplete="off">
    <label class="adm-field"><span>اسم المستخدم الجديد (اتركه فارغاً للإبقاء على «{currentUsername}»)</span><input class="adm-input ltr" autocomplete="username" bind:value={newUsername} maxlength="40" /></label>
    <label class="adm-field"><span>كلمة المرور الحالية</span><input class="adm-input ltr" type="password" autocomplete="current-password" bind:value={currentPassword} required /></label>
    <label class="adm-field"><span>كلمة المرور الجديدة (12 حرفاً على الأقل)</span><input class="adm-input ltr" type="password" autocomplete="new-password" bind:value={newPassword} required minlength="12" /></label>
    <button class="adm-btn primary" type="submit">تغيير</button>
  </form>
</section>

{#if !forced}
<section class="adm-card">
  <h2 class="adm-h" style="font-size:17px">التحقق بخطوتين</h2>
  <p class="adm-sub">
    الحالة: <span class={`adm-tag ${enabled ? 'on' : 'warn'}`}>{enabled ? 'مفعّل' : 'غير مفعّل'}</span>
  </p>

  {#if !enabled || setup}
    {#if !setup}
      <button class="adm-btn primary" onclick={startSetup}>بدء الإعداد</button>
    {:else}
      <p>أضف هذا المفتاح إلى تطبيق المصادقة على هاتفك، ثم أدخل الرمز الذي يظهر:</p>
      <p class="adm-pre" style="user-select:all">{setup.totpSecret}</p>
      <form onsubmit={confirmSetup}>
        <label class="adm-field"><span>الرمز من التطبيق</span><input class="adm-input ltr" inputmode="numeric" autocomplete="one-time-code" bind:value={code} required maxlength="8" /></label>
        <button class="adm-btn primary" type="submit">تفعيل</button>
      </form>
    {/if}
  {/if}

  {#if enabled && !setup}
    <form onsubmit={disable} style="margin-top:16px">
      <label class="adm-field"><span>لتعطيله: كلمة المرور ورمز حالي</span>
        <input class="adm-input ltr" type="password" placeholder="كلمة المرور" bind:value={currentPassword} />
        <input class="adm-input ltr" style="margin-top:8px" inputmode="numeric" placeholder="الرمز" bind:value={code} />
      </label>
      <button class="adm-btn danger" type="submit">تعطيل</button>
    </form>
  {/if}

  {#if codes.length}
    <h3 style="font-size:15px;margin-top:16px">رموز الاسترداد</h3>
    <p class="adm-sub">كل رمز يعمل مرة واحدة. احفظها في مكان آمن خارج الهاتف.</p>
    <div class="adm-codes">{#each codes as c (c)}<div>{c}</div>{/each}</div>
  {/if}
</section>
{/if}
