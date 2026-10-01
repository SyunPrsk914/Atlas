// Resolve the Supabase project URL and anon key from whatever env vars are
// actually set. The Vercel Supabase integration, Vite, and a hand-copied
// .env.example do not agree on names, and a postgres connection string or a
// quoted placeholder will make @supabase/supabase-js throw
// "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL" before any feature
// runs. This module picks the first value that is a real https project URL
// and a real anon/publishable key, and says exactly what is wrong otherwise.
//
// Safe to import from the Vite client and from the serverless function.

const URL_NAMES = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const KEY_NAMES = [
  'SUPABASE_ANON_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
];

const PLACEHOLDER = /YOUR-PROJECT-REF|your-anon-public-key|your-project-ref|changeme|^placeholder$/i;

export function stripWrapping(value) {
  let s = String(value ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  // Vercel sometimes stores a trailing newline or a trailing slash comment.
  return s.replace(/\s+#.*$/, '').trim();
}

export function looksLikeJwtOrKey(value) {
  const s = stripWrapping(value);
  return s.startsWith('eyJ') || s.startsWith('sb_publishable_') || s.startsWith('sb_secret_');
}

export function looksLikeHttpUrl(value) {
  return /^https?:\/\//i.test(stripWrapping(value));
}

/** Pull https://<ref>.supabase.co out of a Postgres connection string, if possible. */
export function recoverProjectUrl(postgresUrl) {
  const s = stripWrapping(postgresUrl);
  const fromHost = s.match(/db\.([a-z0-9]{12,30})\.supabase\.co/i);
  if (fromHost) return `https://${fromHost[1].toLowerCase()}.supabase.co`;
  const fromUser = s.match(/postgres(?:ql)?:\/\/postgres\.([a-z0-9]{12,30})(?::|@)/i);
  if (fromUser) return `https://${fromUser[1].toLowerCase()}.supabase.co`;
  return '';
}

/**
 * @param {string} raw
 * @returns {{ url: string, problem: string, recovered?: boolean }}
 */
export function normalizeSupabaseUrl(raw) {
  const original = stripWrapping(raw);
  if (!original) return { url: '', problem: 'empty' };
  if (PLACEHOLDER.test(original)) return { url: '', problem: 'placeholder' };
  if (/^postgres(ql)?:\/\//i.test(original)) {
    const recovered = recoverProjectUrl(original);
    if (recovered) return { url: recovered, problem: '', recovered: true };
    return { url: '', problem: 'postgres' };
  }
  let candidate = original;
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[a-z0-9.-]+\.supabase\.co\/?$/i.test(candidate)) candidate = `https://${candidate}`;
    else return { url: '', problem: 'not-http' };
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: '', problem: 'not-http' };
    }
    return { url: parsed.origin, problem: '' };
  } catch {
    return { url: '', problem: 'malformed' };
  }
}

function describeUrlProblem(name, problem) {
  if (problem === 'postgres') {
    return `${name} is a Postgres connection string, not the project URL. Use https://YOUR-REF.supabase.co from Supabase → Project Settings → API (Project URL). Do not use the database URI.`;
  }
  if (problem === 'placeholder') {
    return `${name} is still the placeholder from .env.example. Replace it with your real project URL (https://YOUR-REF.supabase.co).`;
  }
  if (problem === 'not-http' || problem === 'malformed') {
    return `${name} is not a valid http(s) URL. It must look like https://YOUR-REF.supabase.co — include the https://, and do not wrap the value in quotes.`;
  }
  return `${name} could not be used as a Supabase project URL.`;
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function resolveSupabaseConfig(env = {}) {
  const problems = [];
  /** @type {{ name: string, url: string, recovered: boolean }[]} */
  const urls = [];
  /** @type {{ name: string, value: string }[]} */
  const keys = [];

  for (const name of URL_NAMES) {
    const value = stripWrapping(env[name]);
    if (!value) continue;
    if (looksLikeJwtOrKey(value)) {
      if (isPublicSupabaseKey(value)) keys.push({ name, value });
      problems.push(isPublicSupabaseKey(value)
        ? `${name} contains an API key, not a project URL. The URL and the anon key look swapped.`
        : `${name} contains a secret key, not a project URL. Never put the service_role key in a URL variable.`);
      continue;
    }
    const normalized = normalizeSupabaseUrl(value);
    if (normalized.url) urls.push({ name, url: normalized.url, recovered: !!normalized.recovered });
    else problems.push(describeUrlProblem(name, normalized.problem));
  }

  for (const name of KEY_NAMES) {
    const value = stripWrapping(env[name]);
    if (!value) continue;
    if (looksLikeHttpUrl(value) || /^[a-z0-9.-]+\.supabase\.co\/?$/i.test(value)) {
      const normalized = normalizeSupabaseUrl(value);
      if (normalized.url) {
        urls.push({ name, url: normalized.url, recovered: !!normalized.recovered });
        problems.push(`${name} looks like a project URL, so it was not used as the anon key. The URL and the key look swapped.`);
      }
      continue;
    }
    if (PLACEHOLDER.test(value)) {
      problems.push(`${name} is still the placeholder from .env.example. Paste the anon / public key from Supabase → Project Settings → API.`);
      continue;
    }
    if (!isPublicSupabaseKey(value)) {
      problems.push(`${name} is not an anon or publishable key. Do not use the service_role key. Copy the anon / public key from Supabase → Project Settings → API.`);
      continue;
    }
    keys.push({ name, value });
  }

  const url = urls[0] || null;
  const key = keys[0] || null;
  const hadAny = URL_NAMES.some((n) => stripWrapping(env[n])) || KEY_NAMES.some((n) => stripWrapping(env[n]));

  return {
    url: url?.url || '',
    key: key?.value || '',
    urlSource: url?.name || null,
    keySource: key?.name || null,
    recoveredFromDatabaseUrl: !!url?.recovered,
    problems,
    configured: !!(url?.url && key?.value),
    // A bad value was supplied and we could not recover a usable project URL.
    // Callers must not pass that string to createClient.
    invalidReason: !url?.url && hadAny
      ? (problems[0] || 'Supabase is configured, but no value is a valid https project URL.')
      : '',
  };
}

/** True for an anon / publishable key. False for a service-role or secret key. */
export function isPublicSupabaseKey(value) {
  const s = stripWrapping(value);
  if (!s || s.length < 20) return false;
  if (s.startsWith('sb_secret_')) return false;
  if (PLACEHOLDER.test(s)) return false;
  const payload = decodeJwtPayload(s);
  if (payload?.role === 'service_role') return false;
  return s.startsWith('eyJ') || s.startsWith('sb_publishable_');
}

function decodeJwtPayload(token) {
  const part = String(token).split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    if (typeof atob !== 'function') return null;
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}
