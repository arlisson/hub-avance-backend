/**
 * API handler that returns public Supabase configuration
 * @param {Object} req - The incoming HTTP request object
 * @param {Object} res - The outgoing HTTP response object
 * @param {Function} res.status - Sets the HTTP status code
 * @param {Function} res.json - Sends a JSON response
 * @returns {void} Sends a JSON response with Supabase configuration or error
 */
export default function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;

  if (!url || !anon) return res.status(500).json({ ok: false, error: "missing_env" });

  res.status(200).json({ ok: true, supabaseUrl: url, supabaseAnonKey: anon });
}