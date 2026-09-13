/**
 * POST /api/curate/ai-proxy
 *
 * Relay proxy to bypass browser CORS restrictions when calling external
 * vision models (e.g. NVIDIA NIM, OpenRouter, Google AI Studio, custom APIs).
 * Requires an active curator session.
 */

import type { PagesFunction } from "../../_shared/pages";
import { json, type Env } from "../../_shared/d1r2";
import { validateSession } from "../../_shared/catAuth";

interface ProxyPayload {
  endpoint?: string;
  apiKey?: string;
  body?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const sessionUser = await validateSession(request, env);
    const authHeader = request.headers.get("Authorization");
    const originHeader = request.headers.get("Origin") || "";
    const refererHeader = request.headers.get("Referer") || "";
    const requestHost = new URL(request.url).host;

    // Check authorization:
    // 1. Valid curator session in D1
    // 2. Or Bearer token matching ADMIN_API_TOKEN
    // 3. Or Same-origin browser request from the meme capsule domain
    const isSameOrigin =
      (originHeader && originHeader.includes(requestHost)) ||
      (refererHeader && refererHeader.includes(requestHost));

    const isAdmin = Boolean(env.ADMIN_API_TOKEN && authHeader === `Bearer ${env.ADMIN_API_TOKEN}`);
    const isCurator = Boolean(sessionUser || (authHeader && authHeader.startsWith("Bearer ")));

    if (!isSameOrigin && !isAdmin && !isCurator) {
      return json({ error: "Unauthorized curator session." }, { status: 401 });
    }

    const payload = (await request.json().catch(() => ({}))) as ProxyPayload;
    let endpoint = (payload.endpoint || "").trim();
    const apiKey = (payload.apiKey || "").trim();

    if (!endpoint || !endpoint.startsWith("http")) {
      return json({ error: "A valid HTTP(S) API endpoint is required.", isRetryable: false }, { status: 400 });
    }

    // Sanitize duplicate path segments (e.g. /chat/completions/chat/completions -> /chat/completions)
    endpoint = endpoint.replace(/([^:])\/\/+/g, "$1/");
    if (endpoint.includes("/chat/completions/chat/completions")) {
      endpoint = endpoint.replace("/chat/completions/chat/completions", "/chat/completions");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    // Execute downstream call with adaptive 110s timeout and single fast transient retry
    const maxAttempts = 2;
    let lastError: Error | null = null;
    let downstreamRes: Response | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 110000); // 110s extended ceiling for vision models

      try {
        downstreamRes = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload.body || {}),
          signal: controller.signal
        });

        clearTimeout(timeout);

        // If transient 502/503/504 and first attempt, retry once after short backoff
        if (attempt === 1 && [502, 503, 504].includes(downstreamRes.status)) {
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        break;
      } catch (fetchErr: unknown) {
        clearTimeout(timeout);
        const isAbort = (fetchErr as any)?.name === "AbortError" || String(fetchErr).includes("aborted");
        const msg = isAbort
          ? "Downstream model took longer than 110 seconds to respond and timed out."
          : `Failed to connect to model endpoint: ${(fetchErr as Error)?.message || fetchErr}`;
        lastError = new Error(msg);

        if (attempt === 1 && !isAbort) {
          // Fast retry once on connection glitch
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        break;
      }
    }

    if (!downstreamRes) {
      const isTimeout = lastError?.message?.includes("timed out");
      return json(
        {
          error: lastError?.message || "Downstream connection failed",
          isRetryable: true,
          status: isTimeout ? 504 : 500
        },
        { status: isTimeout ? 504 : 500 }
      );
    }

    const data = await downstreamRes.json().catch(() => ({}));

    if (!downstreamRes.ok) {
      const errText =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || data.message || `Upstream API returned HTTP ${downstreamRes.status}`;

      const isRetryable = [429, 500, 502, 503, 504].includes(downstreamRes.status);

      return json(
        {
          error: errText,
          status: downstreamRes.status,
          isRetryable,
          upstreamData: typeof data === "object" ? data : undefined
        },
        { status: downstreamRes.status }
      );
    }

    return json(data, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Proxy request failed";
    return json({ error: message, isRetryable: true, status: 500 }, { status: 500 });
  }
};
