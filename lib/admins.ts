// Super-admins: the two accounts that own the console. They can remove other
// admins from the dashboard and are starred in the admin roster. They can never
// be removed through the UI (only by editing this list / the DB directly).
export const SUPER_ADMIN_EMAILS = [
  "elijah@unitywall.co",
  "adamrakhmanovit@gmail.com",
] as const;

export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return (SUPER_ADMIN_EMAILS as readonly string[]).includes(
    email.trim().toLowerCase(),
  );
}
