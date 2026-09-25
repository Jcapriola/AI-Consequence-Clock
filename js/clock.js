const STATUS_RANK = {
  VERIFIED: 3,
  CORROBORATED: 2,
  REPORTED: 1,
  UNCONFIRMED: 1,
  UNDER_REVIEW: 0,
  REJECTED: -1
};

const HEADLINE_GRADES = new Set(["PRIMARY", "INDEPENDENT_SECONDARY"]);
const AGENT_ROLES = new Set(["agent_initiated", "agent_executed"]);
const AUTH_GAP = new Set(["none_documented"]);

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}

function money(records) {
  const confirmed = records
    .map((r) => r.financial_loss_confirmed)
    .filter(Boolean);
  const byCcy = {};
  for (const row of confirmed) {
    byCcy[row.currency] = (byCcy[row.currency] || 0) + Number(row.amount || 0);
  }
  return byCcy;
}

function isHeadlineEligible(i) {
  return STATUS_RANK[i.verification_status] >= 2 && HEADLINE_GRADES.has(i.evidence_grade);
}

function derive(incidents) {
  const countable = incidents.filter(isHeadlineEligible);
  const agent = countable.filter((i) => AGENT_ROLES.has(i.causal_role)).length;
  const unauthorized = countable.filter((i) => i.unauthorized_claim === "true").length;
  const exposure = countable.filter((i) => i.category === "data_exposure" || i.consequence_class === "data").length;
  const prompt = countable.filter((i) => i.category === "prompt_injection").length;
  const human = countable.filter((i) => i.human_intervention === true).length;
  const rolled = countable.filter((i) => i.reversibility === "rolled_back" || i.rolled_back === true).length;
  const noAuth = countable.filter((i) => AUTH_GAP.has(i.authorization_evidence)).length;
  const lags = countable
    .map((i) => (Number.isFinite(i.disclosure_lag_days) ? i.disclosure_lag_days : daysBetween(i.incident_date, i.disclosure_date)))
    .filter((d) => d !== null && d >= 0);
  const avgLag = lags.length ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length) : null;
  const regions = {};
  for (const i of countable) {
    const key = i.country_region || "Unknown";
    regions[key] = (regions[key] || 0) + 1;
  }
  return {
    methodology_version: "0.2.1-preview",
    generated_at: null,
    eligible_record_count: countable.length,
    record_ids: countable.map((i) => i.id),
    record_count: incidents.length,
    headline_eligible: countable.length,
    known_incidents: countable.length,
    agent_caused: agent,
    unauthorized,
    data_exposures: exposure,
    prompt_injection: prompt,
    human_interventions: human,
    rolled_back: rolled,
    regulatory: 0,
    no_exec_auth: noAuth,
    financial: money(countable),
    disclosure_lag_days: avgLag,
    disclosure_lag_n: lags.length,
    regions,
    countable
  };
}

function formatMoney(map) {
  const parts = Object.entries(map).map(([ccy, amt]) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(amt);
  });
  return parts.length ? parts.join(" + ") : "None in headline set";
}

