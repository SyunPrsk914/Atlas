import React from "react";
import { isDemoMode, supabaseConfigProblem } from "@/api/base44Client";

// Shown when the app is not talking to Supabase. A bad URL is not the same as
// "you have not configured anything" — say which it is.
export default function DemoModeBanner() {
  if (!isDemoMode) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg"
    >
      {supabaseConfigProblem ? (
        <>
          <span className="font-semibold">Supabase is not connected.</span>{" "}
          {supabaseConfigProblem}
        </>
      ) : (
        <>
          <span className="font-semibold">Demo mode</span> — data is stored in this
          browser only. Set the project URL and anon key (see{" "}
          <span className="font-mono">DEPLOYMENT.md</span>) to go live.
        </>
      )}
    </div>
  );
}
