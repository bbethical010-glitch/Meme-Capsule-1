import type { PagesFunction } from "./_shared/pages";
import { json, requireAdmin, type Env } from "./_shared/d1r2";

type ReportStatus = "pending" | "resolved" | "dismissed";

type ReportRow = {
  id: number;
  meme_id: string | null;
  meme_url: string;
  meme_title: string | null;
  author: string;
  source: string | null;
  reason: string;
  details: string | null;
  device_id: string;
  status: ReportStatus;
  created_at: number;
  updated_at: number;
};

const dashboardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Meme Capsule Reports</title>
  <style>
    :root{color-scheme:dark;--bg:#121212;--panel:#1d1d1d;--panel2:#282828;--text:#f5f5f5;--muted:#b8b8b8;--yellow:#f4c300;--green:#34c759;--red:#ff625c}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(160deg,#242424,var(--bg) 55%);color:var(--text);font:15px/1.45 system-ui,-apple-system,sans-serif}
    main{max-width:1180px;margin:auto;padding:24px}.hero,.card{background:var(--panel);border:2px solid #000;box-shadow:4px 4px #000}.hero{padding:22px;margin-bottom:20px}
    h1{margin:0 0 6px;font-size:clamp(28px,5vw,42px)}h2{margin:10px 0 0}.muted,p{color:var(--muted)}.controls,.stats,.actions{display:flex;gap:10px;flex-wrap:wrap}.controls{margin-bottom:20px}
    input,select,button{font:inherit;border:2px solid #000;padding:10px 12px;background:var(--panel2);color:var(--text)}input{min-width:240px;flex:1}button{cursor:pointer;font-weight:800;background:var(--yellow);color:#111}button.secondary{background:var(--panel2);color:var(--text)}button.danger{background:var(--red)}
    .stats{margin-bottom:20px}.stat{min-width:130px;padding:14px 16px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.stat strong{font-size:26px}
    #reports{display:grid;gap:14px}.report{padding:17px}.meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:13px}.badge{border:2px solid #000;background:#000;padding:3px 8px;text-transform:uppercase;font-size:11px;font-weight:800}.pending{color:var(--yellow)}.resolved{color:var(--green)}.dismissed{color:var(--red)}
    .report-title{font-size:19px;font-weight:800;margin:12px 0 4px}.url{overflow-wrap:anywhere;color:var(--yellow)}.details{white-space:pre-wrap;margin:12px 0;color:var(--muted)}.actions{margin-top:14px}.empty{padding:36px;text-align:center;color:var(--muted)}
    #login{max-width:460px;margin:12vh auto;padding:24px}.login-row{display:flex;gap:10px;margin-top:16px}.login-row input{min-width:0}
  </style>
</head>
<body>
  <main id="app">
    <section id="login" class="hero">
      <h1>Reports</h1><p>Enter the admin API token to review Meme Capsule reports.</p>
      <div class="login-row"><input id="token" type="password" autocomplete="current-password" placeholder="Admin API token"><button id="unlock">Open dashboard</button></div>
      <p id="login-error"></p>
    </section>
    <section id="dashboard" hidden>
      <section class="hero"><h1>Meme Reports</h1><p>Review, dismiss, or resolve reports submitted by the mobile app.</p></section>
      <section class="controls"><input id="search" placeholder="Search title, author, reason, device..."><select id="status"><option value="">All statuses</option><option value="pending">Pending</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select><button id="refresh">Refresh</button><button id="logout" class="secondary">Log out</button></section>
      <section id="stats" class="stats"></section>
      <section id="reports"></section>
    </section>
  </main>
  <script>
    const state={reports:[],token:sessionStorage.getItem("meme-capsule-report-token")||""};
    const $=id=>document.getElementById(id);
    const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    const date=value=>{const parsed=new Date(Number(value));return Number.isNaN(parsed.valueOf())?"Unknown date":parsed.toLocaleString()};
    const headers=()=>({Authorization:"Bearer "+state.token});
    const showDashboard=show=>{$("login").hidden=show;$("dashboard").hidden=!show};
    const visibleReports=()=>{const query=$("search").value.trim().toLowerCase(),status=$("status").value;return state.reports.filter(report=>(!status||report.status===status)&&(!query||[report.meme_title,report.meme_url,report.author,report.reason,report.device_id,report.details].some(value=>String(value||"").toLowerCase().includes(query))))};
    const render=()=>{
      const counts={total:state.reports.length,pending:0,resolved:0,dismissed:0};
      state.reports.forEach(report=>{if(report.status in counts)counts[report.status]++});
      $("stats").innerHTML=Object.entries(counts).map(([label,value])=>'<div class="card stat"><div class="label">'+label+'</div><strong>'+value+"</strong></div>").join("");
      const reports=visibleReports();
      $("reports").innerHTML=reports.length?reports.map(report=>'<article class="card report"><div class="meta"><span class="badge '+escapeHtml(report.status)+'">'+escapeHtml(report.status)+'</span><span>#'+escapeHtml(report.id)+'</span><span>'+escapeHtml(date(report.created_at))+'</span></div><div class="report-title">'+escapeHtml(report.meme_title||"UNTITLED")+'</div><div class="meta"><span>Author: '+escapeHtml(report.author)+'</span><span>Reason: '+escapeHtml(report.reason)+'</span><span>Source: '+escapeHtml(report.source||"Meme Capsule")+'</span></div><p class="url"><a class="url" href="'+escapeHtml(report.meme_url)+'" target="_blank" rel="noreferrer">'+escapeHtml(report.meme_url)+'</a></p>'+(report.details?'<div class="details">'+escapeHtml(report.details)+"</div>":"")+'<div class="meta"><span>Device: '+escapeHtml(report.device_id)+'</span></div><div class="actions">'+(report.status!=="resolved"?'<button data-id="'+escapeHtml(report.id)+'" data-status="resolved">Resolve</button>':"")+(report.status!=="dismissed"?'<button class="danger" data-id="'+escapeHtml(report.id)+'" data-status="dismissed">Dismiss</button>':"")+"</div></article>").join(""):'<div class="card empty">No reports match the current filters.</div>';
    };
    const load=async()=>{
      const response=await fetch("/reports?format=json&limit=250",{headers:headers()});
      if(response.status===401){sessionStorage.removeItem("meme-capsule-report-token");state.token="";showDashboard(false);$("login-error").textContent="Invalid or expired admin token.";return}
      if(!response.ok)throw new Error("Unable to load reports.");
      const data=await response.json();state.reports=Array.isArray(data.reports)?data.reports:[];showDashboard(true);render();
    };
    $("unlock").addEventListener("click",async()=>{state.token=$("token").value.trim();if(!state.token)return;$("login-error").textContent="";sessionStorage.setItem("meme-capsule-report-token",state.token);try{await load()}catch(error){$("login-error").textContent=error.message}});
    $("refresh").addEventListener("click",()=>load().catch(error=>alert(error.message)));
    $("logout").addEventListener("click",()=>{sessionStorage.removeItem("meme-capsule-report-token");state.token="";showDashboard(false)});
    $("search").addEventListener("input",render);$("status").addEventListener("change",render);
    $("reports").addEventListener("click",async event=>{const button=event.target.closest("button[data-id]");if(!button)return;button.disabled=true;const response=await fetch("/reports",{method:"PATCH",headers:{"Content-Type":"application/json",...headers()},body:JSON.stringify({id:Number(button.dataset.id),status:button.dataset.status})});if(!response.ok){button.disabled=false;alert("Unable to update report.")}else await load()});
    if(state.token)load().catch(()=>showDashboard(false));
  </script>
</body>
</html>`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("format") !== "json") {
    return new Response(dashboardHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const authError = requireAdmin(request, env);
  if (authError) return authError;

  const status = url.searchParams.get("status");
  const query = url.searchParams.get("q")?.trim() || "";
  const limitValue = Number(url.searchParams.get("limit") || "100");
  const limit = Number.isFinite(limitValue) ? Math.min(Math.max(Math.floor(limitValue), 1), 250) : 100;
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (status && ["pending", "resolved", "dismissed"].includes(status)) {
    where.push("status = ?");
    params.push(status);
  }
  if (query) {
    where.push("(meme_url LIKE ? OR meme_title LIKE ? OR author LIKE ? OR reason LIKE ? OR device_id LIKE ? OR details LIKE ?)");
    const pattern = `%${query}%`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const result = await env.DB.prepare(`
    SELECT id, meme_id, meme_url, meme_title, author, source, reason, details, device_id, status, created_at, updated_at
    FROM meme_reports
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(...params, limit).all<ReportRow>();

  return json({ reports: result.results || [] });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const authError = requireAdmin(request, env);
  if (authError) return authError;

  let payload: { id?: number; status?: ReportStatus };
  try {
    payload = await request.json() as { id?: number; status?: ReportStatus };
  } catch {
    return json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!Number.isInteger(payload.id) || !payload.status || !["resolved", "dismissed"].includes(payload.status)) {
    return json({ error: "A numeric id and status of resolved or dismissed are required." }, { status: 400 });
  }

  const result = await env.DB.prepare(
    "UPDATE meme_reports SET status = ?, updated_at = ? WHERE id = ?"
  ).bind(payload.status, Date.now(), payload.id).run();

  if (!result.meta.changes) {
    return json({ error: "Report not found." }, { status: 404 });
  }

  return json({ success: true, id: payload.id, status: payload.status });
};
