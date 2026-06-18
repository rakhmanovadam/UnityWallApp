import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin-session";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminLoginForm from "./login-form";
import AdminConsole from "./console";

export default async function AdminPage() {
  const ctx = await getAdminContext();

  if (!ctx) {
    // Distinguish between "no session" and "signed in but not admin".
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      return (
        <section className="screen screen--pad screen--col">
          <span className="kicker kicker--dusk">UnityWall · Admin</span>
          <h1 className="display display--med">Not authorized</h1>
          <p className="lede">
            Signed in as {auth.user.email}, but this account doesn&apos;t have
            admin role. Ping support to be added.
          </p>
        </section>
      );
    }

    return (
      <section className="screen screen--pad screen--col">
        <span className="kicker kicker--dusk">UnityWall · Admin</span>
        <h1 className="display display--med">Staff sign-in</h1>
        <p className="lede">
          Magic-link sign-in with role check. This page is never linked
          publicly.
        </p>
        <AdminLoginForm />
        <div className="info" style={{ marginTop: 18 }}>
          <div className="info__head">
            <span className="dot dot--dusk" />
            Role gate: <code>app_metadata.role = &apos;admin&apos;</code>
          </div>
          <div className="info__body">
            Server-side role check, never a shared code.
          </div>
        </div>
      </section>
    );
  }

  // Authed admin — load initial metrics + pending applications + recent leads.
  const db = createAdminClient();
  const [
    { count: emails },
    { count: venues },
    { count: pending },
    { data: applications },
    { data: leads },
  ] = await Promise.all([
    db.from("guests").select("*", { count: "exact", head: true }),
    db
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("status", "approved"),
    db
      .from("applications")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_review"),
    db
      .from("applications")
      .select("id, venue, contact, email, phone, city, country, notes, status, created_at")
      .eq("status", "pending_review")
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("leads")
      .select("id, source, email, name, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <AdminConsole
      email={ctx.email}
      metrics={{
        emails: emails ?? 0,
        venues: venues ?? 0,
        pending: pending ?? 0,
      }}
      applications={applications ?? []}
      leads={leads ?? []}
    />
  );
}
