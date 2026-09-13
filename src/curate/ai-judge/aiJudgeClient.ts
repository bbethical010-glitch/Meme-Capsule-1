import type { CurateMemeItem } from "../curateTypes";
import {
  CURATION_TOPICS,
  CURATION_TONES,
  CURATION_MECHANISMS
} from "../curateTypes";
import type { AiJudgeConfig, AiJudgeDecision } from "./aiJudgeTypes";
import {
  buildAiJudgeSystemPrompt,
  buildAiJudgeUserPrompt,
  buildUnifiedAiJudgePrompt
} from "./aiJudgePrompt";

const VALID_STATUSES = new Set(["keep", "excluded", "duplicate", "review_later"]);
const VALID_TOPICS = new Set(CURATION_TOPICS.map((t) => t.id));
const VALID_TONES = new Set(CURATION_TONES.map((t) => t.id));
const VALID_MECHS = new Set(CURATION_MECHANISMS.map((m) => m.id));

/**
 * Robust JSON extractor that finds and parses the outermost JSON object
 * from any model output, handling conversational wrappers, markdown fences,
 * and conversational preambles.
 */
export const extractJsonFromText = (text: string): any => {
  let cleaned = text.trim();

  // Strip standard markdown fences if present
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Search for outermost JSON object boundaries { ... }
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }
    throw new Error(`Model output did not contain valid JSON: "${cleaned.slice(0, 120)}..."`);
  }
};

// Session caches for model capabilities to avoid repeated 501/400 failures and redundant round-trips
const unsupportedJsonModeModels = new Set<string>();
const unsupportedSystemRoleModels = new Set<string>();

const getModelCacheKey = (config: AiJudgeConfig): string =>
  `${config.provider}:${config.model}`.toLowerCase();

/**
 * Robustly normalizes API base URLs and endpoints across diverse AI providers,
 * preventing duplicate /chat/completions/chat/completions or missing /v1 paths (HTTP 404).
 */
export const resolveChatEndpoint = (baseUrl: string): string => {
  let url = (baseUrl || "").trim();
  if (!url) return "";

  // Normalize duplicate slashes except after http(s):
  url = url.replace(/([^:])\/\/+/g, "$1/");

  // If already a full chat completions endpoint
  if (url.endsWith("/chat/completions")) {
    return url;
  }
  if (url.endsWith("/chat")) {
    return `${url}/completions`;
  }

  // Handle provider base URL shorthand patterns
  const lower = url.toLowerCase();
  if (lower.includes("integrate.api.nvidia.com") && !lower.includes("/v1")) {
    url = `${url.replace(/\/+$/, "")}/v1`;
  } else if (lower.includes("openrouter.ai") && !lower.includes("/api/v1")) {
    url = lower.includes("/api") ? `${url.replace(/\/+$/, "")}/v1` : `${url.replace(/\/+$/, "")}/api/v1`;
  } else if (lower.includes("api.groq.com") && !lower.includes("/openai/v1")) {
    url = lower.includes("/openai") ? `${url.replace(/\/+$/, "")}/v1` : `${url.replace(/\/+$/, "")}/openai/v1`;
  }

  return `${url.replace(/\/+$/, "")}/chat/completions`;
};

/**
 * Execute a completion call either directly or via the Cloudflare CORS proxy.
 */
