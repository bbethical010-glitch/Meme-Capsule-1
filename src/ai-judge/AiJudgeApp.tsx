import { useEffect, useRef, useState } from "react";
import { aiJudgeApi, type AiConfig, type AiProgress, type AiResult, type AiUser } from "./aiJudgeApi";
import "./aiJudge.css";

const DEFAULT_MODEL = { nvidia: "meta/llama-3.2-11b-vision-instruct", openai: "gpt-4o-mini" };
type FeedItem = AiResult & { image_url: string; created_at: string };

function Login({ onLogin }: { onLogin: (token: string, user: AiUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return setError("ENTER BOTH USERNAME AND PASSWORD");
    setLoading(true); setError("");
    try {
      const result = await aiJudgeApi.login(username.trim(), password);
      sessionStorage.setItem("ai_judge_token", result.token);
      sessionStorage.setItem("ai_judge_user", JSON.stringify(result.user));
      onLogin(result.token, result.user);
    } catch { setError("INVALID CREDENTIALS"); } finally { setLoading(false); }
  };
  return <main className="ai-login"><form className="ai-login-card" onSubmit={submit}>
    <div className="ai-kicker">MEME CAPSULE</div><h1>AI JUDGE CONSOLE</h1><p>OPERATOR ACCESS ONLY</p>
    <input autoFocus placeholder="USERNAME" value={username} onChange={(e) => setUsername(e.target.value)} disabled={loading} />
    <input type="password" placeholder="PASSWORD" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} />
    <button className="ai-primary" disabled={loading}>{loading ? "AUTHENTICATING..." : "INITIALISE"}</button>
    {error && <strong className="ai-error">{error}</strong>}
  </form></main>;
}

