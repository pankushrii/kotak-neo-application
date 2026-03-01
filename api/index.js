// api/index.js

const express = require("express");
const cors = require("cors");
const { clear, getSession } = require("./sessionStore");
const {
  loginWithTotp,
  placeOrder,
  getOrders,
  getPositions,
  searchScrip
} = require("./kotakClient");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// -------- Auth (TOTP only) --------

app.post("/api/auth/login", async (req, res) => {
  try {
    const { totp } = req.body || {};
    if (!totp) {
      return res.status(400).json({ error: "totp is required" });
    }

    const data = await loginWithTotp(totp);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error("Login error", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data || err.message || "Login failed"
    });
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
  res.json({ success: true });
});

// -------- Orders --------

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
      return res
        .status(400)
        .json({ error: "trading_symbol, quantity, side are required" });
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
    console.error("Order error", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data || err.message || "Order failed"
    });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const data = await getOrders();
    res.json(data);
  } catch (err) {
    console.error("Orders error", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data || err.message || "Orders fetch failed"
    });
  }
});

// -------- Positions --------

app.get("/api/positions", async (req, res) => {
  try {
    const data = await getPositions();
    res.json(data);
  } catch (err) {
    console.error("Positions error", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data || err.message || "Positions fetch failed"
    });
  }
});

// -------- Symbol search (autosuggest) --------
//
// Frontend calls: GET /api/symbols?q=...

app.get("/api/symbols", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    if (!q || q.length < 2) {
      return res.json([]);
    }

    const data = await searchScrip({
      exchange_segment: "nse_cm",
      symbol: q.toUpperCase()
    });

    const rows = Array.isArray(data) ? data : data?.data || [];

    const mapped = rows.slice(0, 15).map((s) => ({
      trdSymbol: s.pTrdSymbol || s.trading_symbol || "",
      name: s.pSymbolName || s.pDesc || "",
      exchSeg: s.pExchSeg || s.exchange_segment || "nse_cm"
    }));

    res.json(mapped);
  } catch (err) {
    console.error(
      "Symbol search error =>",
      err.response?.status,
      err.response?.data || err.message
    );
    res.status(500).json({ error: "Symbol search failed" });
  }
});


// Local dev server (not used on Vercel)
if (process.env.NODE_ENV === "development") {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log("API listening on", port);
  });
}

// For Vercel serverless
module.exports = app;
