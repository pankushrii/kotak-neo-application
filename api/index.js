const express = require("express");
const cors = require("cors");
const {
  kotakLogin,
  placeOrder,
  getPositions,
  getOrders
} = require("./kotakClient");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Login – user passes TOTP from Google Authenticator.
app.post("/api/auth/login", async (req, res) => {
  try {
    const { totp } = req.body;
    if (!totp) {
      return res.status(400).json({ error: "totp is required" });
    }
    const data = await kotakLogin({ totp });
    res.json({ success: true, ...data });
  } catch (err) {
    console.error("Login error", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.message || err.message || "Login failed"
    });
  }
});

// Place basic market order.
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
    } = req.body;

    if (!trading_symbol || !quantity || !side) {
      return res
        .status(400)
        .json({ error: "trading_symbol, quantity, side required" });
    }

    const payload = {
      trading_symbol,
      quantity: String(quantity),
      transaction_type: side === "BUY" ? "B" : "S",
      exchange_segment,
      product,
      order_type,
      validity,
      price: "0",
      amo: "NO",
      disclosed_quantity: "0",
      market_protection: "0",
      pf: "N",
      trigger_price: "0"
    };

    const data = await placeOrder(payload);
    res.json(data);
  } catch (err) {
    console.error("Order error", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.message || err.message || "Order failed"
    });
  }
});

app.get("/api/positions", async (req, res) => {
  try {
    const data = await getPositions();
    res.json(data);
  } catch (err) {
    console.error("Positions error", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data?.message || err.message || "Positions failed"
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
      error: err.response?.data?.message || err.message || "Orders fetch failed"
    });
  }
});

// Local dev server.
if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log("API listening on", port));
}

// For Vercel serverless.
module.exports = app;
