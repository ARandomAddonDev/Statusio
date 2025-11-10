// ============================================================================
// Statusio • Stremio Add-on (TV-Compatible + Quotes v1.1.20)
// Based on Ratings Aggregator pattern, but with fun status quotes
// ============================================================================

import sdk from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = sdk;
import fetch from "node-fetch";

// ----------------------------- Icon ----------------------------------------
const LOGO_URL =
  "https://raw.githubusercontent.com/ARandomAddonDev/Statusio/refs/heads/main/assets/logo.png";

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
  return {
    days: ceilDays(ms),
    untilISO: new Date(Date.now() + ms).toISOString(),
  };
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
  "Boss muted, show blasted",
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
  "Procrastinatw: cinematic",
  "Budget: snacks approved.",
  "Tonight’s plan: stay.",
  "Your couch filed PTO.",
  "Microwave = trailer time",
  "Main quest: relax.",
  "Side quest: popcorn.",
  "Therapy but with dragons",
  "Stretch, sip, stream.",
  "Zoom out, zone in.",
  "One more can't hurt, right?",
  "Doomscrolling, but make it TV",
  "I wanna know what happens next!",
  "Just one season. *Lies.*",
  "Sleep is overrated.",
  "Cliffhanger got me hostage",
  "I can quit… after this arc",
  "This is self-care (delulu)",
  "Oops, next ep autoplays",
  "Brain: just one more. *12 later*",
  "Plot > rent > everything",
  "We roll credits at 3AM",
  "I live here now. Send help.",
  "Let the credits roll… never",
  "My cardio: skipping intros",
  "Hydrate? I drink plot twists",
  "Laundry can wait. Drama can’t",
  "Toilet break = high risk",
  "Remote > friends > family",
  "Eyes square, vibes rectangle",
  "Binge now, adult later",
  "Spoilers are a hate crime",
  "Ctrl+Z real life, pls",
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
  "Roll credits on worry.",
  "Pay up or plot twist: pain",
  "Binge tax due, peasant",
  "Wallet lighter, soul fuller",
  "Renew or face the void",
  "Card declined? Big sad",
  "Couch demands tribute",
  "Subscription > therapy",
  "Click or cry at 99%",
  "Renewal = plot armor",
  "Don’t let the algorithm win",
];

// 3 days or less (critical)
const QUOTES_CRIT = [
  "Boss fight: renewal.",
  "Renew soon, it's coming!",
  "Please renew soon...",
  "Your time is almost up!",
  "Don't let it catch on",
  "Two taps, all vibes.",
  "Renew = peace unlocked.",
  "Don’t lose the finale.",
  "Almost out—top up.",
  "3…2…renew.",
  "Tiny bill, big joy.",
  "Grab the lifeline.",
  "Save the weekend.",
  "Clock’s loud. Renew.",
  "Last ep loading… or not",
  "Buffering fate. Renew.",
  "Do it or doomscroll life",
  "Finale blocked. Pay up.",
  "Renew or rage quit",
  "Plot armor expiring",
];

