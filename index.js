// ============================================================================
// Statusio • Stremio Add-on (info-only stream cards, one per provider)
// Providers: Real-Debrid, AllDebrid, Premiumize, TorBox, Debrid-Link
// Features: Per-provider tokens via Configure, caching, logo in manifest
//
// Node setup:
//   - package.json: { "type": "module", "scripts": { "start": "node index.js" } }
//   - npm i stremio-addon-sdk node-fetch
//   - Run locally:  npm start
//   - Optional local env testing: set RD_TOKEN=XXXX && npm start
//   - Manifest URL: http://127.0.0.1:7042/manifest.json
// ============================================================================

import sdk from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = sdk;
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// ----------------------------- Icon ----------------------------------------
const logoPath = path.join(process.cwd(), "assets", "logo.png");
let LOGO_DATA_URL = null;
try {
  const b64 = fs.readFileSync(logoPath).toString("base64");
  LOGO_DATA_URL = `data:image/png;base64,${b64}`;
  console.log("[logo] embedded from", logoPath);
} catch (e) {
  console.warn("[logo] could not read logo at", logoPath, e.message);
}

// ----------------------------- Helpers -------------------------------------
const MIN = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ceilDays = (ms) => Math.max(0, Math.ceil(ms / DAY_MS));
const addMsToISO = (ms) => new Date(Date.now() + ms).toISOString();
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
  return { days: ceilDays(ms), untilISO: addMsToISO(ms) };
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

// ----------------------------- QUOTES --------------------------------------

// 14+ days (OK)
const QUOTES_OK = [
  "Grind & binge",
  "Work n' watch",
  "Emails? Nah, episodes",
  "Multitask: cry + work",
  "Boss on mute, show on blast",
  "Plot twist: me",
  "Popcorn is needed",
  "Sequel my life",
  "Cue the chaos",
  "Credits? Nope. Next.",
  "Plot armor ON",
  "Spoiler: snacks",
  "Villain = bills",
  "Dramatic sip",
  "Boom. Plot.",
  "You earned ‘Next Ep’.",
  "Inbox zero, season one.",
  "Adulting with captions.",
  "Meetings end, movies start.",
  "Procrastination: cinematic.",
  "Budget: snacks approved.",
  "Tonight’s plan: stay.",
  "Your couch filed PTO.",
  "Microwave time = trailer time.",
  "Main quest: relax.",
  "Side quest: popcorn.",
  "Therapy, but with dragons.",
  "Stretch, sip, stream.",
  "Zoom out, zone in."
];

// 14 days or less (warning)
const QUOTES_WARN = [
  "Renew before cliffhanger.",
  "Cheaper than snacks.",
  "Tiny fee, huge chill.",
  "Beat the ‘oops, expired’.",
  "Your future self says thanks.",
  "Renew now, binge later.",
  "Don’t pause the fun.",
  "Click. Renew. Continue.",
  "Keep calm, renew on.",
  "Roll credits on worry."
];

// 3 days or less (critical)
const QUOTES_CRIT = [
  "Boss fight: renewal.",
  "Renew soon, it's coming!",
  "Please renew soon...",
  "Your time is almost up!",
  "Two taps, all vibes.",
  "Renew = peace unlocked.",
  "Don’t lose the finale.",
  "Almost out—top up.",
  "3…2…renew.",
  "Tiny bill, big joy.",
  "Save the weekend.",
  "Clock’s loud. Renew."
];

// 0 or less (expired)
const QUOTES_EXPIRED = [
  "Renew ASAP or else...",
  "We pause respectfully.",
  "Refill the fun meter.",
  "Next ep awaits payment.",
  "Fix the sub, then binge.",
  "Snack break until renew.",
  "Epic… after renewal.",
  "Re-subscribe to continue."
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// --------------------------- Providers -------------------------------------
// Each returns: { name, premium: true|false|null, daysLeft, untilISO, username?, note? }

async function pRealDebrid({ token, fetchImpl = fetch }) {
  const name = "Real-Debrid";
  if (!token)
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: "missing token"
    };
  try {
    const res = await fetchImpl("https://api.real-debrid.com/rest/1.0/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Statusio/1.0"
      }
    });
    if (!res.ok)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: `HTTP ${res.status}`
      };
    const j = await res.json();

    const username = j?.username || j?.user || null;
    const premium =
      j.premium === true ||
      String(j.type || "").toLowerCase() === "premium";
    let untilISO = null,
      days = null;

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

    if (premium === true)
      return {
        name,
        premium: true,
        daysLeft: days ?? null,
        untilISO: untilISO ?? null,
        username
      };
    if (premium === false)
      return {
        name,
        premium: false,
        daysLeft: 0,
        untilISO: null,
        username
      };

    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username,
      note: "status unknown"
    };
  } catch (e) {
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: `network ${e.message}`
    };
  }
}

