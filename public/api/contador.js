/**
 * API handler that increments an access counter and redirects to a target URL.
 * 
 * @param {Object} req - The HTTP request object
 * @param {Object} req.query - Query parameters
 * @param {string} req.query.app - The application identifier (required)
 * @param {Object} res - The HTTP response object
 * 
 * @returns {void} Redirects to the target URL for the specified app or sends an error response
 * 
 * @throws {string} Returns error messages:
 *   - "missing_app" (400) - if app parameter is empty or not provided
 *   - "missing_env" (500) - if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables are missing
 *   - "unknown_app" (400) - if the app is not found in the targets mapping
 *   - "server_error" (500) - if an unexpected error occurs during execution
 * 
 * @description
 * This serverless function:
 * 1. Validates the 'app' query parameter
 * 2. Checks for required Supabase environment variables
 * 3. Maps the app to its target URL using environment variables
 * 4. Calls Supabase RPC to atomically increment access counter
 * 5. Redirects user to the target URL with HTTP 302 status
 * 
 * @example
 * GET /api/contador?app=desktop
 */
export default async function handler(req, res) {
  try {
    const app = String(req.query.app || "").trim();
    const userId = String(req.query.user_id || "").trim();
    const metric = String(req.query.metric || "access").trim().toLowerCase();

    if (!app) return res.status(400).send("missing_app");
    if (!userId) return res.status(400).send("missing_user");
    if (!["access", "download"].includes(metric)) {
      return res.status(400).send("invalid_metric");
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return res.status(500).send("missing_env");
    }

    const targets = {
      desktop: process.env.TARGET_DESKTOP_URL,
      agent: process.env.TARGET_AGENT_URL,
      protocol: process.env.TARGET_PROTOCOL_URL,
    };

    const target = targets[app];
    if (!target) return res.status(400).send("unknown_app");

    const headers = {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    };

    const globalRpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_access`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_name: app }),
    });

    if (!globalRpc.ok) {
      const t = await globalRpc.text();
      console.error("increment_access failed:", {
        status: globalRpc.status,
        body: t,
        app,
      });
    }

    const profileRpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_profile_app_metric`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_user_id: userId,
        p_app_name: app,
        p_metric: metric,
      }),
    });

    if (!profileRpc.ok) {
      const t = await profileRpc.text();
      console.error("increment_profile_app_metric failed:", {
        status: profileRpc.status,
        body: t,
        userId,
        app,
        metric,
      });

      return res.status(500).send("profile_metric_failed");
    }

    res.writeHead(302, { Location: target });
    res.end();
  } catch (e) {
    console.error("contador error:", e);
    res.status(500).send("server_error");
  }
}