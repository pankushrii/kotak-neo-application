import axios from "axios";

// CRITICAL: withCredentials: true ensures cookies are sent/received in every request
const api = axios.create({ 
  baseURL: "/api",
  withCredentials: true 
});

export const ApiClient = {
  login(totp) {
    return api.post("/auth/login", { totp }).then((r) => r.data);
  },

  getSession() {
    return api.get("/auth/session").then((r) => r.data);
  },

  logout() {
    return api.post("/auth/logout").then((r) => r.data);
  },

  placeOrder(body) {
    return api.post("/orders", body).then((r) => r.data);
  },

  getPositions() {
    return api.get("/positions").then((r) => r.data);
  },

  getOrders() {
    return api.get("/orders").then((r) => r.data);
  },

  searchSymbols(query) {
    return api
      .get("/symbols", { params: { q: query } })
      .then((r) => r.data);
  }, // <--- Ensure this comma exists!

  /**
   * Fetches Option Chain for a specific index
   * @param {string} symbol - "NIFTY", "BANKNIFTY", or "SENSEX"
   */
  getOptionChain(symbol) {
    console.log(`📈 [Frontend]: Fetching Option Chain for ${symbol}...`);
    return api
      .get("/option-chain", { params: { symbol } })
      .then((r) => r.data);
  }
};
