// Local demo backend — used automatically when VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY are NOT set. Implements the exact same surface as the
// Supabase backend, but persists to browser localStorage so the whole UI can be
// explored before any keys are configured. A banner in the app makes the mode
// obvious. Do NOT use this for real data — connect Supabase for that.

import { invokeLLM } from './llmClient';

const DB_KEY = 'atlas_demo_db_v1';
const TOKEN_KEY = 'atlas_access_token';
const USER_KEY = 'atlas_demo_user';

const TABLES = ['universities', 'essays', 'materials', 'profiles', 'roadmap_tasks', 'college_knowledge'];

const now = () => new Date().toISOString();
const uid = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);

function loadDB() {
  try {
    return JSON.parse(window.localStorage.getItem(DB_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveDB(db) {
  window.localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function table(db, name) {
  if (!db[name]) db[name] = [];
  return db[name];
}

export function createLocalBackend() {
  const getAuthToken = async () => window.localStorage.getItem(TOKEN_KEY);

  const requireUser = () => {
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) {
      const e = new Error('Not authenticated');
      e.status = 401;
      throw e;
    }
    return JSON.parse(raw);
  };

  const makeEntity = (name) => ({
    list: async () => {
      requireUser();
      const db = loadDB();
      return [...table(db, name)].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    },

    filter: async (query = {}) => {
      requireUser();
      const db = loadDB();
      return table(db, name).filter((row) =>
        Object.entries(query).every(([k, v]) => row[k] === v),
      );
    },

    get: async (id) => {
      requireUser();
      const db = loadDB();
      return table(db, name).find((r) => r.id === id) ?? null;
    },

    create: async (data) => {
      const user = requireUser();
      const db = loadDB();
      const row = {
        ...data,
        id: uid(),
        created_by_id: user.id,
        created_at: now(),
        updated_at: now(),
      };
      table(db, name).push(row);
      saveDB(db);
      return row;
    },

    update: async (id, data) => {
      requireUser();
      const db = loadDB();
      const rows = table(db, name);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const { id: _id, created_at: _c, updated_at: _u, created_by_id: _o, ...rest } = data || {};
      rows[idx] = { ...rows[idx], ...rest, updated_at: now() };
      saveDB(db);
      return rows[idx];
    },

    delete: async (id) => {
      requireUser();
      const db = loadDB();
      db[name] = table(db, name).filter((r) => r.id !== id);
      saveDB(db);
      return { success: true };
    },

    deleteMany: async (query = {}) => {
      requireUser();
      const db = loadDB();
      db[name] = table(db, name).filter(
        (row) => !Object.entries(query).every(([k, v]) => row[k] === v),
      );
      saveDB(db);
      return { success: true };
    },

    bulkCreate: async (items = []) => {
      const user = requireUser();
      const db = loadDB();
      const created = items.map((data) => ({
        ...data,
        id: uid(),
        created_by_id: user.id,
        created_at: now(),
        updated_at: now(),
      }));
      table(db, name).push(...created);
      saveDB(db);
      return created;
    },
  });

  const auth = {
    me: async () => requireUser(),

    isAuthenticated: async () => !!window.localStorage.getItem(USER_KEY),

    setToken: (token) => {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
    },

    loginViaEmailPassword: async (email) => {
      // Demo mode: any credentials work — data stays in this browser only.
      const user = { id: uid(), email, demo: true };
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
      window.localStorage.setItem(TOKEN_KEY, 'demo-token');
      return user;
    },

    register: async ({ email }) => {
      const user = { id: uid(), email, demo: true };
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
      window.localStorage.setItem(TOKEN_KEY, 'demo-token');
      return { access_token: 'demo-token', auto_verified: true };
    },

    verifyOtp: async ({ email }) => {
      const user = { id: uid(), email, demo: true };
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
      window.localStorage.setItem(TOKEN_KEY, 'demo-token');
      return { access_token: 'demo-token' };
    },

    resendOtp: async () => ({ success: true }),

    resetPasswordRequest: async () => ({ success: true }),

    resetPassword: async () => ({ success: true }),

    loginWithProvider: async (_provider, returnTo = '/') => {
      const user = { id: uid(), email: 'demo@example.com', demo: true };
      window.localStorage.setItem(USER_KEY, JSON.stringify(user));
      window.localStorage.setItem(TOKEN_KEY, 'demo-token');
      const safePath = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
        ? returnTo
        : '/';
      window.location.href = safePath;
    },

    logout: (redirectUrl) => {
      window.localStorage.removeItem(USER_KEY);
      window.localStorage.removeItem(TOKEN_KEY);
      if (redirectUrl) window.location.href = redirectUrl;
    },

    redirectToLogin: (returnTo = '/') => {
      const safePath = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
        ? returnTo
        : '/';
      window.location.href = `/login?returnTo=${encodeURIComponent(safePath)}`;
    },
  };

  return {
    isSupabase: false,
    entities: Object.fromEntries(TABLES.map((name) => [name, makeEntity(name)])),
    auth,
    integrations: {
      Core: {
        // Same endpoint as production. Without a configured provider the API
        // returns schema-shaped DEMO content so every screen is explorable.
        InvokeLLM: (params) => invokeLLM(params, getAuthToken),

        UploadPublicFile: async ({ file }) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ file_url: reader.result });
          reader.onerror = () => reject(new Error('File read failed'));
          reader.readAsDataURL(file);
        }),
      },
    },
    app: {
      getPublicSettings: async () => ({ id: 'atlas-demo', public_settings: { demo: true } }),
    },
  };
}
