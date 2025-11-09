// ============================================================================
// Statusio • Stremio Add-on (TV-Compatible Version)
// Based on proven Ratings Aggregator pattern that works on Android TV/tvOS
// ============================================================================

import sdk from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = sdk;
import fetch from "node-fetch";

// ----------------------------- Icon ----------------------------------------
const LOGO_URL = "https://raw.githubusercontent.com/ARandomAddonDev/Statusio/refs/heads/main/assets/logo.png";

// ----------------------------- Helpers -------------------------------------
const MIN = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ceilDays = (ms) => Math.max(0, Math.ceil(ms / DAY_MS));
const redact = (tok) =>
  tok ? `${String(tok).slice(0, 4)}…${String(tok).slice(-4)}` : "(none)";
const isoDate = (iso) =>
  iso ? new Date(iso).toISOString().slice(0, 10) : "N/A";

function daysLeftFromEpochSec(epochSec) {
  const secs = Number(epochSec || 0);
  if (!Number.isFinite(secs) || secs <= 0) return { days: 0, untilISO: null };
  const ms = secs * 1000 - Date.now();
  if (ms <= 0) return { days: 0, untilISO: null };
  return { days: ceilDays(ms), untilISO: new Date(secs * 1000).toISOString() };
}

function daysLeftFromDurationSec(durationSec) {
  const secs = Number(durationSec || 0);
  if (!Number.isFinite(secs) || secs <= 0) return { days: 0, untilISO: null };
  const ms = secs * 1000;
  return { days: ceilDays(ms), untilISO: new Date(Date.now() + ms).toISOString() };
}

// Simple in-memory cache
const cache = new Map();
const setCache = (key, value, ttlMs) =>
  cache.set(key, { value, exp: Date.now() + ttlMs });
const getCache = (key) => {
  const it = cache.get(key);
  if (!it) return null;
  if (Date.now() > it.exp) {
    cache.delete(key);
    return null;
  }
  return it.value;
};

// --------------------------- Providers -------------------------------------
async function pRealDebrid({ token, fetchImpl = fetch }) {
  const name = "Real-Debrid";
  if (!token) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: "missing token" };
  
  try {
    const res = await fetchImpl("https://api.real-debrid.com/rest/1.0/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "Statusio/1.0" }
    });
    
    if (!res.ok) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: `HTTP ${res.status}` };
    
    const j = await res.json();
    const username = j?.username || j?.user || null;
    const premium = j.premium === true || String(j.type || "").toLowerCase() === "premium";
    let untilISO = null, days = null;

    if (j.expiration) {
      const expNum = Number(j.expiration);
      if (Number.isFinite(expNum) && expNum > 1_000_000_000) {
        const out = daysLeftFromEpochSec(expNum);
        days = out.days;
        untilISO = out.untilISO;
      } else {
        const d = new Date(j.expiration);
        if (!isNaN(d.getTime())) {
          const ms = d.getTime() - Date.now();
          days = ms > 0 ? ceilDays(ms) : 0;
          untilISO = d.toISOString();
        }
      }
    } else if (j.premium_until || j.premiumUntil) {
      const exp = Number(j.premium_until || j.premiumUntil);
      const out = daysLeftFromEpochSec(exp);
      days = out.days;
      untilISO = out.untilISO;
    }

    if (premium === true) return { name, premium: true, daysLeft: days ?? null, untilISO: untilISO ?? null, username };
    if (premium === false) return { name, premium: false, daysLeft: 0, untilISO: null, username };
    
    return { name, premium: null, daysLeft: null, untilISO: null, username, note: "status unknown" };
  } catch (e) {
    return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: `network ${e.message}` };
  }
}

