import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutRow from "./sign-out-row";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <section className="screen screen--scroll">
      {user?.email ? (
        <SignOutRow email={user.email} showEmail={false} />
      ) : null}
      <div className="home__top">
        <span className="brandmark brandmark--md home__mark" />
        <h1 className="display home__h">
          Welcome to <em>Unitywalls</em>.
        </h1>
        <p className="lede home__lede">
          A shared photo wall for weddings &amp; events. Three doors — pick the
          one that&apos;s you.
        </p>
      </div>

      <Link className="home-tile" href="/join">
        <span className="kicker kicker--dusk">For guests</span>
        <div className="home-tile__t">Join a wall</div>
        <div className="home-tile__d">
          Got a join code? Step inside and start adding photos.
        </div>
        <span className="home-tile__arrow">→</span>
      </Link>

      <Link className="home-tile home-tile--accent" href="/request">
        <span className="kicker kicker--dusk">For venues &amp; planners</span>
        <div className="home-tile__t">Use Unitywalls for your own venue</div>
        <div className="home-tile__d">
          Apply to host. We review every application by hand.
        </div>
        <span className="home-tile__arrow">→</span>
      </Link>

      <Link className="home-tile home-tile--quiet" href="/dashboard">
        <span className="kicker kicker--mute">For approved hosts</span>
        <div className="home-tile__t">Host login</div>
        <div className="home-tile__d">
          Sign in to manage your walls, the QR, and downloads.
        </div>
        <span className="home-tile__arrow">→</span>
      </Link>

      {user?.email ? (
        <div style={{ marginTop: 8, textAlign: "center" }}>
          <SignOutRow email={user.email} align="center" />
        </div>
      ) : null}

      <div className="home__foot">
        <span className="brandmark brandmark--xs" />
        <span>Powered by Unitywalls · support@unitywall.co</span>
      </div>
    </section>
  );
}
