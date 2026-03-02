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

function chooseBestScripFileUrl(candidates, baseUrl) {
  console.log(`🔍 https://www.wordwebonline.com/en/SELECTION: Analyzing ${candidates.length} candidates...`);
  const urls = candidates
    .filter(Boolean)
    .map((u) => {
      const s = String(u).trim();
      if (!s) return null;
      if (s.startsWith("http")) return s;
      return s.startsWith("/") ? `${baseUrl}${s}` : `${baseUrl}/${s}`;
    })
    .filter(Boolean);

  const preferred = urls.find((u) => /nse/i.test(u) && /(cm|cash|eq)/i.test(u) && /\.csv(\.gz)?$/i.test(u));
  const final = preferred || urls.find(u => /\.csv(\.gz)?$/i.test(u)) || urls[0];
  console.log("🎯 https://www.selected.com/:", final);
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

async function fetchMasterScripCsvAndCache(force, session) {
  const now = Date.now();
  const age = now - SCRIP_CACHE.updatedAt;

  if (!force && SCRIP_CACHE.rows.length && age < CACHE_DURATION_MS) {
    console.log(`⚡ [Cache Hit]: Using existing data (${SCRIP_CACHE.rows.length} rows, Age: ${Math.round(age/1000)}s)`);
    return SCRIP_CACHE;
  }

  console.log("🌐 [Cache Miss/Force]: Fetching fresh Scrip Master...");
  const baseUrl = session.baseUrl;
  if (!baseUrl) throw new Error("No baseUrl in session. Login first.");
  
  const headers = sessionHeadersOrThrow(session);
  const filePathsUrl = `${baseUrl}/script-details/1.0/masterscrip/file-paths`;

  console.log("🚀 [API Request]: GET file-paths...");
  const filePathsResp = await axios.get(filePathsUrl, { headers });
  
  const candidates = [];
  extractStringsDeep(filePathsResp.data, candidates);
  const chosenUrl = chooseBestScripFileUrl(candidates, baseUrl);

  if (!chosenUrl) throw new Error("Could not find CSV URL.");

  console.log("📥 [Download]: Starting file download...");
  const dl = await axios.get(chosenUrl, { responseType: "arraybuffer", timeout: 120000 });
  console.log(`📥 [Download]: Complete. Size: ${dl.data.length} bytes`);

  let bin = Buffer.from(dl.data);
  let csvText;
  if (/\.gz$/i.test(chosenUrl)) {
    console.log("🧩 [Decompress]: Gunzipping .gz file...");
    csvText = zlib.gunzipSync(bin).toString("utf-8");
  } else {
    csvText = bin.toString("utf-8");
  }

  const rows = parseScripMasterCsv(csvText);
  SCRIP_CACHE = { updatedAt: now, rows, meta: { sourceUrl: chosenUrl, count: rows.length } };
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
    const cache = await fetchMasterScripCsvAndCache(false, session);

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
