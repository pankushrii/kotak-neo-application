import React, { useState } from "react";
import { ApiClient } from "../apiClient";

export function PlaceOrderForm({ onOrderPlaced }) {
  const [symbol, setSymbol] = useState("RELIANCE-EQ");
  const [qty, setQty] = useState(1);
  const [side, setSide] = useState("BUY");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await ApiClient.placeOrder({
        trading_symbol: symbol,
        quantity: qty,
        side
      });
      setMessage("Order placed successfully.");
      onOrderPlaced(res);
    } catch (e) {
      setMessage(
        e.response?.data?.error || e.message || "Order placement failed."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Place Order</h2>
      <div className="form-row">
        <label>Symbol</label>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="e.g. RELIANCE-EQ"
        />
      </div>
      <div className="form-row">
        <label>Quantity</label>
        <input
          type="number"
          value={qty}
          min={1}
          onChange={(e) => setQty(Number(e.target.value))}
        />
      </div>
      <div className="form-row">
        <label>Side</label>
        <select value={side} onChange={(e) => setSide(e.target.value)}>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
        </select>
      </div>
      <button onClick={submit} disabled={loading}>
        {loading ? "Placing..." : "Place Order"}
      </button>
      {message && <p className="message">{message}</p>}
    </div>
  );
}
