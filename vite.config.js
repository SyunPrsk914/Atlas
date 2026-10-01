import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { isPublicSupabaseKey, resolveSupabaseConfig } from './api/supabaseConfig.js'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

// Vite only copies VITE_* into process.env. The API handlers also need
// SUPABASE_URL / NEXT_PUBLIC_* from .env.local, or local research fails while
// the deployed site (where Vercel injects every var) looks configured.
function applyServerEnv(mode) {
  const fromFile = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(fromFile)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
  return fromFile
}

// Serve the /api Vercel functions during `npm run dev` so local development
// behaves exactly like the deployed site (the AI endpoint included).
function vercelApiDevPlugin() {
  const routes = {
    '/api/invoke-llm': () => import('./api/invoke-llm.js').then((m) => m.handleInvokeLLM),
    '/api/status': () => import('./api/status.js').then((m) => m.handleStatus),
    '/api/health': () => Promise.resolve(async (_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, mode: 'vite-dev' }));
    }),
  };
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      applyServerEnv(server.config.mode)
      for (const [path, load] of Object.entries(routes)) {
        server.middlewares.use(path, (req, res) => {
          load()
            .then((handler) => handler(req, res))
            .catch((err) => {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err?.message || 'Server error' }));
            });
        });
      }
    },
    configurePreviewServer(server) {
      applyServerEnv(server.config.mode)
      for (const [path, load] of Object.entries(routes)) {
        server.middlewares.use(path, (req, res) => {
          load()
            .then((handler) => handler(req, res))
            .catch((err) => {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err?.message || 'Server error' }));
            });
        });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const fileEnv = applyServerEnv(mode)
  // The browser only sees a project URL and an anon/publishable key. A Postgres
  // URI or a swapped key in SUPABASE_* / NEXT_PUBLIC_* is recovered here so the
  // client does not call createClient with an invalid URL. The service role is
  // never inlined.
  const resolved = resolveSupabaseConfig({ ...fileEnv, ...process.env })
  const publicUrl = resolved.url || ''
  const publicKey = isPublicSupabaseKey(resolved.key) ? resolved.key : ''

  return {
    plugins: [
      vercelApiDevPlugin(),
      react(),
    ],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(publicUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(publicKey),
      'import.meta.env.VITE_SUPABASE_CONFIG_PROBLEM': JSON.stringify(
        resolved.configured ? '' : (resolved.invalidReason || resolved.problems[0] || ''),
      ),
    },
    resolve: {
      alias: {
        '@': r('./src'),
      },
    },
    server: {
      host: true,
      port: 5173,
      allowedHosts: true,
    },
    preview: {
      host: true,
      port: 4173,
      allowedHosts: true,
    },
  }
})
