<script lang="ts">
  import { api, errorText } from '../api';

  interface Props {
    stage: 'signed-out' | 'half' | 'full' | 'loading';
    totpEnabled: boolean;
    initialNotice?: string;
    onSuccess: (detail: { csrfToken: string; username: string }) => void;
    onStage: (stage: 'signed-out' | 'half') => void;
  }

  let { stage, totpEnabled, initialNotice = '', onSuccess, onStage }: Props = $props();

  let username = $state('');
  let password = $state('');
  let code = $state('');
  let busy = $state(false);
  let error = $state(initialNotice);

  async function submitPassword(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await api('POST', '/login', { username: username.trim(), password });
      password = '';
      onStage('half');
    } catch (cause) {
      error = errorText(cause);
    } finally {
      busy = false;
    }
  }

  async function submitCode(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      const result = await api<{ stage: string; csrfToken: string }>('POST', '/login/totp', { code: code.replace(/\s+/g, '') });
      code = '';
      onSuccess({ csrfToken: result.csrfToken, username: username.trim() });
    } catch (cause) {
      error = errorText(cause);
    } finally {
      busy = false;
    }
  }

  async function cancel() {
    await api('POST', '/logout', {}).catch(() => undefined);
    onStage('signed-out');
  }
</script>

<div class="adm-login">
  <section class="adm-card" aria-labelledby="login-title">
    <h1 class="adm-h" id="login-title">تسجيل الدخول</h1>
    <p class="adm-sub">الدخول محمي بكلمة مرور ورمز تحقق من تطبيق على هاتفك.</p>

    {#if error}
      <p class="adm-error" role="alert">{error}</p>
    {/if}

    {#if stage !== 'half'}
      <form onsubmit={submitPassword} autocomplete="on">
        <label class="adm-field">
          <span>اسم المستخدم</span>
          <input class="adm-input ltr" name="username" autocomplete="username" bind:value={username} required maxlength="120" />
        </label>
        <label class="adm-field">
          <span>كلمة المرور</span>
          <input class="adm-input ltr" type="password" name="password" autocomplete="current-password" bind:value={password} required maxlength="400" />
        </label>
        <button class="adm-btn primary" type="submit" disabled={busy} style="width:100%">دخول</button>
      </form>
    {:else}
      <form onsubmit={submitCode}>
        <label class="adm-field">
          <span>رمز التحقق (6 أرقام) أو رمز الاسترداد</span>
          <input class="adm-input ltr" name="code" inputmode="text" autocomplete="one-time-code" bind:value={code} required maxlength="32" />
          <small>{totpEnabled ? 'افتح تطبيق المصادقة وأدخل الرمز الحالي.' : 'التحقق بخطوتين غير مفعّل بعد.'}</small>
        </label>
        <button class="adm-btn primary" type="submit" disabled={busy} style="width:100%">تحقق</button>
        <button class="adm-btn" type="button" onclick={cancel} style="width:100%;margin-top:10px">إلغاء</button>
      </form>
    {/if}
  </section>
</div>
