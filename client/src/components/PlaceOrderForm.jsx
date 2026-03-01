import React, { useEffect, useRef, useState } from "react";
import { ApiClient } from "../apiClient";

export function PlaceOrderForm({ onOrderPlaced }) {
  const [symbol, setSymbol] = useState("RELIANCE-EQ");
  const [qty, setQty] = useState(1);
  const [side, setSide] = useState("BUY");
  const [product, setProduct] = useState("CNC");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  // Debounced symbol search
  useEffect(() => {
    const q = symbol.trim();
    if (!q || q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const data = await ApiClient.searchSymbols(q);
        setSuggestions(data || []);
        setShowSuggestions(true);
      } catch (err) {
        console.error("Symbol search failed", err);
        setSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setSearchLoading(false);
      }
    }, 220);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [symbol]);

  const handleSelectSuggestion = (s) => {
    setSymbol(s.trdSymbol || s.name || "");
    setShowSuggestions(false);
  };

  const handleBlur = () => {
    // small delay so click on suggestion still works
    setTimeout(() => setShowSuggestions(false), 150);
  };

  const submit = async () => {
    setLoading(true);
    setMessage("");
    try {
      if (!symbol || Number(qty) <= 0) {
        setMessage("Please enter a valid symbol and quantity.");
        setLoading(false);
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
        <div className="muted">Start typing to search symbols.</div>
      </div>

      <div className="form-grid">
        <div className="form-row symbol-field">
          <label>Symbol</label>
          <input
            ref={inputRef}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onFocus={() => symbol.length >= 2 && setShowSuggestions(true)}
            onBlur={handleBlur}
            placeholder="RELIANCE-EQ"
          />
          {searchLoading && <div className="spinner" />}

          {showSuggestions && suggestions.length > 0 && (
            <div className="suggest-box">
              {suggestions.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="suggest-item"
                  onMouseDown={() => handleSelectSuggestion(s)}
                >
                  <div className="suggest-symbol">{s.trdSymbol}</div>
                  <div className="suggest-sub">
                    {s.name} · {s.exchSeg}
                  </div>
                </button>
              ))}
            </div>
          )}

          {showSuggestions && !searchLoading && suggestions.length === 0 && (
            <div className="suggest-box empty">
              <div className="suggest-sub">No matches for “{symbol}”.</div>
            </div>
          )}
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
