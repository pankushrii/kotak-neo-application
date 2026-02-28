import React, { useEffect, useState } from "react";
import { LoginPanel } from "./components/LoginPanel";
import { PlaceOrderForm } from "./components/PlaceOrderForm";
import { PositionsTable } from "./components/PositionsTable";
import { OrdersTable } from "./components/OrdersTable";
import { ApiClient } from "./apiClient";

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);

  const refreshData = async () => {
    try {
      const [pos, ord] = await Promise.all([
        ApiClient.getPositions(),
        ApiClient.getOrders()
      ]);
      setPositions(pos);
      setOrders(ord);
    } catch (e) {
      console.error("Refresh error", e);
    }
  };

  useEffect(() => {
    if (loggedIn) {
      refreshData();
    }
  }, [loggedIn]);

  return (
    <div className="container">
      <h1>Kotak Neo Trading UI</h1>

      <LoginPanel
        onLoggedIn={() => setLoggedIn(true)}
        onLoggedOut={() => {
          setLoggedIn(false);
          setPositions([]);
          setOrders([]);
        }}
      />

      {loggedIn && (
        <>
          <PlaceOrderForm onOrderPlaced={refreshData} />
          <div className="grid">
            <PositionsTable positions={positions} />
            <OrdersTable orders={orders} />
          </div>
        </>
      )}
    </div>
  );
}

export default App;
