import React from "react";
import { isDemoMode } from "@/api/base44Client";

// Small, unobtrusive badge shown only when no Supabase keys are configured.
// In demo mode all data lives in this browser's localStorage and the AI
// endpoint returns clearly-labeled demo output until an LLM key is set.
export default function DemoModeBanner() {
  if (!isDemoMode) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg"
      title="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see DEPLOYMENT.md) to switch to Supabase."
    >
      <span className="font-semibold">Demo mode</span> — data is stored in this
      browser only. Connect Supabase to go live (see{" "}
      <span className="font-mono">DEPLOYMENT.md</span>).
    </div>
  );
}
