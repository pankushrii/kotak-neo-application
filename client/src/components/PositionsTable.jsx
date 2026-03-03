import React, { useEffect, useState } from "react";
import { ApiClient } from "../apiClient";

export function PositionsTable() {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchPositions = async () => {
    try {
      const data = await ApiClient.getPositions();
      setPositions(data);
    } catch (err) {
      console.error("Failed to fetch positions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="loader">Loading Positions...</div>;

  return (
    <div className="positions-container">
      <div className="card">
        <div className="card-head">
          <h3>Your Positions</h3>
          <button onClick={fetchPositions} className="refresh-btn">🔄</button>
        </div>
        
        <table className="trade-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Qty</th>
              <th>Avg Price</th>
              <th>LTP</th>
              <th>P&L</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, idx) => {
              const pnl = (pos.lastPrice - pos.averagePrice) * pos.netQty;
              const isProfit = pnl >= 0;

              return (
                <tr key={idx}>
                  <td>
                    <div className="symbol-name">{pos.tradingSymbol}</div>
                    <small className="seg-tag">{pos.exchangeSegment}</small>
                  </td>
                  <td className={pos.netQty < 0 ? "text-red" : "text-green"}>
                    {pos.netQty}
                  </td>
                  <td>₹{Number(pos.averagePrice).toFixed(2)}</td>
                  <td>₹{Number(pos.lastPrice).toFixed(2)}</td>
                  <td className={isProfit ? "profit" : "loss"}>
                    {isProfit ? "+" : ""}
                    {pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
