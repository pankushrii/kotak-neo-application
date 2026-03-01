// api/index.js

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const zlib = require("zlib");

const { clear, getSession } = require("./sessionStore");
const { apiConfig } = require("./kotakConfig");

const {
  loginWithTotp,
  placeOrder,
  getOrders,
  getPositions
} = require("./kotakClient");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// --------------------
// Scrip master cache
// --------------------
let SCRIP_CACHE = {
  updatedAt: 0,
  rows: [],
  meta: {
    sourceUrl: null,
    count: 0
  }
};

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

function hasActiveSession() {
  const s = getSession();
  return !!(s.sessionToken && s.baseUrl);
}

function baseUrlOrThrow() {
  const s = getSession();
  if (!s.baseUrl) throw new Error("No baseUrl in session. Login first.");
  return s.baseUrl;
}

function sessionHeadersOrThrow() {
  const s = getSession();
  if (!s.sessionToken) throw new Error("No sessionToken. Login first.");

  // v2: session token goes in Auth header
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "neo-fin-key": apiConfig.neoFinKey,
    Auth: s.sessionToken
  };

  if (s.sessionSid) headers.sid = s.sessionSid;

  return headers;
}

// Recursively extract all string values from any JSON shape
function extractStringsDeep(x, out) {
  if (!x) return;
  if (typeof x === "string") {
    out.push(x);
    return;
  }
  if (Array.isArray(x)) {
    for (const v of x) extractStringsDeep(v, out);
    return;
  }
  if (typeof x === "object") {
    for (const k of Object.keys(x)) extractStringsDeep(x[k], out);
  }
}

function chooseBestScripFileUrl(candidates, baseUrl) {
  // Normalize to absolute URLs
  const urls = candidates
    .filter(Boolean)
    .map((u) => {
      const s = String(u).trim();
      if (!s) return null;
      if (s.startsWith("http://") || s.startsWith("https://")) return s;
      if (s.startsWith("/")) return `${baseUrl}${s}`;
      // sometimes they may return relative like "path/to/file.csv"
      return `${baseUrl}/${s}`;
    })
    .filter(Boolean);

  // Prefer CSV/CSV.GZ
  const csvLike = urls.filter((u) => /\.csv(\.gz)?$/i.test(u));
  const pool = csvLike.length ? csvLike : urls;

  // Prefer NSE cash market patterns if present
  const prefer = (u) =>
    /nse/i.test(u) && /(cm|cash|eq)/i.test(u) && /\.csv(\.gz)?$/i.test(u);

  const preferred = pool.find(prefer);
  return preferred || pool[0] || null;
}

// Simple CSV line parser supporting quoted fields
function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // handle escaped quote ""
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }
  result.push(cur);
  return result.map((s) => s.trim());
}

function parseScripMasterCsv(csvText) {
  const lines = String(csvText).split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  // Try to locate common columns; fallback to first columns if not found
  const iTrd =
    idx("pTrdSymbol") >= 0 ? idx("pTrdSymbol") :
    idx("trdSym") >= 0 ? idx("trdSym") :
    idx("trading_symbol") >= 0 ? idx("trading_symbol") : -1;

  const iName =
    idx("pSymbolName") >= 0 ? idx("pSymbolName") :
    idx("name") >= 0 ? idx("name") :
    idx("pDesc") >= 0 ? idx("pDesc") : -1;

  const iSeg =
    idx("pExchSeg") >= 0 ? idx("pExchSeg") :
    idx("exchange_segment") >= 0 ? idx("exchange_segment") :
    idx("exchSeg") >= 0 ? idx("exchSeg") : -1;

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]).map((v) => v.replace(/^"|"$/g, ""));
    if (!cols.length) continue;

    const trdSymbol = iTrd >= 0 ? cols[iTrd] : cols[1] || cols[0] || "";
    const name = iName >= 0 ? cols[iName] : cols[2] || "";
    const exchSeg = iSeg >= 0 ? cols[iSeg] : "nse_cm";

    if (!trdSymbol) continue;

    rows.push({
      trdSymbol,
      name,
      exchSeg
    });
  }

  return rows;
}