async function pAllDebrid({ key, fetchImpl = fetch }) {
  const name = "AllDebrid";
  if (!key)
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: "missing key"
    };
  try {
    const res = await fetchImpl("https://api.alldebrid.com/v4/user", {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": "Statusio/1.0" }
    });
    if (!res.ok)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: `HTTP ${res.status}`
      };
    const j = await res.json();
    if (j?.status !== "success" || !j?.data?.user)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: "bad response"
      };

    const u = j.data.user;
    const username = u?.username || null;
    const isPrem = !!u.isPremium;
    let out = { days: null, untilISO: null };
    if (
      Number.isFinite(Number(u.premiumUntil)) &&
      Number(u.premiumUntil) > 0
    )
      out = daysLeftFromEpochSec(Number(u.premiumUntil));

    return isPrem
      ? {
          name,
          premium: true,
          daysLeft: out.days,
          untilISO: out.untilISO,
          username
        }
      : { name, premium: false, daysLeft: 0, untilISO: null, username };
  } catch (e) {
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: `network ${e.message}`
    };
  }
}

async function pPremiumize({ key, useOAuth = false, fetchImpl = fetch }) {
  const name = "Premiumize";
  if (!key)
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: "missing key"
    };
  try {
    const url = new URL("https://www.premiumize.me/api/account/info");
    url.searchParams.set(useOAuth ? "access_token" : "apikey", key);
    const res = await fetchImpl(url.toString(), {
      headers: { "User-Agent": "Statusio/1.0" }
    });
    if (!res.ok)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: `HTTP ${res.status}`
      };
    const j = await res.json();
    if (String(j.status).toLowerCase() !== "success")
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: "bad response"
      };

    const out = daysLeftFromEpochSec(j.premium_until || 0);
    const isPrem = out.days > 0;
    const username = j?.customer_id ? String(j.customer_id) : null;

    return isPrem
      ? {
          name,
          premium: true,
          daysLeft: out.days,
          untilISO: out.untilISO,
          username
        }
      : { name, premium: false, daysLeft: 0, untilISO: null, username };
  } catch (e) {
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: `network ${e.message}`
    };
  }
}

async function pTorBox({ token, fetchImpl = fetch }) {
  const name = "TorBox";
  if (!token)
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: "missing token"
    };
  try {
    const res = await fetchImpl(
      "https://api.torbox.app/v1/api/user/me?settings=true",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "Statusio/1.0"
        }
      }
    );
    if (!res.ok)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: `HTTP ${res.status}`
      };
    const j = await res.json();

    const u = j?.data?.user || j?.user || j;
    const username = u?.username || null;
    const isPrem =
      u?.isPremium === true ||
      String(u?.accountType ?? "").toLowerCase() === "premium";
    let out = { days: 0, untilISO: null };

    if (u?.premiumUntil) out = daysLeftFromEpochSec(u.premiumUntil);
    else if (
      u?.premium_left ||
      u?.premiumLeft ||
      u?.remainingPremiumSeconds
    ) {
      out = daysLeftFromDurationSec(
        u.premium_left || u.premiumLeft || u.remainingPremiumSeconds
      );
    }

    if (isPrem)
      return {
        name,
        premium: true,
        daysLeft: out.days || null,
        untilISO: out.untilISO,
        username
      };
    if (out.days > 0)
      return {
        name,
        premium: true,
        daysLeft: out.days,
        untilISO: out.untilISO,
        username
      };

    return {
      name,
      premium: false,
      daysLeft: 0,
      untilISO: null,
      username,
      note: u?.note || undefined
    };
  } catch (e) {
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: `network ${e.message}`
    };
  }
}

async function pDebridLink({
  key,
  authScheme = "Bearer",
  endpoint = "https://debrid-link.com/api/account/infos",
  fetchImpl = fetch
}) {
  const name = "Debrid-Link";
  if (!key)
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: "missing key"
    };
  try {
    let url = endpoint;
    const init = { headers: { "User-Agent": "Statusio/1.0" } };

    if (authScheme === "Bearer") init.headers.Authorization = `Bearer ${key}`;
    else {
      const u = new URL(endpoint);
      u.searchParams.set("apikey", key);
      url = u.toString();
    }

    const res = await fetchImpl(url, init);
    if (!res.ok)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: `HTTP ${res.status}`
      };
    const j = await res.json();
    if (!j?.success || !j?.value)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: "bad response"
      };

    const secs = Number(j.value.premiumLeft || 0);
    const out =
      secs > 0 ? daysLeftFromDurationSec(secs) : { days: 0, untilISO: null };
    const username = j?.value?.username || null;

    if (out.days > 0)
      return {
        name,
        premium: true,
        daysLeft: out.days,
        untilISO: out.untilISO,
        username
      };
    return {
      name,
      premium: false,
      daysLeft: 0,
      untilISO: null,
      username,
      note: `accountType=${j.value.accountType ?? "?"}`
    };
  } catch (e) {
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: `network ${e.message}`
    };
  }
}

