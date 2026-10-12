/**
 * Cryptography helpers built exclusively on the Web Crypto API, so the same code
 * runs in Pages Functions and in Node during the pre-render step.
 *
 * No third-party crypto dependency is used and no key material is ever logged.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Byte arrays created by `new Uint8Array(n)` are backed by a real ArrayBuffer,
 * which is what Web Crypto's `BufferSource` expects. Naming it keeps the crypto
 * helpers honest under strict TypeScript settings.
 */
type Bytes = Uint8Array<ArrayBuffer>;

/* --------------------------------------------------------------- encodings */

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Bytes {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Bytes {
  const binary = atob(value.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Bytes {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return base64ToBytes(padded);
}

/** URL-safe random identifier, `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToHex(buffer);
}

export function randomBase64Url(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToBase64Url(buffer);
}

/* ----------------------------------------------------------------- hashing */

export async function sha256Hex(input: string | Bytes): Promise<string> {
  const data = typeof input === 'string' ? encoder.encode(input) : input;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

/**
 * Salted, truncated hash used to recognise a returning visitor without ever
 * storing the address itself. The salt rotates daily and is derived from the
 * session secret, so yesterday's identifiers cannot be correlated with today's.
 */
export async function visitorHash(
  secret: string,
  input: { ip?: string | null; userAgent?: string | null; day: string },
): Promise<string> {
  const material = `${input.day}|${input.ip ?? ''}|${input.userAgent ?? ''}`;
  const mac = await hmac(secret, material, 'SHA-256');
  return bytesToHex(mac.slice(0, 16));
}

/** Hashing without the request IP: used for "same browser" grouping only. */
export async function clientFingerprint(secret: string, input: { ip?: string | null; day: string }) {
  return visitorHash(secret, { ip: input.ip, userAgent: null, day: input.day });
}

export async function hmac(
  secret: string | Bytes,
  data: string | Bytes,
  hash: 'SHA-1' | 'SHA-256' | 'SHA-512' = 'SHA-256',
): Promise<Bytes> {
  const keyBytes = typeof secret === 'string' ? encoder.encode(secret) : secret;
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign']);
  const payload = typeof data === 'string' ? encoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, payload));
}

/** Constant-time comparison for short strings (hex digests, CSRF tokens, ...). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------------------------------------------------------- passwords */

const DEFAULT_ITERATIONS = 150_000;

export interface PasswordOptions {
  iterations?: number;
}

export async function hashPassword(password: string, options: PasswordOptions = {}): Promise<string> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const salt: Bytes = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const bits = await deriveBits(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number.parseInt(parts[2] ?? '', 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  const salt = base64ToBytes(parts[3] ?? '');
  const expected = parts[4] ?? '';
  const bits = await deriveBits(password, salt, iterations);
  return timingSafeEqual(bytesToBase64(bits), expected);
}

async function deriveBits(password: string, salt: Bytes, iterations: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Password strength check used by the control panel before saving a new one. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push('length');
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) problems.push('case');
  if (!/[0-9]/.test(password)) problems.push('digit');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('symbol');
  const weak = ['password', 'qwerty', 'admin', '123456', 'portfolio', 'yousif', 'yswef'];
  if (weak.some((w) => password.toLowerCase().includes(w))) problems.push('common');
  return problems;
}

/* ----------------------------------------------------------- symmetric seal */

async function aesKey(secret: string, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.digest('SHA-256', encoder.encode(`${info}|${secret}`));
  return crypto.subtle.importKey('raw', base, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypts a small JSON payload (used for TOTP secrets at rest). */
export async function sealJson(secret: string, payload: unknown, info = 'seal-v1'): Promise<string> {
  const key = await aesKey(secret, info);
  const iv: Bytes = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = encoder.encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(cipher)}`;
}

export async function openSealedJson<T = unknown>(secret: string, token: string, info = 'seal-v1'): Promise<T | null> {
  try {
    const [version, ivPart, cipherPart] = token.split('.');
    if (version !== 'v1' || !ivPart || !cipherPart) return null;
    const key = await aesKey(secret, info);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(ivPart) },
      key,
      base64UrlToBytes(cipherPart),
    );
    return JSON.parse(decoder.decode(plain)) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- signed tokens */

/** Compact signed token: `<payload-b64url>.<hmac>` — used for short-lived links. */
export async function signPayload(secret: string, payload: Record<string, unknown>): Promise<string> {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const mac = bytesToBase64Url(await hmac(secret, body, 'SHA-256'));
  return `${body}.${mac}`;
}

export async function verifyPayload<T = Record<string, unknown>>(
  secret: string,
  token: string,
  options: { maxAgeSeconds?: number; now?: number } = {},
): Promise<T | null> {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = bytesToBase64Url(await hmac(secret, body, 'SHA-256'));
  if (!timingSafeEqual(expected, mac)) return null;
  try {
    const payload = JSON.parse(decoder.decode(base64UrlToBytes(body))) as T & { exp?: number; iat?: number };
    const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
    if (options.maxAgeSeconds && payload.iat && nowSeconds - payload.iat > options.maxAgeSeconds) return null;
    if (payload.exp && payload.exp < nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------- TOTP */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Bytes {
  const clean = input.replace(/[=\s-]/g, '').toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Generates a new base32 TOTP secret (160 bits, the RFC 4226 recommendation). */
export function generateTotpSecret(): string {
  const bytes: Bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/** RFC 6238 code for a given counter (RFC 4226 truncation, HMAC-SHA1). */
export async function generateTotpCode(secret: string, counter: number): Promise<string> {
  const key = base32Decode(secret);
  const message: Bytes = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i -= 1) {
    message[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  const digest = await hmac(key, message, 'SHA-1');
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export interface TotpVerifyResult {
  valid: boolean;
  counter?: number;
}

/**
 * Verifies a 6-digit code, tolerating one period of clock drift in each
 * direction. `minCounter` rejects replaying a code that was already used.
 */
export async function verifyTotp(
  secret: string,
  code: string,
  options: { window?: number; stepSeconds?: number; now?: number; minCounter?: number } = {},
): Promise<TotpVerifyResult> {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) return { valid: false };
  const step = options.stepSeconds ?? 30;
  const window = options.window ?? 1;
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const current = Math.floor(nowSeconds / step);
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + offset;
    if (counter < 0) continue;
    if (options.minCounter && counter <= options.minCounter) continue;
    const expected = await generateTotpCode(secret, counter);
    if (timingSafeEqual(expected, clean)) return { valid: true, counter };
  }
  return { valid: false };
}

export function otpauthUrl(options: {
  secret: string;
  account: string;
  issuer: string;
  stepSeconds?: number;
  digits?: number;
}): string {
  const label = encodeURIComponent(`${options.issuer}:${options.account}`);
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(options.digits ?? 6),
    period: String(options.stepSeconds ?? 30),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Recovery codes: readable groups, stored only as PBKDF2 hashes. */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = randomToken(5).toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}