async function fetchMasterScripCsvAndCache(force) {
  const now = Date.now();
  const age = now - SCRIP_CACHE.updatedAt;

  console.log("🧠 fetchMasterScripCsvAndCache called:", { force, cached: !!SCRIP_CACHE.rows?.length, ageMs: age });

  if (!force && SCRIP_CACHE.rows?.length && age < CACHE_DURATION_MS) {
    console.log("✅ Using cached scrip master:", { count: SCRIP_CACHE.rows.length, updatedAt: SCRIP_CACHE.updatedAt });
    return SCRIP_CACHE;
  }

  if (!hasActiveSession()) {
    throw new Error("No active session. Login first before downloading scrip master.");
  }

  const baseUrl = baseUrlOrThrow();
  const headers = sessionHeadersOrThrow();

  // IMPORTANT: your logs show this endpoint exists on baseUrl host, but POST returns 404.
  const filePathsUrl = `${baseUrl}/scrip/1.0/masterscrip/file-paths`;

  console.log("📍 baseUrl:", baseUrl);
  console.log("🌐 filePathsUrl:", filePathsUrl);
  console.log("🧾 headers:", { Auth: headers.Auth ? "present" : "missing", sid: headers.sid ? "present" : "missing", "neo-fin-key": headers["neo-fin-key"] });

  let filePathsResp;
  try {
    console.log("🚀 GET file-paths...");
    filePathsResp = await axios.get(filePathsUrl, { headers });
    console.log("✅ file-paths status:", filePathsResp.status);
  } catch (err) {
    console.error("❌ file-paths failed:", err.response?.status, err.response?.data || err.message);
    throw err;
  }

  // Extract candidate URLs/paths from response JSON
  const candidates = [];
  extractStringsDeep(filePathsResp.data, candidates);

  console.log("📦 file-paths extracted string candidates:", candidates.slice(0, 30));
  console.log("📦 candidate count:", candidates.length);

  const chosenUrl = chooseBestScripFileUrl(candidates, baseUrl);
  console.log("🎯 chosen master scrip file URL:", chosenUrl);

  if (!chosenUrl) {
    throw new Error("Could not find any CSV/CSV.GZ URL in file-paths response.");
  }

  // Download the CSV (or CSV.GZ)
  let bin;
  try {
    console.log("⬇️ downloading scrip master file...");
    const dl = await axios.get(chosenUrl, { headers, responseType: "arraybuffer" });
    console.log("✅ download status:", dl.status);
    bin = Buffer.from(dl.data);
    console.log("📦 downloaded bytes:", bin.length);
  } catch (err) {
    console.error("❌ download failed:", err.response?.status, err.response?.data || err.message);
    throw err;
  }

  // If gz, gunzip
  let csvText;
  const isGz = /\.gz$/i.test(chosenUrl);
  try {
    if (isGz) {
      console.log("🧩 gunzipping .gz content...");
      csvText = zlib.gunzipSync(bin).toString("utf-8");
    } else {
      csvText = bin.toString("utf-8");
    }
    console.log("✅ csvText length:", csvText.length);
  } catch (err) {
    console.error("❌ failed to decode CSV:", err.message);
    throw err;
  }

  // Parse
  let rows;
  try {
    console.log("🧮 parsing CSV...");
    rows = parseScripMasterCsv(csvText);
    console.log("✅ parsed rows:", rows.length);
  } catch (err) {
    console.error("❌ CSV parse failed:", err.message);
    throw err;
  }

  // Cache
  SCRIP_CACHE = {
    updatedAt: now,
    rows,
    meta: {
      sourceUrl: chosenUrl,
      count: rows.length
    }
  };

  console.log("✅ scrip master cache updated:", SCRIP_CACHE.meta);
  return SCRIP_CACHE;
}

// --------------------
// Routes
// --------------------
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/auth/login", async (req, res) => {
  try {
    const { totp } = req.body || {};
    if (!totp) return res.status(400).json({ error: "totp is required" });

    const data = await loginWithTotp(totp);

    // (optional) warm up cache in background after login
    fetchMasterScripCsvAndCache(false).catch((e) =>
      console.error("⚠️ warmup scrip master failed:", e.response?.data || e.message)
    );

    res.json({ success: true, ...data });
  } catch (err) {
    console.error("Login error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message || "Login failed" });
  }
});

app.get("/api/auth/session", (req, res) => {
  const s = getSession();
  res.json({
    hasSession: !!(s.sessionToken && s.baseUrl),
    lastLoginAt: s.lastLoginAt
  });
});

app.post("/api/auth/logout", (req, res) => {
  clear();
  // clear cache too (optional)
  SCRIP_CACHE = { updatedAt: 0, rows: [], meta: { sourceUrl: null, count: 0 } };
  res.json({ success: true });
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      trading_symbol,
      quantity,
      side,
      exchange_segment = "nse_cm",
      product = "CNC",
      order_type = "MKT",
      validity = "DAY"
    } = req.body || {};

    if (!trading_symbol || !quantity || !side) {
      return res.status(400).json({ error: "trading_symbol, quantity, side are required" });
    }

    const payload = {
      exchange_segment,
      product,
      price: "0",
      order_type,
      quantity: String(quantity),
      validity,
      trading_symbol,
      transaction_type: side === "BUY" ? "B" : "S",
      amo: "NO",
      disclosed_quantity: "0",
      market_protection: "0",
      pf: "N",
      trigger_price: "0",
      tag: null
    };

    const data = await placeOrder(payload);
    res.json(data);
  } catch (err) {
    console.error("Order error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message || "Order failed" });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const data = await getOrders();
    res.json(data);
  } catch (err) {
    console.error("Orders fetch error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message || "Orders fetch failed" });
  }
});

app.get("/api/positions", async (req, res) => {
  try {
    const data = await getPositions();
    res.json(data);
  } catch (err) {
    console.error("Positions fetch error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message || "Positions fetch failed" });
  }
});

// Force refresh (optional helper)
app.post("/api/scrip/refresh", async (req, res) => {
  try {
    const cache = await fetchMasterScripCsvAndCache(true);
    res.json({ success: true, meta: cache.meta, updatedAt: cache.updatedAt });
  } catch (err) {
    console.error("Scrip refresh error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message || "Scrip refresh failed" });
  }
});

// Autosuggest endpoint
app.get("/api/symbols", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    if (!q || q.length < 2) return res.json([]);

    const query = q.toUpperCase();

    const cache = await fetchMasterScripCsvAndCache(false);
    const rows = cache.rows || [];

    const matches = rows
      .filter((r) => {
        const ts = (r.trdSymbol || "").toUpperCase();
        const nm = (r.name || "").toUpperCase();
        return ts.includes(query) || nm.includes(query);
      })
      .slice(0, 15);

    res.json(matches);
  } catch (err) {
    console.error("Symbol search failed:", err.response?.status, err.response?.data || err.message);
    res.status(500).json({ error: "Symbol search failed" });
  }
});

// Local dev only
if (process.env.NODE_ENV === "development") {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log("API listening on", port));
}

// For Vercel
module.exports = app;