export const postCompletion = async (
  config: AiJudgeConfig,
  body: Record<string, unknown>
): Promise<any> => {
  const endpoint = resolveChatEndpoint(config.baseUrl);

  if (config.useProxy) {
    const token = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("curator_token") : null;
    const proxyHeaders: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (token) {
      proxyHeaders["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch("/api/curate/ai-proxy", {
      method: "POST",
      headers: proxyHeaders,
      body: JSON.stringify({
        endpoint,
        apiKey: config.apiKey,
        body
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errDetail =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || data.message || `Proxy failed with HTTP ${res.status}`;
      throw new Error(errDetail);
    }
    return data;
  }

  // Direct browser-to-API call
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || data.error || `API returned HTTP ${res.status}`);
  }
  return data;
};

/**
 * Test API connection and credentials with a small fast text prompt.
 */
export const testAiConnection = async (config: AiJudgeConfig): Promise<{ success: boolean; message: string }> => {
  if (!config.baseUrl.trim()) {
    return { success: false, message: "Base URL is required." };
  }

  try {
    const payload = {
      model: config.model,
      messages: [
        { role: "user", content: "Reply with the single word OK." }
      ],
      max_tokens: 150 // Reasoning models (Muse, Kimi) require adequate token budget for thinking tokens
    };

    const data = await postCompletion(config, payload);
    const choice = data?.choices?.[0];
    const content = (
      choice?.message?.content ||
      choice?.message?.reasoning_content ||
      choice?.text ||
      ""
    ).trim();

    if (content) {
      return { success: true, message: `Connected to ${config.model} successfully!` };
    }
    return { success: false, message: "Received empty response from model." };
  } catch (err: unknown) {
    let msg = err instanceof Error ? err.message : "Connection failed.";
    if (msg.includes("timed out") || msg.includes("aborted")) {
      msg = `Model request timed out (${config.model.split("/").pop()}). Large (90B) or reasoning models can take 30+ seconds to respond on free/shared tiers. Please retry, or use a faster vision model like 11B or Phi-3.`;
    }
    return {
      success: false,
      message: msg
    };
  }
};

/**
 * Universal Vision Model Analysis with Adaptive Fallback & Memory:
 * 1. Automatically checks feature memory to bypass doomed response_format calls (preventing 501/400 errors).
 * 2. Tries standard structured output mode if supported.
 * 3. If rejected due to 501, 400, response_format, or system message restrictions,
 *    remembers this capability and seamlessly falls back to universal adaptive payload.
 * 4. Uses outermost JSON extraction to reliably parse conversational model outputs.
 */
export const analyzeMemeWithAi = async (
  meme: CurateMemeItem,
  config: AiJudgeConfig
): Promise<AiJudgeDecision> => {
  const startTime = Date.now();
  const cacheKey = getModelCacheKey(config);

  const isReasoningModel =
    config.model.toLowerCase().includes("muse") ||
    config.model.toLowerCase().includes("glimmer") ||
    config.model.toLowerCase().includes("kimi") ||
    config.model.toLowerCase().includes("reasoning") ||
    config.model.toLowerCase().includes("think");

  // Models that don't support response_format or already failed with 501/400 in this session
  const jsonModeDisabled = isReasoningModel || unsupportedJsonModeModels.has(cacheKey);
  const systemRoleDisabled = unsupportedSystemRoleModels.has(cacheKey);

  // Vision image detail payload optimization (low detail drastically cuts token latency)
  const imagePayload: Record<string, unknown> = {
    url: meme.image_url
  };
  if (
    config.provider === "openrouter" ||
    config.provider === "gemini" ||
    config.baseUrl.toLowerCase().includes("openrouter") ||
    config.baseUrl.toLowerCase().includes("openai")
  ) {
    imagePayload["detail"] = "low";
  }

  const tokenLimit = isReasoningModel ? 500 : 380;

  const buildMessages = (useUnifiedPrompt: boolean) => {
    if (useUnifiedPrompt || systemRoleDisabled) {
      return [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildUnifiedAiJudgePrompt(meme.title, meme.id, config.customInstructions)
            },
            {
              type: "image_url",
              image_url: imagePayload
            }
          ]
        }
      ];
    }

    return [
      {
        role: "system",
        content: buildAiJudgeSystemPrompt(config.customInstructions)
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildAiJudgeUserPrompt(meme.title, meme.id)
          },
          {
            type: "image_url",
            image_url: imagePayload
          }
        ]
      }
    ];
  };

  const standardPayload: Record<string, unknown> = {
    model: config.model,
    messages: buildMessages(false),
    temperature: 0.1,
    max_tokens: tokenLimit
  };

  if (!jsonModeDisabled) {
    standardPayload["response_format"] = { type: "json_object" };
  }

  let data: any;
  try {
    // Attempt 1: Fast inference request (direct or memory-adapted)
    data = await postCompletion(config, standardPayload);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

    // Check if error is related to response_format, unsupported parameters, 501 Not Implemented, or 400/422 Bad Request
    const isFormatOr501Error =
      errMsg.includes("501") ||
      errMsg.includes("not implemented") ||
      errMsg.includes("response_format") ||
      errMsg.includes("json_object") ||
      errMsg.includes("schema") ||
      errMsg.includes("unexpected") ||
      errMsg.includes("extra inputs") ||
      errMsg.includes("not supported") ||
      errMsg.includes("400") ||
      errMsg.includes("422") ||
      errMsg.includes("bad request");

    const isSystemError = errMsg.includes("system") || errMsg.includes("role");

    if (isFormatOr501Error || isSystemError) {
      // Remember capability failure to avoid repeating failed round trips in future memes
      if (isFormatOr501Error) {
        unsupportedJsonModeModels.add(cacheKey);
      }
      if (isSystemError) {
        unsupportedSystemRoleModels.add(cacheKey);
      }

      // Attempt 2: Universal Adaptive Fallback without response_format and unified prompt if needed
      const fallbackPayload: Record<string, unknown> = {
        model: config.model,
        messages: buildMessages(true),
        temperature: 0.1,
        max_tokens: isReasoningModel ? 600 : 450
      };

      data = await postCompletion(config, fallbackPayload);
    } else {
      throw err;
    }
  }

  const latencyMs = Date.now() - startTime;
  const choice = data?.choices?.[0];
  const rawContent = (
    choice?.message?.content ||
    choice?.message?.reasoning_content ||
    choice?.text ||
    ""
  ).trim();

  if (!rawContent) {
    throw new Error("Model returned empty or invalid response content.");
  }

  // Parse JSON with robust outermost extractor
  let parsed: any;
  try {
    parsed = extractJsonFromText(rawContent);
  } catch (parseErr) {
    throw new Error(`Failed to parse AI output as JSON: ${rawContent.slice(0, 100)}...`);
  }

  // Sanitize and normalize classification fields
  let corpusStatus = String(parsed.corpus_status || "keep").toLowerCase();
  if (!VALID_STATUSES.has(corpusStatus)) {
    corpusStatus = "keep";
  }

  // Filter topics (must be within CURATION_TOPICS, max 3)
  const rawTopics = Array.isArray(parsed.topics) ? parsed.topics : [];
  const validTopics = rawTopics
    .map((t: unknown) => String(t).trim())
    .filter((t: string) => VALID_TOPICS.has(t as any))
    .slice(0, 3);

  // Filter tone (must be in CURATION_TONES, exactly 1)
  let tone: string | null = parsed.tone ? String(parsed.tone).trim() : null;
  if (tone && !VALID_TONES.has(tone as any)) {
    tone = "Neutral";
  }

  // Filter mechanisms (must be in CURATION_MECHANISMS, max 2)
  const rawMechs = Array.isArray(parsed.humour_mechanisms) ? parsed.humour_mechanisms : [];
  const validMechs = rawMechs
    .map((m: unknown) => String(m).trim())
    .filter((m: string) => VALID_MECHS.has(m as any))
    .slice(0, 2);

  const confidence =
    typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0.85;

  // Apply low-confidence fallback if score is below threshold
  if (confidence < config.confidenceThreshold) {
    corpusStatus = config.lowConfidenceFallback;
  }

  const curatorNote = parsed.curator_note
    ? String(parsed.curator_note).trim()
    : "Automated AI curation";

  return {
    corpus_status: corpusStatus as any,
    duplicate_of: parsed.duplicate_of || null,
    topics: validTopics.length > 0 ? validTopics : ["Everyday Life"],
    tone: tone || "Neutral",
    humour_mechanisms: validMechs.length > 0 ? validMechs : ["Relatability"],
    curator_note: curatorNote,
    confidence,
    modelUsed: config.model,
    latencyMs
  };
};