async function pAllDebrid({ key, fetchImpl = fetch }) {
  const name = "AllDebrid";
  if (!key) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: "missing key" };
  
  try {
    const res = await fetchImpl("https://api.alldebrid.com/v4/user", {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": "Statusio/1.0" }
    });
    
    if (!res.ok) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: `HTTP ${res.status}` };
    
    const j = await res.json();
    if (j?.status !== "success" || !j?.data?.user) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: "bad response" };

    const u = j.data.user;
    const username = u?.username || null;
    const isPrem = !!u.isPremium;
    let out = { days: null, untilISO: null };
    
    if (Number.isFinite(Number(u.premiumUntil)) && Number(u.premiumUntil) > 0) {
      out = daysLeftFromEpochSec(Number(u.premiumUntil));
    }

    return isPrem
      ? { name, premium: true, daysLeft: out.days, untilISO: out.untilISO, username }
      : { name, premium: false, daysLeft: 0, untilISO: null, username };
  } catch (e) {
    return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: `network ${e.message}` };
  }
}

async function pPremiumize({ key, useOAuth = false, fetchImpl = fetch }) {
  const name = "Premiumize";
  if (!key) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: "missing key" };
  
  try {
    const url = new URL("https://www.premiumize.me/api/account/info");
    url.searchParams.set(useOAuth ? "access_token" : "apikey", key);
    
    const res = await fetchImpl(url.toString(), { headers: { "User-Agent": "Statusio/1.0" } });
    
    if (!res.ok) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: `HTTP ${res.status}` };
    
    const j = await res.json();
    if (String(j.status).toLowerCase() !== "success") return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: "bad response" };

    const out = daysLeftFromEpochSec(j.premium_until || 0);
    const isPrem = out.days > 0;
    const username = j?.customer_id ? String(j.customer_id) : null;

    return isPrem
      ? { name, premium: true, daysLeft: out.days, untilISO: out.untilISO, username }
      : { name, premium: false, daysLeft: 0, untilISO: null, username };
  } catch (e) {
    return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: `network ${e.message}` };
  }
}

async function pTorBox({ token, fetchImpl = fetch }) {
  const name = "TorBox";
  if (!token) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: "missing token" };
  
  try {
    const res = await fetchImpl("https://api.torbox.app/v1/api/user/me?settings=true", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "Statusio/1.0" }
    });
    
    if (!res.ok) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: `HTTP ${res.status}` };
    
    const j = await res.json();
    const u = j?.data?.user || j?.user || j;
    const username = u?.username || null;
    const isPrem = u?.isPremium === true || String(u?.accountType ?? "").toLowerCase() === "premium";
    let out = { days: 0, untilISO: null };

    if (u?.premiumUntil) {
      out = daysLeftFromEpochSec(u.premiumUntil);
    } else if (u?.premium_left || u?.premiumLeft || u?.remainingPremiumSeconds) {
      out = daysLeftFromDurationSec(u.premium_left || u.premiumLeft || u.remainingPremiumSeconds);
    }

    if (isPrem) return { name, premium: true, daysLeft: out.days || null, untilISO: out.untilISO, username };
    if (out.days > 0) return { name, premium: true, daysLeft: out.days, untilISO: out.untilISO, username };
    
    return { name, premium: false, daysLeft: 0, untilISO: null, username, note: u?.note || undefined };
  } catch (e) {
    return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: `network ${e.message}` };
  }
}

async function pDebridLink({ key, authScheme = "Bearer", endpoint = "https://debrid-link.com/api/account/infos", fetchImpl = fetch }) {
  const name = "Debrid-Link";
  if (!key) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: "missing key" };
  
  try {
    let url = endpoint;
    const init = { headers: { "User-Agent": "Statusio/1.0" } };

    if (authScheme === "Bearer") {
      init.headers.Authorization = `Bearer ${key}`;
    } else {
      const u = new URL(endpoint);
      u.searchParams.set("apikey", key);
      url = u.toString();
    }

    const res = await fetchImpl(url, init);
    if (!res.ok) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: `HTTP ${res.status}` };
    
    const j = await res.json();
    if (!j?.success || !j?.value) return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: "bad response" };

    const secs = Number(j.value.premiumLeft || 0);
    const out = secs > 0 ? daysLeftFromDurationSec(secs) : { days: 0, untilISO: null };
    const username = j?.value?.username || null;

    if (out.days > 0) return { name, premium: true, daysLeft: out.days, untilISO: out.untilISO, username };
    
    return { name, premium: false, daysLeft: 0, untilISO: null, username, note: `accountType=${j.value.accountType ?? "?"}` };
  } catch (e) {
    return { name, premium: null, daysLeft: null, untilISO: null, username: null, note: `network ${e.message}` };
  }
}

