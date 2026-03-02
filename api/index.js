const express = require("express");
const cors = require("cors");
const axios = require("axios");
const zlib = require("zlib");
const cookieParser = require("cookie-parser");

const { apiConfig } = require("./kotakConfig");
const {
  loginWithTotp,
  placeOrder,
  getOrders,
  getPositions
} = require("./kotakClient");

const app = express();

// --- Middleware Configuration ---
app.use(cookieParser());
app.use(cors({ 
  origin: true, 
  credentials: true 
}));
app.use(express.json());

// --------------------
// Scrip master cache
// --------------------
let SCRIP_CACHE = {
  updatedAt: 0,
  rows: [],
  meta: { sourceUrl: null, count: 0 }
};

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

// --------------------
// Session Helpers
// --------------------
function getSessionFromReq(req) {
  const session = {
    baseUrl: req.cookies.baseUrl,
    sessionToken: req.cookies.sessionToken,
    sessionSid: req.cookies.sessionSid
  };
  console.log("🍪 [Cookie Check]:", { 
    hasBaseUrl: !!session.baseUrl, 
    hasToken: !!session.sessionToken,
    sid: session.sessionSid || "none" 
  });
  return session;
}

function sessionHeadersOrThrow(session) {
  if (!session.sessionToken) {
    console.error("❌ [Header Error]: sessionToken missing from session object");
    throw new Error("No sessionToken. Login first.");
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "neo-fin-key": apiConfig.neoFinKey,
    Auth: session.sessionToken,
    Authorization: apiConfig.accessToken,
    ...(session.sessionSid && { sid: session.sessionSid })
  };
  console.log("🛠️ [Headers Generated] (Auth/neo-fin-key present)");
  return headers;
}

// --------------------
// Utility Functions
// --------------------
function extractStringsDeep(x, out) {
  if (!x) return;
  if (typeof x === "string") { out.push(x); return; }
  if (Array.isArray(x)) { for (const v of x) extractStringsDeep(v, out); return; }
  if (typeof x === "object") { for (const k of Object.keys(x)) extractStringsDeep(x[k], out); }
}

function chooseBestScripFileUrl(candidates, baseUrl, isOptionChain = false) {
  console.log(`🔍 https://www.wordwebonline.com/en/SELECTION: Analyzing ${candidates.length} candidates (Mode: ${isOptionChain ? 'F&O' : 'Cash'})...`);
  
  const urls = candidates
    .filter(Boolean)
    .map((u) => {
      const s = String(u).trim();
      if (!s) return null;
      if (s.startsWith("http")) return s;
      return s.startsWith("/") ? `${baseUrl}${s}` : `${baseUrl}/${s}`;
    })
    .filter(Boolean);

  let final;

  if (isOptionChain) {
    // Look specifically for the Derivatives file (nse_fo)
    final = urls.find((u) => /nse_fo/i.test(u) && /\.csv(\.gz)?$/i.test(u));
    console.log("🎲 [F&O Target Check]:", final || "Not found, falling back...");
  }

  if (!final) {
    // Default/Fallback to Cash Market (nse_cm)
    final = urls.find((u) => /nse/i.test(u) && /(cm|cash|eq)/i.test(u) && /\.csv(\.gz)?$/i.test(u));
  }

  // Final catch-all fallback
  final = final || urls.find(u => /\.csv(\.gz)?$/i.test(u)) || urls[0];
  
  console.log("🎯 [Final Selection]:", final);
  return final;
}



function parseScripMasterCsv(csvText) {
  console.log("📄 [Parser]: Starting CSV parse...");
  const lines = String(csvText).split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  
  // Minimal CSV parser logic
  const header = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  const iTrd = header.findIndex(h => /trdSym|pTrdSymbol|trading_symbol/i.test(h));
  const iName = header.findIndex(h => /pSymbolName|name|pDesc/i.test(h));

  console.log(`📊 [Parser]: Found columns - trdSymbol idx: ${iTrd}, name idx: ${iName}`);

  const rows = lines.slice(1).map(line => {
    const cols = line.split(",").map(v => v.replace(/^"|"$/g, "").trim());
    return {
      trdSymbol: cols[iTrd] || "",
      name: cols[iName] || "",
      exchSeg: "nse_cm"
    };
  }).filter(r => r.trdSymbol);

  console.log(`✅ [Parser]: Successfully parsed ${rows.length} rows`);
  return rows;
}

