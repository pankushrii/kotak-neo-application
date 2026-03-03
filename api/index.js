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

// --- Endpoints ---
app.get("/api/option-chain", async (req, res) => {
  try {
    const { symbol, spotPrice } = req.query; // spotPrice passed from frontend
    const session = getSessionFromReq(req);
    console.log(`📈 [Frontend]: Fetching Option Chain for ${symbol} around ${spotPrice}...`);
    const cache = await fetchMasterScripCsvAndCache(false, session, true);

    if (!symbol || !spotPrice) {
      return res.status(400).json({ error: "Symbol and spotPrice are required" });
    }

    const currentMonth = new Date().toLocaleString('en-us', { month: 'short' }).toUpperCase();
    const spot = parseFloat(spotPrice);
    const range = 2000;

    const filtered = cache.rows.filter(r => {
      const ts = r.trdSymbol.toUpperCase();
      
      // 1. Must be the requested Index
      if (!ts.startsWith(symbol.toUpperCase())) return false;
      
      // 2. Must be Current Month
      if (!r.expiry.includes(currentMonth)) return false;

      // 3. Extract Strike Price from symbol (e.g., NIFTY26MAR2619500CE -> 19500)
      // Regex looks for digits between the date and the CE/PE suffix
      const strikeMatch = ts.match(/[A-Z](\d+)(?:CE|PE)$/);
      if (!strikeMatch) return false;
      
      const strike = parseFloat(strikeMatch[1]);

      // 4. Check if Strike is within ± 2000 points
      return strike >= (spot - range) && strike <= (spot + range);
    });

    // Sort by Strike Price for a better UI experience
    filtered.sort((a, b) => {
      const strikeA = parseInt(a.trdSymbol.match(/\d+(?=CE|PE)/));
      const strikeB = parseInt(b.trdSymbol.match(/\d+(?=CE|PE)/));
      return strikeA - strikeB;
    });

    console.log(`📊 [Option Chain]: Found ${filtered.length} strikes for ${symbol} within ±2000 range.`);
    res.json(filtered);
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
    const url = `${cleanBaseUrl}/portfolio/v1/positions`;
    
    console.log("📂 [Positions] Fetching from:", url);
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
    res.status(500).json({ error: err.message });
  }
});
module.exports = app;
