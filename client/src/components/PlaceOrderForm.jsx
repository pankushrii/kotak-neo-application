import React, { useEffect, useRef, useState } from "react";
import { ApiClient } from "../apiClient";

export function PlaceOrderForm({ onOrderPlaced }) {
  const [symbol, setSymbol] = useState("");
  const [qty, setQty] = useState(1);
  const [side, setSide] = useState("BUY");
  const [product, setProduct] = useState("CNC");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // --- NEW: Price & Price Type States ---
  const [priceType, setPriceType] = useState("MKT");
  const [price, setPrice] = useState("");
  const [ltp, setLtp] = useState(null);

  // Option Chain States
  const [viewMode, setViewMode] = useState("SEARCH");
  const [optionIndex, setOptionIndex] = useState("NIFTY");
  const [chainData, setChainData] = useState([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [strikeFilter, setStrikeFilter] = useState("");
  const [spotPrice, setSpotPrice] = useState(25000); 

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const debounceRef = useRef(null);

  // Symbol Search Logic
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

  // Option Chain Fetching
  useEffect(() => {
    if (viewMode !== "OPTION_CHAIN") return;
    const fetchChain = async () => {
      setChainLoading(true);
      try {
        const data = await ApiClient.getOptionChain(optionIndex, spotPrice);
        setChainData(data || []);
      } catch (err) {
        setMessage("Failed to load option chain.");
      } finally {
        setChainLoading(false);
      }
    };
    fetchChain();
  }, [optionIndex, viewMode, spotPrice]);

  // Live LTP Fetching (Polls every 5 seconds)
  useEffect(() => {
    if (!symbol) return;
    
    const fetchPrice = async () => {
      try {
        // Find token for selected strike if in Option Chain mode
        const selectedOpt = viewMode === "OPTION_CHAIN" 
          ? chainData.find(o => o.trdSymbol === symbol) 
          : suggestions.find(o => o.trdSymbol === symbol);

        if (selectedOpt && selectedOpt.token) {
          const data = await ApiClient.getPrice(selectedOpt.token, selectedOpt.exchSeg || selectedOpt.exch);
          const latestPrice = data?.data?.[0]?.ltp;
          setLtp(latestPrice);
          // Auto-fill price if Market is selected to ensure reference price exists
          if (priceType === "MKT") setPrice(latestPrice);
        }
      } catch (err) {
        console.error("LTP Fetch error", err);
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 5000);
    return () => clearInterval(interval);
  }, [symbol, chainData, viewMode, priceType]);

  const filteredChain = chainData.filter(opt => 
    opt.trdSymbol.toLowerCase().includes(strikeFilter.toLowerCase())
  );

  const submit = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await ApiClient.placeOrder({
        trading_symbol: symbol.trim(),
        quantity: Number(qty),
        side,
        product,
        // Pass price data to backend
        price: priceType === "MKT" ? ltp : Number(price),
        priceType: "LMT" // Forced to LMT in backend logic to prevent 1041 rejection
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
          <button className={viewMode === "SEARCH" ? "active" : ""} onClick={() => { setViewMode("SEARCH"); setSymbol(""); }}>Search Stocks</button>
          <button className={viewMode === "OPTION_CHAIN" ? "active" : ""} onClick={() => { setViewMode("OPTION_CHAIN"); setProduct("NRML"); setSymbol(""); }}>Option Chain</button>
        </div>
      </div>

      <div className="form-grid">
        {viewMode === "SEARCH" ? (
          <div className="form-row symbol-field">
            <label>Search Symbol</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. RELIANCE-EQ" />
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
            <label>Index & Strike Search</label>
            <div className="chain-selector" style={{ display: 'flex', gap: '5px', flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: '5px' }}>
                <select style={{ flex: 1 }} value={optionIndex} onChange={(e) => { 
                  setOptionIndex(e.target.value); 
                  setSymbol(""); 
                  setLtp(null);
                  setSpotPrice(e.target.value === "BANKNIFTY" ? 60000 : 25000);
                }}>
                  <option value="NIFTY">NIFTY</option>
                  <option value="BANKNIFTY">BANKNIFTY</option>
                </select>
                <input 
                  style={{ flex: 1 }}
                  type="number"
                  placeholder="Spot Price"
                  value={spotPrice}
                  onChange={(e) => setSpotPrice(Number(e.target.value))}
                />
              </div>
              
              <input 
                type="text" 
                placeholder="Filter strikes..." 
                value={strikeFilter}
                onChange={(e) => setStrikeFilter(e.target.value)}
              />

              <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                <option value="">-- {filteredChain.length} Strikes Found --</option>
                {filteredChain.map((opt, idx) => {
                  const strikeMatch = opt.trdSymbol.match(/(\d+)(CE|PE)$/);
                  const displayStrike = strikeMatch ? strikeMatch[1] : "N/A";
                  const displayType = strikeMatch ? strikeMatch[2] : "";
                  return (
                    <option key={idx} value={opt.trdSymbol}>
                      {opt.trdSymbol.startsWith("NIFTY") ? "NIFTY" : "BANKNIFTY"} | {opt.expiry} | STRIKE: {displayStrike} | {displayType}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        <div className="form-row">
          <label>Quantity</label>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>

        {/* --- NEW: Price Selection UI --- */}
        <div className="form-row">
          <label>Price Type</label>
          <select value={priceType} onChange={(e) => setPriceType(e.target.value)}>
            <option value="MKT">Market (At LTP)</option>
            <option value="LMT">Limit Order</option>
          </select>
        </div>

        <div className="form-row">
          <label>Price {ltp && <span style={{color: '#007bff'}}> (LTP: ₹{ltp})</span>}</label>
          <input 
            type="number" 
            step="0.05"
            value={price} 
            onChange={(e) => setPrice(e.target.value)} 
            disabled={priceType === "MKT"}
            placeholder={priceType === "MKT" ? "Market Price" : "Enter Price"}
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

      <div className="btn-row">
        <button onClick={submit} disabled={loading || !symbol} className={side.toLowerCase()}>
          {loading ? "Processing..." : `${side} ${symbol || "Order"}`}
        </button>
      </div>
      {message && <p className={`message ${message.includes("success") ? "success" : "error"}`}>{message}</p>}
    </div>
  );
}
