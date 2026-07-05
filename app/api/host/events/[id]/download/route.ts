import { z } from "zod";
import { Zip, ZipPassThrough } from "fflate";
import { requireOwnedEvent } from "@/lib/host-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTOS_BUCKET } from "@/lib/db/photos";

export const runtime = "nodejs";
// Weddings routinely produce >60 MB of approved photos. Vercel Node functions
// stream out fine at this length, but the walltime cap has to be raised —
// Hobby caps at 60s, Pro at 300s. 300 is the conservative safe ceiling.
export const maxDuration = 300;

const ParamsSchema = z.object({ id: z.string().uuid() });

// Fetches every approved photo for the event and streams a ZIP archive of
// their full-resolution originals. Behavior:
//   - The response body is a ReadableStream backed by fflate's Zip so nothing
//     is buffered in memory; the archive is emitted as its parts complete.
//   - Photos are downloaded from the private wall-photos bucket via the
//     service-role client — this route never returns signed URLs to the
//     client because that would let anyone with the URL exfiltrate photos.
//   - Names inside the archive are stable and human-readable
//     (photo-0001-<uuid>.jpg) so a host can sort by capture order.
//   - A failure fetching any single photo is logged into the ZIP as a
//     placeholder text file and the archive continues — losing 200 photos
//     because photo #7's storage row rot-nulled would be a worse outcome.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const parsedParams = ParamsSchema.safeParse(await ctx.params);
  if (!parsedParams.success) {
    return jsonError("invalid_event", 400);
  }

  const owned = await requireOwnedEvent(parsedParams.data.id);
  if (!owned) return jsonError("forbidden", 403);

  const admin = createAdminClient();
  const { data: photos, error } = await admin
    .from("photos")
    .select("id, storage_path, content_type, uploaded_at")
    .eq("event_id", parsedParams.data.id)
    .eq("status", "approved")
    .order("uploaded_at", { ascending: true });

  if (error) return jsonError("list_failed", 500);

  const rows = photos ?? [];
  const filename = `unitywall-${owned.event.code}-photos.zip`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // controller already closed; ignore.
          }
        }
      };

      // fflate's Zip streams by invoking the callback for each output chunk.
      // `final` fires once at the end of the archive.
      const zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err);
          closed = true;
          return;
        }
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
          return;
        }
        if (final) close();
      });

      // No photos? Emit an empty archive (a valid ZIP by itself) so the
      // client still gets a downloadable file with a helpful readme instead
      // of a 404.
      if (rows.length === 0) {
        const readme = new ZipPassThrough("README.txt");
        zip.add(readme);
        readme.push(
          new TextEncoder().encode(
            "No approved photos on this wall yet. Come back once guests upload.",
          ),
          true,
        );
        zip.end();
        return;
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const humanIndex = String(i + 1).padStart(4, "0");
        const ext = extForType(row.content_type) ?? guessExtFromPath(
          row.storage_path,
        );
        const entryName = `photo-${humanIndex}-${row.id}.${ext}`;
        const entry = new ZipPassThrough(entryName);
        zip.add(entry);

        try {
          const { data, error: dlErr } = await admin.storage
            .from(PHOTOS_BUCKET)
            .download(row.storage_path);
          if (dlErr || !data) {
            throw new Error(dlErr?.message ?? "download_null");
          }
          const buf = new Uint8Array(await data.arrayBuffer());
          entry.push(buf, true);
        } catch (dlErr) {
          // Best-effort continuation. The archive keeps flowing so the host
          // still gets everything else. A tombstone entry documents the loss
          // so support has a paper trail.
          const msg =
            dlErr instanceof Error ? dlErr.message : "unknown_error";
          entry.push(
            new TextEncoder().encode(
              `This photo (${row.id}) failed to download: ${msg}\n`,
            ),
            true,
          );
        }
      }

      zip.end();
    },
    cancel() {
      // Client closed the connection — nothing to do; the async loop will
      // finish and the enqueue calls will no-op via the try/catch.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // The archive length isn't known until we finish streaming; omit
      // Content-Length so the browser accepts chunked transfer.
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extForType(ct: string | null): string | null {
  if (!ct) return null;
  if (ct === "image/jpeg") return "jpg";
  if (ct === "image/png") return "png";
  if (ct === "image/webp") return "webp";
  if (ct === "image/heic" || ct === "image/heif") return "heic";
  return null;
}

function guessExtFromPath(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "jpg";
}
