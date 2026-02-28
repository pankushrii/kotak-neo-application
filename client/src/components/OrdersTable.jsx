import React from "react";

export function OrdersTable({ orders }) {
  const rows = Array.isArray(orders) ? orders : orders?.data || [];
  return (
    <div className="card">
      <h2>Orders</h2>
      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o, idx) => (
            <tr key={idx}>
              <td>{o.order_id || o.n_ord_no}</td>
              <td>{o.trading_symbol || o.symbol}</td>
              <td>{o.transaction_type || o.side}</td>
              <td>{o.quantity}</td>
              <td>{o.status || o.order_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
