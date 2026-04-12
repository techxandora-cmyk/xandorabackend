// src/middleware/requireAdminWrite.js

module.exports = function requireAdminWrite(req, res, next) {
  if (!req.user || !req.user.roles) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const roles = req.user.roles;

  // 🔥 Allow MASTER_ADMIN and ADMIN full write access
  if (roles.includes("MASTER_ADMIN") || roles.includes("ADMIN")) {
    return next();
  }

  return res.status(403).json({ error: "Forbidden" });
};
