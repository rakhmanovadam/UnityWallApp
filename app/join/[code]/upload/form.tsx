"use client";

import { useRef, useState } from "react";

type UploadItem = {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "processing" | "done" | "error";
  progress: number;
  thumbDataUrl?: string;
  error?: string;
};

const MAX_BYTES = 25_000_000;
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function localId() {
  return Math.random().toString(36).slice(2, 10);
}

function readPreview(file: File): Promise<string | undefined> {
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
  if (it.status === "uploading") {
    return `uploading · ${Math.round(it.progress)}%`;
  }
  if (it.status === "processing") return "processing…";
  if (it.status === "error") return it.error ?? "error";
  return (mb ? mb + " · " : "") + "on the wall";
}

export default function UploadForm({ code }: { code: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const stateLabel =
    total === 0 ? "Idle" : done === total ? "Done" : "Uploading";
  const barPct = total ? (done / total) * 100 : 0;

  function updateItem(id: string, patch: Partial<UploadItem>) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
  }

  async function uploadOne(item: UploadItem, file: File) {
    // 1. init: server inserts pending row + signed upload URL
    let initRes: Response;
    try {
      initRes = await fetch("/api/uploads/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          content_type: file.type,
          bytes: file.size,
        }),
      });
    } catch {
      updateItem(item.id, { status: "error", error: "network" });
      return;
    }

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
              : "couldn't start upload";
      updateItem(item.id, { status: "error", error: reason });
      return;
    }

    const init = (await initRes.json()) as {
      photo_id: string;
      upload_url: string;
    };

    // 2. PUT the file to Supabase, streaming xhr.upload.onprogress
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", init.upload_url, true);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          updateItem(item.id, { progress: (e.loaded / e.total) * 100 });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          updateItem(item.id, { status: "error", error: "upload failed" });
          resolve();
        }
      };
      xhr.onerror = () => {
        updateItem(item.id, { status: "error", error: "network" });
        resolve();
      };
      xhr.send(file);
    });

    if (items.find((i) => i.id === item.id)?.status === "error") return;

    // 3. finalize: server runs sharp, writes thumb, flips status
    updateItem(item.id, { status: "processing", progress: 100 });
    try {
      const finRes = await fetch("/api/uploads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_id: init.photo_id }),
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

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const toQueue: Array<{ item: UploadItem; file: File }> = [];
    for (const file of Array.from(files)) {
      if (!ALLOWED.has(file.type)) continue;
      if (file.size > MAX_BYTES) {
        const id = localId();
        toQueue.push({
          item: {
            id,
            name: file.name,
            size: file.size,
            status: "error",
            progress: 0,
            error: "max 25 MB",
          },
          file,
        });
        continue;
      }
      const preview = await readPreview(file);
      const id = localId();
      toQueue.push({
        item: {
          id,
          name: file.name,
          size: file.size,
          status: "uploading",
          progress: 0,
          thumbDataUrl: preview,
        },
        file,
      });
    }
    setItems((prev) => [...prev, ...toQueue.map((t) => t.item)]);
    // Kick off uploads sequentially — Supabase signed upload URLs don't
    // benefit from parallelism on a phone uplink.
    for (const { item, file } of toQueue) {
      if (item.status === "error") continue;
      await uploadOne(item, file);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <>
      <label className="dropzone" htmlFor="file-input">
        <input
          id="file-input"
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <span className="dropzone__plus" aria-hidden="true">
          +
        </span>
        <span className="dropzone__t">Tap to add photos</span>
      </label>

      <div className="upload__status">
        <span id="upload-count">{`${done} of ${total} added to the wall`}</span>
        <span className="kicker kicker--mute" id="upload-state">
          {stateLabel}
        </span>
      </div>
      <div className="upload__bar" aria-hidden="true">
        <div id="upload-bar-fill" style={{ width: `${barPct}%` }} />
      </div>

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
              <span className="uprow__state uprow__state--done">✓</span>
            ) : it.status === "uploading" || it.status === "processing" ? (
              <span className="uprow__state uprow__state--spin" />
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
