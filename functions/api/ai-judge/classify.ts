import type { PagesFunction } from "../../_shared/pages";
import { json, type Env } from "../../_shared/d1r2";
import { requireAiJudgeAuth } from "../../_shared/aiJudgeAuth";

const TOPICS = ["Everyday Life", "Work / Education", "Relationships", "Family", "Politics / Society", "Internet Culture", "Pop Culture", "Gaming", "Animals", "Food", "Technology", "Other"];
const TONES = ["Wholesome", "Dark", "Chaotic", "Cynical", "Awkward", "Neutral"];
const MECHANISMS = ["Relatability", "Absurdity", "Irony", "Satire", "Exaggeration", "Cringe", "Dark Humour", "Parody", "Surrealism"];
const DECISIONS = ["keep", "excluded", "duplicate", "review_later"];

interface Payload { run_id?: string; meme_id?: string; image_url?: string }
interface Config { provider: "nvidia" | "openai"; model: string; api_key: string; max_retries: number; temperature: number }
interface Result { topics: string[]; tone: string; humour_mechanisms: string[]; decision: string; confidence: number; reasoning: string }

const buildPrompt = () => `You are an AI meme judge. Analyse the meme image and classify it using exactly this taxonomy.
TOPICS: ${TOPICS.join(", ")}
TONE: ${TONES.join(", ")}
HUMOUR MECHANISMS: ${MECHANISMS.join(", ")}
DECISION: keep, excluded, duplicate, or review_later.
Respond with only JSON: {"topics":["Everyday Life"],"tone":"Neutral","humour_mechanisms":["Relatability"],"decision":"keep","confidence":0.85,"reasoning":"One short sentence."}
Use 1-3 topics, exactly one tone, 1-2 humour mechanisms, confidence from 0 to 1.`;

const extractJson = (text: string): Record<string, unknown> => {
  const clean = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
    throw new Error("Model returned invalid JSON.");
  }
};

const validateResult = (raw: Record<string, unknown>): Result => {
  const topics = Array.isArray(raw.topics) ? raw.topics.filter((value): value is string => typeof value === "string") : [];
  const mechanisms = Array.isArray(raw.humour_mechanisms) ? raw.humour_mechanisms.filter((value): value is string => typeof value === "string") : [];
  const tone = typeof raw.tone === "string" ? raw.tone : "";
  const decision = raw.decision === "exclude" ? "excluded" : raw.decision === "later" ? "review_later" : typeof raw.decision === "string" ? raw.decision : "";
  const confidence = typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : NaN;
  if (topics.length < 1 || topics.length > 3 || topics.some((value) => !TOPICS.includes(value)) ||
      !TONES.includes(tone) || mechanisms.length < 1 || mechanisms.length > 2 || mechanisms.some((value) => !MECHANISMS.includes(value)) ||
      !DECISIONS.includes(decision) || !Number.isFinite(confidence)) {
    throw new Error("Model response did not match the required taxonomy.");
  }
  return { topics, tone, humour_mechanisms: mechanisms, decision, confidence, reasoning: typeof raw.reasoning === "string" ? raw.reasoning.slice(0, 500) : "No reasoning provided." };
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAiJudgeAuth(request, env);
  const body = (await request.json().catch(() => ({}))) as Payload;
  const runId = (body.run_id || "").trim();
  const memeId = (body.meme_id || "").trim();
  const imageUrl = (body.image_url || "").trim();
  const started = Date.now();
  const config = runId ? await env.DB.prepare("SELECT provider, model, api_key, max_retries, temperature FROM ai_judge_config WHERE user_id = ?").bind(user.id).first<Config>() : null;
  const fail = async (message: string) => {
    if (runId && memeId && config) {
      await env.DB.prepare("INSERT INTO ai_judge_processed (meme_id, run_id, user_id, error, model, provider, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(memeId, runId, user.id, message.slice(0, 500), config.model, config.provider, Date.now() - started).run();
      await env.DB.prepare("UPDATE ai_judge_runs SET processed = processed + 1, failed = failed + 1 WHERE id = ? AND user_id = ?").bind(runId, user.id).run();
    }
    return json({ success: false, meme_id: memeId, error: message });
  };
  if (!runId || !memeId || !imageUrl) return fail("run_id, meme_id, and image_url are required.");
  const run = await env.DB.prepare("SELECT id, status FROM ai_judge_runs WHERE id = ? AND user_id = ?").bind(runId, user.id).first<{ id: string; status: string }>();
  if (!run || run.status !== "running") return fail("Run is not active.");
  if (!config?.api_key) return fail("AI provider configuration is missing.");
  try {
    const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
    if (!imageResponse.ok) throw new Error(`Image request failed with ${imageResponse.status}.`);
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    const base64 = btoa(binary);
    let result: Result | null = null;
    let rawText = "";
    let tokens = 0;
    let lastError = "AI request failed.";
    const retries = Math.min(5, Math.max(1, config.max_retries || 3));
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const endpoint = config.provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://integrate.api.nvidia.com/v1/chat/completions";
        const content = [{ type: "text", text: buildPrompt() }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}`, ...(config.provider === "openai" ? { detail: "low" } : {}) } }];
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.api_key}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ model: config.model, temperature: config.temperature, max_tokens: 400, stream: false, messages: [{ role: "user", content }], ...(config.provider === "openai" ? { response_format: { type: "json_object" } } : {}) }),
          signal: AbortSignal.timeout(25000)
        });
        if (!response.ok) throw new Error(`AI provider returned ${response.status}.`);
        const payload = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
        rawText = payload.choices?.[0]?.message?.content || "";
        tokens = payload.usage?.total_tokens || 0;
        result = validateResult(extractJson(rawText));
        break;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : "AI request failed.";
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
    if (!result) return fail(lastError);
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ai_judge_processed (meme_id, run_id, user_id, decision, topics, tone, mechanisms, confidence, reasoning, raw_response, model, provider, tokens_used, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(memeId, runId, user.id, result.decision, JSON.stringify(result.topics), result.tone, JSON.stringify(result.humour_mechanisms), result.confidence, result.reasoning, rawText, config.model, config.provider, tokens, Date.now() - started),
      env.DB.prepare(`INSERT INTO meme_curation (meme_id, user_id, user_name, corpus_status, topics, tone, humour_mechanisms, curator_note, reviewed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(meme_id, user_id) DO UPDATE SET corpus_status = excluded.corpus_status, topics = excluded.topics, tone = excluded.tone, humour_mechanisms = excluded.humour_mechanisms, curator_note = excluded.curator_note, user_name = excluded.user_name, updated_at = excluded.updated_at`)
        .bind(memeId, user.id, "AI Judge", result.decision, JSON.stringify(result.topics), result.tone, JSON.stringify(result.humour_mechanisms), result.reasoning, now, now),
      env.DB.prepare("UPDATE ai_judge_runs SET processed = processed + 1, succeeded = succeeded + 1 WHERE id = ? AND user_id = ?").bind(runId, user.id)
    ]);
    return json({ success: true, meme_id: memeId, decision: result.decision, topics: result.topics, tone: result.tone, humour_mechanisms: result.humour_mechanisms, confidence: result.confidence, reasoning: result.reasoning, tokens_used: tokens, duration_ms: Date.now() - started });
  } catch (error: unknown) {
    return fail(error instanceof Error ? error.message : "Classification failed.");
  }
};
