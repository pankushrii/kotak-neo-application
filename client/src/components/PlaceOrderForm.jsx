import React, { useState } from "react";
import { ApiClient } from "../apiClient";

export function PlaceOrderForm({ onOrderPlaced }) {
  const [symbol, setSymbol] = useState("RELIANCE-EQ");
  const [qty, setQty] = useState(1);
  const [side, setSide] = useState("BUY");
  const [product, setProduct] = useState("CNC");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async () => {
    setLoading(true);
    setMessage("");
    try {
      if (!symbol || qty <= 0) {
        setMessage("Please enter valid symbol and quantity.");
        setLoading(false);
        return;
      }

      const res = await ApiClient.placeOrder({
        trading_symbol: symbol.trim(),
        quantity: qty,
        side,
        product
      });

      setMessage("Order placed (request accepted).");
      onOrderPlaced && onOrderPlaced(res);
    } catch (e) {
      setMessage(e?.response?.data?.error || e.message || "Order placement failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Place Order</h2>
        <div className="muted">Market order · Equity</div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          abel>Symbol</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </div>

        <div className="form-row">
          abel>Quantity</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
        </div>

        <div className="form-row">
          abel>Side</label>
          <select value={side} onChange={(e) => setSide(e.target.value)}>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </div>

        <div className="form-row">
          abel>Product</label>
          <select value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="CNC">CNC</option>
            <option value="MIS">MIS</option>
            <option value="NRML">NRML</option>
          </select>
        </div>
      </div>

      <div className="btn-row">
        <button onClick={submit} disabled={loading}>
          {loading ? "Placing…" : "Place Order"}
        </button>
      </div>

      {message && <p className={message.includes("failed") ? "error" : "message"}>{message}</p>}
    </div>
  );
}
