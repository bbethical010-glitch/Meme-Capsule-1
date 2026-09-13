import { useState, useRef, useEffect, useCallback } from "react";
import type { CurateMemeItem } from "../curateTypes";
import type { AiJudgeConfig, AiJudgeDecision, AiJudgeLoopState } from "./aiJudgeTypes";
import { analyzeMemeWithAi } from "./aiJudgeClient";

interface UseAiJudgeLoopProps {
  currentMeme: CurateMemeItem | null;
  config: AiJudgeConfig;
  onApplyDecision: (decision: AiJudgeDecision) => void;
  onAdvance: (decision?: AiJudgeDecision) => Promise<CurateMemeItem | null>;
}

export function useAiJudgeLoop({
  currentMeme,
  config,
  onApplyDecision,
  onAdvance
}: UseAiJudgeLoopProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [loopState, setLoopState] = useState<AiJudgeLoopState>("idle");
  const [statusMessage, setStatusMessage] = useState("AI Mode is ready");
  const [previewProgress, setPreviewProgress] = useState(0); // 0 to 100
  const [lastDecision, setLastDecision] = useState<AiJudgeDecision | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [batchProcessed, setBatchProcessed] = useState(0);
  const [recoveredCount, setRecoveredCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);

  // References to prevent stale closures and concurrency bugs
  const isRunningRef = useRef(false);
  const isProcessingRef = useRef(false);
  const currentMemeRef = useRef(currentMeme);
  const configRef = useRef(config);
  const timerRef = useRef<number | null>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const inFlightMemeIdRef = useRef<string | null>(null);
  const processedCountRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);

  useEffect(() => {
    currentMemeRef.current = currentMeme;
  }, [currentMeme]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (progressIntervalRef.current) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  const stop = useCallback((msg?: unknown) => {
    clearTimers();
    isRunningRef.current = false;
    isProcessingRef.current = false;
    inFlightMemeIdRef.current = null;
    setIsRunning(false);
    setLoopState("stopped");
    setPreviewProgress(0);

    const safeMsg = typeof msg === "string" ? msg : "AI Mode stopped by user";
    setStatusMessage(safeMsg);
  }, [clearTimers]);

  // Main robust processing pipeline for a single meme with automatic error recovery
  const processMeme = useCallback(async (meme: CurateMemeItem) => {
    if (!isRunningRef.current) return;
    if (isProcessingRef.current && inFlightMemeIdRef.current === meme.id) return;

    // Check batch count limit if configured
    if (
      configRef.current.batchMode === "count" &&
      processedCountRef.current >= configRef.current.batchCount
    ) {
      stop(`Batch limit reached (${configRef.current.batchCount} memes evaluated)`);
      return;
    }

    isProcessingRef.current = true;
    inFlightMemeIdRef.current = meme.id;
    setLoopState("analyzing");
    setStatusMessage(`Analyzing meme: ${meme.id}...`);
    setErrorMessage(null);
    setPreviewProgress(0);

    const MAX_RETRIES = 2;
    let attempt = 0;
    let decision: AiJudgeDecision | null = null;
    let lastError: unknown = null;

    // Fast retry loop with jitter for transient recoverable errors
    while (attempt < MAX_RETRIES && isRunningRef.current) {
      attempt += 1;
      try {
        decision = await analyzeMemeWithAi(meme, configRef.current);
        // Successful analysis!
        consecutiveFailuresRef.current = 0;
        if (attempt > 1) {
          setRecoveredCount((prev) => prev + 1);
        }
        break;
      } catch (err: unknown) {
        lastError = err;
        const errText = err instanceof Error ? err.message : String(err);
        const errLower = errText.toLowerCase();

        // Non-recoverable failures (Auth errors, missing key)
        const isAuthError =
          errLower.includes("401") ||
          errLower.includes("unauthorized") ||
          errLower.includes("403") ||
          errLower.includes("forbidden") ||
          errLower.includes("invalid api key");

        if (isAuthError) {
          isProcessingRef.current = false;
          setErrorMessage(errText);
          stop(`Authentication error: ${errText}`);
          return;
        }

        // Recoverable failures: 429, 500, 502, 503, 504, timeout, network disconnect
        if (attempt < MAX_RETRIES && isRunningRef.current) {
          setLoopState("retrying");
          const backoffMs = Math.min(3000, 1000 * attempt + Math.random() * 300);
          setStatusMessage(
            `🔄 Temporary glitch on ${meme.id} (${errText.slice(0, 45)}). Retrying ${attempt}/${MAX_RETRIES} in ${(backoffMs / 1000).toFixed(1)}s...`
          );

          await new Promise<void>((resolve) => {
            timerRef.current = window.setTimeout(resolve, backoffMs);
          });
          clearTimers();
        }
      }
    }

    if (!isRunningRef.current) {
      isProcessingRef.current = false;
      return;
    }

    // If retries exhausted, handle gracefully without halting entire batch
    if (!decision) {
      consecutiveFailuresRef.current += 1;
      const finalErrText = lastError instanceof Error ? lastError.message : "AI Analysis failed";
      setErrorMessage(`Meme ${meme.id}: ${finalErrText}`);

      // Circuit breaker: pause if 5 consecutive different memes fail completely
      if (consecutiveFailuresRef.current >= 5) {
        isProcessingRef.current = false;
        stop("Paused: 5 consecutive memes failed. Please check your provider quota, model name, or base URL.");
        return;
      }

      // Safe fallback decision: Mark as review_later and keep continuous batch moving
      decision = {
        corpus_status: (configRef.current.lowConfidenceFallback || "review_later") as any,
        duplicate_of: null,
        topics: ["Everyday Life"],
        tone: "Neutral",
        humour_mechanisms: ["Relatability"],
        curator_note: `[AI Error Recovery] Processing failed after ${MAX_RETRIES} attempts: ${finalErrText.slice(0, 100)}`,
        confidence: 0.1,
        modelUsed: configRef.current.model,
        latencyMs: 0
      };

      setSkippedCount((prev) => prev + 1);
      setStatusMessage(`⚠️ Meme ${meme.id} skipped after ${MAX_RETRIES} retries. Advancing...`);
    }

    if (!isRunningRef.current) {
      isProcessingRef.current = false;
      return;
    }

    // 1. Populate visual UI state
    onApplyDecision(decision);
    setLastDecision(decision);

    // 2. Visual countdown preview (or instant bypass if previewDelayMs is 0)
    const totalDelay = Math.max(0, configRef.current.previewDelayMs);

    if (totalDelay > 0) {
      setLoopState("previewing");
      setStatusMessage(`Previewing decision (${totalDelay}ms)...`);

      const stepMs = 50;
      let elapsed = 0;
      clearTimers();

      progressIntervalRef.current = window.setInterval(() => {
        elapsed += stepMs;
        const pct = Math.min(100, Math.round((elapsed / totalDelay) * 100));
        setPreviewProgress(pct);

        if (elapsed >= totalDelay && progressIntervalRef.current) {
          window.clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
      }, stepMs);

      await new Promise<void>((resolve) => {
        timerRef.current = window.setTimeout(resolve, totalDelay);
      });
      clearTimers();
    }

    if (!isRunningRef.current) {
      isProcessingRef.current = false;
      return;
    }

    // 3. Save decision and request next meme (single flight, no duplicates)
    setLoopState("saving");
    setStatusMessage("Saving decision and advancing...");
    processedCountRef.current += 1;
    setBatchProcessed(processedCountRef.current);

    let nextMeme: CurateMemeItem | null = null;
    try {
      nextMeme = await onAdvance(decision);
    } catch (saveErr) {
      console.error("Auto advance save error:", saveErr);
    }

    isProcessingRef.current = false;

    if (!isRunningRef.current) return;

    // 4. Continuously advance to next meme
    if (nextMeme && nextMeme.id !== meme.id) {
      processMeme(nextMeme);
    } else {
      stop("Queue finished or no more unreviewed memes in this queue.");
    }
  }, [onApplyDecision, onAdvance, clearTimers, stop]);

  // Handle manual navigation when loop is active and idle
  useEffect(() => {
    if (isRunning && currentMeme && !isProcessingRef.current) {
      if (inFlightMemeIdRef.current !== currentMeme.id) {
        processMeme(currentMeme);
      }
    }
  }, [isRunning, currentMeme, processMeme]);

  const start = useCallback(() => {
    if (!configRef.current.apiKey && configRef.current.provider !== "custom") {
      setErrorMessage("Please configure an API Key before starting AI Mode.");
      setLoopState("error");
      return;
    }
    if (!currentMemeRef.current) {
      setErrorMessage("No meme loaded to evaluate.");
      return;
    }

    clearTimers();
    isRunningRef.current = true;
    isProcessingRef.current = false;
    consecutiveFailuresRef.current = 0;
    setIsRunning(true);
    setErrorMessage(null);
    processedCountRef.current = 0;
    setBatchProcessed(0);
    setRecoveredCount(0);
    setSkippedCount(0);
    processMeme(currentMemeRef.current);
  }, [clearTimers, processMeme]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
      isRunningRef.current = false;
      isProcessingRef.current = false;
    };
  }, [clearTimers]);

  return {
    isRunning,
    loopState,
    statusMessage,
    previewProgress,
    lastDecision,
    errorMessage,
    batchProcessed,
    recoveredCount,
    skippedCount,
    start,
    stop
  };
}
