import React, { useEffect, useRef, useState } from "react";
import { ApiClient } from "../apiClient";

export function PlaceOrderForm({ onOrderPlaced }) {
  const [symbol, setSymbol] = useState("RELIANCE-EQ");
  const [qty, setQty] = useState(1);
  const [side, setSide] = useState("BUY");
  const [product, setProduct] = useState("CNC");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Option Chain States
  const [viewMode, setViewMode] = useState("SEARCH");
  const [optionIndex, setOptionIndex] = useState("NIFTY");
  const [chainData, setChainData] = useState([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [strikeFilter, setStrikeFilter] = useState("");
  
  // --- UPDATED SPOT PRICES FOR 2026 ---
  const [spotPrice, setSpotPrice] = useState(25000); 
  const [ltp, setLtp] = useState(null); // To show live price of selected strike

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const debounceRef = useRef(null);

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

  useEffect(() => {
    if (viewMode !== "OPTION_CHAIN") return;
    const fetchChain = async () => {
      setChainLoading(true);
      setMessage("Loading Scrip Master...");
      try {
        // Pass both index and spotPrice to backend for ±2000 range filtering
        const data = await ApiClient.getOptionChain(optionIndex, spotPrice);
        setChainData(data || []);
        setMessage("");
      } catch (err) {
        setMessage("Failed to load option chain.");
      } finally {
        setChainLoading(false);
      }
    };
    fetchChain();
  }, [optionIndex, viewMode, spotPrice]);

  // --- FETCH LIVE PRICE OF SELECTED STRIKE ---
  useEffect(() => {
    if (viewMode !== "OPTION_CHAIN" || !symbol) return;
    
    const selectedOpt = chainData.find(o => o.trdSymbol === symbol);
    if (selectedOpt && selectedOpt.token) {
      ApiClient.getPrice(selectedOpt.token, selectedOpt.exchSeg)
        .then(data => {
          const price = data?.data?.[0]?.ltp;
          setLtp(price);
        })
        .catch(() => setLtp(null));
    }
  }, [symbol, chainData, viewMode]);

  const filteredChain = chainData.filter(opt => 
    opt.name.toLowerCase().includes(strikeFilter.toLowerCase()) ||
    opt.trdSymbol.toLowerCase().includes(strikeFilter.toLowerCase())
  );

  const submit = async () => {
    setLoading(true);
    setMessage("");
    try {
      console.log("Placeing order on submit");
      alert("placeOrder from OrderForm");
      const res = await ApiClient.placeOrder({
        trading_symbol: symbol.trim(),
        quantity: Number(qty),
        side,
        product
      });
      setMessage("Order placed successfully.");
      if (onOrderPlaced) onOrderPlaced(res);
    } catch (e) {
      console.log("Placeing order on submit Error",e);
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
          <button className={viewMode === "SEARCH" ? "active" : ""} onClick={() => setViewMode("SEARCH")}>Search Stocks</button>
          <button className={viewMode === "OPTION_CHAIN" ? "active" : ""} onClick={() => { setViewMode("OPTION_CHAIN"); setProduct("NRML"); }}>Option Chain</button>
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
                  if(e.target.value === "BANKNIFTY") setSpotPrice(60000);
                  else setSpotPrice(25000);
                }}>
                  <option value="NIFTY">NIFTY</option>
                  <option value="BANKNIFTY">BANKNIFTY</option>
                </select>

                {/* Manual Spot Price Input to center the ±2000 range */}
                <input 
                  style={{ flex: 1, padding: '8px', fontSize: '12px' }}
                  type="number"
                  placeholder="Spot Price"
                  value={spotPrice}
                  onChange={(e) => setSpotPrice(Number(e.target.value))}
                />
              </div>
              
              <input 
                type="text" 
                placeholder="Filter strikes (e.g. 21500)" 
                value={strikeFilter}
                onChange={(e) => setStrikeFilter(e.target.value)}
                style={{ padding: '8px', fontSize: '12px' }}
              />

              <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                <option value="">-- {filteredChain.length} Strikes Found --</option>
             {filteredChain.map((opt, idx) => {
  // Use regex to extract digits (Strike) and the last two letters (CE/PE)
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

              {/* Upfront Price Visibility */}
              {ltp !== null && (
                <div style={{ padding: '10px', background: '#f0f7ff', borderRadius: '4px', border: '1px solid #cce3ff', marginTop: '5px' }}>
                   <strong style={{ color: '#004085' }}>Live LTP: ₹{ltp}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="form-row">
          <label>Quantity</label>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Side</label>
          <select value={side} onChange={(e) => setSide(e.target.value)}><option value="BUY">Buy</option><option value="SELL">Sell</option></select>
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
