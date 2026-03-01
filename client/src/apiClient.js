// client/src/apiClient.js

import axios from "axios";

const api = axios.create({ baseURL: "/api" });

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
  }
};
