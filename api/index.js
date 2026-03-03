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

let SCRIP_CACHE = { updatedAt: 0, rows: [], type: null, meta: { sourceUrl: null, count: 0 } };
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

// --- Session Helpers ---
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

// --- Scrip Master Utilities ---

function chooseBestScripFileUrl(candidates, baseUrl, isOptionChain) {
  const urls = candidates.filter(Boolean).map(u => {
    const s = String(u).trim();
    if (s.startsWith("http")) return s;
    return s.startsWith("/") ? `${baseUrl}${s}` : `${baseUrl}/${s}`;
  });

  if (isOptionChain) {
    // Priority for nse_fo.csv for derivatives
    const foFile = urls.find(u => /nse_fo/i.test(u) || /nfo/i.test(u));
    if (foFile) return foFile;
  }
  return urls.find(u => /nse_cm/i.test(u) || /eq/i.test(u)) || urls[0];
}

function extractStringsDeep(x, out) {
  if (!x) return;
  if (typeof x === "string") { out.push(x); return; }
  if (Array.isArray(x)) { for (const v of x) extractStringsDeep(v, out); return; }
  if (typeof x === "object") { for (const k of Object.keys(x)) extractStringsDeep(x[k], out); }
}

/**
 * CORE PARSER: Extracts Index Options and Expiry
 */
function parseScripMasterCsv(csvText, isOptionChain) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  const iTrd = header.findIndex(h => /trdSym|pTrdSymbol|trading_symbol/i.test(h));
  const iName = header.findIndex(h => /pSymbolName|name|pDesc/i.test(h));
  const iInst = header.findIndex(h => /pInstType|instrument_type/i.test(h));
  const iToken = header.indexOf("pScripRefKey"); // This is your Token
  const iExch = header.indexOf("pExchSeg");
  const iPSymbol = header.indexOf("pSymbol");

  return lines.slice(1).map(line => {
    const cols = line.split(",").map(v => v.replace(/^"|"$/g, "").trim());
    const trdSymbol = cols[iTrd] || "";
    const instType = iInst >= 0 ? cols[iInst] : "";
    

    // If fetching Options, only keep Index Options (OPTIDX)
    if (isOptionChain && instType !== "OPTIDX") return null;

    let expiry = "";
    if (isOptionChain && trdSymbol) {
      // Extract expiry date code from symbol (e.g., 25N11 from NIFTY25N11...)
      const match = trdSymbol.match(/\d{2}[A-Z1-9]{3}/);
      expiry = match ? match[0] : "";
    }

    return {
      trdSymbol,
      name: cols[iName] || "",
      expiry,
      exchSeg: cols[iExch] || (isOptionChain ? "nse_fo" : "nse_cm"),
      token: cols[iToken] || "",
      pSymbol: cols[iPSymbol] || ""
      
    };
  }).filter(r => r !== null && r.trdSymbol);
}

async function fetchMasterScripCsvAndCache(force, session, isOptionChain = false) {
  console.log("fetchMasterScripCsvAndCache called");
  const now = Date.now();
  const targetType = isOptionChain ? "FO" : "CM";
  
  if (!force && SCRIP_CACHE.rows.length && SCRIP_CACHE.type === targetType && (now - SCRIP_CACHE.updatedAt < CACHE_DURATION_MS)) {
    console.log(`⚡ [Cache Hit]: Using ${targetType} data`);
    return SCRIP_CACHE;
  }

  const baseUrl = session.baseUrl;
  if (!baseUrl) throw new Error("No baseUrl in session. Login first.");
  const headers = sessionHeadersOrThrow(session);

  const filePathsUrl = `${baseUrl}/script-details/1.0/masterscrip/file-paths`;
  const filePathsResp = await axios.get(filePathsUrl, { headers });
  console.log("fetchMasterScripCsvAndCache Filepathresp");
  const candidates = [];
  extractStringsDeep(filePathsResp.data, candidates);
  const chosenUrl = chooseBestScripFileUrl(candidates, baseUrl, isOptionChain);

  const dl = await axios.get(chosenUrl, { responseType: "arraybuffer", timeout: 120000 });
  let bin = Buffer.from(dl.data);
  let csvText = /\.gz$/i.test(chosenUrl) ? zlib.gunzipSync(bin).toString("utf-8") : bin.toString("utf-8");

  // Call the newly defined parser
  const rows = parseScripMasterCsv(csvText, isOptionChain);
  SCRIP_CACHE = { 
    updatedAt: now, 
    rows, 
    type: targetType, 
    meta: { sourceUrl: chosenUrl, count: rows.length } 
  };
  return SCRIP_CACHE;
}


/**
 * Helper to convert NSE symbol date strings to Date objects
 * Formats handled: 
 * - Monthly: 26MAR (Year 26, Month MAR)
 * - Weekly: 26312 (Year 26, Month 3, Day 12)
 */
