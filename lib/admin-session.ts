import { createClient } from "@/lib/supabase/server";

export type AdminContext = {
  userId: string;
  email: string;
};

export async function getAdminContext(): Promise<AdminContext | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const role =
    (auth.user.app_metadata as { role?: string } | undefined)?.role ?? null;
  if (role !== "admin") return null;
  return { userId: auth.user.id, email: auth.user.email ?? "" };
}