function render(data) {
  const incidents = data.incidents || [];
  const s = derive(incidents);
  const stamp = data.generated_at || new Date().toISOString();
  document.getElementById("updated").textContent = stamp.replace("T", " ").replace(":00-04:00", " EDT");
  document.getElementById("kpi-known").textContent = s.known_incidents.toLocaleString();
  document.getElementById("kpi-agent").textContent = s.agent_caused.toLocaleString();
  document.getElementById("kpi-unauth").textContent = s.unauthorized.toLocaleString();
  document.getElementById("kpi-expose").textContent = s.data_exposures.toLocaleString();
  document.getElementById("kpi-money").textContent = formatMoney(s.financial);
  document.getElementById("hero-value").textContent = s.no_exec_auth.toLocaleString();
  document.getElementById("kpi-prompt").textContent = s.prompt_injection.toLocaleString();
  document.getElementById("kpi-human").textContent = s.human_interventions.toLocaleString();
  document.getElementById("kpi-rollback").textContent = s.rolled_back.toLocaleString();
  document.getElementById("kpi-reg").textContent = s.regulatory.toLocaleString();
  document.getElementById("lag").textContent = s.disclosure_lag_days === null ? "—" : String(s.disclosure_lag_days);
  document.getElementById("lag-n").textContent = String(s.disclosure_lag_n);
  document.getElementById("record-count").textContent = String(s.record_count);
  document.getElementById("headline-count").textContent = String(s.headline_eligible);

  const latest = [...incidents].sort((a, b) => Date.parse(b.disclosure_date) - Date.parse(a.disclosure_date));
  const lastMajor = latest[0];
  if (lastMajor) {
    const d = Math.max(0, daysBetween(lastMajor.disclosure_date, "2026-09-24"));
    document.getElementById("days-since").textContent = String(d);
    document.getElementById("prev-incidents").innerHTML = latest.slice(0, 4).map((i) =>
      `<li><span>${i.disclosure_date}</span><span>${i.title}</span></li>`
    ).join("");
  }

  const cats = {};
  for (const i of s.countable) cats[i.category] = (cats[i.category] || 0) + 1;
  document.getElementById("cats").innerHTML = Object.entries(cats)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<div><span>${k.replaceAll("_", " ")}</span><b>${v}</b></div>`)
    .join("") || "<div><span>No headline-eligible records in this slice</span><b>0</b></div>";

  document.getElementById("regions").innerHTML = Object.entries(s.regions)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
    .join("");

  document.getElementById("feed").innerHTML = latest.map((i) => `
    <div class="feed-row">
      <div class="when">${i.disclosure_date}</div>
      <div>${i.title}</div>
      <span class="status">${i.verification_status}</span>
      <span class="status">${i.evidence_grade}</span>
      <span class="sev ${i.severity}">${i.severity}</span>
    </div>
  `).join("");

  s.methodology_version = data.methodology_version || s.methodology_version;
  s.generated_at = stamp;
  window.__INCIDENTS = incidents;
  window.__SUMMARY = s;
  drawChart(incidents);
  attachChecksum(incidents, s);
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function attachChecksum(incidents, s) {
  const input = incidents.map((i) => i.id).sort().join(",");
  const digest = await sha256Hex(input);
  s.dataset_checksum_sha256 = digest;
  let published = null;
  try {
    published = await fetch("./data/summary.json").then((r) => r.json());
  } catch (e) {
    published = null;
  }
  const match = published && published.dataset_checksum_sha256 === digest;
  const meta = document.getElementById("repro");
  if (meta) {
    meta.textContent = `methodology ${s.methodology_version} · eligible ${s.eligible_record_count} · sha256 ${digest.slice(0, 16)}… · ids ${s.record_ids.join(", ") || "none"} · checksum ${match ? "matches summary.json" : "computed locally"}`;
  }
}

function drawChart(incidents) {
  const canvas = document.getElementById("trend");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth * 2;
  const h = canvas.height = 180 * 2;
  ctx.scale(2, 2);
  const width = canvas.clientWidth;
  const height = 180;
  ctx.clearRect(0, 0, width, height);
  const buckets = {};
  for (const i of incidents) {
    const key = (i.disclosure_date || "").slice(0, 7);
    if (!key) continue;
    buckets[key] = (buckets[key] || 0) + 1;
  }
  const keys = Object.keys(buckets).sort();
  const vals = keys.map((k) => buckets[k]);
  const max = Math.max(1, ...vals);
  ctx.strokeStyle = "rgba(94,231,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(28, 16);
  ctx.lineTo(28, height - 28);
  ctx.lineTo(width - 10, height - 28);
  ctx.stroke();
  ctx.strokeStyle = "#5ee7ff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  vals.forEach((v, idx) => {
    const x = 28 + (idx / Math.max(1, vals.length - 1)) * (width - 48);
    const y = (height - 28) - (v / max) * (height - 56);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = "#8aa0b8";
  ctx.font = "11px IBM Plex Sans, sans-serif";
  if (keys[0]) ctx.fillText(keys[0], 28, height - 10);
  if (keys.at(-1)) ctx.fillText(keys.at(-1), width - 70, height - 10);
}

function matchesFilter(i, filter) {
  if (!filter) return true;
  if (filter === "no_auth") return i.authorization_evidence === "none_documented";
  if (filter === "agent") return AGENT_ROLES.has(i.causal_role);
  if (filter === "unauthorized") return i.unauthorized_claim === "true";
  if (filter === "data_exposure") return i.category === "data_exposure" || i.consequence_class === "data";
  if (filter === "prompt_injection") return i.category === "prompt_injection";
  return i.category === filter;
}

function openList(filter) {
  const incidents = window.__INCIDENTS || [];
  const rows = incidents.filter((i) => matchesFilter(i, filter));
  const body = document.getElementById("sheet-body");
  document.getElementById("sheet-title").textContent = filter ? `Records · ${filter}` : "All seed records";
  body.innerHTML = rows.map((i) => `
    <article class="incident">
      <h3>${i.title}</h3>
      <p>${i.summary}</p>
      <p>
        <span class="status">${i.verification_status}</span>
        <span class="status">${i.evidence_grade}</span>
        <span class="sev ${i.severity}">${i.severity}</span>
      </p>
      <p>
        Causal role: <b>${i.causal_role}</b> · Adversary: <b>${i.adversary}</b> ·
        Auth evidence: <b>${i.authorization_evidence}</b> · Unauthorized claim: <b>${i.unauthorized_claim}</b><br/>
        Reversibility: <b>${i.reversibility}</b> · Consequence: <b>${i.consequence_class}</b> ·
        Lag: <b>${i.disclosure_lag_days ?? "unknown"}</b> days
      </p>
      <p>Incident ${i.incident_date || "unknown"} · Disclosed ${i.disclosure_date}</p>
      <p>Sources: ${i.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${s.publisher}</a>`).join(", ")}</p>
    </article>
  `).join("") || "<p>No matching seed records.</p>";
  document.getElementById("modal").classList.add("open");
}

document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal" || e.target.classList.contains("close")) {
    document.getElementById("modal").classList.remove("open");
  }
});

fetch("./data/incidents.json")
  .then((r) => r.json())
  .then(render)
  .catch((err) => {
    document.getElementById("updated").textContent = "failed to load seed data";
    console.error(err);
  });
