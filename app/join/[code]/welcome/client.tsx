"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import BackLink from "@/app/back-link";

// Adam's LinkedIn profile, linked from the guest welcome copy. Update this if
// the profile URL changes.
const ADAM_LINKEDIN_URL = "https://www.linkedin.com/in/adamrakhmanov/";

const PARTNERS: Array<{ src: string; alt: string; soon?: boolean }> = [
  { src: "/assets/partners/djq.png", alt: "DJQ" },
  { src: "/assets/partners/copper-to-gold.png", alt: "Copper to Gold" },
  { src: "/assets/partners/es-supper-club.png", alt: "E's Supper Club" },
  { src: "/assets/partners/ears-sun-gear.png", alt: "Ears Sun Gear" },
  { src: "/assets/partners/house-of-india.png", alt: "House of India" },
  { src: "/assets/partners/miguel-media.png", alt: "Miguel Media" },
  { src: "/assets/partners/collaborative-dev.png", alt: "Collaborative Dev" },
  { src: "/assets/partners/hotel-la-panoramica.png", alt: "Hotel la Panoramica" },
  { src: "/assets/partners/coming-soon.png", alt: "More coming soon", soon: true },
];

function postLead(body: Record<string, unknown>) {
  return fetch("/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

export default function WelcomeClient({
  code,
  verifiedEmail,
}: {
  code: string;
  verifiedEmail?: string | null;
}) {
  const aboutRef = useRef<HTMLElement | null>(null);
  const reachRef = useRef<HTMLElement | null>(null);
  const warmFired = useRef(false);
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!aboutRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === aboutRef.current) {
            if (entry.isIntersecting && !warmFired.current) {
              warmTimer.current = setTimeout(() => {
                if (warmFired.current) return;
                warmFired.current = true;
                void postLead({
                  source: "warm",
                  code,
                  email: verifiedEmail ?? null,
                });
              }, 1500);
            } else if (!entry.isIntersecting && warmTimer.current) {
              clearTimeout(warmTimer.current);
              warmTimer.current = null;
            }
          }
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(aboutRef.current);
    if (reachRef.current) obs.observe(reachRef.current);
    return () => {
      obs.disconnect();
      if (warmTimer.current) clearTimeout(warmTimer.current);
    };
  }, [code, verifiedEmail]);

  return (
    <section className="screen screen--scroll">
      <BackLink href={`/join/${encodeURIComponent(code)}`} />
      <header className="ob__bar">
        <div className="ob__brand">
          <span className="brandmark brandmark--xs" />
          <span className="kicker kicker--mute">Powered by Unitywalls</span>
        </div>
        <Link
          href={`/join/${encodeURIComponent(code)}/upload`}
          className="ob__skip"
        >
          Skip →
        </Link>
      </header>

      <article className="ob__intro" data-section="intro">
        <div className="brand-tile brand-tile--sm" />
        <h1 className="display display--sm">Welcome to the wall</h1>
        <p className="ob__body">
          This is UnityWalls, an app crafted by UnityWall Technological
          Solutions, LLC and Adam Rakhmanov. It&apos;s one of many projects
          we&apos;ve brought to the world. Welcome, and enjoy.
        </p>

        <div className="ob__how">
          <div className="kicker kicker--mute">How to add your photos</div>
          {[
            { n: 1, t: 'Tap "Start uploading"', d: "Open your camera roll right here." },
            { n: 2, t: "Pick your favorites", d: "A few candids or the whole night — your call." },
            { n: 3, t: "Watch them land", d: "They fade onto the wall as they upload." },
          ].map((s) => (
            <div key={s.n} className="step">
              <span className="step__num">{s.n}</span>
              <div>
                <div className="step__t">{s.t}</div>
                <div className="step__d">{s.d}</div>
              </div>
            </div>
          ))}
        </div>

        <Link
          href={`/join/${encodeURIComponent(code)}/upload`}
          className="btn btn--primary"
        >
          Start uploading photos <span className="arrow">→</span>
        </Link>
        <div className="ob__scroll">
          Want to learn more? Visit UnityWall at{" "}
          <a
            href="https://unitywall.co"
            target="_blank"
            rel="noopener noreferrer"
            className="link-dusk"
          >
            unitywall.co
          </a>
          , and connect with{" "}
          <a
            href={ADAM_LINKEDIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="link-dusk"
          >
            Adam on LinkedIn
          </a>
          .
        </div>
      </article>

      <article
        className="ob__about"
        data-section="about"
        ref={(el) => {
          aboutRef.current = el;
        }}
      >
        <span className="kicker kicker--dusk">About Unitywalls</span>
        <h2 className="title">More than just websites</h2>
        <p className="ob__body">
          We build and maintain the full digital presence for the people who
          make great rooms — from first logo to last post.
        </p>

        <div className="kicker kicker--mute" style={{ marginTop: 24 }}>
          Brands we&apos;ve worked with
        </div>
        <div className="brands">
          {PARTNERS.map((p) => (
            <div
              key={p.src}
              className={"brands__cell" + (p.soon ? " brands__cell--soon" : "")}
            >
              <img src={p.src} alt={p.alt} />
            </div>
          ))}
        </div>

        <div className="callout">
          Run a venue or plan weddings? You&apos;re exactly who we love building
          for.
        </div>
      </article>

      <article
        className="ob__reach"
        data-section="reach_out"
        ref={(el) => {
          reachRef.current = el;
        }}
      >
        <div className="reach__head">
          <span className="kicker kicker--dusk">Send us a message</span>
          <span className="badge badge--live">
            <span className="pulse" />
            Reply in under 1 hour
          </span>
        </div>

        <form
          id="reach-form"
          className="form form--reach"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const cleanEmail = email.trim();
            const cleanMsg = msg.trim();
            if (!cleanEmail || !cleanMsg) {
              setError("Email and message are required.");
              return;
            }
            setError(null);
            await postLead({
              source: "hot",
              code,
              email: cleanEmail,
              message: cleanMsg,
            });
            setSubmitted(true);
            setEmail("");
            setMsg("");
          }}
        >
          <div className="field">
            <input
              type="email"
              name="lead_email"
              placeholder="Your email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field field--ta">
            <textarea
              name="lead_msg"
              rows={3}
              placeholder="Tell us what you're building…"
              required
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
            />
          </div>
          {error ? (
            <p className="microcopy" style={{ color: "#b8443b" }}>
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn--primary">
            {submitted ? "Sent — we'll be in touch" : "Send message"}
          </button>
        </form>

        <p className="microcopy center">
          Prefer to talk? <strong>support@unitywall.co</strong> · (615) 424-3176
        </p>
      </article>
    </section>
  );
}