function parseExpiry(trdSymbol, indexName) {
  const datePart = trdSymbol.replace(indexName.toUpperCase(), "").match(/^[A-Z0-9]{5}/)?.[0];
  if (!datePart) return new Date(2099, 0, 1);

  const year = 2000 + parseInt(datePart.substring(0, 2));
  
  // Weekly Format: 26312 (Year 26, Month 3, Day 12)
  if (/^\d{5}$/.test(datePart)) {
    const month = parseInt(datePart.substring(2, 3), 16) - 1; // Handle Oct(O), Nov(N), Dec(D) if hex
    const day = parseInt(datePart.substring(3, 5));
    return new Date(year, month, day);
  }

  // Monthly Format: 26MAR (Year 26, Month MAR)
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const monthStr = datePart.substring(2, 5);
  const monthIdx = months.indexOf(monthStr);
  
  // Monthly expiries are usually the last Thursday
  return new Date(year, monthIdx, 28); 
}

/**
 * Updated Parser to extract date from the 'token' field: DDMMMYY (e.g., 17MAR26)
 */
function parseExpiryFromToken(tokenStr) {
  // Regex looks for 2 digits, 3 letters, 2 digits (e.g., 17MAR26)
  const match = tokenStr.toUpperCase().match(/(\d{2})([A-Z]{3})(\d{2})/);
  if (!match) return new Date(2099, 0, 1);

  const day = parseInt(match[1]);
  const monthStr = match[2];
  const year = 2000 + parseInt(match[3]);

  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const monthIdx = months.indexOf(monthStr);

  return new Date(year, monthIdx, day);
}

