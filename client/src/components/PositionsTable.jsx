import React from "react";

export function PositionsTable({ positions }) {
  const rows = Array.isArray(positions) ? positions : positions?.data || [];
  return (
    <div className="card">
      <h2>Positions</h2>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Qty</th>
            <th>P&L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, idx) => (
            <tr key={idx}>
              <td>{p.trading_symbol || p.symbol}</td>
              <td>{p.net_quantity || p.quantity}</td>
              <td>{p.unrealized_pnl ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
