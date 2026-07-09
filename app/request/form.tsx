"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type FormState = {
  venue: string;
  contact: string;
  email: string;
  phone: string;
  events: string;
  address: string;
  website: string;
  about: string;
  tos: boolean;
};

const EMPTY: FormState = {
  venue: "",
  contact: "",
  email: "",
  phone: "",
  events: "",
  address: "",
  website: "",
  about: "",
  tos: false,
};

export default function RequestForm() {
  const router = useRouter();
  const [state, setState] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      id="apply-form"
      className="form form--apply"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!state.venue || !state.contact || !state.email || !state.tos) {
          setError("Fill required fields and accept the terms.");
          return;
        }
        setSubmitting(true);
        setError(null);
        try {
          // address + events_per_year + website live in notes — we don't
          // need columns for marketing fields.
          const notes = [
            state.events ? `Events/yr: ${state.events}` : null,
            state.address ? `Address: ${state.address}` : null,
            state.website ? `Website: ${state.website}` : null,
            state.about ? `\nAbout:\n${state.about}` : null,
          ]
            .filter(Boolean)
            .join("\n");

          const res = await fetch("/api/applications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              venue: state.venue,
              contact: state.contact,
              email: state.email,
              phone: state.phone || null,
              notes: notes || null,
            }),
          });
          if (!res.ok) {
            setError("Couldn't submit. Try again in a moment.");
            setSubmitting(false);
            return;
          }
          router.push("/request/sent");
        } catch {
          setError("Network error. Try again.");
          setSubmitting(false);
        }
      }}
    >
      <div className="field-block">
        <label className="label">Venue / business name</label>
        <div className="field">
          <input
            name="venue"
            placeholder="Copper to Gold"
            required
            value={state.venue}
            onChange={(e) => set("venue", e.target.value)}
          />
        </div>
      </div>
      <div className="field-block">
        <label className="label">Contact name</label>
        <div className="field">
          <input
            name="contact"
            placeholder="Elena Cho"
            required
            value={state.contact}
            onChange={(e) => set("contact", e.target.value)}
          />
        </div>
      </div>
      <div className="field-block">
        <label className="label">Email</label>
        <div className="field">
          <input
            name="email"
            type="email"
            placeholder="you@venue.co"
            required
            value={state.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
      </div>
      <div className="row-2">
        <div className="field-block">
          <label className="label">Phone</label>
          <div className="field">
            <input
              name="phone"
              placeholder="(615) 555-0148"
              value={state.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
        </div>
        <div className="field-block field-block--sm">
          <label className="label">Events / yr</label>
          <div className="field">
            <input
              name="events"
              placeholder="40–60"
              value={state.events}
              onChange={(e) => set("events", e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="field-block">
        <label className="label">Address</label>
        <div className="field">
          <input
            name="address"
            placeholder="214 Hagan St, Nashville TN"
            value={state.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </div>
      </div>
      <div className="field-block">
        <label className="label">Website</label>
        <div className="field">
          <input
            name="website"
            placeholder="coppertogold.co"
            value={state.website}
            onChange={(e) => set("website", e.target.value)}
          />
        </div>
      </div>
      <div className="field-block">
        <label className="label">About your venue</label>
        <div className="field field--ta">
          <textarea
            name="about"
            rows={3}
            placeholder="A restored 1920s foundry — weddings, dinners, and gallery nights."
            value={state.about}
            onChange={(e) => set("about", e.target.value)}
          />
        </div>
      </div>

      <label className="tos">
        <input
          type="checkbox"
          name="tos"
          required
          checked={state.tos}
          onChange={(e) => set("tos", e.target.checked)}
        />
        <span className="tos__box">
          <span>✓</span>
        </span>
        <span className="tos__text">
          I agree to the{" "}
          <Link className="ulink" href="/terms" target="_blank">
            Terms of Service
          </Link>{" "}
          and hosting guidelines. <span className="req">Required</span>
        </span>
      </label>
      {error ? (
        <p className="microcopy" style={{ color: "#b8443b" }}>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn btn--primary"
        disabled={submitting}
      >
        {submitting ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
