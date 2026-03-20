// api/public-agent-config.js
/**
 * API handler that returns public agent configuration.
 * 
 * Retrieves environment variables for login, agent chat, and agent proxy URLs,
 * and returns them as JSON. Returns a 500 error if required URLs are missing.
 * 
 * @param {Object} req - The HTTP request object (unused)
 * @param {Object} res - The HTTP response object
 * @param {Function} res.status - Sets the HTTP status code
 * @param {Function} res.json - Sends a JSON response
 * @returns {Object} JSON response containing:
 *   - {boolean} ok - Success status
 *   - {string} [loginUrl] - URL for login page (from LOGIN_URL env or default)
 *   - {string} [agentChatUrl] - URL for agent chat (from AGENT_CHAT_URL env or default)
 *   - {string} [agentProxyUrl] - URL for agent proxy (from AGENT_PROXY_URL env or default)
 *   - {string} [error] - Error message if ok is false
 */
export default function handler(req, res) {
  const loginUrl = process.env.LOGIN_URL || "/login/login.html"; // ex: "/login/login.html"
  const agentChatUrl = process.env.AGENT_CHAT_URL || "/agent-chat/agent"; // ex: "/agente-chat/agent.html"
  const agentProxyUrl = process.env.AGENT_PROXY_URL || "https://n8n.clientevip.net.br/webhook/agente-avance-v2"; // ex: "/api/agent"

  if (!loginUrl || !agentChatUrl) {
    return res.status(500).json({ ok: false, error: "missing_env" });
  }

  return res.status(200).json({
    ok: true,
    loginUrl,
    agentChatUrl,
    agentProxyUrl,
  });
}