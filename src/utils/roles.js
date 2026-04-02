export function isAdminRole(role) {
  const r = String(role || "").toLowerCase();
  return r === "admin" || r === "administrador";
}

export function canManage(role, protocol) {
  return isAdminRole(role) || Number(protocol) === 1;
}
