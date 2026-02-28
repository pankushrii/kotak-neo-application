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
      if (!symbol || Number(qty) <= 0) {
        setMessage("Please enter a valid symbol and quantity.");
        return;
      }

      const res = await ApiClient.placeOrder({
        trading_symbol: symbol.trim(),
        quantity: Number(qty),
        side,
        product
      });

      setMessage("Order placed (request accepted).");
      if (onOrderPlaced) onOrderPlaced(res);
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
          <label>Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="RELIANCE-EQ"
          />
        </div>

        <div className="form-row">
          <label>Quantity</label>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>

        <div className="form-row">
          <label>Side</label>
          <select value={side} onChange={(e) => setSide(e.target.value)}>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </div>

        <div className="form-row">
          <label>Product</label>
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

      {message && (
        <p className={message.toLowerCase().includes("fail") ? "error" : "message"}>
          {message}
        </p>
      )}
    </div>
  );
}
