"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import imageCompression from "browser-image-compression";

// A single row in the upload UI. Files never leave the tab as bytes — only
// this metadata is persisted (see sessionStorage handling below), and the
// File object stays in the in-memory map keyed by item.id.
type UploadItem = {
  id: string;
  name: string;
  size: number;
  status:
    | "queued"      // waiting for the sequential worker
    | "waiting"     // browser is offline; will resume on 'online' event
    | "compressing" // client-side shrink before signed upload
    | "uploading"   // PUT to Supabase Storage
    | "processing"  // finalize route running sharp/HEIC → thumb
    | "done"
    | "error";
  progress: number;
  thumbDataUrl?: string;
  error?: string;
  // When set, finalize crashed but the object is up in storage; a Retry can
  // skip re-uploading and just re-call /api/uploads/finalize.
  photoId?: string;
};

const MAX_BYTES = 25_000_000;
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// HEIC / HEIF decoders don't run reliably in browsers — the file gets sent
// as-is and sharp on the server converts it. Everything else runs through
// browser-image-compression so venue Wi-Fi carries 1–2 MB per photo instead
// of 10.
const HEIC_TYPES = new Set(["image/heic", "image/heif"]);

// Persist a tiny snapshot of the queue so a reload during an event doesn't
// leave the host wondering whether their photos landed. Bytes aren't
// persisted (would need IndexedDB + quota handling); on reload the surviving
// rows appear as "error · reload interrupted" with a re-pick prompt, except
// for rows that already reached the "processing" phase — those had their
// object uploaded and can be finalized just by pressing Retry.
const STORAGE_KEY_PREFIX = "uw_upload_queue:";

function localId() {
  return Math.random().toString(36).slice(2, 10);
}

async function readPreview(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      resolve(undefined);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

function metaFor(it: UploadItem) {
  const mb = it.size ? (it.size / (1024 * 1024)).toFixed(1) + " MB" : "";
  if (it.status === "queued") return "queued";
  if (it.status === "waiting") return "waiting for connection";
  if (it.status === "compressing") return "compressing…";
  if (it.status === "uploading") {
    return `uploading · ${Math.round(it.progress)}%`;
  }
  if (it.status === "processing") return "processing…";
  if (it.status === "error") return it.error ?? "error";
  return (mb ? mb + " · " : "") + "on the wall";
}

// Rough server-side finalize cost per photo (sharp decode + thumb + signed
// URL round-trips). Folded into the ETA so it doesn't sit at "0s left" while
// rows say "processing…".
const FINALIZE_SEC = 2;

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 10) return "a few seconds left";
  if (seconds < 60) return `about ${Math.ceil(seconds / 5) * 5}s left`;
  const mins = Math.floor(seconds / 60);
  const rest = Math.round((seconds % 60) / 15) * 15;
  return rest > 0
    ? `about ${mins}m ${rest}s left`
    : `about ${mins}m left`;
}

