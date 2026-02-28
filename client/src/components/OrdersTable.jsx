import React from "react";

function normalizeOrders(raw) {
  const rows = Array.isArray(raw) ? raw : raw?.data || [];
  return rows.map((o) => ({
    orderId: o.nOrdNo || o.n_ord_no || o.order_id || "-",
    symbol: o.trdSym || o.trading_symbol || o.symbol || "-",
    side: o.trnsTp || o.transaction_type || o.side || "-",
    qty: o.qty || o.quantity || "-",
    status: o.ordSt || o.status || o.order_status || "-"
  }));
}

export function OrdersTable({ orders, loading }) {
  const rows = normalizeOrders(orders);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Orders</h2>
        <div className="muted">{loading ? "Loading…" : `${rows.length} rows`}</div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No orders found</div>
          <div className="empty-sub">Place an order to see order history here.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Symbol</th>
              <th>Side</th>
              <th className="right">Qty</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td className="mono">{r.orderId}</td>
                <td className="mono">{r.symbol}</td>
                <td>{r.side}</td>
                <td className="right">{r.qty}</td>
                <td>
                  <span className={`pill ${String(r.status).toLowerCase()}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
