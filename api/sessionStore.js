let sessionToken = null;
let sessionSid = null;
let baseUrl = null;
let lastLoginAt = null;

module.exports = {
  setSession({ token, sid, baseUrl: url }) {
    sessionToken = token || null;
    sessionSid = sid || null;
    baseUrl = url || null;
    lastLoginAt = Date.now();
  },
  getSession() {
    return { sessionToken, sessionSid, baseUrl, lastLoginAt };
  },
  clear() {
    sessionToken = null;
    sessionSid = null;
    baseUrl = null;
    lastLoginAt = null;
  }
};
