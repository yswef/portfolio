<script lang="ts">
  /**
   * Work request form.
   *
   * Everything is validated in the browser first (so a phone user gets an
   * immediate answer) and again on the server. Turnstile is loaded only when a
   * site key is configured, and the widget is invisible for most visitors.
   */
  interface Strings {
    name: string;
    email: string;
    phone: string;
    company: string;
    projectType: string;
    budget: string;
    subject: string;
    message: string;
    messageHint: string;
    send: string;
    sending: string;
    success: string;
    error: string;
    rateLimited: string;
    turnstileFailed: string;
    invalidEmail: string;
    required: string;
    honeypot: string;
  }

  export let locale: 'ar' | 'en';
  export let strings: Strings;
  export let turnstileSiteKey = '';
  export let projectTypes: string[] = [];

  let name = '';
  let email = '';
  let phone = '';
  let company = '';
  let projectType = '';
  let budget = '';
  let subject = '';
  let message = '';
  let website = ''; // honeypot
  let state: 'idle' | 'sending' | 'sent' | 'error' = 'idle';
  let errorMessage = '';
  let turnstileToken = '';

  const t = (key: 'invalidEmail' | 'required') => strings[key];

  function onTurnstileLoaded() {
    const container = document.querySelector('.turnstile-slot');
    if (!container || !turnstileSiteKey) return;
    const w = window as unknown as { turnstile?: { render: (el: Element, options: Record<string, unknown>) => void } };
    w.turnstile?.render(container, {
      sitekey: turnstileSiteKey,
      theme: 'dark',
      callback: (token: string) => {
        turnstileToken = token;
      },
      'expired-callback': () => {
        turnstileToken = '';
      },
    });
  }

  $: if (turnstileSiteKey) {
    const w = window as unknown as { turnstile?: unknown };
    if (w.turnstile) {
      onTurnstileLoaded();
    } else if (!document.getElementById('turnstile-script')) {
      const script = document.createElement('script');
      script.id = 'turnstile-script';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = onTurnstileLoaded;
      document.head.appendChild(script);
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    errorMessage = '';

    if (!name.trim()) {
      state = 'error';
      errorMessage = t('required');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      state = 'error';
      errorMessage = t('invalidEmail');
      return;
    }
    if (message.trim().length < 10) {
      state = 'error';
      errorMessage = t('required');
      return;
    }

    state = 'sending';
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone,
          company,
          projectType,
          budget,
          subject,
          body: message,
          website,
          locale,
          turnstileToken,
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };

      if (response.ok && data.ok) {
        state = 'sent';
        name = email = phone = company = subject = message = budget = projectType = '';
        turnstileToken = '';
        return;
      }
      state = 'error';
      errorMessage =
        data.error === 'rate_limited'
          ? strings.rateLimited
          : data.error === 'turnstile_failed'
            ? strings.turnstileFailed
            : data.error === 'invalid_email'
              ? strings.invalidEmail
              : strings.error;
    } catch {
      state = 'error';
      errorMessage = strings.error;
    }
  }
</script>

<form class="stack" on:submit={submit} novalidate>
  <div class="grid grid-two" style="gap:1rem">
    <div class="field">
      <label for="cf-name">{strings.name} *</label>
      <input id="cf-name" class="input" bind:value={name} autocomplete="name" required maxlength="120" />
    </div>
    <div class="field">
      <label for="cf-email">{strings.email} *</label>
      <input id="cf-email" class="input" type="email" bind:value={email} autocomplete="email" required maxlength="200" />
    </div>
    <div class="field">
      <label for="cf-phone">{strings.phone}</label>
      <input id="cf-phone" class="input" type="tel" bind:value={phone} autocomplete="tel" maxlength="40" />
    </div>
    <div class="field">
      <label for="cf-company">{strings.company}</label>
      <input id="cf-company" class="input" bind:value={company} autocomplete="organization" maxlength="160" />
    </div>
    {#if projectTypes.length > 0}
      <div class="field">
        <label for="cf-type">{strings.projectType}</label>
        <select id="cf-type" class="select" bind:value={projectType}>
          <option value="">—</option>
          {#each projectTypes as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </div>
    {/if}
    <div class="field">
      <label for="cf-budget">{strings.budget}</label>
      <input id="cf-budget" class="input" bind:value={budget} maxlength="80" />
    </div>
  </div>

  <div class="field">
    <label for="cf-subject">{strings.subject}</label>
    <input id="cf-subject" class="input" bind:value={subject} maxlength="200" />
  </div>

  <div class="field">
    <label for="cf-message">{strings.message} *</label>
    <textarea id="cf-message" class="textarea" bind:value={message} required maxlength="6000"></textarea>
    <span class="hint">{strings.messageHint}</span>
  </div>

  <!-- Honeypot: real visitors never see it. -->
  <div class="hp">
    <label for="cf-website">{strings.honeypot}</label>
    <input id="cf-website" bind:value={website} tabindex="-1" autocomplete="off" />
  </div>

  {#if turnstileSiteKey}
    <div class="turnstile-slot"></div>
  {/if}

  <div class="row" style="justify-content:space-between">
    <button class="btn btn--primary" type="submit" disabled={state === 'sending'}>
      {state === 'sending' ? strings.sending : strings.send}
    </button>
    <p class="hint" aria-live="polite">
      {#if state === 'sent'}
        <span style="color:var(--mint)">{strings.success}</span>
      {:else if state === 'error'}
        <span style="color:var(--oxide)">{errorMessage}</span>
      {/if}
    </p>
  </div>
</form>
