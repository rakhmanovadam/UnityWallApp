"use client";

import { useEffect, useRef, useState } from "react";

// One row of the admin_master_emails view (see migration 0003 + the
// /api/admin/emails route). `name` is a single combined field — the view
// doesn't split first/last.
export type MasterRow = {
  email: string;
  name: string | null;
  lead_temperature: "cold" | "warm" | "hot";
  person_type: "guest" | "venue_host";
  converted: boolean;
  converted_at: string | null;
  marketing_opt_in: boolean;
  joined_at: string | null;
  photos_uploaded: number;
  verified_events: number;
};

export type FunnelCounts = {
  cold: number;
  warm: number;
  hot: number;
  converted: number;
};

type ApiResponse = {
  items: MasterRow[];
  total: number;
  counts: FunnelCounts;
  pagination: { limit: number; offset: number };
};

type Temperature = "" | "cold" | "warm" | "hot";
type PersonType = "" | "guest" | "venue_host";
type Converted = "" | "true" | "false";

const LIMIT = 50;

const EMPTY_COUNTS: FunnelCounts = { cold: 0, warm: 0, hot: 0, converted: 0 };

// Interactive master collected-emails table. Reads the existing
// /api/admin/emails endpoint (auth-gated server-side). When the server hands
// down `initial`, the first render uses it directly so there's no load flash;
// any filter/paging interaction re-fetches client-side.
export default function MasterEmails({
  initial,
}: {
  initial?: { items: MasterRow[]; total: number; counts: FunnelCounts };
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [temperature, setTemperature] = useState<Temperature>("");
  const [personType, setPersonType] = useState<PersonType>("");
  const [converted, setConverted] = useState<Converted>("");
  const [offset, setOffset] = useState(0);

  const [items, setItems] = useState<MasterRow[]>(initial?.items ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [counts, setCounts] = useState<FunnelCounts>(
    initial?.counts ?? EMPTY_COUNTS,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Emails whose converted PATCH is in flight — disables just that checkbox.
  const [savingEmails, setSavingEmails] = useState<Set<string>>(new Set());

  // Skip the first client fetch when the server already gave us page 1 with
  // default filters — otherwise fetch immediately on mount.
  const firstRun = useRef(true);
  const hasInitial = useRef(Boolean(initial));

  // Debounce the search box so keystrokes don't spam the endpoint.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Any filter change resets to page 1 via the onChange handlers below, so the
  // fetch effect only needs to watch the resolved values + offset.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (hasInitial.current) return; // SSR data already in state
    }

    const ctrl = new AbortController();
    setLoading(true);
    setError(false);

    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (temperature) params.set("temperature", temperature);
    if (personType) params.set("person_type", personType);
    if (converted) params.set("converted", converted);
    params.set("limit", String(LIMIT));
    params.set("offset", String(offset));

    fetch(`/api/admin/emails?${params.toString()}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status_${res.status}`);
        const data = (await res.json()) as ApiResponse;
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
        setCounts(data.counts ?? EMPTY_COUNTS);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(true);
      })
      .finally(() => {
        // Guard against a stale response flipping loading off after a newer
        // request already turned it on.
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [debouncedQ, temperature, personType, converted, offset]);

  function resetPageAnd<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setOffset(0);
    };
  }

  const setTemp = resetPageAnd(setTemperature);
  const setType = resetPageAnd(setPersonType);
  const setConv = resetPageAnd(setConverted);

  // Manual "actually bought from UnityWall" toggle. Optimistic: the checkbox
  // and the Converted counter flip immediately and revert if the PATCH fails.
  async function toggleConverted(row: MasterRow) {
    const next = !row.converted;
    setSavingEmails((prev) => new Set(prev).add(row.email));
    setItems((prev) =>
      prev.map((r) =>
        r.email === row.email ? { ...r, converted: next } : r,
      ),
    );
    setCounts((prev) => ({
      ...prev,
      converted: Math.max(0, prev.converted + (next ? 1 : -1)),
    }));
    try {
      const res = await fetch("/api/admin/emails", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: row.email, converted: next }),
      });
      if (!res.ok) throw new Error("patch_failed");
    } catch {
      setItems((prev) =>
        prev.map((r) =>
          r.email === row.email ? { ...r, converted: row.converted } : r,
        ),
      );
      setCounts((prev) => ({
        ...prev,
        converted: Math.max(0, prev.converted + (next ? -1 : 1)),
      }));
    } finally {
      setSavingEmails((prev) => {
        const copy = new Set(prev);
        copy.delete(row.email);
        return copy;
      });
    }
  }

  function clearFilters() {
    setQ("");
    setDebouncedQ("");
    setTemperature("");
    setPersonType("");
    setConverted("");
    setOffset(0);
  }

  const hasFilters =
    Boolean(q) || Boolean(temperature) || Boolean(personType) || Boolean(converted);

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + LIMIT, total);
  const canPrev = offset > 0;
  const canNext = offset + LIMIT < total;

  return (
    <div>
      {/* Funnel snapshot */}
      <div className="metrics metrics--admin" style={{ marginBottom: 18 }}>
        <div className="metric">
          <span className="metric__n">{counts.cold.toLocaleString()}</span>
          <span className="kicker kicker--mute">Cold</span>
        </div>
        <div className="metric">
          <span className="metric__n metric__n--dusk">
            {counts.warm.toLocaleString()}
          </span>
          <span className="kicker kicker--mute">Warm</span>
        </div>
        <div className="metric">
          <span className="metric__n metric__n--dusk">
            {counts.hot.toLocaleString()}
          </span>
          <span className="kicker kicker--mute">Hot</span>
        </div>
        <div className="metric">
          <span className="metric__n">{counts.converted.toLocaleString()}</span>
          <span className="kicker kicker--mute">Converted</span>
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <div className="field field--inline" style={{ flex: "1 1 200px" }}>
          <input
            type="search"
            inputMode="search"
            placeholder="Search email or name…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            aria-label="Search collected emails"
          />
        </div>
        <select
          value={temperature}
          onChange={(e) => setTemp(e.target.value as Temperature)}
          aria-label="Filter by temperature"
          style={selectStyle}
        >
          <option value="">All temps</option>
          <option value="cold">Cold</option>
          <option value="warm">Warm</option>
          <option value="hot">Hot</option>
        </select>
        <select
          value={personType}
          onChange={(e) => setType(e.target.value as PersonType)}
          aria-label="Filter by person type"
          style={selectStyle}
        >
          <option value="">All types</option>
          <option value="guest">Guest</option>
          <option value="venue_host">Venue host</option>
        </select>
        <select
          value={converted}
          onChange={(e) => setConv(e.target.value as Converted)}
          aria-label="Filter by converted"
          style={selectStyle}
        >
          <option value="">Any status</option>
          <option value="true">Converted</option>
          <option value="false">Not converted</option>
        </select>
        {hasFilters ? (
          <button
            type="button"
            className="btn btn--inline"
            onClick={clearFilters}
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Table */}
      {error ? (
        <div className="info">
          <div className="info__head">
            <span className="dot dot--amber" />
            Couldn&apos;t load emails
          </div>
          <div className="info__body">
            <button
              type="button"
              className="btn btn--inline"
              onClick={() => setOffset((o) => o)}
            >
              Retry
            </button>
          </div>
        </div>
      ) : items.length === 0 && !loading ? (
        <div className="info">
          <div className="info__head">
            <span className="dot dot--dusk" />
            {hasFilters ? "No matches" : "No emails yet"}
          </div>
          <div className="info__body">
            {hasFilters
              ? "No collected emails match these filters."
              : "Collected guest and host emails will show up here."}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: "auto", opacity: loading ? 0.55 : 1 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Temp</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Converted</th>
                <th style={thStyle}>Opt-in</th>
                <th style={thStyle}>Joined</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Photos</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.email}>
                  <td style={tdStyle}>{row.email}</td>
                  <td style={tdStyle}>{row.name ?? "—"}</td>
                  <td style={tdStyle}>
                    <span
                      className={
                        "lead__tag" +
                        (row.lead_temperature === "hot"
                          ? " lead__tag--hot"
                          : row.lead_temperature === "warm"
                            ? " lead__tag--warm"
                            : "")
                      }
                    >
                      {cap(row.lead_temperature)}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {row.person_type === "venue_host" ? "Venue host" : "Guest"}
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      checked={row.converted}
                      disabled={savingEmails.has(row.email)}
                      onChange={() => void toggleConverted(row)}
                      title={
                        row.converted
                          ? `Bought from UnityWall${row.converted_at ? ` · ${fmtDate(row.converted_at)}` : ""}`
                          : "Mark as bought from UnityWall"
                      }
                      aria-label={`Mark ${row.email} as converted`}
                      style={{ width: 16, height: 16, cursor: "pointer" }}
                    />
                  </td>
                  <td style={tdStyle}>
                    {row.marketing_opt_in ? (
                      <span title="Opted in to marketing emails">✓</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={tdStyle}>{fmtDate(row.joined_at)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {row.photos_uploaded.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > 0 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 14,
          }}
        >
          <span className="microcopy">
            {from.toLocaleString()}–{to.toLocaleString()} of{" "}
            {total.toLocaleString()}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn--inline"
              disabled={!canPrev || loading}
              onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btn--inline"
              disabled={!canNext || loading}
              onClick={() => setOffset((o) => o + LIMIT)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

const selectStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid rgba(20,20,30,0.14)",
  background: "#fff",
  fontFamily: "inherit",
  fontSize: 14,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
  minWidth: 620,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid rgba(20,20,30,0.12)",
  fontWeight: 600,
  fontSize: 12,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "rgba(20,20,30,0.55)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid rgba(20,20,30,0.06)",
  whiteSpace: "nowrap",
};
