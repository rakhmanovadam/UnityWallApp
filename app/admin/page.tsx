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
          <span className="kicker kicker--dusk">Unitywalls · Admin</span>
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
        <span className="kicker kicker--dusk">Unitywalls · Admin</span>
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

  // Authed admin — load initial metrics + pending applications + the first
  // page of the master collected-emails table (with funnel counts) so the
  // console renders without a client-side load flash. The table component
  // re-fetches /api/admin/emails on any filter/paging interaction.
  const db = createAdminClient();
  const masterHead = () =>
    db
      .from("admin_master_emails")
      .select("email", { count: "exact", head: true });

  const [
    { count: venues },
    { count: pending },
    { data: applications },
    { data: masterItems, count: masterTotal },
    { count: coldCount },
    { count: warmCount },
    { count: hotCount },
    { count: convertedCount },
  ] = await Promise.all([
    // Venues tile = actual walls (events). Counting events means deleting a
    // wall decrements this the moment the console re-fetches (router.refresh).
    db.from("events").select("*", { count: "exact", head: true }),
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
      .from("admin_master_emails")
      .select("*", { count: "exact" })
      .order("joined_at", { ascending: false, nullsFirst: false })
      .range(0, 49),
    masterHead().eq("lead_temperature", "cold"),
    masterHead().eq("lead_temperature", "warm"),
    masterHead().eq("lead_temperature", "hot"),
    masterHead().eq("converted", true),
  ]);

  return (
    <AdminConsole
      email={ctx.email}
      metrics={{
        // Emails tile = the collected-emails population, the same set the
        // funnel + conversion are measured against (keeps convert% <= 100%).
        emails: masterTotal ?? 0,
        venues: venues ?? 0,
        pending: pending ?? 0,
      }}
      applications={applications ?? []}
      emails={{
        items: masterItems ?? [],
        total: masterTotal ?? 0,
        counts: {
          cold: coldCount ?? 0,
          warm: warmCount ?? 0,
          hot: hotCount ?? 0,
          converted: convertedCount ?? 0,
        },
      }}
    />
  );
}
