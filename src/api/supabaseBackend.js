// Supabase-backed implementation of the Base44 SDK surface used by this app.
// Every page talks to `base44.entities.* / auth.* / integrations.Core.* / app.*`
// unchanged — this module maps that API onto Supabase (Postgres + Auth +
// Storage), without Base44 runtime dependencies. AI routing is handled by runAI.
//
// Entity mapping (old Base44 entity -> Postgres table):
//   University        -> universities
//   Essay             -> essays
//   Material          -> materials
//   Profile           -> profiles
//   RoadmapTask       -> roadmap_tasks
//   CollegeKnowledge  -> college_knowledge
//   ApplicantKnowledge -> applicant_knowledge   (AI Knowledge Base; new)

import { createClient } from '@supabase/supabase-js';
import { makeError } from '@/lib/aiError';
import { invokeLLM, invokeLLMDetailed } from './llmClient';

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
  ApplicantKnowledge: 'applicant_knowledge',
};

// Columns per table, with types used for safe coercion (Base44 accepted empty
// strings for numbers/dates; Postgres does not).
//
// OPTIONAL_COLUMNS lists additive fields that older Supabase projects may not
// have yet (`materials.analysis`, `essays.limit_unit`, application platform,
// Knowledge Base provenance, and extended profile fields). They are written only if
// the database actually has them: a PostgREST "Could not find the column"
// error removes the column from the allow-list for the rest of the session and
// the write is retried without it. That keeps a freshly merged app fully
// functional against an older database — you simply re-run `supabase/schema.sql`
// (idempotent) to turn the extra persistence on.
const OPTIONAL_COLUMNS = {
  materials: ['analysis'],
  essays: ['limit_unit'],
  universities: ['application_platform'],
  college_knowledge: ['source_url', 'source_text', 'research_provider', 'research_model', 'grounded'],
  profiles: [
    'full_name', 'citizenship_status', 'curriculum', 'first_generation', 'rank',
    'act_score', 'toefl_total', 'duolingo_english', 'test_policy', 'funding_source',
  ],
};

const COLUMNS = {
  universities: {
    name: 'text', country: 'text', major: 'text', application_type: 'text',
    deadline: 'date', status: 'text', notes: 'text', color: 'text',
    application_platform: 'text',
  },
  essays: {
    university_id: 'text', university_name: 'text', title: 'text', prompt: 'text',
    word_limit: 'number', content: 'text', status: 'text', type: 'text',
    scope: 'text', application_platform: 'text', review_notes: 'text',
    limit_unit: 'text',
  },
  materials: {
    title: 'text', type: 'text', content: 'text', file_url: 'text', link_url: 'text', notes: 'text',
    analysis: 'json',
  },
  profiles: {
    nationality: 'text', school_system: 'text', graduation_year: 'text', background_summary: 'text',
    ib_predicted_score: 'number', ib_subjects: 'text', gpa_value: 'text', gpa_scale: 'text',
    sat_math: 'number', sat_ebrw: 'number', additional_test_info: 'text',
    ielts_listening: 'number', ielts_reading: 'number', ielts_writing: 'number', ielts_speaking: 'number',
    activities: 'json', honors: 'json', activities_awards: 'text',
    requires_financial_aid: 'boolean', financial_aid_notes: 'text', education_notes: 'text',
    additional_context: 'text',
    full_name: 'text', citizenship_status: 'text', curriculum: 'text',
    first_generation: 'text', rank: 'text', act_score: 'number',
    toefl_total: 'number', duolingo_english: 'number', test_policy: 'text', funding_source: 'text',
  },
  roadmap_tasks: {
    university_id: 'text', title: 'text', description: 'text', category: 'text',
    completed: 'boolean', order: 'number',
  },
  college_knowledge: {
    university_name: 'text', knowledge: 'text', last_updated: 'date',
    source_url: 'text', source_text: 'text', research_provider: 'text',
    research_model: 'text', grounded: 'boolean',
  },
  applicant_knowledge: {
    kind: 'text', category: 'text', text: 'text', origin: 'text', source_label: 'text',
    source_id: 'text', platform: 'text', sort_order: 'number', data: 'json',
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
    throw makeError(error.message || 'Database error', { status: 500, pgCode: error.code });
  }
  return data ?? fallback;
}

/** True when a PostgREST error means "this column is not in the database". */
function isMissingColumnError(error) {
  const message = String(error?.message || '');
  const code = `${error?.code || ''} ${error?.pgCode || ''}`;
  // PostgREST's PGRST204 wording inserts the missing column name between
  // "the" and "column" (for example, "Could not find the 'source_url'
  // column of 'college_knowledge' in the schema cache").
  return /PGRST204|Could not find the .*column|column .* does not exist|42703/i.test(`${code} ${message}`);
}

