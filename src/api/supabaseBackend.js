// Supabase-backed implementation of the Base44 SDK surface used by this app.
// Every page talks to `base44.entities.* / auth.* / integrations.Core.* / app.*`
// unchanged — this module maps that API onto Supabase (Postgres + Auth +
// Storage), so there are no Base44 credits or token limits involved.
//
// Entity mapping (old Base44 entity -> Postgres table):
//   University        -> universities
//   Essay             -> essays
//   Material          -> materials
//   Profile           -> profiles
//   RoadmapTask       -> roadmap_tasks
//   CollegeKnowledge  -> college_knowledge

import { createClient } from '@supabase/supabase-js';
import { invokeLLM } from './llmClient';

// ---------------------------------------------------------------------------
// Table definitions (column allow-lists taken from the old Base44 entity JSON)
// ---------------------------------------------------------------------------
const SYSTEM_FIELDS = new Set(['id', 'created_at', 'updated_at', 'created_by_id', 'created_by']);

const TABLES = {
  University: 'universities',
  Essay: 'essays',
  Material: 'materials',
  Profile: 'profiles',
  RoadmapTask: 'roadmap_tasks',
  CollegeKnowledge: 'college_knowledge',
};

// Columns per table, with types used for safe coercion (Base44 accepted empty
// strings for numbers/dates; Postgres does not).
const COLUMNS = {
  universities: {
    name: 'text', country: 'text', major: 'text', application_type: 'text',
    deadline: 'date', status: 'text', notes: 'text', color: 'text',
  },
  essays: {
    university_id: 'text', university_name: 'text', title: 'text', prompt: 'text',
    word_limit: 'number', content: 'text', status: 'text', type: 'text',
    scope: 'text', application_platform: 'text', review_notes: 'text',
  },
  materials: {
    title: 'text', type: 'text', content: 'text', file_url: 'text', link_url: 'text', notes: 'text',
  },
  profiles: {
    nationality: 'text', school_system: 'text', graduation_year: 'text', background_summary: 'text',
    ib_predicted_score: 'number', ib_subjects: 'text', gpa_value: 'text', gpa_scale: 'text',
    sat_math: 'number', sat_ebrw: 'number', additional_test_info: 'text',
    ielts_listening: 'number', ielts_reading: 'number', ielts_writing: 'number', ielts_speaking: 'number',
    activities: 'json', honors: 'json', activities_awards: 'text',
    requires_financial_aid: 'boolean', financial_aid_notes: 'text', education_notes: 'text',
    additional_context: 'text',
  },
  roadmap_tasks: {
    university_id: 'text', title: 'text', description: 'text', category: 'text',
    completed: 'boolean', order: 'number',
  },
  college_knowledge: {
    university_name: 'text', knowledge: 'text', last_updated: 'date',
  },
};

function sanitize(table, data) {
  const cols = COLUMNS[table] || {};
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (SYSTEM_FIELDS.has(key)) continue;
    const type = cols[key];
    if (!type) continue; // drop unknown/system columns (id, created_*, stray keys)
    if (type === 'number' || type === 'date') {
      if (value === '' || value === undefined) out[key] = null;
      else if (typeof value === 'string' && type === 'number' && value.trim() !== '' && !Number.isNaN(Number(value))) out[key] = Number(value);
      else out[key] = value;
    } else if (type === 'boolean') {
      out[key] = value === true || value === 'true';
    } else {
      out[key] = value === undefined ? null : value;
    }
  }
  return out;
}

function unwrap({ data, error }, fallback = null) {
  if (error) {
    const e = new Error(error.message || 'Database error');
    e.status = 500;
    throw e;
  }
  return data ?? fallback;
}

function notAuthenticated() {
  const e = new Error('Not authenticated');
  e.status = 401;
  throw e;
}

