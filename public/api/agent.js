// api/agent.js
/**
 * Handles POST requests to forward data to an n8n webhook after validating user authentication.
 * 
 * This API route validates the incoming request using a Bearer token against Supabase,
 * extracts the user's email, and forwards the request body along with the email to an n8n webhook.
 * 
 * @async
 * @param {Object} req - The HTTP request object
 * @param {string} req.method - The HTTP method (only POST is allowed)
 * @param {Object} req.headers - Request headers containing authorization token
 * @param {string} req.headers.authorization - Bearer token for authentication
 * @param {Object|string} req.body - The request body to forward to n8n
 * @param {Object} res - The HTTP response object
 * @param {Function} res.status - Sets the HTTP status code
 * @param {Function} res.json - Sends a JSON response
 * @param {Function} res.send - Sends a text response
 * @param {Function} res.setHeader - Sets response headers
 * 
 * @returns {Promise<void>} Sends HTTP response with n8n webhook response or error message
 * 
 * @throws {401} If no token is provided or token is invalid
 * @throws {405} If request method is not POST
 * @throws {500} If required environment variables are missing or n8n request fails
 * 
 * @requires Environment variables: N8N_WEBHOOK_URL, SUPABASE_URL, SUPABASE_ANON_KEY
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!n8nUrl || !supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ ok: false, error: "missing_env" });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ ok: false, error: "no_token" });

  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!userResp.ok) {
    return res.status(401).json({ ok: false, error: "invalid_session" });
  }

  const user = await userResp.json();
  const email = user?.email || null;

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  if (!body || typeof body !== "object") body = {};

  const n8nResp = await fetch(n8nUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      email,
    }),
  });

  const text = await n8nResp.text();
  res.setHeader("Cache-Control", "no-store");
  return res.status(n8nResp.ok ? 200 : 500).send(text);
}