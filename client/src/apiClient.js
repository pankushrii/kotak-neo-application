import axios from "axios";
const api = axios.create({ baseURL: "/api" });

export const ApiClient = {
  login: (totp) => api.post("/auth/login", { totp }).then((r) => r.data),
  getSession: () => api.get("/auth/session").then((r) => r.data),
  logout: () => api.post("/auth/logout").then((r) => r.data),

  placeOrder: (body) => api.post("/orders", body).then((r) => r.data),
  getPositions: () => api.get("/positions").then((r) => r.data),
  getOrders: () => api.get("/orders").then((r) => r.data)
};