// 0 or less (expired)
const QUOTES_EXPIRED = [
  "Renew ASAP or else...",
  "Your ISP will be mad!",
  "Renew now to avoid ISP Warnings",
  "Renew subscription to continue",
  "Renew to avoid confrontation",
  "Renew now to continue",
  "We're not responsible, renew.",
  "We pause respectfully.",
  "Refill the fun meter.",
  "Next ep awaits payment.",
  "Fix the sub, then binge.",
  "Snack break until renew.",
  "Epic… after renewal.",
  "Re-subscribe to continue.",
  "Broke hours activated",
  "Screen black, dreams too",
  "Renew or rot in reality",
  "Buffering… forever",
  "Cliffhanger hell awaits",
  "Wallet betrayed you",
  "Free trial? Cute story",
  "Back to real life, sucka",
  "Binge blocked. L.",
  "Paywall won. You lost.",
  "Subscription graveyard",
  "Bills > chills > skills",
  "Restart life.exe failed",
  "You had one job: renew",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// --------------------------- Providers -------------------------------------
async function pRealDebrid({ token, fetchImpl = fetch }) {
  const name = "Real-Debrid";
  if (!token)
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: "missing token",
    };

  try {
    const res = await fetchImpl("https://api.real-debrid.com/rest/1.0/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "Statusio/1.0" },
    });

    if (!res.ok)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: `HTTP ${res.status}`,
      };

    const j = await res.json();
    const username = j?.username || j?.user || null;
    const premium =
      j.premium === true || String(j.type || "").toLowerCase() === "premium";
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
        username,
      };
    if (premium === false)
      return {
        name,
        premium: false,
        daysLeft: 0,
        untilISO: null,
        username,
      };

    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username,
      note: "status unknown",
    };
  } catch (e) {
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: `network ${e.message}`,
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
      note: "missing key",
    };

  try {
    const res = await fetchImpl("https://api.alldebrid.com/v4/user", {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": "Statusio/1.0" },
    });

    if (!res.ok)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: `HTTP ${res.status}`,
      };

    const j = await res.json();
    if (j?.status !== "success" || !j?.data?.user)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: "bad response",
      };

    const u = j.data.user;
    const username = u?.username || null;
    const isPrem = !!u.isPremium;
    let out = { days: null, untilISO: null };

    if (Number.isFinite(Number(u.premiumUntil)) && Number(u.premiumUntil) > 0) {
      out = daysLeftFromEpochSec(Number(u.premiumUntil));
    }

    return isPrem
      ? {
          name,
          premium: true,
          daysLeft: out.days,
          untilISO: out.untilISO,
          username,
        }
      : { name, premium: false, daysLeft: 0, untilISO: null, username };
  } catch (e) {
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: `network ${e.message}`,
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
      note: "missing key",
    };

  try {
    const url = new URL("https://www.premiumize.me/api/account/info");
    url.searchParams.set(useOAuth ? "access_token" : "apikey", key);

    const res = await fetchImpl(url.toString(), {
      headers: { "User-Agent": "Statusio/1.0" },
    });

    if (!res.ok)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: `HTTP ${res.status}`,
      };

    const j = await res.json();
    if (String(j.status).toLowerCase() !== "success")
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: "bad response",
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
          username,
        }
      : { name, premium: false, daysLeft: 0, untilISO: null, username };
  } catch (e) {
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: `network ${e.message}`,
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
      note: "missing token",
    };

  try {
    const res = await fetchImpl(
      "https://api.torbox.app/v1/api/user/me?settings=true",
      {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "Statusio/1.0" },
      }
    );

    if (!res.ok)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: `HTTP ${res.status}`,
      };

    const j = await res.json();
    const u = j?.data?.user || j?.user || j;
    const username = u?.username || null;
    const isPrem =
      u?.isPremium === true ||
      String(u?.accountType ?? "").toLowerCase() === "premium";
    let out = { days: 0, untilISO: null };

    if (u?.premiumUntil) {
      out = daysLeftFromEpochSec(u.premiumUntil);
    } else if (u?.premium_left || u?.premiumLeft || u?.remainingPremiumSeconds) {
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
        username,
      };
    if (out.days > 0)
      return {
        name,
        premium: true,
        daysLeft: out.days,
        untilISO: out.untilISO,
        username,
      };

    return {
      name,
      premium: false,
      daysLeft: 0,
      untilISO: null,
      username,
      note: u?.note || undefined,
    };
  } catch (e) {
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: `network ${e.message}`,
    };
  }
}

async function pDebridLink({
  key,
  authScheme = "Bearer",
  endpoint = "https://debrid-link.com/api/account/infos",
  fetchImpl = fetch,
}) {
  const name = "Debrid-Link";
  if (!key)
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: "missing key",
    };

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
    if (!res.ok)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: `HTTP ${res.status}`,
      };

    const j = await res.json();
    if (!j?.success || !j?.value)
      return {
        name,
        premium: null,
        daysLeft: null,
        untilISO: null,
        username: null,
        note: "bad response",
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
        username,
      };

    return {
      name,
      premium: false,
      daysLeft: 0,
      untilISO: null,
      username,
      note: `accountType=${j.value.accountType ?? "?"}`,
    };
  } catch (e) {
    return {
      name,
      premium: null,
      daysLeft: null,
      untilISO: null,
      username: null,
      note: `network ${e.message}`,
    };
  }
}

