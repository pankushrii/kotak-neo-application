const express = require("express");
const cors = require("cors");
const axios = require("axios");
const zlib = require("zlib");
const cookieParser = require("cookie-parser");

const { apiConfig } = require("./kotakConfig");
const { loginWithTotp, placeOrder, getOrders, getPositions } = require("./kotakClient");

const app = express();

app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// --------------------
// Global Cache State
// --------------------
let SCRIP_CACHE = {
  updatedAt: 0,
  rows: [],
  type: null, // Tracks if currently loaded file is "CM" (Cash) or "FO" (F&O)
  meta: { sourceUrl: null, count: 0 }
};

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

// --------------------
// Helpers
// --------------------
function getSessionFromReq(req) {
  return {
    baseUrl: req.cookies.baseUrl,
    sessionToken: req.cookies.sessionToken,
    sessionSid: req.cookies.sessionSid
  };
}

function sessionHeadersOrThrow(session) {
  if (!session.sessionToken) throw new Error("No sessionToken. Login first.");
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "neo-fin-key": apiConfig.neoFinKey,
    Auth: session.sessionToken,
    Authorization: apiConfig.accessToken,
    ...(session.sessionSid && { sid: session.sessionSid })
  };
}

// Fixed selection logic to prioritize F&O file for Option Chain
function chooseBestScripFileUrl(candidates, baseUrl, isOptionChain) {
  const urls = candidates.filter(Boolean).map(u => {
    const s = String(u).trim();
    if (s.startsWith("http")) return s;
    return s.startsWith("/") ? `${baseUrl}${s}` : `${baseUrl}/${s}`;
  });

  if (isOptionChain) {
    // Look specifically for nse_fo (Derivatives)
    const foFile = urls.find(u => /nse_fo/i.test(u) || /nfo/i.test(u));
    if (foFile) return foFile;
  }

  // Fallback to Cash Market
  return urls.find(u => /nse_cm/i.test(u) || /eq/i.test(u)) || urls[0];
}

// Recursively extract all strings from API response
function extractStringsDeep(x, out) {
  if (!x) return;
  if (typeof x === "string") { out.push(x); return; }
  if (Array.isArray(x)) { for (const v of x) extractStringsDeep(v, out); return; }
  if (typeof x === "object") { for (const k of Object.keys(x)) extractStringsDeep(x[k], out); }
}

async function fetchMasterScripCsvAndCache(force, session, isOptionChain = false) {
  const now = Date.now();
  const targetType = isOptionChain ? "FO" : "CM";
  
  // Use cache only if type matches and it's fresh
  if (!force && SCRIP_CACHE.rows.length && SCRIP_CACHE.type === targetType && (now - SCRIP_CACHE.updatedAt < CACHE_DURATION_MS)) {
    console.log(`⚡ [Cache Hit]: Using ${targetType} data`);
    return SCRIP_CACHE;
  }

  const baseUrl = session.baseUrl;
  if (!baseUrl) throw new Error("No baseUrl in session. Login first.");
  const headers = sessionHeadersOrThrow(session);

  // FIXED: Explicitly define filePathsUrl before use
  const filePathsUrl = `${baseUrl}/script-details/1.0/masterscrip/file-paths`;
  console.log(`🚀 [API Request]: Fetching paths from ${filePathsUrl}`);
  
  const filePathsResp = await axios.get(filePathsUrl, { headers });
  const candidates = [];
  extractStringsDeep(filePathsResp.data, candidates);
  
  const chosenUrl = chooseBestScripFileUrl(candidates, baseUrl, isOptionChain);
  console.log(`🎯 [File Selected]: ${chosenUrl}`);

  const dl = await axios.get(chosenUrl, { responseType: "arraybuffer", timeout: 120000 });
  let bin = Buffer.from(dl.data);
  let csvText = /\.gz$/i.test(chosenUrl) ? zlib.gunzipSync(bin).toString("utf-8") : bin.toString("utf-8");

  // Parse Lines
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  const iTrd = header.findIndex(h => /trdSym|pTrdSymbol|trading_symbol/i.test(h));
  const iName = header.findIndex(h => /pSymbolName|name|pDesc/i.test(h));

  const rows = lines.slice(1).map(line => {
    const cols = line.split(",").map(v => v.replace(/^"|"$/g, "").trim());
    const trdSymbol = cols[iTrd] || "";

    // --- MINIMAL CHANGE: Extract Expiry ---
    let expiry = "";
    if (isOptionChain && trdSymbol) {
      // Matches pattern like 26MAR26 or 05MAR26
      const match = trdSymbol.match(/\d{2}[A-Z]{3}\d{2}/);
      expiry = match ? match[0] : "";
    }
    return {
      trdSymbol,
      name: cols[iName] || "",
      expiry, // Now included in the response
      exchSeg: isOptionChain ? "nse_fo" : "nse_cm"
    };
  }).filter(r => r.trdSymbol);
  
  SCRIP_CACHE = { 
    updatedAt: now, 
    rows, 
    type: targetType, 
    meta: { sourceUrl: chosenUrl, count: rows.length } 
  };
  return SCRIP_CACHE;
}

// --------------------
// Endpoints
// --------------------

app.post("/api/auth/login", async (req, res) => {
  try {
    const data = await loginWithTotp(req.body.totp);
    const opt = { httpOnly: true, secure: true, sameSite: "none", maxAge: 24 * 60 * 60 * 1000 };
    res.cookie("sessionToken", data.sessionToken, opt);
    res.cookie("baseUrl", data.baseUrl, opt);
    if (data.sessionSid) res.cookie("sessionSid", data.sessionSid, opt);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/auth/session", (req, res) => {
  const s = getSessionFromReq(req);
  res.json({ hasSession: !!(s.sessionToken && s.baseUrl) });
});

app.get("/api/option-chain", async (req, res) => {
  try {
    const { symbol } = req.query; // e.g. NIFTY
    const session = getSessionFromReq(req);
    // Force isOptionChain = true to get the NFO file
    const cache = await fetchMasterScripCsvAndCache(false, session, true);

    const filtered = cache.rows.filter(r => {
      const ts = r.trdSymbol.toUpperCase();
      // Match Index name and ensure it ends with CE or PE
      return ts.startsWith(symbol.toUpperCase()) && (ts.endsWith("CE") || ts.endsWith("PE"));
    });

    console.log(`📊 [Option Chain]: Found ${filtered.length} strikes for ${symbol}`);
    res.json(filtered.slice(0, 150));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/symbols", async (req, res) => {
  try {
    const q = (req.query.q || "").toUpperCase();
    const session = getSessionFromReq(req);
    const cache = await fetchMasterScripCsvAndCache(false, session, false);
    const matches = cache.rows.filter(r => r.trdSymbol.toUpperCase().includes(q)).slice(0, 15);
    res.json(matches);
  } catch (err) { res.status(401).json({ error: err.message }); }
});

module.exports = app;
