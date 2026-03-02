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
  origin: true, // Set this to your frontend URL in production
  credentials: true 
}));
app.use(express.json());

// --------------------
// Scrip master cache (Stays in memory for the duration of the Lambda execution)
// --------------------
let SCRIP_CACHE = {
  updatedAt: 0,
  rows: [],
  meta: { sourceUrl: null, count: 0 }
};

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

// --------------------
// Session Helpers (Reading from Cookies)
// --------------------
function getSessionFromRequest(req) {
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
  const urls = candidates
    .filter(Boolean)
    .map((u) => {
      const s = String(u).trim();
      if (!s) return null;
      if (s.startsWith("http")) return s;
      return s.startsWith("/") ? `${baseUrl}${s}` : `${baseUrl}/${s}`;
    })
    .filter(Boolean);

  const csvLike = urls.filter((u) => /\.csv(\.gz)?$/i.test(u));
  const pool = csvLike.length ? csvLike : urls;
  const preferred = pool.find((u) => /nse/i.test(u) && /(cm|cash|eq)/i.test(u) && /\.csv(\.gz)?$/i.test(u));
  return preferred || pool[0] || null;
}

function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } 
      else { inQuotes = !inQuotes; }
      continue;
    }
    if (ch === "," && !inQuotes) { result.push(cur); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur);
  return result.map((s) => s.trim());
}

function parseScripMasterCsv(csvText) {
  const lines = String(csvText).split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, ""));
  const idx = (n) => header.findIndex(h => h.toLowerCase() === n.toLowerCase());

  const iTrd = [idx("pTrdSymbol"), idx("trdSym"), idx("trading_symbol")].find(i => i >= 0);
  const iName = [idx("pSymbolName"), idx("name"), idx("pDesc")].find(i => i >= 0);
  const iSeg = [idx("pExchSeg"), idx("exchange_segment"), idx("exchSeg")].find(i => i >= 0);

  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line).map(v => v.replace(/^"|"$/g, ""));
    return {
      trdSymbol: iTrd >= 0 ? cols[iTrd] : cols[1] || "",
      name: iName >= 0 ? cols[iName] : cols[2] || "",
      exchSeg: iSeg >= 0 ? cols[iSeg] : "nse_cm"
    };
  }).filter(r => r.trdSymbol);
}

async function fetchMasterScripCsvAndCache(force, session) {
  const now = Date.now();
  if (!force && SCRIP_CACHE.rows.length && (now - SCRIP_CACHE.updatedAt < CACHE_DURATION_MS)) {
    return SCRIP_CACHE;
  }

  const baseUrl = session.baseUrl;
  if (!baseUrl) throw new Error("No baseUrl in session. Login first.");
  const headers = sessionHeadersOrThrow(session);

  const filePathsUrl = `${baseUrl}/script-details/1.0/masterscrip/file-paths`;
  const filePathsResp = await axios.get(filePathsUrl, { headers });

  const candidates = [];
  extractStringsDeep(filePathsResp.data, candidates);
  const chosenUrl = chooseBestScripFileUrl(candidates, baseUrl);

  if (!chosenUrl) throw new Error("Could not find CSV URL.");

  const dl = await axios.get(chosenUrl, { responseType: "arraybuffer", timeout: 120000 });
  let bin = Buffer.from(dl.data);
  let csvText = /\.gz$/i.test(chosenUrl) ? zlib.gunzipSync(bin).toString("utf-8") : bin.toString("utf-8");

  const rows = parseScripMasterCsv(csvText);
  SCRIP_CACHE = { updatedAt: now, rows, meta: { sourceUrl: chosenUrl, count: rows.length } };
  return SCRIP_CACHE;
}

// --------------------
// Routes
// --------------------
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/auth/login", async (req, res) => {
  try {
    const { totp } = req.body;
    if (!totp) return res.status(400).json({ error: "totp required" });

    const data = await loginWithTotp(totp);

    const cookieOptions = {
      httpOnly: true,
      secure: true, // Set to false if testing on localhost without SSL
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000
    };

    res.cookie("sessionToken", data.sessionToken, cookieOptions);
    res.cookie("baseUrl", data.baseUrl, cookieOptions);
    if (data.sessionSid) res.cookie("sessionSid", data.sessionSid, cookieOptions);

    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fixes the 404 in your second screenshot
app.get("/api/auth/session", (req, res) => {
  const session = getSessionFromReq(req);
  res.json({
    hasSession: !!(session.sessionToken && session.baseUrl),
  });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("sessionToken");
  res.clearCookie("baseUrl");
  res.clearCookie("sessionSid");
  res.json({ success: true });
});

app.get("/api/symbols", async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    const q = (req.query.q || "").toString().trim().toUpperCase();
    if (q.length < 2) return res.json([]);

    const cache = await fetchMasterScripCsvAndCache(false, session);
    const matches = cache.rows
      .filter(r => r.trdSymbol.toUpperCase().includes(q) || r.name.toUpperCase().includes(q))
      .slice(0, 15);

    res.json(matches);
  } catch (err) {
    console.error("Symbol search failed:", err.message);
    res.status(401).json({ error: err.message });
  }
});

// Update standard routes to use cookies
app.get("/api/orders", async (req, res) => {
  try {
    // Note: getOrders() in kotakClient needs to be updated to accept session 
    // or you can manually call axios here using sessionHeadersOrThrow(getSessionFromRequest(req))
    const data = await getOrders(); 
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Local dev only
if (process.env.NODE_ENV === "development") {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log("API listening on", port));
}

module.exports = app;