// --------------------------- Status Formatting -----------------------------
function getStatusInfo(days) {
  if (days <= 0) return { emoji: "🔴", status: "EXPIRED" };
  if (days <= 3) return { emoji: "🟠", status: "CRITICAL" };
  if (days <= 14) return { emoji: "🟡", status: "WARNING" };
  return { emoji: "🟢", status: "OK" };
}

function getQuoteForDays(days) {
  if (days <= 0) return pick(QUOTES_EXPIRED);
  if (days <= 3) return pick(QUOTES_CRIT);
  if (days <= 14) return pick(QUOTES_WARN);
  return pick(QUOTES_OK);
}

// --------------------------- Manifest (TV-Compatible) ----------------------
const manifest = {
  id: "a1337user.statusio.tv.compatible",
  version: "1.1.20",
  name: "Statusio",
  description:
    "Shows premium status & days remaining across multiple debrid providers.",
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
      title: "Cache Minutes (default 45)",
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
      default: "Bearer",
    },
    {
      key: "dl_endpoint",
      type: "text",
      title: "Debrid-Link Endpoint Override",
      default: "https://debrid-link.com/api/account/infos",
    },
  ],
};

const builder = new addonBuilder(manifest);

// --------------------------- Shared Data Fetching --------------------------
async function fetchStatusData(cfg) {
  const cacheMin = Number.isFinite(Number(cfg.cache_minutes))
    ? Math.max(1, Number(cfg.cache_minutes))
    : 45;

  const tokens = {
    rd: String(cfg.rd_token || process.env.RD_TOKEN || "").trim(),
    ad: String(cfg.ad_key || process.env.AD_KEY || "").trim(),
    pm: String(cfg.pm_key || process.env.PM_KEY || "").trim(),
    tb: String(cfg.tb_token || process.env.TB_TOKEN || "").trim(),
    dl: String(cfg.dl_key || process.env.DL_KEY || "").trim(),
  };

  const enabled = {
    realdebrid: !!tokens.rd,
    alldebrid: !!tokens.ad,
    premiumize: !!tokens.pm,
    torbox: !!tokens.tb,
    debridlink: !!tokens.dl,
  };

  const cacheKey = [
    Object.entries(enabled)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(","),
    `rd:${redact(tokens.rd)}`,
    `ad:${redact(tokens.ad)}`,
    `pm:${redact(tokens.pm)}`,
    `tb:${redact(tokens.tb)}`,
    `dl:${redact(tokens.dl)}:${cfg.dl_auth || "Bearer"}:${cfg.dl_endpoint || ""}`,
  ].join("|");

  let results = getCache(cacheKey);

  if (!results) {
    try {
      const jobs = [];
      if (enabled.realdebrid) jobs.push(pRealDebrid({ token: tokens.rd }));
      if (enabled.alldebrid) jobs.push(pAllDebrid({ key: tokens.ad }));
      if (enabled.premiumize) jobs.push(pPremiumize({ key: tokens.pm }));
      if (enabled.torbox) jobs.push(pTorBox({ token: tokens.tb }));
      if (enabled.debridlink)
        jobs.push(
          pDebridLink({
            key: tokens.dl,
            authScheme: cfg.dl_auth || "Bearer",
            endpoint: (cfg.dl_endpoint ||
              "https://debrid-link.com/api/account/infos").trim(),
          })
        );

      results = jobs.length ? await Promise.all(jobs) : [];
      setCache(cacheKey, results, cacheMin * MIN);
    } catch (e) {
      console.error("[Statusio] Error fetching provider data:", e);
      return { error: e.message, results: [], enabled, hasData: false };
    }
  }

  return {
    results,
    enabled,
    hasData: results.some((r) => r.premium !== null || r.username),
  };
}