// --------------------------- Status Formatting -----------------------------
function getStatusInfo(days) {
  if (days <= 0) return { emoji: "🔴", status: "EXPIRED" };
  if (days <= 3) return { emoji: "🟠", status: "CRITICAL" };
  if (days <= 14) return { emoji: "🟡", status: "WARNING" };
  return { emoji: "🟢", status: "OK" };
}

// SIMPLIFIED FORMATTING - Like Ratings Aggregator
function formatProviderStatus(r) {
  const user = r?.username ? `@${String(r.username)}` : "—";
  const days = Number.isFinite(r.daysLeft) && r.daysLeft !== null ? r.daysLeft : r.premium ? "—" : 0;
  const dateStr = r.untilISO ? isoDate(r.untilISO) : r.premium ? "—" : "N/A";

  const numericDays = typeof days === "number" ? days : 9999;
  const { emoji, status } = getStatusInfo(numericDays);

  return `${emoji} ${r.name}: ${status}\nUser: ${user}\nExpires: ${dateStr}\nDays left: ${days}${r.note ? `\nNote: ${r.note}` : ''}`;
}

// --------------------------- Manifest (TV-Compatible) ---------------------
const manifest = {
  id: "a1337user.statusio.tv.compatible",
  version: "1.1.14",
  name: "Statusio",
  description: "Shows premium status & days remaining across multiple debrid providers.",
  
  // EXACTLY like Ratings Aggregator
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: [],
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
  },
  logo: LOGO_URL,

  config: [
    {
      key: "cache_minutes",
      type: "number",
      default: "45",
      title: "Cache Minutes (default 45)"
    },
    { key: "rd_token", type: "text", title: "Real-Debrid Token (Bearer)" },
    { key: "ad_key", type: "text", title: "AllDebrid API Key (Bearer)" },
    { key: "pm_key", type: "text", title: "Premiumize apikey OR access_token" },
    { key: "tb_token", type: "text", title: "TorBox Token (Bearer)" },
    { key: "dl_key", type: "text", title: "Debrid-Link API Key/Token" },
    {
      key: "dl_auth",
      type: "text",
      title: "Debrid-Link Auth Scheme (Bearer/query)",
      default: "Bearer"
    },
    {
      key: "dl_endpoint",
      type: "text",
      title: "Debrid-Link Endpoint Override",
      default: "https://debrid-link.com/api/account/infos"
    }
  ]
};

const builder = new addonBuilder(manifest);

