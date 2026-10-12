/**
 * Cloudflare Turnstile verification for the contact form.
 *
 * When `TURNSTILE_SECRET` is not configured the check is skipped and the caller
 * records the submission as unverified, so the form keeps working on a fresh
 * deployment. The deployment guide asks for the secret to be set.
 */
export interface TurnstileResult {
  success: boolean;
  configured: boolean;
  errors: string[];
  hostname?: string;
}

const ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  if (!secret) return { success: false, configured: false, errors: ['not-configured'] };
  if (!token) return { success: false, configured: true, errors: ['missing-token'] };

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const response = await fetch(ENDPOINT, { method: 'POST', body });
    const data = (await response.json()) as {
      success?: boolean;
      'error-codes'?: string[];
      hostname?: string;
    };
    return {
      success: Boolean(data.success),
      configured: true,
      errors: data['error-codes'] ?? [],
      hostname: data.hostname,
    };
  } catch (error) {
    return {
      success: false,
      configured: true,
      errors: [error instanceof Error ? error.message.slice(0, 120) : 'verify-failed'],
    };
  }
}
