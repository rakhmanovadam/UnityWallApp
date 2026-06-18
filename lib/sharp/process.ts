import sharp from "sharp";

export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const MAX_BYTES = 25_000_000;
export const THUMB_WIDTH = 480;
export const FULL_MAX_DIMENSION = 2400;

export function extForContentType(ct: string): string {
  switch (ct) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
    case "image/heif":
      return "heic";
    default:
      return "bin";
  }
}

export type ProcessResult = {
  fullBuffer: Buffer;
  fullContentType: "image/jpeg" | "image/png" | "image/webp";
  thumbBuffer: Buffer;
  width: number;
  height: number;
};

// Strips EXIF (kills GPS leaks), auto-orients from EXIF rotation, converts
// HEIC/HEIF to JPEG, caps the longest edge at FULL_MAX_DIMENSION, and emits a
// 480px-wide thumb. Throws on unreadable input — caller maps to 415/400.
export async function processImage(
  input: Buffer,
  inputContentType: string,
): Promise<ProcessResult> {
  // sharp can fail to read HEIC on hosts without libheif (notably some
  // serverless runtimes). We let it surface — proxy.ts caps upload size, so
  // the throw budget is small.
  const base = sharp(input, { failOn: "truncated" }).rotate();
  const meta = await base.metadata();

  if (!meta.width || !meta.height) {
    throw new Error("unreadable_image");
  }

  // Default sharp behavior already strips all metadata (EXIF/IPTC/XMP);
  // never call .keepMetadata() here or GPS coords leak.
  let pipeline = base;

  if (Math.max(meta.width, meta.height) > FULL_MAX_DIMENSION) {
    pipeline = pipeline.resize({
      width: meta.width >= meta.height ? FULL_MAX_DIMENSION : undefined,
      height: meta.height > meta.width ? FULL_MAX_DIMENSION : undefined,
      withoutEnlargement: true,
    });
  }

  let fullContentType: "image/jpeg" | "image/png" | "image/webp";
  let fullBuffer: Buffer;

  if (inputContentType === "image/png") {
    fullContentType = "image/png";
    fullBuffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (inputContentType === "image/webp") {
    fullContentType = "image/webp";
    fullBuffer = await pipeline.webp({ quality: 82 }).toBuffer();
  } else {
    fullContentType = "image/jpeg";
    fullBuffer = await pipeline
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
  }

  const finalMeta = await sharp(fullBuffer).metadata();

  const thumbBuffer = await sharp(fullBuffer)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();

  return {
    fullBuffer,
    fullContentType,
    thumbBuffer,
    width: finalMeta.width ?? meta.width,
    height: finalMeta.height ?? meta.height,
  };
}
