// Shared client for the self-hosted /api/invoke-llm endpoint (the replacement
// for Base44's Core.InvokeLLM). Used by both the Supabase and the demo
// backends, so behavior is identical once deployed.

export async function invokeLLM(params, getAuthToken) {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const token = typeof getAuthToken === 'function' ? await getAuthToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* proceed without token; server will decide */ }

  const res = await fetch('/api/invoke-llm', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  let body = {};
  try {
    body = await res.json();
  } catch { /* non-JSON error body */ }

  if (!res.ok) {
    throw new Error(body.error || `AI request failed (HTTP ${res.status})`);
  }
  return body.result;
}
