export const SUPERADMIN_EMAIL = "rjamescute2@gmail.com";
export const ADMIN_EMAIL = "gerlieantipaso27@gmail.com";

export type AccountRole = "superadmin" | "admin" | "user";

export function accountRoleForEmail(email?: string | null): AccountRole {
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail === SUPERADMIN_EMAIL) return "superadmin";
  if (normalizedEmail === ADMIN_EMAIL) return "admin";
  return "user";
}

export function isSuperadminRole(role: unknown): boolean {
  return role === "superadmin";
}