// --------------------------- Rendering -------------------------------------
function statusInfo(days) {
  if (days <= 0) return { mark: "🔴 Status: Expired", bucket: QUOTES_EXPIRED };
  if (days <= 3) return { mark: "🟠 Status: Critical", bucket: QUOTES_CRIT };
  if (days <= 14) return { mark: "🟡 Status: Warning", bucket: QUOTES_WARN };
  return { mark: "🟢 Status: OK", bucket: QUOTES_OK };
}

function renderProviderCard(r) {
  const service = r.name;
  const user = r?.username ? `@${String(r.username)}` : "—";
  const days =
    Number.isFinite(r.daysLeft) && r.daysLeft !== null
      ? r.daysLeft
      : r.premium
      ? "—"
      : 0;
  const dateStr = r.untilISO ? isoDate(r.untilISO) : r.premium ? "—" : "N/A";

  const numericDays = typeof days === "number" ? days : 9999;
  const { mark, bucket } = statusInfo(numericDays);
  const quote = pick(bucket);

  let titlePrefix = "🟢 OK";
  if (mark.startsWith("🟡")) titlePrefix = "🟡 Warning";
  else if (mark.startsWith("🟠")) titlePrefix = "🟠 Critical";
  else if (mark.startsWith("🔴")) titlePrefix = "🔴 Expired";

  const title = `${titlePrefix} — ${service}`;

  const lines = [
    "———————————————",
    `🤝 Service: ${service}`,
    `👤 ${user}`,
    `⭐ Premium until: ${dateStr}`,
    `⏳ Days remaining: ${days} D`,
    `${mark}`,
    `💬 ${quote}`,
    "———————————————"
  ].join("\n");

  return { title, description: lines };
}

// --------------------------- Manifest & Config ------------------------------
const manifest = {
  // ⚠ Change ID if you want Stremio to treat this as a fresh addon
  id: "a1337user.statusio.multi.simple.v2",
  version: "1.0.9",
  name: "Statusio",
  description:
    "Shows premium status & days remaining across multiple debrid providers.",
  resources: ["stream"],
  types: ["movie", "series", "channel", "tv"],
  catalogs: [],
  behaviorHints: { configurable: true, configurationRequired: false },
  logo: LOGO_DATA_URL || undefined,
  config: [
    {
      name: "cache_minutes",
      type: "number",
      default: 45,
      title: "Cache Minutes (default 45)"
    },

    // Tokens / keys – presence = enabled
    { name: "rd_token", type: "text", title: "Real-Debrid Token (Bearer)" },
    { name: "ad_key", type: "text", title: "AllDebrid API Key (Bearer)" },
    {
      name: "pm_key",
      type: "text",
      title: "Premiumize apikey OR access_token"
    },
    { name: "tb_token", type: "text", title: "TorBox Token (Bearer)" },
    { name: "dl_key", type: "text", title: "Debrid-Link API Key/Token" },

    // Very simple extra text for Debrid-Link auth/endpoint
    {
      name: "dl_auth",
      type: "text",
      title: "Debrid-Link Auth Scheme (Bearer/query)",
      default: "Bearer"
    },
    {
      name: "dl_endpoint",
      type: "text",
      title: "Debrid-Link Endpoint Override",
      default: "https://debrid-link.com/api/account/infos"
    }
  ]
};

const builder = new addonBuilder(manifest);