/**
 * Runs a Supabase call and, if it fails because an OPTIONAL column is not yet
 * present in the database, permanently removes the missing optional column
 * from the allow-list, and retries. It can drop several missing optional
 * columns before succeeding against an older Supabase project without forcing
 * an immediate migration.
 */
function withOptionalColumnFallback(table, optional, run) {
  return async (...args) => {
    while (true) {
      try {
        return await run(...args);
      } catch (error) {
        if (!isMissingColumnError(error)) throw error;
        const present = COLUMNS[table] || {};
        const missing = (optional || OPTIONAL_COLUMNS[table] || []).filter(
          (column) => column in present && String(error?.message || '').includes(column),
        );
        if (missing.length === 0) throw error;
        // Older deployments can be missing several additive columns. Remove
        // each reported column and retry until the write succeeds or a real
        // (non-optional) schema error is returned.
        missing.forEach((column) => { delete present[column]; });
      }
    }
  };
}

function notAuthenticated() {
  throw makeError('Not authenticated', { status: 401 });
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

    filter: withOptionalColumnFallback(table, OPTIONAL_COLUMNS[table], async (query = {}) => {
      const safe = {};
      for (const [k, v] of Object.entries(query)) {
        if (k in (COLUMNS[table] || {})) safe[k] = v;
      }
      let q = supabase.from(table).select('*');
      for (const [k, v] of Object.entries(safe)) q = q.eq(k, v);
      return unwrap(await q.order('created_at', { ascending: true }), []);
    }),

    get: async (id) => {
      const rows = unwrap(await supabase.from(table).select('*').eq('id', id).limit(1), []);
      return rows[0] ?? null;
    },

    create: withOptionalColumnFallback(table, OPTIONAL_COLUMNS[table], async (data) => {
      const rows = unwrap(await supabase.from(table).insert(sanitize(table, data)).select(), []);
      return rows[0];
    }),

    update: withOptionalColumnFallback(table, OPTIONAL_COLUMNS[table], async (id, data) => {
      const rows = unwrap(
        await supabase.from(table).update(sanitize(table, data)).eq('id', id).select(),
        [],
      );
      return rows[0] ?? null;
    }),

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

    bulkCreate: withOptionalColumnFallback(table, OPTIONAL_COLUMNS[table], async (items = []) => {
      if (!items.length) return [];
      const rows = unwrap(
        await supabase.from(table).insert(items.map((i) => sanitize(table, i))).select(),
        [],
      );
      return rows;
    }),
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
      // Optional hosted compatibility path -> POST /api/invoke-llm. Current
      // pages route through runAI and use local Ollama by default.
      InvokeLLM: (params) => invokeLLM(params, getAuthToken),

      // Additive: same call, but also returns the server's `meta` block so the
      // UI can report whether a response was web-grounded / demo / truncated.
      InvokeLLMDetailed: (params) => invokeLLMDetailed(params, getAuthToken),

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
    /**
     * Optional columns the database is missing.
     *
     * `probe()` asks PostgREST for each table's optional columns once. That
     * matters because a column is otherwise only discovered when a write to it
     * fails — by which point the field has already been silently dropped, and
     * the applicant has no idea their data is not being saved. Probing on load
     * lets the UI say "run supabase/schema.sql" before anything is lost.
     *
     * The synchronous accessor still answers correctly either way: a write that
     * hits a missing column removes it from COLUMNS immediately.
     */
    capabilities: {
      missingOptionalColumns: () => Object.entries(OPTIONAL_COLUMNS).flatMap(([table, cols]) =>
        cols.filter((c) => !(c in (COLUMNS[table] || {})))),

      async probe() {
        // PostgREST names one missing column per error. Asking for every
        // optional column at once used to stop after the first, so the banner
        // under-reported what would be dropped on save.
        for (const [table, cols] of Object.entries(OPTIONAL_COLUMNS)) {
          let pending = cols.filter((c) => c in (COLUMNS[table] || {}));
          while (pending.length) {
            const { error } = await supabase.from(table).select(pending.join(',')).limit(1);
            if (!error || !isMissingColumnError(error)) break;
            const named = [...pending].sort((a, b) => b.length - a.length)
              .find((c) => error.message.includes(c));
            if (!named) break;
            delete COLUMNS[table][named];
            pending = pending.filter((c) => c !== named);
          }
        }
        return this.missingOptionalColumns();
      },
    },
    auth,
    integrations,
    app: {
      getPublicSettings: async () => ({ id: 'atlas', public_settings: {} }),
    },
  };
}
