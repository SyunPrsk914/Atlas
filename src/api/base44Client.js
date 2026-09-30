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
//   * Supabase (Postgres + Auth + Storage)  — when VITE_SUPABASE_URL and
//     VITE_SUPABASE_ANON_KEY are set. This is the production path (Vercel +
//     Supabase; see DEPLOYMENT.md).
//   * localStorage demo mode               — when they are not set, so the UI
//     runs with zero configuration. Data stays in this browser only.

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

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isDemoMode = !(supabaseUrl && supabaseAnonKey);

export const base44 = isDemoMode
  ? createLocalBackend()
  : createSupabaseBackend(supabaseUrl, supabaseAnonKey);
