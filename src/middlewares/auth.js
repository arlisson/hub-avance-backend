import jwt from "jsonwebtoken";

function getTokenFromHeader(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export function authenticateToken(req, res, next) {
  try {
    const token = getTokenFromHeader(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Token não informado."
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({
        ok: false,
        error: "JWT_SECRET não configurado."
      });
    }

    const decoded = jwt.verify(token, secret);

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: "Token inválido ou expirado."
    });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user?.role) {
      return res.status(403).json({
        ok: false,
        error: "Acesso negado."
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        ok: false,
        error: "Permissão insuficiente."
      });
    }

    return next();
  };
}