export default function UploadForm({
  code,
  limit,
  usedInitial = 0,
}: {
  code: string;
  // Per-guest photo cap (events.max_uploads_per_guest). Undefined = unknown,
  // hide the allowance UI rather than guess.
  limit?: number;
  // Photos this guest had already landed before this session, from the server.
  usedInitial?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  // Count of "done" rows present right after rehydration — those were already
  // counted in usedInitial (they're prior-session uploads the server knows
  // about), so they must not be double-counted in the live allowance tally.
  const baselineDoneRef = useRef(0);
  const [online, setOnline] = useState(true);
  // Smoothed upload throughput (bytes/sec) measured from XHR progress
  // events. EMA keeps the ETA from jumping around on bursty venue Wi-Fi.
  const [speed, setSpeed] = useState(0);
  const speedSampleRef = useRef<{ t: number; loaded: number } | null>(null);
  const speedRef = useRef(0);
  // Ids currently being deleted, so the row's Remove button shows progress and
  // can't be double-fired.
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  // Count of files skipped on the last pick because a same-named file was
  // already in the queue. Shown as a dismissable notice.
  const [dupSkipped, setDupSkipped] = useState(0);
  // Count of files skipped on the last pick because they'd exceed this guest's
  // per-wall photo allowance.
  const [limitSkipped, setLimitSkipped] = useState(0);

  // File objects live outside React state — putting them in state would blow
  // out re-renders and set us up for stale-file bugs on retry. The map is
  // keyed by item.id so a UI retry click can find the original File.
  const filesRef = useRef<Map<string, File>>(new Map());
  // Single sequential worker guard: uploads run one at a time on a phone
  // uplink, and this flag prevents multiple pickers or retries from starting
  // parallel workers.
  const workerBusyRef = useRef(false);

  const storageKey = `${STORAGE_KEY_PREFIX}${code}`;

  // Rehydrate the queue snapshot on first mount. We only surface rows that
  // were done or had already reached the processing stage — everything else
  // is a lost cause without the bytes and would just be UX noise.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const rows = JSON.parse(raw) as UploadItem[];
      const surviving = rows
        .map((r) => {
          if (r.status === "done") return r;
          // A row with a photoId is one whose object made it into storage;
          // Retry will just re-run finalize. Everything else is orphaned by
          // the reload and gets marked as such.
          if (r.photoId) {
            return {
              ...r,
              status: "error" as const,
              error: "resume needed — tap retry",
              progress: 100,
            };
          }
          return {
            ...r,
            status: "error" as const,
            error: "interrupted — re-pick the file",
          };
        })
        .slice(0, 200); // keep the UI snappy
      baselineDoneRef.current = surviving.filter(
        (r) => r.status === "done",
      ).length;
      if (surviving.length > 0) setItems(surviving);
    } catch {
      // Corrupt cache; forget it silently rather than blocking the page.
    }
  }, [storageKey]);

  // Persist on every items change. The debounced-write pattern isn't worth
  // it here — sessionStorage is fast and events don't rapidly churn during
  // upload progress (progress lives on the row, but we only write id / name
  // / status / photoId).
  useEffect(() => {
    try {
      const snapshot = items.map(({ id, name, size, status, photoId }) => ({
        id,
        name,
        size,
        status,
        photoId,
        progress: 0,
      }));
      sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
      // Storage quota; silently ignore.
    }
  }, [items, storageKey]);

  // Track offline/online state so we can pause the worker cleanly. Some
  // browsers fire 'online' even for cases where fetch still fails, so the
  // worker treats a real fetch failure as authoritative.
  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    function onOnline() {
      setOnline(true);
    }
    function onOffline() {
      setOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  }

  // Client-side compression. HEIC/HEIF pass through (browsers can't decode
  // them). Everything else targets ≤ 2 MB, max dimension 2560px, preserving
  // EXIF orientation (server-side sharp also auto-orients, but this keeps
  // the client preview correct too).
  async function maybeCompress(file: File): Promise<File> {
    if (HEIC_TYPES.has(file.type)) return file;
    // Small files aren't worth touching — the round-trip cost of decoding +
    // re-encoding often beats the network savings.
    if (file.size <= 1_500_000) return file;
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 2,
        maxWidthOrHeight: 2560,
        useWebWorker: true,
        // Preserve original type when possible — jpeg stays jpeg, png stays
        // png. The lib produces jpeg fallbacks for exotic formats; that's
        // fine because our finalize pipeline also accepts jpeg.
        fileType: file.type,
      });
      // Wrap as File to preserve the name (Blob-only outputs break `name`
      // on the finalize side).
      return new File([compressed], file.name, {
        type: compressed.type,
        lastModified: file.lastModified,
      });
    } catch {
      // Compression failure isn't fatal — upload the original.
      return file;
    }
  }

  const processQueue = useCallback(async () => {
    if (workerBusyRef.current) return;
    workerBusyRef.current = true;

    // The worker keeps pulling until nothing is left in a runnable state.
    // A snapshot per-iteration avoids stale-closure bugs since setItems is
    // async and we check the latest state each turn.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Find the next item in queued state that also has its File.
      const next = await new Promise<UploadItem | null>((resolve) => {
        setItems((prev) => {
          const runnable = prev.find(
            (it) => it.status === "queued" && filesRef.current.has(it.id),
          );
          resolve(runnable ?? null);
          return prev;
        });
      });
      if (!next) break;

      // If the browser thinks we're offline, park everything queued until
      // 'online' fires again. Worker exits so the next pass has a fresh
      // busy=false.
      if (!navigator.onLine) {
        setItems((prev) =>
          prev.map((it) =>
            it.status === "queued" ? { ...it, status: "waiting" } : it,
          ),
        );
        break;
      }

      const file = filesRef.current.get(next.id);
      if (!file) {
        updateItem(next.id, {
          status: "error",
          error: "file missing — re-pick",
        });
        continue;
      }

      await runOne(next, file);
    }

    workerBusyRef.current = false;
  }, []);

  // A single upload run, callable both from the queue worker and directly
  // from a retry click. If photoId is already known the init step is
  // skipped and we jump straight to finalize.
  async function runOne(item: UploadItem, file: File) {
    // If a prior run already reached finalize (photoId set, object uploaded)
    // we only need to poke finalize again.
    const skipToFinalize = Boolean(item.photoId);

    try {
      let photoId = item.photoId;

      if (!skipToFinalize) {
        // Compress before init so the size we quote is the size we send.
        updateItem(item.id, { status: "compressing", progress: 0 });
        const prepared = await maybeCompress(file);
        // Swap the File in the ref so retry gets the compressed version too.
        filesRef.current.set(item.id, prepared);

        updateItem(item.id, {
          status: "uploading",
          progress: 0,
          size: prepared.size,
        });

        const initRes = await fetch("/api/uploads/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: prepared.name,
            content_type: prepared.type,
            bytes: prepared.size,
          }),
        });
        if (!initRes.ok) {
          const data = (await initRes.json().catch(() => ({}))) as {
            error?: string;
          };
          const reason =
            data.error === "unauthorized"
              ? "sign in first"
              : data.error === "file_too_large"
                ? "max 25 MB"
                : data.error === "invalid_body"
                  ? "format not supported"
                  : data.error === "uploads_closed"
                    ? "the host closed uploads"
                    : data.error === "event_not_live"
                      ? "wall isn't live"
                      : data.error === "upload_limit_reached"
                        ? "photo limit reached"
                        : "couldn't start upload";
          updateItem(item.id, { status: "error", error: reason });
          return;
        }

        const init = (await initRes.json()) as {
          photo_id: string;
          upload_url: string;
        };
        photoId = init.photo_id;
        updateItem(item.id, { photoId });

        // PUT the compressed file to Supabase.
        speedSampleRef.current = null; // fresh XHR — loaded counter restarts
        const putOk = await new Promise<boolean>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", init.upload_url, true);
          xhr.setRequestHeader("Content-Type", prepared.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              updateItem(item.id, { progress: (e.loaded / e.total) * 100 });
              // Sample throughput between progress events; EMA (α=0.3)
              // smooths spikes. Samples under 250ms apart are noise.
              const now = performance.now();
              const prev = speedSampleRef.current;
              if (prev && now - prev.t >= 250 && e.loaded > prev.loaded) {
                const inst = ((e.loaded - prev.loaded) / (now - prev.t)) * 1000;
                const ema = speedRef.current
                  ? speedRef.current * 0.7 + inst * 0.3
                  : inst;
                speedRef.current = ema;
                setSpeed(ema);
                speedSampleRef.current = { t: now, loaded: e.loaded };
              } else if (!prev) {
                speedSampleRef.current = { t: now, loaded: e.loaded };
              }
            }
          };
          xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
          xhr.onerror = () => resolve(false);
          xhr.ontimeout = () => resolve(false);
          xhr.send(prepared);
        });
        if (!putOk) {
          updateItem(item.id, { status: "error", error: "upload failed" });
          return;
        }
      }

      updateItem(item.id, { status: "processing", progress: 100 });

      const finRes = await fetch("/api/uploads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_id: photoId }),
      });
      if (!finRes.ok) {
        const data = (await finRes.json().catch(() => ({}))) as {
          error?: string;
        };
        updateItem(item.id, {
          status: "error",
          error:
            data.error === "unsupported_image"
              ? "couldn't read image"
              : "processing failed",
        });
        return;
      }
      updateItem(item.id, { status: "done" });
    } catch {
      updateItem(item.id, { status: "error", error: "network" });
    }
  }

  // Browser notification when the batch finishes while the guest is in
  // another app/tab. Permission is requested at upload start (a user
  // gesture just happened, so the prompt isn't out of the blue). Note: on
  // iOS Safari the Notification API only exists for installed home-screen
  // web apps — the `"Notification" in window` guard makes it a quiet no-op
  // there.
  const batchActiveRef = useRef(false);
  useEffect(() => {
    const total = items.length;
    if (total === 0) return;
    const done = items.filter((i) => i.status === "done").length;
    const errored = items.filter((i) => i.status === "error").length;
    const active = done + errored < total;

    if (active && !batchActiveRef.current) {
      batchActiveRef.current = true;
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    } else if (!active && batchActiveRef.current) {
      batchActiveRef.current = false;
      if (
        document.visibilityState === "hidden" &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification("Unitywalls", {
            body:
              errored > 0
                ? `${done} photo${done === 1 ? "" : "s"} on the wall · ${errored} need a retry`
                : `All ${done} photo${done === 1 ? "" : "s"} are on the wall 🎉`,
          });
        } catch {
          // Some browsers require a service worker for constructor
          // notifications; nothing to do — the in-page status still shows.
        }
      }
    }
  }, [items]);

  // Kick the worker whenever queued items appear or the network comes back.
  useEffect(() => {
    const hasQueued = items.some(
      (it) => it.status === "queued" || (it.status === "waiting" && online),
    );
    if (!hasQueued) return;
    // Waiting items should flip back to queued when we're online again.
    if (online) {
      setItems((prev) =>
        prev.map((it) =>
          it.status === "waiting" ? { ...it, status: "queued" } : it,
        ),
      );
    }
    void processQueue();
  }, [items, online, processQueue]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Reject duplicates by filename. Seed the set with every filename already
    // in the queue (any status), then also dedupe within this same batch — so
    // picking two files both named adam123.png only keeps the first.
    const seen = new Set(items.map((it) => it.name.trim().toLowerCase()));
    let skipped = 0;
    let overLimit = 0;
    // Headroom against the per-guest cap: photos the server already knows about
    // (usedInitial, which includes rehydrated "done" rows) plus everything
    // still in flight or freshly landed this session (non-error rows beyond the
    // rehydrated baseline). Undefined/zero limit means no cap.
    const capped = typeof limit === "number" && limit > 0;
    const active =
      items.filter((it) => it.status !== "error").length -
      baselineDoneRef.current;
    const effectiveUsed = usedInitial + Math.max(0, active);
    let headroom = capped
      ? Math.max(0, (limit as number) - effectiveUsed)
      : Infinity;
    const toEnqueue: UploadItem[] = [];
    for (const file of Array.from(files)) {
      if (!ALLOWED.has(file.type)) continue;
      const dedupeKey = file.name.trim().toLowerCase();
      if (seen.has(dedupeKey)) {
        skipped++;
        continue;
      }
      seen.add(dedupeKey);
      const id = localId();
      if (file.size > MAX_BYTES) {
        // Oversized rows are rejected client-side and never reach storage, so
        // they don't consume the guest's allowance.
        toEnqueue.push({
          id,
          name: file.name,
          size: file.size,
          status: "error",
          progress: 0,
          error: "max 25 MB",
        });
        continue;
      }
      if (headroom <= 0) {
        overLimit++;
        continue;
      }
      headroom--;
      const preview = await readPreview(file);
      filesRef.current.set(id, file);
      toEnqueue.push({
        id,
        name: file.name,
        size: file.size,
        status: navigator.onLine ? "queued" : "waiting",
        progress: 0,
        thumbDataUrl: preview,
      });
    }
    setItems((prev) => [...prev, ...toEnqueue]);
    setDupSkipped(skipped);
    setLimitSkipped(overLimit);
    if (inputRef.current) inputRef.current.value = "";
  }

  // Remove a photo the guest already landed on the wall. Only "done" rows
  // carry a photoId; the server re-checks ownership against the guest cookie,
  // so a tampered id just 404s. On success (or a 404 — already gone) the row
  // and its cached File are dropped.
  async function removePhoto(id: string) {
    const item = items.find((it) => it.id === id);
    if (!item?.photoId) return;
    setRemoving((prev) => new Set(prev).add(id));
    try {
      const res = await fetch("/api/uploads/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_id: item.photoId }),
      });
      if (res.ok || res.status === 404) {
        filesRef.current.delete(id);
        setItems((prev) => prev.filter((it) => it.id !== id));
      }
    } catch {
      // Leave the row in place so the guest can try again.
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function retry(id: string) {
    const item = items.find((it) => it.id === id);
    if (!item) return;
    // If bytes are gone (post-reload) and we don't have a photoId, prompt
    // the user to re-pick — nothing to do here.
    if (!filesRef.current.has(id) && !item.photoId) {
      updateItem(id, { error: "re-pick the file, then retry" });
      return;
    }
    updateItem(id, {
      status: navigator.onLine ? "queued" : "waiting",
      error: undefined,
      progress: 0,
    });
  }

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const errored = items.filter((i) => i.status === "error").length;
  const uploading = total > 0 && online && done + errored < total;
  const stateLabel =
    total === 0
      ? "Idle"
      : !online
        ? "Offline"
        : !uploading
          ? errored > 0
            ? `${errored} to retry`
            : "Done"
          : "Uploading";
  const barPct = total ? (done / total) * 100 : 0;

  // Live allowance: photos already on the server (usedInitial) plus what this
  // session newly landed (done beyond the rehydrated baseline). Clamped ≥0 so
  // removes can't push it negative mid-render.
  const hasLimit = typeof limit === "number" && limit > 0;
  const landed = Math.max(0, usedInitial + (done - baselineDoneRef.current));
  const remaining = hasLimit ? Math.max(0, (limit as number) - landed) : Infinity;
  const atLimit = hasLimit && remaining <= 0;

  // Time remaining = bytes still to send at the measured throughput, plus a
  // flat finalize allowance per photo that hasn't landed yet. Hidden until
  // the first speed sample exists (nothing to estimate from before that).
  let etaText = "";
  if (uploading && speed > 0) {
    let bytesLeft = 0;
    let pendingCount = 0;
    for (const it of items) {
      if (
        it.status === "queued" ||
        it.status === "waiting" ||
        it.status === "compressing"
      ) {
        bytesLeft += it.size;
        pendingCount++;
      } else if (it.status === "uploading") {
        bytesLeft += it.size * (1 - it.progress / 100);
        pendingCount++;
      } else if (it.status === "processing") {
        pendingCount++;
      }
    }
    etaText = formatEta(bytesLeft / speed + pendingCount * FINALIZE_SEC);
  }

  return (
    <>
      <label
        className={"dropzone" + (atLimit ? " dropzone--disabled" : "")}
        htmlFor="file-input"
      >
        <input
          id="file-input"
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          disabled={atLimit}
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <span className="dropzone__plus" aria-hidden="true">
          +
        </span>
        <span className="dropzone__t">
          {atLimit ? "Photo limit reached" : "Tap to add photos"}
        </span>
      </label>

      {hasLimit ? (
        <p
          className="upload__allowance"
          role="status"
          style={atLimit ? { color: "#b8443b" } : undefined}
        >
          {atLimit
            ? `You've reached your ${limit}-photo limit for this wall.`
            : `${landed} of ${limit} photos used · ${remaining} left`}
        </p>
      ) : null}

      {limitSkipped > 0 ? (
        <p
          className="microcopy"
          style={{ marginTop: 10, color: "#b8443b" }}
          role="status"
        >
          Skipped {limitSkipped} photo{limitSkipped === 1 ? "" : "s"} — that
          would pass your {limit}-photo limit for this wall.
        </p>
      ) : null}

      {dupSkipped > 0 ? (
        <p
          className="microcopy"
          style={{ marginTop: 10, color: "#b8443b" }}
          role="status"
        >
          Skipped {dupSkipped} duplicate{dupSkipped === 1 ? "" : "s"} — a photo
          with the same file name was already added.
        </p>
      ) : null}

      {!online ? (
        <p
          className="microcopy"
          style={{ marginTop: 10, color: "#b8443b" }}
          role="status"
        >
          You&apos;re offline. Photos stay queued and upload the moment you
          reconnect.
        </p>
      ) : null}

      <div className="upload__status">
        <span id="upload-count">{`${done} of ${total} added to the wall`}</span>
        <span className="kicker kicker--mute" id="upload-state">
          {etaText ? `${stateLabel} · ${etaText}` : stateLabel}
        </span>
      </div>
      <div className="upload__bar" aria-hidden="true">
        <div id="upload-bar-fill" style={{ width: `${barPct}%` }} />
      </div>
      {uploading ? (
        <p className="microcopy" role="status" style={{ marginTop: 8 }}>
          Don&apos;t close this website while photos upload — switching to
          another app for a moment is fine. We&apos;ll notify you when
          everything&apos;s on the wall.
        </p>
      ) : null}

      <ul id="upload-list" className="upload__list" role="list">
        {items.map((it, idx) => (
          <li
            key={it.id}
            className="uprow"
            style={{ animationDelay: `${idx * 60}ms` }}
          >
            <div
              className="uprow__thumb"
              style={
                it.thumbDataUrl
                  ? { backgroundImage: `url(${it.thumbDataUrl})` }
                  : undefined
              }
            />
            <div className="uprow__body">
              <div className="uprow__name">{it.name}</div>
              <div className="uprow__meta">{metaFor(it)}</div>
            </div>
            {it.status === "done" ? (
              <div className="uprow__done">
                <span className="uprow__state uprow__state--done">✓</span>
                <button
                  type="button"
                  className="ulink uprow__remove"
                  onClick={() => removePhoto(it.id)}
                  disabled={removing.has(it.id)}
                  aria-label={`Remove ${it.name} from the wall`}
                >
                  {removing.has(it.id) ? "Removing…" : "Remove"}
                </button>
              </div>
            ) : it.status === "error" ? (
              <button
                type="button"
                className="ulink"
                onClick={() => retry(it.id)}
                aria-label={`Retry uploading ${it.name}`}
              >
                Retry
              </button>
            ) : it.status === "waiting" ? (
              <span
                className="uprow__state"
                title="Waiting for connection"
                aria-label="Waiting for connection"
              >
                ⏸
              </span>
            ) : (
              <span className="uprow__state uprow__state--spin" />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
