import type { PagesFunction } from "../../_shared/pages";
import { json, type Env } from "../../_shared/d1r2";
import { requireAiJudgeAuth } from "../../_shared/aiJudgeAuth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  await requireAiJudgeAuth(request, env);
  return json({ success: false, error: "Not implemented" });
};
