// Drop-in replacement for the old Base44 SDK client.
//
// The public surface is identical to what every page already calls:
//   base44.entities.<Entity>.{list,filter,get,create,update,delete,deleteMany,bulkCreate}
//   base44.auth.{me,isAuthenticated,setToken,loginViaEmailPassword,register,verifyOtp,
//                resendOtp,resetPasswordRequest,resetPassword,loginWithProvider,logout,redirectToLogin}
//   base44.integrations.Core.{InvokeLLM,UploadPublicFile}
//   base44.app.getPublicSettings
//
// Backends:
//   * Supabase (Postgres + Auth + Storage)  — when a real project URL and anon
//     key resolve from VITE_*, NEXT_PUBLIC_*, or SUPABASE_* (see vite.config.js).
//   * localStorage demo mode               — when they are not set, so the UI
//     runs with zero configuration. Data stays in this browser only.
//
// A set-but-invalid URL is not passed to createClient. That used to throw
// "Invalid supabaseUrl" and take the Knowledge Base down with it.

import { resolveSupabaseConfig } from '../../api/supabaseConfig.js';
import { createSupabaseBackend } from './supabaseBackend';
import { createLocalBackend } from './localBackend';

// Legacy Base44 link hygiene: scrub stale tokens when ?clear_access_token=true.
if (typeof window !== 'undefined') {
  try {
    if (new URLSearchParams(window.location.search).get('clear_access_token') === 'true') {
      window.localStorage.removeItem('base44_access_token');
      window.localStorage.removeItem('token');
      window.localStorage.removeItem('atlas_access_token');
    }
  } catch { /* no window URL (SSR/tests) */ }
}

// Vite inlines these. vite.config.js fills them from whichever public env name
// actually holds a valid project URL and anon key.
const supabaseConfig = resolveSupabaseConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

// vite.config.js inlines this from every public env name, including a bad
// SUPABASE_URL that never reaches the browser as a URL.
const inlinedProblem = import.meta.env.VITE_SUPABASE_CONFIG_PROBLEM || '';

export const supabaseConfigProblem = supabaseConfig.configured
  ? ''
  : (inlinedProblem || supabaseConfig.invalidReason || supabaseConfig.problems[0] || '');

export const isDemoMode = !supabaseConfig.configured;

export const base44 = supabaseConfig.configured
  ? createSupabaseBackend(supabaseConfig.url, supabaseConfig.key)
  : createLocalBackend();
