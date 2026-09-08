const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const headers = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

async function parse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data as T;
}

export interface AiUser { id: string; username: string; display_name: string }
export interface AiConfig { provider: "nvidia" | "openai"; model: string; has_api_key: boolean }
export interface AiMeme { id: string; image_url: string; title: string }
export interface AiResult { success: boolean; meme_id: string; decision?: string; topics?: string[]; tone?: string; humour_mechanisms?: string[]; confidence?: number; reasoning?: string; tokens_used?: number; duration_ms?: number; error?: string }
export interface AiProgress { processed: number; total: number; percent: number }

export const aiJudgeApi = {
  login: async (username: string, password: string) => parse<{ token: string; user: AiUser; expires_at: string }>(await fetch(`${BASE}/api/ai-judge/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })),
  logout: async (token: string) => parse<{ success: boolean }>(await fetch(`${BASE}/api/ai-judge/logout`, { method: "POST", headers: headers(token) })),
  getConfig: async (token: string) => parse<AiConfig>(await fetch(`${BASE}/api/ai-judge/config`, { headers: headers(token) })),
  saveConfig: async (token: string, config: { provider: "nvidia" | "openai"; model: string; api_key: string; max_retries: number; temperature: number }) => parse<AiConfig>(await fetch(`${BASE}/api/ai-judge/config`, { method: "POST", headers: headers(token), body: JSON.stringify(config) })),
  startRun: async (token: string) => parse<{ run_id: string; total_queued: number }>(await fetch(`${BASE}/api/ai-judge/run/start`, { method: "POST", headers: headers(token) })),
  stopRun: async (token: string, runId: string) => parse<{ success: boolean }>(await fetch(`${BASE}/api/ai-judge/run/stop`, { method: "POST", headers: headers(token), body: JSON.stringify({ run_id: runId }) })),
  getProgress: async (token: string, runId: string) => parse<{ run: Record<string, unknown>; recent_decisions: Record<string, unknown>[]; decision_breakdown: Record<string, unknown>[] }>(await fetch(`${BASE}/api/ai-judge/run/progress?run_id=${encodeURIComponent(runId)}`, { headers: headers(token) })),
  getNextMeme: async (token: string, runId: string) => parse<{ meme: AiMeme | null; progress: AiProgress }>(await fetch(`${BASE}/api/ai-judge/next-meme?run_id=${encodeURIComponent(runId)}`, { headers: headers(token) })),
  classify: async (token: string, runId: string, memeId: string, imageUrl: string) => parse<AiResult>(await fetch(`${BASE}/api/ai-judge/classify`, { method: "POST", headers: headers(token), body: JSON.stringify({ run_id: runId, meme_id: memeId, image_url: imageUrl }) })),
  getRuns: async (token: string) => parse<{ runs: Record<string, unknown>[] }>(await fetch(`${BASE}/api/ai-judge/runs`, { headers: headers(token) }))
};