function Dashboard({ token, user, onLogout }: { token: string; user: AiUser; onLogout: () => void }) {
  const [config, setConfig] = useState<AiConfig>({ provider: "nvidia", model: DEFAULT_MODEL.nvidia, has_api_key: false });
  const [apiKey, setApiKey] = useState("");
  const [retries, setRetries] = useState(3);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("READY");
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<AiProgress>({ processed: 0, total: 0, percent: 0 });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [breakdown, setBreakdown] = useState<Record<string, number>>({});
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const runningRef = useRef(false);

  useEffect(() => {
    aiJudgeApi.getConfig(token).then(setConfig).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Unable to load configuration."));
    aiJudgeApi.getRuns(token).then((result) => setRuns(result.runs)).catch(() => undefined);
  }, [token]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setNotice("");
    try {
      const saved = await aiJudgeApi.saveConfig(token, { provider: config.provider, model: config.model, api_key: apiKey, max_retries: retries, temperature: 0 });
      setConfig(saved); setApiKey(""); setNotice("CONFIG SAVED");
    } catch (error: unknown) { setNotice(error instanceof Error ? error.message : "CONFIG SAVE FAILED"); } finally { setSaving(false); }
  };

  const refreshProgress = async (id: string) => {
    const result = await aiJudgeApi.getProgress(token, id);
    const run = result.run;
    setProgress({ processed: Number(run.processed || 0), total: Number(run.total_queued || 0), percent: Number(run.total_queued) ? Math.round((Number(run.processed || 0) / Number(run.total_queued)) * 100) : 0 });
    const counts: Record<string, number> = {};
    result.decision_breakdown.forEach((item) => { counts[String(item.decision)] = Number(item.count); });
    setBreakdown(counts);
  };

  const loop = async (id: string) => {
    runningRef.current = true; setRunning(true); setStatus("RUNNING");
    let completed = false;
    while (runningRef.current) {
      let next;
      try { next = await aiJudgeApi.getNextMeme(token, id); } catch { setNotice("NETWORK ERROR — RUN PAUSED"); break; }
      setProgress(next.progress);
      if (!next.meme) { completed = true; setStatus("COMPLETE"); break; }
      try {
        const result = await aiJudgeApi.classify(token, id, next.meme.id, next.meme.image_url);
        if (result.success) setFeed((current) => [{ ...result, image_url: next.meme!.image_url, created_at: new Date().toISOString() }, ...current].slice(0, 20));
      } catch { setNotice("CLASSIFY REQUEST FAILED — CONTINUING"); }
      await refreshProgress(id).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    runningRef.current = false; setRunning(false);
    if (!completed) setStatus("STOPPED");
    aiJudgeApi.getRuns(token).then((result) => setRuns(result.runs)).catch(() => undefined);
  };

  const start = async () => {
    setNotice("");
    try {
      const result = await aiJudgeApi.startRun(token);
      setRunId(result.run_id); setProgress({ processed: 0, total: result.total_queued, percent: 0 }); setBreakdown({});
      void loop(result.run_id);
    } catch (error: unknown) { setNotice(error instanceof Error ? error.message : "RUN START FAILED"); }
  };
  const stop = async () => {
    runningRef.current = false;
    if (runId) await aiJudgeApi.stopRun(token, runId).catch(() => undefined);
    setRunning(false); setStatus("STOPPED");
  };
  const logout = async () => {
    if (running) await stop();
    await aiJudgeApi.logout(token).catch(() => undefined);
    onLogout();
  };
  const keep = breakdown.keep || 0;
  const excluded = breakdown.excluded || 0;
  const failed = breakdown.failed || 0;

  return <main className="ai-shell">
    <header className="ai-header"><div className="ai-title">AI JUDGE CONSOLE</div><div className="ai-user">{user.display_name}</div><button onClick={logout}>LOG OUT</button></header>
    <div className="ai-layout">
      <aside className="ai-sidebar">
        <section className="ai-panel"><h2>PROVIDER CONFIG</h2><form onSubmit={save}>
          <div className="ai-pills">{(["nvidia", "openai"] as const).map((provider) => <button type="button" key={provider} className={config.provider === provider ? "active" : ""} onClick={() => setConfig({ ...config, provider, model: DEFAULT_MODEL[provider] })}>{provider === "nvidia" ? "NVIDIA NIM" : "OPENAI"}</button>)}</div>
          <label>MODEL<input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} /></label>
          <label>API KEY<input type="password" placeholder={config.has_api_key ? "KEY SAVED — ENTER TO REPLACE" : "PASTE PROVIDER KEY"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></label>
          {config.has_api_key && <small className="ai-success">KEY SAVED ✓</small>}
          <label>MAX RETRIES<input type="number" min="1" max="5" value={retries} onChange={(e) => setRetries(Number(e.target.value))} /></label>
          <button className="ai-secondary" disabled={saving}>{saving ? "SAVING..." : "SAVE CONFIG"}</button>
        </form></section>
        <section className="ai-panel"><h2>RUN CONTROL</h2><div className={`ai-status ${running ? "running" : status === "COMPLETE" ? "complete" : "idle"}`}><span />{status}</div>
          <button className="ai-primary" onClick={running ? stop : start} disabled={!config.has_api_key && !running}>{running ? "STOP AI JUDGING" : "START AI JUDGING"}</button>
          <div className="ai-progress-label"><b>{progress.processed} / {progress.total}</b><span>{progress.percent}%</span></div><div className="ai-progress"><i style={{ width: `${progress.percent}%` }} /></div>
          {notice && <div className="ai-notice">{notice}</div>}
        </section>
      </aside>
      <section className="ai-content"><div className="ai-stats"><Stat label="PROCESSED" value={progress.processed} /><Stat label="KEEP" value={keep} tone="green" /><Stat label="EXCLUDE" value={excluded} tone="red" /><Stat label="FAILED" value={failed} tone="pink" /></div>
        <section className="ai-panel"><h2>LIVE DECISION FEED</h2>{feed.length === 0 ? <p className="ai-muted">Start a run to see AI decisions here.</p> : feed.map((item, index) => <article className="ai-feed-item" key={`${item.meme_id}-${index}`}><img src={item.image_url} alt="" /><div><b className={`decision ${item.decision}`}>{item.decision}</b><span className="ai-tag">{item.tone}</span><small>{Math.round((item.confidence || 0) * 100)}% confidence · {item.reasoning}</small></div></article>)}</section>
        <section className="ai-panel"><h2>RUN HISTORY</h2><div className="ai-table">{runs.map((run) => <div className="ai-run-row" key={String(run.id)}><b>{String(run.id).slice(0, 12)}</b><span>{String(run.provider)}</span><span>{String(run.model)}</span><span>{String(run.processed)} processed</span><strong>{String(run.status)}</strong></div>)}</div></section>
      </section>
    </div>
  </main>;
}

function Stat({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return <div className={`ai-stat ${tone}`}><small>{label}</small><strong>{value}</strong></div>;
}

export default function AiJudgeApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem("ai_judge_token"));
  const [user, setUser] = useState<AiUser | null>(() => {
    const raw = sessionStorage.getItem("ai_judge_user");
    try { return raw ? JSON.parse(raw) as AiUser : null; } catch { return null; }
  });
  if (!token || !user) return <Login onLogin={(nextToken, nextUser) => { setToken(nextToken); setUser(nextUser); }} />;
  return <Dashboard token={token} user={user} onLogout={() => { sessionStorage.removeItem("ai_judge_token"); sessionStorage.removeItem("ai_judge_user"); setToken(null); setUser(null); }} />;
}
