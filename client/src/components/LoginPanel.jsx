import React, { useState, useEffect } from "react";
import { ApiClient } from "../apiClient";

export function LoginPanel({ onLoggedIn, onLoggedOut }) {
  const [tradingToken, setTradingToken] = useState("");
  const [tradingSid, setTradingSid] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [lastLoginAt, setLastLoginAt] = useState(null);
  const [error, setError] = useState("");

  const loadSession = async () => {
    try {
      const s = await ApiClient.getSession();
      setHasSession(s.hasSession);
      setLastLoginAt(s.lastLoginAt);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    loadSession();
  }, []);

  const handleSetSession = async () => {
    setLoading(true);
    setError("");
    try {
      await ApiClient.setSession({ tradingToken, tradingSid, baseUrl });
      setHasSession(true);
      setLastLoginAt(Date.now());
      onLoggedIn();
    } catch (e) {
      setError(
        e.response?.data?.error ||
          e.message ||
          "Failed to set trading session."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    setError("");
    try {
      await ApiClient.logout();
      setHasSession(false);
      setLastLoginAt(null);
      onLoggedOut();
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Logout failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Kotak Neo Session</h2>

      <p className="caption">
        Paste your <strong>TRADING_TOKEN</strong>, <strong>TRADING_SID</strong>{" "}
        and <strong>BASE_URL</strong> from your daily TOTP + MPIN login script.
      </p>

      <div className="form-row">
        <label>TRADING_TOKEN</label>
        <input
          value={tradingToken}
          onChange={(e) => setTradingToken(e.target.value)}
          placeholder="eyJhbGciOi..."
        />
      </div>

      <div className="form-row">
        <label>TRADING_SID</label>
        <input
          value={tradingSid}
          onChange={(e) => setTradingSid(e.target.value)}
          placeholder="uuid / sid"
        />
      </div>

      <div className="form-row">
        <label>BASE_URL</label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://napi.kotaksecurities.com/..."
        />
      </div>

      <div className="btn-row">
        <button onClick={handleSetSession} disabled={loading}>
          {loading ? "Saving..." : "Set Session"}
        </button>
        {hasSession && (
          <button
            className="secondary"
            onClick={handleLogout}
            disabled={loading}
          >
            Clear Session
          </button>
        )}
      </div>

      {hasSession && (
        <p className="session-ok">
          Active session. Last set:{" "}
          {lastLoginAt ? new Date(lastLoginAt).toLocaleString() : "now"}
        </p>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