// ---------------------------- Stream Handler -------------------------------
builder.defineStreamHandler(async (args) => {
  const cfg = args?.config || {};
  console.log("[Statusio cfg]", JSON.stringify(cfg, null, 2));

  // Prefer CONFIG; fall back to env only if config key is empty
  const rdFromCfg =
    cfg.rd_token || cfg.RD_TOKEN || cfg.rdToken || cfg.realdebrid || "";
  const adFromCfg = cfg.ad_key || cfg.AD_KEY || cfg.alldebrid || "";
  const pmFromCfg = cfg.pm_key || cfg.PM_KEY || cfg.premiumize || "";
  const tbFromCfg = cfg.tb_token || cfg.TB_TOKEN || cfg.torbox || "";
  const dlFromCfg = cfg.dl_key || cfg.DL_KEY || cfg.debridlink || "";

  const cacheMin = Number.isFinite(Number(cfg.cache_minutes))
    ? Math.max(1, Number(cfg.cache_minutes))
    : 45;

  const tokens = {
    rd: String(rdFromCfg || process.env.RD_TOKEN || "").trim(),
    ad: String(adFromCfg || process.env.AD_KEY || "").trim(),
    pm: String(pmFromCfg || process.env.PM_KEY || "").trim(),
    tb: String(tbFromCfg || process.env.TB_TOKEN || "").trim(),
    dl: String(dlFromCfg || process.env.DL_KEY || "").trim()
  };

  const enabled = {
    realdebrid: !!tokens.rd,
    alldebrid: !!tokens.ad,
    premiumize: !!tokens.pm,
    torbox: !!tokens.tb,
    debridlink: !!tokens.dl
  };

  console.log("[Statusio enabled]", enabled);

  const cacheKey = [
    Object.entries(enabled)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(","),
    `rd:${redact(tokens.rd)}`,
    `ad:${redact(tokens.ad)}`,
    `pm:${redact(tokens.pm)}`,
    `tb:${redact(tokens.tb)}`,
    `dl:${redact(tokens.dl)}:${cfg.dl_auth || "Bearer"}:${
      cfg.dl_endpoint || ""
    }`
  ].join("|");

  let results = getCache(cacheKey);
  if (!results) {
    try {
      const jobs = [];
      if (enabled.realdebrid) jobs.push(pRealDebrid({ token: tokens.rd }));
      if (enabled.alldebrid) jobs.push(pAllDebrid({ key: tokens.ad }));
      if (enabled.premiumize)
        jobs.push(
          pPremiumize({
            key: tokens.pm,
            useOAuth:
              String(cfg.pm_auth || "").toLowerCase() === "oauth" ||
              String(cfg.dl_auth || "").toLowerCase() === "oauth" // legacy fallback
          })
        );
      if (enabled.torbox) jobs.push(pTorBox({ token: tokens.tb }));
      if (enabled.debridlink)
        jobs.push(
          pDebridLink({
            key: tokens.dl,
            authScheme: cfg.dl_auth || "Bearer",
            endpoint:
              (cfg.dl_endpoint || "https://debrid-link.com/api/account/infos")
                .trim()
          })
        );

      results = jobs.length ? await Promise.all(jobs) : [];
      setCache(cacheKey, results, cacheMin * MIN);
    } catch (e) {
      const lines = [
        "———————————————",
        "⚠️ Unable to fetch debrid status",
        String(e.message || e),
        "———————————————"
      ].join("\n");
      return {
        streams: [
          {
            name: "🔐 Statusio",
            title: "⚠️ Status unavailable",
            description: lines,
            behaviorHints: { notWebReady: true },
            externalUrl: "about:blank"
          }
        ],
        cacheMaxAge: 60
      };
    }
  }

  const streams = [];
  for (const r of results) {
    const card = renderProviderCard(r);
    streams.push({
      name: "🔐 Statusio",
      title: card.title,
      description: card.description,
      behaviorHints: { notWebReady: true },
      externalUrl: "about:blank"
    });
  }

  // If no providers enabled, show guidance / debug
  if (streams.length === 0) {
    const hasAnyCfg = Object.keys(cfg).length > 0;
    if (!hasAnyCfg) {
      streams.push({
        name: "🔐 Statusio",
        title: "⚠️ Add a token in Configure",
        description: [
          "———————————————",
          "Add at least one token in Configure:",
          "• Real-Debrid (rd_token)",
          "• AllDebrid (ad_key)",
          "• Premiumize (pm_key)",
          "• TorBox (tb_token)",
          "• Debrid-Link (dl_key)",
          "———————————————"
        ].join("\n"),
        behaviorHints: { notWebReady: true },
        externalUrl: "about:blank"
      });
    } else {
      // Debug card: helpful to verify if config actually arrived
      streams.push({
        name: "🔐 Statusio",
        title: "⚠️ Config received but no providers enabled",
        description: [
          "———————————————",
          "We received config from Stremio, but no provider token is enabled.",
          "",
          `Real-Debrid:   ${redact(tokens.rd)}`,
          `AllDebrid:     ${redact(tokens.ad)}`,
          `Premiumize:    ${redact(tokens.pm)}`,
          `TorBox:        ${redact(tokens.tb)}`,
          `Debrid-Link:   ${redact(tokens.dl)}`,
          "",
          "Check that your tokens are valid and saved in Configure.",
          "———————————————"
        ].join("\n"),
        behaviorHints: { notWebReady: true },
        externalUrl: "about:blank"
      });
    }
  }

  return {
    streams,
    cacheMaxAge: cacheMin * 60,
    staleRevalidate: cacheMin * 60,
    staleError: cacheMin * 60
  };
});

// ------------------------------ Server -------------------------------------
const PORT = Number(process.env.PORT || 7042);
serveHTTP(builder.getInterface(), { port: PORT, hostname: "0.0.0.0" });
console.log(`Statusio at http://127.0.0.1:${PORT}/manifest.json`);