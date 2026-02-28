import React, { useEffect, useMemo, useState } from "react";
import { LoginPanel } from "./components/LoginPanel";
import { PlaceOrderForm } from "./components/PlaceOrderForm";
import { PositionsTable } from "./components/PositionsTable";
import { OrdersTable } from "./components/OrdersTable";
import { ApiClient } from "./apiClient";
import "./styles.css";

function maskMobile(m) {
  if (!m) return "";
  const s = String(m);
  if (s.length <= 4) return s;
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

function App() {
  const [hasSession, setHasSession] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [activeTab, setActiveTab] = useState("trade");
  const [banner, setBanner] = useState("");

  // Hardcoded identity (recognizable). You can also expose from backend later.
  const userIdentity = useMemo(() => {
    return { ucc: "YIVKF", mobile: "+917000560918" };
  }, []);

  const refreshSession = async () => {
    const s = await ApiClient.getSession();
    setHasSession(!!s.hasSession);
  };

  const refreshData = async () => {
    setLoadingData(true);
    try {
      const [pos, ord] = await Promise.all([
        ApiClient.getPositions(),
        ApiClient.getOrders()
      ]);

      setPositions(pos?.data || pos || []);
      setOrders(ord?.data || ord || []);
    } catch (e) {
      // show minimal message; detailed errors remain in console
      setBanner("Failed to refresh Orders/Positions. Check API connectivity.");
      setTimeout(() => setBanner(""), 4000);
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    refreshSession().catch(() => {});
  }, []);

  useEffect(() => {
    if (hasSession) refreshData().catch(() => {});
  }, [hasSession]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-title">Kotak Neo Trading</div>
          <div className="brand-subtitle">Simple trading dashboard</div>
        </div>

        <div className="topbar-right">
          {hasSession ? (
            <div className="userpill">
              <div className="userpill-title">Logged in</div>
              <div className="userpill-sub">
                UCC: {userIdentity.ucc} · {maskMobile(userIdentity.mobile)}
              </div>
            </div>
          ) : (
            <div className="userpill warn">
              <div className="userpill-title">Not logged in</div>
              <div className="userpill-sub">Enter TOTP to start</div>
            </div>
          )}

          {hasSession && (
            <button className="ghost" onClick={refreshData} disabled={loadingData}>
              {loadingData ? "Refreshing..." : "Refresh"}
            </button>
          )}
        </div>
      </header>

      <main className="container">
        {banner && <div className="banner">{banner}</div>}

        {/* LOGIN: show only when not logged in */}
        {!hasSession && (
          <LoginPanel
            onLoggedIn={async () => {
              await refreshSession();
            }}
            onLoggedOut={async () => {
              await refreshSession();
            }}
          />
        )}

        {/* DASHBOARD */}
        {hasSession && (
          <>
            <div className="tabs">
              <button
                className={activeTab === "trade" ? "tab active" : "tab"}
                onClick={() => setActiveTab("trade")}
              >
                Trade
              </button>
              <button
                className={activeTab === "positions" ? "tab active" : "tab"}
                onClick={() => setActiveTab("positions")}
              >
                Positions
              </button>
              <button
                className={activeTab === "orders" ? "tab active" : "tab"}
                onClick={() => setActiveTab("orders")}
              >
                Orders
              </button>
            </div>

            {activeTab === "trade" && (
              <PlaceOrderForm
                onOrderPlaced={() => {
                  setBanner("Order request sent. Refreshing…");
                  setTimeout(() => setBanner(""), 2500);
                  refreshData();
                }}
              />
            )}

            {activeTab === "positions" && (
              <PositionsTable positions={positions} loading={loadingData} />
            )}

            {activeTab === "orders" && (
              <OrdersTable orders={orders} loading={loadingData} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