app.get("/api/option-chain", async (req, res) => {
  try {
    const { symbol, spotPrice } = req.query;
    const session = getSessionFromReq(req);
    const cache = await fetchMasterScripCsvAndCache(false, session, true);

    // --- DIAGNOSTIC LOG START ---
    if (cache.rows.length > 0) {
      console.log("📝 [Diagnostic] Total Rows:", cache.rows.length);
      console.log("📝 [Diagnostic] Keys found in Row 0:", Object.keys(cache.rows[0]));
      
      // Look for the first row that even mentions NIFTY to see what its 'name' is
      const sampleNifty = cache.rows.find(r => 
        JSON.stringify(r).toUpperCase().includes("NIFTY")
      );
      console.log("📝 [Diagnostic] Sample NIFTY Row Data:", JSON.stringify(sampleNifty));
    }
    // --- DIAGNOSTIC LOG END ---

    const spot = parseFloat(spotPrice);
    const range = 2000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const processed = cache.rows.map((r) => {
      // 1. Try to find the name in multiple possible keys
      const rowName = (r.name || r.pSymbolName || "").toString().trim().toUpperCase();
      const targetName = symbol.trim().toUpperCase();
      
      // 2. Try to find the token/scrip string in multiple possible keys
      const scripStr = (r.token || r.pScripRefKey || r.trdSymbol || "").toString().toUpperCase();

      if (rowName !== targetName) return null;

      // 3. Flexible Regex for Strike: Looking for numbers before CE/PE
      const strikeMatch = scripStr.match(/(\d+)(?:\.\d+)?(CE|PE)$/);
      if (!strikeMatch) return null;

      const strikeValue = parseFloat(strikeMatch[1]);
      if (strikeValue < (spot - range) || strikeValue > (spot + range)) return null;

      return {
        ...r,
        strike: strikeValue,
        type: strikeMatch[2],
        dateObj: parseExpiryFromToken(scripStr),
        scripStr // useful for debugging
      };
    }).filter(Boolean);

    console.log(`✅ [Step 1] Matches after Name/Strike filter: ${processed.length}`);

    const futureRows = processed
      .filter(r => r.dateObj >= today)
      .sort((a, b) => a.dateObj - b.dateObj);

    const uniqueDates = [...new Set(futureRows.map(r => r.dateObj.getTime()))].slice(0, 2);
    const finalData = futureRows.filter(r => uniqueDates.includes(r.dateObj.getTime()));

    res.json(finalData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const data = await loginWithTotp(req.body.totp);
    console.log("Data while login",data);
    const opt = { httpOnly: true, secure: true, sameSite: "none", maxAge: 24 * 60 * 60 * 1000 };
    // res.cookie("sessionToken", data.sessionToken, opt);
    res.cookie("sessionToken", data.token || data.sessionToken, opt);
    res.cookie("baseUrl", data.baseUrl, opt);
    res.cookie("sessionSid", data.sid || "none", opt);
    if (data.sessionSid) res.cookie("sessionSid", data.sessionSid, opt);
    res.json({ success: true });
  } catch (err) { 
    console.error("Errro while logging",err);
    res.status(500).json({ error: err.message }); }
});

app.get("/api/auth/session", (req, res) => {
  const s = getSessionFromReq(req);
  res.json({ hasSession: !!(s.sessionToken && s.baseUrl) });
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

app.post("/api/get-strike-prices", async (req, res) => {
  try {
    const { instrumentTokens } = req.body; 
    const session = getSessionFromReq(req);
    const headers = sessionHeadersOrThrow(session);

    // 1. Official v2 Path from settings.py
    const cleanBaseUrl = session.baseUrl.replace(/\/$/, "");
    const fullUrl = `${cleanBaseUrl}/quotes/v1/quotes`;

    console.log("🌐 [LTP Request] URL:", fullUrl);
    
    // 2. Format payload exactly as the v2 SDK does
    // It requires 'quote_type' to be sent to get LTP
    const payload = {
      instrumentTokens: instrumentTokens.map(t => ({
        instrumentToken: String(t.instrument_token || t.instrumentToken),
        exchangeSegment: t.exchange_segment || t.exchangeSegment
      })),
      quoteType: "ltp" // This tells the API to return the Last Traded Price
    };

    const response = await axios.post(fullUrl, payload, { headers });

    // 3. The response structure for v2 is usually { "data": [ ... ] }
    // but Kotak sometimes nests it under "message"
    res.json(response.data);

  } catch (err) {
    if (err.response) {
      console.error("❌ [Kotak API Error]:", err.response.status, JSON.stringify(err.response.data));
      return res.status(err.response.status).json(err.response.data);
    }
    res.status(500).json({ error: err.message });
  }
});

// Ensure this specific route exists
app.post("/api/place-order", async (req, res) => {
  try {
    const session = getSessionFromReq(req);
    const orderData = req.body; // {trading_symbol, quantity, side, product}

    console.log("🍪 [Incoming Cookies]:", JSON.stringify(req.cookies));

  // LOG 2: Check parsed session object
  console.log("👤 [Parsed Session]:", {
    hasToken: !!session.sessionToken,
    hasBaseUrl: !!session.baseUrl,
    sid: session.sessionSid || 'none'
  });
    console.log("📦 [API]: Placing order for", orderData.trading_symbol);
    
    // Call your Kotak Client logic
    const result = await placeOrder(orderData, session);
    console.log("📦 [API]: Placing order Results", result);
    res.json(result);
  } catch (err) {
    console.log("[Order Error]", err.message);
    console.error("❌ [Order Error]:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/get-ltp", async (req, res) => {
  try {
    // Frontend should pass: ?pSymbol=62926&exchange=nse_fo
    const { pSymbol, exchange = "nse_fo" } = req.query;
    const session = getSessionFromReq(req);
    const headers = sessionHeadersOrThrow(session);

    if (!pSymbol) {
      return res.status(400).json({ error: "pSymbol query parameter is required" });
    }

    // Dynamic URL construction based on your discovery
    const cleanBaseUrl = session.baseUrl.replace(/\/$/, "");
    const fullUrl = `${cleanBaseUrl}/script-details/1.0/quotes/neosymbol/${exchange}|${pSymbol}/ltp`;

    console.log("🌐 [LTP Request] URL:", fullUrl);

    const response = await axios.get(fullUrl, { headers });

    console.log("✅ [LTP Response] Status:", response.status);
    res.json(response.data);

  } catch (err) {
    if (err.response) {
      console.error("❌ [Kotak API Error]:", err.response.status, err.response.data);
      return res.status(err.response.status).json(err.response.data);
    }
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/positions", async (req, res) => {
  try {
    const session = getSessionFromReq(req);
    const headers = sessionHeadersOrThrow(session);
    
    // Construct and log the URL
    const cleanBaseUrl = session.baseUrl.replace(/\/$/, "");
    const url = `${cleanBaseUrl}/quick/user/positions`;
    
    console.log("📂 [Positions] Fetching from:", url+ "Headers ",headers);
    // console.log("🔑 [Positions] Headers:", JSON.stringify(headers)); // Uncomment for deep auth debugging

    const response = await axios.get(url, { headers });
    
    // LOG: See the raw structure to find where 'positions' live
    console.log("📥 [Positions] Raw Response Keys:", Object.keys(response.data));

    // Kotak Neo sometimes uses 'data', sometimes 'success' inside a 'message'
    const positions = response.data?.data || 
                      response.data?.success || 
                      response.data?.message || [];

    console.log(`✅ [Positions] Successfully retrieved ${Array.isArray(positions) ? positions.length : 0} items.`);
    
    res.json(positions);
  } catch (err) {
    // Detailed Error Logging
    if (err.response) {
      console.error("❌ [Positions API Error] Status:", err.response.status);
      console.error("❌ [Positions API Error] Body:", JSON.stringify(err.response.data));
    } else {
      console.error("❌ [Positions Local Error]:", err.message);
    }
    console.error("❌ [Positions  Error]:", err);
    res.status(500).json({ error: err.message });
  }
});
module.exports = app;