// ---------------------------- Stream Handler (TV) --------------------------
builder.defineStreamHandler(async (args) => {
  const reqType = String(args?.type || "");
  const reqId = String(args?.id || "");

  console.log("[Statusio v1.1.20] TV stream request:", { type: reqType, id: reqId });

  if (!reqId || !reqId.startsWith("tt")) {
    return { streams: [] };
  }

  // Parse config
  const rawCfg = args?.config ?? {};
  let cfg = {};
  if (typeof rawCfg === "string") {
    try {
      cfg = JSON.parse(rawCfg);
    } catch (e) {
      cfg = {};
    }
  } else if (typeof rawCfg === "object" && rawCfg !== null) {
    cfg = rawCfg;
  }

  console.log("[Statusio v1.1.20 parsed config]", JSON.stringify(cfg, null, 2));

  const statusData = await fetchStatusData(cfg);

  // If no providers configured, return empty (TVs skip setup/instructional stuff)
  if (!Object.values(statusData.enabled).some((v) => v)) {
    console.log("[Statusio v1.1.20] No providers enabled, returning empty for TV");
    return { streams: [] };
  }

  const results = statusData.results || [];
  if (!statusData.hasData || results.length === 0) {
    console.log("[Statusio v1.1.20] No data from providers, returning empty");
    return { streams: [] };
  }

  const lines = [];
  let worstDays = null;

  // Per-service lines
  for (const r of results) {
    if (r.premium === null && !r.username) continue;

    const rawDays =
      Number.isFinite(r.daysLeft) && r.daysLeft !== null
        ? r.daysLeft
        : r.premium
        ? 9999
        : 0;

    const daysForStatus =
      typeof rawDays === "number" && Number.isFinite(rawDays) ? rawDays : 9999;

    const { emoji, status } = getStatusInfo(daysForStatus);
    const labelEmoji = status === "OK" ? "🤝" : "🛠️";

    lines.push(`${labelEmoji} Service: ${r.name} - ${status} ${emoji}`);

    if (
      typeof daysForStatus === "number" &&
      Number.isFinite(daysForStatus) &&
      (worstDays === null || daysForStatus < worstDays)
    ) {
      worstDays = daysForStatus;
    }
  }

  // Pick a primary provider to show detailed info (first with username or premium)
  const primary =
    results.find((r) => r.username || r.premium !== null) || results[0];

  if (primary) {
    const user = primary?.username ? `@${String(primary.username)}` : "—";
    const days =
      Number.isFinite(primary.daysLeft) && primary.daysLeft !== null
        ? primary.daysLeft
        : primary.premium
        ? "—"
        : 0;
    const dateStr = primary.untilISO
      ? isoDate(primary.untilISO)
      : primary.premium
      ? "—"
      : "N/A";

    lines.push(`👤 User: ${user}`);
    lines.push(`⏳️ Expires: ${dateStr}`);
    lines.push(`📅 Days left: ${days}`);
  }

  // Add quote based on worstDays among services
  const daysForQuote =
    typeof worstDays === "number" && Number.isFinite(worstDays)
      ? worstDays
      : 9999;
  const quote = getQuoteForDays(daysForQuote);
  lines.push(`💬 ${quote}`);

  const description = lines.join("\n");

  const streams = [
    {
      name: "🔐 Statusio",
      description,
      // TV-safe: must include url + externalUrl, mark as notWebReady
      url: "https://real-debrid.com/",
      externalUrl: "https://real-debrid.com/",
      behaviorHints: {
        notWebReady: true,
      },
    },
  ];

  console.log(
    `[Statusio v1.1.20] Returning ${streams.length} TV-compatible stream(s)`
  );
  return { streams };
});

// ------------------------------ Server -------------------------------------
const PORT = Number(process.env.PORT || 7042);
serveHTTP(builder.getInterface(), { port: PORT, hostname: "0.0.0.0" });

console.log(
  `✅ Statusio TV v1.1.20 at http://127.0.0.1:${PORT}/manifest.json`
);
console.log(`📱 TV-safe, single-card UX with quotes enabled`);