// Add isOptionChain = false to the parameters
async function fetchMasterScripCsvAndCache(force, session, isOptionChain = false) {
  const now = Date.now();
  
  // We need to distinguish the cache so they don't overwrite each other
  const cacheKey = isOptionChain ? "FO" : "CM";
  const age = now - SCRIP_CACHE.updatedAt;

  if (!force && SCRIP_CACHE.rows.length && age < CACHE_DURATION_MS && SCRIP_CACHE.type === cacheKey) {
    console.log(`⚡ [Cache Hit]: Using existing ${cacheKey} data`);
    return SCRIP_CACHE;
  }

  // ... (session check logic)

  const filePathsResp = await axios.get(filePathsUrl, { headers });
  const candidates = [];
  extractStringsDeep(filePathsResp.data, candidates);

  // PASS THE FLAG HERE
  const chosenUrl = chooseBestScripFileUrl(candidates, baseUrl, isOptionChain);

  // ... (download and parse logic)

  SCRIP_CACHE = { 
    updatedAt: now, 
    rows, 
    type: cacheKey, // Track which file is currently in memory
    meta: { sourceUrl: chosenUrl, count: rows.length } 
  };
  return SCRIP_CACHE;
}

// --------------------
// Routes
// --------------------

app.post("/api/auth/login", async (req, res) => {
  console.log("🔑 [Login]: Attempting login with TOTP...");
  try {
    const { totp } = req.body;
    const data = await loginWithTotp(totp);

    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000
    };

    res.cookie("sessionToken", data.sessionToken, cookieOptions);
    res.cookie("baseUrl", data.baseUrl, cookieOptions);
    if (data.sessionSid) res.cookie("sessionSid", data.sessionSid, cookieOptions);

    console.log("✅ [Login]: Success. Cookies set.");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ [Login Error]:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/session", (req, res) => {
  console.log("🔍 [Session Route]: Checking status...");
  const session = getSessionFromReq(req);
  res.json({ hasSession: !!(session.sessionToken && session.baseUrl) });
});

app.get("/api/option-chain", async (req, res) => {
  const { symbol } = req.query;
  console.log(`📈 [Option Chain]: Request for ${symbol}`);
  try {
    const session = getSessionFromReq(req);
    // CRITICAL: Pass 'true' as the third argument here
    const cache = await fetchMasterScripCsvAndCache(false, session, true);

    const results = cache.rows.filter(r => {
      const trd = r.trdSymbol.toUpperCase();
      return trd.startsWith(symbol.toUpperCase()) && (trd.endsWith("CE") || trd.endsWith("PE"));
    });

    console.log(`📊 [Option Chain]: Found ${results.length} contracts for ${symbol}`);
    res.json(results.slice(0, 100));
  } catch (err) {
    console.error("❌ [Option Chain Error]:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/symbols", async (req, res) => {
  const q = (req.query.q || "").toString().trim().toUpperCase();
  console.log(`🔎 [Symbol Search]: Query "${q}"`);
  try {
    const session = getSessionFromReq(req);
    const cache = await fetchMasterScripCsvAndCache(false, session);
    const matches = cache.rows
      .filter(r => r.trdSymbol.toUpperCase().includes(q) || r.name.toUpperCase().includes(q))
      .slice(0, 15);

    res.json(matches);
  } catch (err) {
    console.error("❌ [Symbol Error]:", err.message);
    res.status(401).json({ error: err.message });
  }
});

// For Vercel
module.exports = app;
