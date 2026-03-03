import React, { useEffect, useRef, useState } from "react";
import { ApiClient } from "../apiClient";

export function PlaceOrderForm({ onOrderPlaced }) {
  // --- Core Form State ---
  const [symbol, setSymbol] = useState("");
  const [qty, setQty] = useState(1);
  const [side, setSide] = useState("BUY");
  const [product, setProduct] = useState("CNC");
  
  // --- Price & Order Type State ---
  const [priceType, setPriceType] = useState("MKT");
  const [price, setPrice] = useState("");
  const [ltp, setLtp] = useState(null);

  // --- UI & View State ---
  const [viewMode, setViewMode] = useState("SEARCH");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" }); // type: "success" or "error"

  // --- Option Chain State ---
  const [optionIndex, setOptionIndex] = useState("NIFTY");
  const [spotPrice, setSpotPrice] = useState(25000); 
  const [chainData, setChainData] = useState([]);
  const [strikeFilter, setStrikeFilter] = useState("");

  // --- Search & Suggestion State ---
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef(null);

  // 1. Symbol Search Logic (Debounced)
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
      try {
        const data = await ApiClient.searchSymbols(q);
        setSuggestions(data || []);
        setShowSuggestions(true);
      } catch (err) {
        setSuggestions([]);
      }
    }, 250);
    
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [symbol, viewMode]);

  // 2. Option Chain Fetching
  useEffect(() => {
    if (viewMode !== "OPTION_CHAIN") return;
    const fetchChain = async () => {
      try {
        const data = await ApiClient.getOptionChain(optionIndex, spotPrice);
        setChainData(data || []);
      } catch (err) {
        setMessage({ text: "Failed to load option chain.", type: "error" });
      }
    };
    fetchChain();
  }, [optionIndex, viewMode, spotPrice]);

  // 3. Live LTP Fetching (Immediate + Polls every 5s)
  useEffect(() => {
    if (!symbol) {
      setLtp(null);
      return;
    }
    
    const fetchPrice = async () => {
      try {
        const selectedOpt = viewMode === "OPTION_CHAIN" 
          ? chainData.find(o => o.trdSymbol === symbol) 
          : suggestions.find(o => o.trdSymbol === symbol);

        if (selectedOpt && selectedOpt.token) {
          
          // Show a loading indicator immediately if we don't have a price yet
          setLtp(prev => prev ? prev : "..."); 

          const data = await ApiClient.getPrice(selectedOpt.token, selectedOpt.exchSeg || selectedOpt.exch || "nse_fo");
          
          // Robustly extract the price based on Kotak's array response
          const latestPrice = data?.data?.[0]?.ltp || data?.success?.[0]?.lastPrice || data?.[0]?.ltp;
          
          if (latestPrice) {
            setLtp(latestPrice);
            // Auto-fill the price input if Market is selected
            if (priceType === "MKT") setPrice(latestPrice);
          } else {
            setLtp("N/A");
          }
        }
      } catch (err) {
        console.error("LTP Fetch error", err);
        setLtp("Error");
      }
    };

    // 1. Fetch immediately as soon as the dropdown changes
    fetchPrice();

  }, [symbol, chainData, viewMode, priceType]);

  // Filter option chain based on user input
  const filteredChain = chainData.filter(opt => 
    opt.trdSymbol.toLowerCase().includes(strikeFilter.toLowerCase())
  );

  // 4. Submit Order
  const submit = async () => {
    setLoading(true);
    setMessage({ text: "", type: "" });
    try {
      const res = await ApiClient.placeOrder({
        trading_symbol: symbol.trim(),
        quantity: Number(qty),
        side,
        product,
        priceType,
        price: priceType === "MKT" ? ltp : Number(price),
        ltp
      });
      setMessage({ text: `Order placed successfully! ID: ${res.data?.success?.NSE?.orderId || 'Confirmed'}`, type: "success" });
      if (onOrderPlaced) onOrderPlaced(res);
    } catch (e) {
      setMessage({ text: e?.response?.data?.error || e.message || "Order failed.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

return (
    <div className="container" style={{ padding: '0px' }}>
      <div className="card">
        {/* Card Header & View Toggle */}
        <div className="card-head">
          <h2>Place Order</h2>
          <div className="mode-toggle">
            <button 
              className={viewMode === "SEARCH" ? "active" : ""} 
              onClick={() => { setViewMode("SEARCH"); setSymbol(""); setShowSuggestions(false); }}
            >
              Search Stocks
            </button>
            <button 
              className={viewMode === "OPTION_CHAIN" ? "active" : ""} 
              onClick={() => { setViewMode("OPTION_CHAIN"); setProduct("NRML"); setSymbol(""); }}
            >
              Option Chain
            </button>
          </div>
        </div>

        {/* Dynamic Form Grid */}
        <div className="form-grid">
          
          {/* Section 1: Symbol Selection */}
          {viewMode === "SEARCH" ? (
            <div className="form-row symbol-field">
              <label>Search Symbol</label>
              <input 
                value={symbol} 
                onChange={(e) => setSymbol(e.target.value)} 
                placeholder="e.g. RELIANCE-EQ" 
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="suggest-box">
                  {suggestions.map((s, idx) => (
                    <div key={idx} className="suggest-item" onClick={() => { setSymbol(s.trdSymbol); setShowSuggestions(false); }}>
                      <span>{s.trdSymbol}</span>
                      <small>{s.name}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="form-row symbol-field" style={{ gap: '12px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Index</label>
                  <select value={optionIndex} onChange={(e) => { 
                    setOptionIndex(e.target.value); 
                    setSymbol(""); 
                    setLtp(null);
                    setSpotPrice(e.target.value === "BANKNIFTY" ? 60000 : 25000);
                  }}>
                    <option value="NIFTY">NIFTY</option>
                    <option value="BANKNIFTY">BANKNIFTY</option>
                  </select>
                </div>
                <div className="form-row" style={{ flex: 1 }}>
                  <label>Spot Price</label>
                  <input type="number" value={spotPrice} onChange={(e) => setSpotPrice(Number(e.target.value))} />
                </div>
              </div>
              
              <div className="form-row">
                <label>Select Strike</label>
                <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                  <option value="">-- Select from {filteredChain.length} Strikes --</option>
                  {filteredChain.map((opt, idx) => {
                    const strikeMatch = opt.trdSymbol.match(/(\d+)(CE|PE)$/);
                    const displayStrike = strikeMatch ? strikeMatch[1] : "N/A";
                    const displayType = strikeMatch ? strikeMatch[2] : "";
                    return (
                      <option key={idx} value={opt.trdSymbol}>
                        {opt.expiry} | STRIKE: {displayStrike} | {displayType}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          )}

          {/* Section 2: Order Details */}
          <div className="form-row">
            <label>Quantity</label>
            <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} min="1" />
          </div>

          <div className="form-row">
            <label>Price Type</label>
            <select value={priceType} onChange={(e) => setPriceType(e.target.value)}>
              <option value="MKT">Market (At LTP)</option>
              <option value="LMT">Limit Order</option>
            </select>
          </div>

          <div className="form-row">
            <label>
              Price {ltp && <span style={{color: '#3b82f6', fontWeight: 600}}> (LTP: ₹{ltp})</span>}
            </label>
            <input 
              type="number" 
              step="0.05"
              value={price} 
              onChange={(e) => setPrice(e.target.value)} 
              disabled={priceType === "MKT"}
              placeholder={priceType === "MKT" ? "Auto-filled at LTP" : "Enter Limit Price"}
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
              <option value="CNC">CNC (Delivery)</option>
              <option value="MIS">MIS (Intraday)</option>
              <option value="NRML">NRML (Overnight)</option>
            </select>
          </div>
        </div>

        {/* Section 3: Action Button & Messages */}
        <div className="btn-row">
          <button 
            className={side === "BUY" ? "buy" : "sell"} 
            onClick={submit} 
            disabled={loading || !symbol}
          >
            {loading ? "Processing..." : `${side} ${symbol || "ORDER"}`}
          </button>
        </div>

        {message.text && (
          <div className={`message ${message.type}`}>
            {message.type === "success" ? "✅ " : "⚠️ "}
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
