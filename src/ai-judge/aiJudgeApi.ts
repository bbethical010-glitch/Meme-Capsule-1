const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const apiBase = BASE || "";
const headers = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const parse = async <T>(response: Response): Promise<T> => {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data as T;
};
export const aiJudgeApi = {
  login: async (username: string, password: string) => parse<{ token: string; user: { id: string; username: string; display_name: string }; expires_at: string }>(
    await fetch(`${apiBase}/api/ai-judge/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })
  ),
  logout: async (token: string) => parse<{ success: boolean }>(await fetch(`${apiBase}/api/ai-judge/logout`, { method: "POST", headers: headers(token) })),
  getConfig: async (token: string) => parse<{ provider: string; model: string; has_api_key: boolean }>(await fetch(`${apiBase}/api/ai-judge/config`, { headers: headers(token) })),
  saveConfig: async (token: string, config: { provider: "nvidia" | "openai"; model: string; api_key: string; max_retries: number; temperature: number }) => parse<{ provider: string; model: string; has_api_key: boolean }>(await fetch(`${apiBase}/api/ai-judge/config`, { method: "POST", headers: headers(token), body: JSON.stringify(config) })),
  startRun: async (token: string) => parse<{ run_id: string; total_queued: number }>(await fetch(`${apiBase}/api/ai-judge/run/start`, { method: "POST", headers: headers(token) })),
  stopRun: async (token: string, runId: string) => parse<{ success: boolean }>(await fetch(`${apiBase}/api/ai-judge/run/stop`, { method: "POST", headers: headers(token), body: JSON.stringify({ run_id: runId }) })),
  getProgress: async (token: string, runId: string) => parse<{ run: Record<string, unknown>; recent_decisions: unknown[]; decision_breakdown: unknown[] }>(await fetch(`${apiBase}/api/ai-judge/run/progress?run_id=${encodeURIComponent(runId)}`, { headers: headers(token) })),
  getNextMeme: async (token: string, runId: string) => parse<{ meme: { id: string; image_url: string; title: string } | null; progress: { processed: number; total: number; percent: number } }>(await fetch(`${apiBase}/api/ai-judge/next-meme?run_id=${encodeURIComponent(runId)}`, { headers: headers(token) })),
  classify: async (token: string, runId: string, memeId: string, imageUrl: string) => parse<{ success: boolean; meme_id: string; decision?: string; topics?: string[]; tone?: string; humour_mechanisms?: string[]; confidence?: number; reasoning?: string; tokens_used?: number; duration_ms?: number; error?: string }>(await fetch(`${apiBase}/api/ai-judge/classify`, { method: "POST", headers: headers(token), body: JSON.stringify({ run_id: runId, meme_id: memeId, image_url: imageUrl }) })),
  getRuns: async (token: string) => parse<{ runs: unknown[] }>(await fetch(`${apiBase}/api/ai-judge/runs`, { headers: headers(token) }))
};
