import React, { useState, useEffect } from "react";
import { ApiClient } from "../apiClient";

export function LoginPanel({ onLoggedIn, onLoggedOut }) {
  const [totp, setTotp] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    const s = await ApiClient.getSession();
    setHasSession(!!s.hasSession);
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const login = async () => {
    setLoading(true);
    setError("");
    try {
      await ApiClient.login(totp);
      await refresh();
      onLoggedIn();
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    setError("");
    try {
      await ApiClient.logout();
      await refresh();
      onLoggedOut();
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Logout failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>Kotak Neo Login (TOTP)</h2>

      <div className="form-row">
        <label>TOTP</label>
        <input
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          placeholder="123456"
        />
      </div>

      <div className="btn-row">
        <button onClick={login} disabled={loading || !totp}>
          {loading ? "Logging in..." : "Login"}
        </button>

        {hasSession && (
          <button className="secondary" onClick={logout} disabled={loading}>
            Logout
          </button>
        )}
      </div>

      {hasSession && <p className="session-ok">Session is active.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
