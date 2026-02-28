let tradingToken = null;
let tradingSid = null;
let lastLoginAt = null;

module.exports = {
  setSession(token, sid) {
    tradingToken = token;
    tradingSid = sid;
    lastLoginAt = Date.now();
  },
  getSession() {
    return { tradingToken, tradingSid, lastLoginAt };
  },
  clear() {
    tradingToken = null;
    tradingSid = null;
    lastLoginAt = null;
  }
};
