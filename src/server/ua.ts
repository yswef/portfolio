/**
 * User-agent parsing without a dependency.
 *
 * Only the signal the analytics page needs is extracted: device class, browser,
 * operating system and whether the request looks automated. Order matters —
 * browser checks run from the most specific token outwards.
 */
export interface ParsedAgent {
  device: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  deviceModel: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  isBot: boolean;
  botName: string | null;
}

const BOT_PATTERNS: [RegExp, string][] = [
  [/Googlebot/i, 'Googlebot'],
  [/bingbot/i, 'Bingbot'],
  [/DuckDuckBot/i, 'DuckDuckBot'],
  [/YandexBot/i, 'YandexBot'],
  [/Baiduspider/i, 'Baiduspider'],
  [/Applebot/i, 'Applebot'],
  [/facebookexternalhit/i, 'FacebookPreview'],
  [/Twitterbot/i, 'Twitterbot'],
  [/LinkedInBot/i, 'LinkedInBot'],
  [/TelegramBot/i, 'TelegramBot'],
  [/WhatsApp/i, 'WhatsAppPreview'],
  [/Slackbot/i, 'Slackbot'],
  [/Discordbot/i, 'Discordbot'],
  [/AhrefsBot|SemrushBot|MJ12bot|DotBot|PetalBot|DataForSeoBot/i, 'SEO crawler'],
  [/Pingdom|UptimeRobot|StatusCake|Better Uptime/i, 'Uptime monitor'],
  [/curl\/|wget\/|python-requests|python-urllib|Go-http-client|okhttp|axios\/|node-fetch|undici/i, 'Scripted client'],
  [/HeadlessChrome|PhantomJS|SlimerJS|Puppeteer|Playwright/i, 'Headless browser'],
  [/bot\b|crawler|spider|crawl|scrap/i, 'Generic bot'],
];

const MOBILE_HINTS = /iPhone|iPod|Android.+Mobile|Windows Phone|BlackBerry|Opera Mini|IEMobile|Mobile Safari/i;
const TABLET_HINTS = /iPad|Android(?!.*Mobile)|Tablet|PlayBook|Silk/i;

export function parseUserAgent(userAgent: string | null | undefined): ParsedAgent {
  const ua = (userAgent ?? '').trim();
  if (!ua) {
    return {
      device: 'unknown',
      deviceModel: null,
      browser: null,
      browserVersion: null,
      os: null,
      osVersion: null,
      isBot: false,
      botName: null,
    };
  }

  for (const [pattern, name] of BOT_PATTERNS) {
    if (pattern.test(ua)) {
      return {
        device: 'bot',
        deviceModel: null,
        browser: name,
        browserVersion: null,
        os: null,
        osVersion: null,
        isBot: true,
        botName: name,
      };
    }
  }

  const device: ParsedAgent['device'] = TABLET_HINTS.test(ua) ? 'tablet' : MOBILE_HINTS.test(ua) ? 'mobile' : 'desktop';

  let browser: string | null = null;
  let browserVersion: string | null = null;
  const browserPatterns: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)|Opera\/([\d.]+)/, 'Opera'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/YaBrowser\/([\d.]+)/, 'Yandex Browser'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/CriOS\/([\d.]+)/, 'Chrome'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
    [/MSIE ([\d.]+)|Trident\/.*rv:([\d.]+)/, 'Internet Explorer'],
  ];
  for (const [pattern, name] of browserPatterns) {
    const match = pattern.exec(ua);
    if (match) {
      browser = name;
      browserVersion = (match[1] ?? match[2] ?? '').split('.')[0] ?? null;
      break;
    }
  }

  let os: string | null = null;
  let osVersion: string | null = null;
  if (/Windows NT 10\.0/.test(ua)) {
    os = 'Windows';
    osVersion = '10/11';
  } else if (/Windows NT ([\d.]+)/.test(ua)) {
    os = 'Windows';
    osVersion = /Windows NT ([\d.]+)/.exec(ua)?.[1] ?? null;
  } else if (/Android ([\d.]+)/.test(ua)) {
    os = 'Android';
    osVersion = /Android ([\d.]+)/.exec(ua)?.[1]?.split('.')[0] ?? null;
  } else if (/iPhone OS ([\d_]+)|CPU OS ([\d_]+)/.test(ua)) {
    os = 'iOS';
    osVersion = (/iPhone OS ([\d_]+)/.exec(ua)?.[1] ?? /CPU OS ([\d_]+)/.exec(ua)?.[1] ?? '').replace(/_/g, '.');
  } else if (/Mac OS X ([\d_.]+)/.test(ua)) {
    os = 'macOS';
    osVersion = /Mac OS X ([\d_.]+)/.exec(ua)?.[1]?.replace(/_/g, '.') ?? null;
  } else if (/CrOS/.test(ua)) {
    os = 'ChromeOS';
  } else if (/Ubuntu|Linux/.test(ua)) {
    os = 'Linux';
  }

  return {
    device,
    deviceModel: deviceModelFrom(ua),
    browser,
    browserVersion,
    os,
    osVersion,
    isBot: false,
    botName: null,
  };
}

function deviceModelFrom(ua: string): string | null {
  const android = /Android [\d.]+;\s*([^;)]+?)(?:\s+Build|\))/.exec(ua);
  if (android?.[1] && !/^wv$|^en-|^[a-z]{2}-[A-Z]{2}$/.test(android[1])) {
    return android[1].trim().slice(0, 60);
  }
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  return null;
}

export type ReferrerType = 'direct' | 'internal' | 'search' | 'social' | 'ai' | 'referral' | 'campaign';

const SEARCH_HOSTS = /(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|qwant|startpage|naver|seznam)\./i;
const SOCIAL_HOSTS =
  /(facebook|instagram|twitter|x\.com|t\.co|linkedin|telegram|whatsapp|reddit|pinterest|tiktok|snapchat|mastodon|youtube|discord|threads)\./i;
const AI_HOSTS = /(chatgpt|openai|perplexity|claude|gemini|copilot|you\.com|phind|poe\.com)/i;

export function classifyReferrer(
  referrer: string | null | undefined,
  ownHost: string,
  utmSource?: string | null,
): { type: ReferrerType; host: string | null } {
  if (utmSource) return { type: 'campaign', host: hostOf(referrer) };
  if (!referrer) return { type: 'direct', host: null };
  const host = hostOf(referrer);
  if (!host) return { type: 'direct', host: null };
  if (host === ownHost || host.endsWith(`.${ownHost}`)) return { type: 'internal', host };
  if (SEARCH_HOSTS.test(host)) return { type: 'search', host };
  if (SOCIAL_HOSTS.test(host)) return { type: 'social', host };
  if (AI_HOSTS.test(host)) return { type: 'ai', host };
  return { type: 'referral', host };
}

export function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}
