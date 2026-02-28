const axios = require("axios");
const { setSession, getSession } = require("./sessionStore");

const BASE_URL = process.env.KOTAK_BASE_URL;

function authHeaders() {
  const { tradingToken, tradingSid } = getSession();
  if (!tradingToken || !tradingSid) {
    throw new Error("Not logged in");
  }
  return {
    Authorization: tradingToken,        // often Bearer <token> – confirm in docs
    "trading-sid": tradingSid
  };
}

// PSEUDOCODE login – adapt to exact endpoints from your docs:
async function kotakLogin({ totp }) {
  const consumerKey = process.env.KOTAK_CONSUMER_KEY;
  const clientId = process.env.KOTAK_CLIENT_ID;
  const mobile = process.env.KOTAK_REGISTERED_MOBILE;
  const mpin = process.env.KOTAK_MPIN;

  // Step 1: TOTP login – get view token & session id.[web:5]
  const step1 = await axios.post(`${BASE_URL}/login/totp`, {
    mobile_number: mobile,
    ucc: clientId,
    totp: totp,
    consumer_key: consumerKey
  });

  const viewToken = step1.data.view_token;
  const sessionId = step1.data.session_id;

  // Step 2: validate MPIN – get trading token + sid.[web:1][web:5]
  const step2 = await axios.post(`${BASE_URL}/login/totp/validate`, {
    session_id: sessionId,
    mpin: mpin,
    view_token: viewToken
  });

  const tradingToken = step2.data.trading_token;
  const tradingSid = step2.data.trading_sid;

  setSession(tradingToken, tradingSid);
  return { tradingToken, tradingSid };
}

async function placeOrder(payload) {
  const headers = authHeaders();
  const res = await axios.post(
    `${BASE_URL}/quick/order/rule/ms/place`,
    payload,
    { headers }
  );
  return res.data;
}

async function getPositions() {
  const headers = authHeaders();
  const res = await axios.get(`${BASE_URL}/positions`, { headers });
  return res.data;
}

async function getOrders() {
  const headers = authHeaders();
  const res = await axios.get(`${BASE_URL}/order/report`, { headers });
  return res.data;
}

module.exports = {
  kotakLogin,
  placeOrder,
  getPositions,
  getOrders
};