// --------------------------- Shared Data Fetching --------------------------
async function fetchStatusData(cfg) {
  const cacheMin = Number.isFinite(Number(cfg.cache_minutes)) ? Math.max(1, Number(cfg.cache_minutes)) : 45;

  const tokens = {
    rd: String(cfg.rd_token || process.env.RD_TOKEN || "").trim(),
    ad: String(cfg.ad_key || process.env.AD_KEY || "").trim(),
    pm: String(cfg.pm_key || process.env.PM_KEY || "").trim(),
    tb: String(cfg.tb_token || process.env.TB_TOKEN || "").trim(),
    dl: String(cfg.dl_key || process.env.DL_KEY || "").trim()
  };

  const enabled = {
    realdebrid: !!tokens.rd,
    alldebrid: !!tokens.ad,
    premiumize: !!tokens.pm,
    torbox: !!tokens.tb,
    debridlink: !!tokens.dl
  };

  const cacheKey = [
    Object.entries(enabled).filter(([, v]) => v).map(([k]) => k).join(","),
    `rd:${redact(tokens.rd)}`,
    `ad:${redact(tokens.ad)}`,
    `pm:${redact(tokens.pm)}`,
    `tb:${redact(tokens.tb)}`,
    `dl:${redact(tokens.dl)}:${cfg.dl_auth || "Bearer"}:${cfg.dl_endpoint || ""}`
  ].join("|");

  let results = getCache(cacheKey);
  
  if (!results) {
    try {
      const jobs = [];
      if (enabled.realdebrid) jobs.push(pRealDebrid({ token: tokens.rd }));
      if (enabled.alldebrid) jobs.push(pAllDebrid({ key: tokens.ad }));
      if (enabled.premiumize) jobs.push(pPremiumize({ key: tokens.pm }));
      if (enabled.torbox) jobs.push(pTorBox({ token: tokens.tb }));
      if (enabled.debridlink) jobs.push(pDebridLink({
        key: tokens.dl,
        authScheme: cfg.dl_auth || "Bearer",
        endpoint: (cfg.dl_endpoint || "https://debrid-link.com/api/account/infos").trim()
      }));

      results = jobs.length ? await Promise.all(jobs) : [];
      setCache(cacheKey, results, cacheMin * MIN);
    } catch (e) {
      console.error("[Statusio] Error fetching provider data:", e);
      return { error: e.message, results: [] };
    }
  }

  return { results, enabled, hasData: results.some(r => r.premium !== null || r.username) };
}

// ---------------------------- Stream Handler (TV-Compatible) ---------------
builder.defineStreamHandler(async (args) => {
  const reqType = String(args?.type || "");
  const reqId = String(args?.id || "");
  
  console.log("[Statusio] TV stream request:", { type: reqType, id: reqId });

  if (!reqId || !reqId.startsWith("tt")) {
    return { streams: [] };
  }

  // Parse config
  const rawCfg = args?.config ?? {};
  let cfg = {};
  if (typeof rawCfg === "string") {
    try { cfg = JSON.parse(rawCfg); } catch (e) { cfg = {}; }
  } else if (typeof rawCfg === "object" && rawCfg !== null) {
    cfg = rawCfg;
  }

  console.log("[Statusio parsed config]", JSON.stringify(cfg, null, 2));

  const statusData = await fetchStatusData(cfg);
  
  // If no providers configured, return empty (TVs don't like setup streams)
  if (!Object.values(statusData.enabled).some(v => v)) {
    console.log("[Statusio] No providers enabled, returning empty for TV");
    return { streams: [] };
  }

  const streams = [];

  // Create TV-compatible streams - SIMPLE like Ratings Aggregator
  if (statusData.hasData) {
    for (const r of statusData.results) {
      if (r.premium !== null || r.username) {
        const { emoji, status } = getStatusInfo(typeof r.daysLeft === 'number' ? r.daysLeft : 9999);
        
        // EXACTLY like Ratings Aggregator pattern
        streams.push({
          name: "🔐 Statusio", // Fixed name like "🎯 Ratings Aggregator"
          description: formatProviderStatus(r),
          // CRITICAL: Must include URL field (use provider homepage)
          url: "https://real-debrid.com/",
          externalUrl: "https://real-debrid.com/",
          behaviorHints: {
            notWebReady: true
            // bingeGroup: `statusio-${r.name.toLowerCase()}`
          }
        });
      }
    }
  }

  // If multiple providers, only return ONE stream to avoid TV issues
  const finalStreams = streams.length > 0 ? [streams[0]] : [];
  
  console.log(`[Statusio] Returning ${finalStreams.length} TV-compatible streams`);
  return { streams: finalStreams };
});

// ------------------------------ Server -------------------------------------
const PORT = Number(process.env.PORT || 7042);
serveHTTP(builder.getInterface(), { port: PORT, hostname: "0.0.0.0" });

console.log(`✅ Statusio TV Compatible at http://127.0.0.1:${PORT}/manifest.json`);
console.log(`📱 Uses proven Ratings Aggregator pattern`);
console.log(`🎯 Test: Go to any movie/series and check streams`);