import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

// Serve the /api Vercel functions during `npm run dev` so local development
// behaves exactly like the deployed site (the AI endpoint included).
function vercelApiDevPlugin() {
  const routes = {
    '/api/invoke-llm': () => import('./api/invoke-llm.js').then((m) => m.handleInvokeLLM),
    '/api/health': () => Promise.resolve(async (_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, mode: 'vite-dev' }));
    }),
  };
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
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
export default defineConfig({
  plugins: [
    vercelApiDevPlugin(),
    react(),
  ],
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
})
