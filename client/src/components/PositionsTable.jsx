import React from "react";

function normalizePositions(raw) {
  const rows = Array.isArray(raw) ? raw : raw?.data || [];
  return rows.map((p) => ({
    symbol: p.trdSym || p.trading_symbol || p.symbol || "-",
    qty: p.net_quantity || p.quantity || p.flBuyQty || "-",
    product: p.prod || p.product || "-",
    pnl: p.pnl || p.unrealized_pnl || "-"
  }));
}

export function PositionsTable({ positions, loading }) {
  const rows = normalizePositions(positions);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Positions</h2>
        <div className="muted">{loading ? "Loading…" : `${rows.length} rows`}</div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No open positions</div>
          <div className="empty-sub">Place an order to see positions here.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Product</th>
              <th className="right">Qty</th>
              <th className="right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td className="mono">{r.symbol}</td>
                <td>{r.product}</td>
                <td className="right">{r.qty}</td>
                <td className="right">{r.pnl}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
