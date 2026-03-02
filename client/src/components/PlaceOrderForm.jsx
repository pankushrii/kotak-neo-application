import React, { useEffect, useRef, useState } from "react";
import { ApiClient } from "../apiClient";

export function PlaceOrderForm({ onOrderPlaced }) {
  const [symbol, setSymbol] = useState("RELIANCE-EQ");
  const [qty, setQty] = useState(1);
  const [side, setSide] = useState("BUY");
  const [product, setProduct] = useState("CNC"); // Change to MIS or NRML for F&O
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Option Chain States
  const [viewMode, setViewMode] = useState("SEARCH"); // SEARCH or OPTION_CHAIN
  const [optionIndex, setOptionIndex] = useState("NIFTY");
  const [chainData, setChainData] = useState([]);
  const [chainLoading, setChainLoading] = useState(false);

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const debounceRef = useRef(null);

  // Effect for standard symbol search
  useEffect(() => {
    if (viewMode !== "SEARCH") return;
    const q = symbol.trim();
    if (!q || q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const data = await ApiClient.searchSymbols(q);
        setSuggestions(data || []);
        setShowSuggestions(true);
      } catch (err) {
        setSuggestions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 220);

    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [symbol, viewMode]);

  // Effect to fetch Option Chain
  useEffect(() => {
    if (viewMode !== "OPTION_CHAIN") return;

    const fetchChain = async () => {
      setChainLoading(true);
      setMessage("Downloading/Filtering Scrip Master..."); // Important for the first load
      try {
        const data = await ApiClient.getOptionChain(optionIndex);
        setChainData(data || []);
        setMessage("");
      } catch (err) {
        setMessage("Failed to load option chain.");
      } finally {
        setChainLoading(false);
      }
    };
    fetchChain();
  }, [optionIndex, viewMode]);

  const submit = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await ApiClient.placeOrder({
        trading_symbol: symbol.trim(),
        quantity: Number(qty),
        side,
        product
      });
      setMessage("Order placed successfully.");
      if (onOrderPlaced) onOrderPlaced(res);
    } catch (e) {
      setMessage(e?.response?.data?.error || e.message || "Order failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Place Order</h2>
        <div className="mode-toggle">
          <button 
            className={viewMode === "SEARCH" ? "active" : ""} 
            onClick={() => setViewMode("SEARCH")}
          >Search Stocks</button>
          <button 
            className={viewMode === "OPTION_CHAIN" ? "active" : ""} 
            onClick={() => {
              setViewMode("OPTION_CHAIN");
              setProduct("NRML"); // Default to NRML for Options
            }}
          >Option Chain</button>
        </div>
      </div>

      <div className="form-grid">
        {viewMode === "SEARCH" ? (
          <div className="form-row symbol-field">
            <label>Search Symbol</label>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. RELIANCE-EQ"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="suggest-box">
                {suggestions.map((s, idx) => (
                  <div key={idx} className="suggest-item" onClick={() => { setSymbol(s.trdSymbol); setShowSuggestions(false); }}>
                    {s.trdSymbol} <small>{s.name}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="form-row">
            <label>Index & Strike</label>
            <div className="chain-selector">
              <select value={optionIndex} onChange={(e) => setOptionIndex(e.target.value)}>
                <option value="NIFTY">NIFTY</option>
                <option value="BANKNIFTY">BANKNIFTY</option>
                <option value="SENSEX">SENSEX</option>
              </select>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                <option value="">-- Select Strike --</option>
                {chainData.map((opt, idx) => (
                  <option key={idx} value={opt.trdSymbol}>{opt.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="form-row">
          <label>Quantity</label>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
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
            <option value="MIS">MIS (Intraday)</option>
            <option value="NRML">NRML (Overnight)</option>
          </select>
        </div>
      </div>

      <div className="btn-row">
        <button onClick={submit} disabled={loading || !symbol}>
          {loading ? "Processing..." : `${side} ${symbol || "Order"}`}
        </button>
      </div>

      {message && <p className="message">{message}</p>}
    </div>
  );
}