// ---------------------------------------------------------------------------
export function createSupabaseBackend(supabaseUrl, supabaseAnonKey) {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const getAuthToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  };

  // ----- entity factory -----------------------------------------------------
  const makeEntity = (table) => ({
    list: async () => unwrap(
      await supabase.from(table).select('*').order('created_at', { ascending: true }),
      [],
    ),

    filter: async (query = {}) => {
      let q = supabase.from(table).select('*');
      for (const [k, v] of Object.entries(query)) q = q.eq(k, v);
      return unwrap(await q.order('created_at', { ascending: true }), []);
    },

    get: async (id) => {
      const rows = unwrap(await supabase.from(table).select('*').eq('id', id).limit(1), []);
      return rows[0] ?? null;
    },

    create: async (data) => {
      const rows = unwrap(await supabase.from(table).insert(sanitize(table, data)).select(), []);
      return rows[0];
    },

    update: async (id, data) => {
      const rows = unwrap(
        await supabase.from(table).update(sanitize(table, data)).eq('id', id).select(),
        [],
      );
      return rows[0] ?? null;
    },

    delete: async (id) => {
      unwrap(await supabase.from(table).delete().eq('id', id));
      return { success: true };
    },

    deleteMany: async (query = {}) => {
      let q = supabase.from(table).delete();
      for (const [k, v] of Object.entries(query)) q = q.eq(k, v);
      unwrap(await q);
      return { success: true };
    },

    bulkCreate: async (items = []) => {
      if (!items.length) return [];
      const rows = unwrap(
        await supabase.from(table).insert(items.map((i) => sanitize(table, i))).select(),
        [],
      );
      return rows;
    },
  });

  // ----- auth (maps 1:1 to the old base44.auth.* methods) -------------------
  const auth = {
    me: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) notAuthenticated();
      return data.user;
    },

    isAuthenticated: async () => {
      const { data } = await supabase.auth.getSession();
      return !!data?.session;
    },

    // Supabase-js persists the session itself after sign-in / verifyOtp.
    // We keep the method for API compatibility (stores a mirror token).
    setToken: (token) => {
      if (token) window.localStorage.setItem('atlas_access_token', token);
    },

    loginViaEmailPassword: async (email, password) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message || 'Invalid email or password');
      return data.user;
    },

    register: async ({ email, password }) => {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw new Error(error.message || 'Registration failed');
      // If email confirmation is disabled in Supabase, signUp returns a session
      // immediately -> caller can skip the OTP screen (see Register.jsx).
      if (data?.session?.access_token) {
        return { access_token: data.session.access_token, auto_verified: true };
      }
      return {};
    },

    verifyOtp: async ({ email, otpCode }) => {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: otpCode,
        type: 'signup',
      });
      if (error) throw new Error(error.message || 'Invalid verification code');
      return { access_token: data?.session?.access_token };
    },

    resendOtp: async (email) => {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw new Error(error.message || 'Could not resend the code');
      return { success: true };
    },

    resetPasswordRequest: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw new Error(error.message || 'Could not send the reset email');
      return { success: true };
    },

    // The recovery email links to /reset-password?token=<TokenHash> (see
    // DEPLOYMENT.md email templates). `resetToken` may be a token hash, a
    // one-time code, or null when a recovery session is already active.
    resetPassword: async ({ resetToken, newPassword }) => {
      if (resetToken) {
        // 1) token_hash style (custom email template)
        let { error } = await supabase.auth.verifyOtp({
          token_hash: resetToken,
          type: 'recovery',
        });
        if (error) {
          // 2) ?code= style (PKCE recovery link)
          ({ error } = await supabase.auth.exchangeCodeForSession(resetToken));
        }
        if (error) {
          throw new Error(error.message || 'Invalid or expired reset link');
        }
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message || 'Failed to reset password');
      return { success: true };
    },

    loginWithProvider: async (provider, returnTo = '/') => {
      const safePath = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
        ? returnTo
        : '/';
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}${safePath}`,
        },
      });
      if (error) throw new Error(error.message || 'Social login failed');
    },

    logout: (redirectUrl) => {
      supabase.auth.signOut().finally(() => {
        window.localStorage.removeItem('atlas_access_token');
        if (redirectUrl) window.location.href = redirectUrl;
      });
    },

    redirectToLogin: (returnTo = '/') => {
      const safePath = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
        ? returnTo
        : '/';
      window.location.href = `/login?returnTo=${encodeURIComponent(safePath)}`;
    },
  };

  // ----- integrations ------------------------------------------------------
  const integrations = {
    Core: {
      // Replaces Base44 Core.InvokeLLM -> POST /api/invoke-llm (Vercel function
      // calling YOUR Gemini/OpenAI/Anthropic key — no Base44 token limits).
      InvokeLLM: (params) => invokeLLM(params, getAuthToken),

      // Replaces Base44 Core.UploadPublicFile -> Supabase Storage public bucket.
      UploadPublicFile: async ({ file }) => {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id || 'anonymous';
        const safeName = String(file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120);
        const path = `${userId}/${Date.now()}-${safeName}`;
        const { error } = await supabase.storage.from('uploads').upload(path, file, {
          upsert: false,
          cacheControl: '3600',
        });
        if (error) throw new Error(error.message || 'File upload failed');
        const { data: pub } = supabase.storage.from('uploads').getPublicUrl(path);
        return { file_url: pub.publicUrl };
      },
    },
  };

  return {
    isSupabase: true,
    _supabase: supabase,
    entities: Object.fromEntries(Object.entries(TABLES).map(([name, table]) => [name, makeEntity(table)])),
    auth,
    integrations,
    app: {
      getPublicSettings: async () => ({ id: 'atlas', public_settings: {} }),
    },
  };
}
