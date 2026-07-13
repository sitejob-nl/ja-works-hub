import { createAdminClient, jsonResponse, requireRolePermission } from "../_shared/auth.ts";
import { CORS_HEADERS, serveEdge } from "../_shared/http.ts";

const BUCKET = "organization-logos";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function json(body: unknown, status = 200) {
  return jsonResponse(body, status, CORS_HEADERS);
}

function extensionFromName(name: string): string | null {
  const ext = name.split(".").pop()?.trim().toLowerCase();
  return ext && EXT_TO_MIME[ext] ? ext : null;
}

function normalizeImageType(file: File) {
  const declaredMime = file.type.trim().toLowerCase();
  const ext = extensionFromName(file.name);
  const mime = MIME_TO_EXT[declaredMime] ? declaredMime : ext ? EXT_TO_MIME[ext] : "";
  const normalizedExt = MIME_TO_EXT[mime] ?? (ext === "jpeg" ? "jpg" : ext);

  if (!mime || !normalizedExt) {
    throw new Error("Kies een JPG, PNG, WebP of GIF afbeelding");
  }

  return { mime, ext: normalizedExt };
}

function logoPathFromPublicUrl(urlValue: unknown, organizationId: string): string | null {
  if (!urlValue || typeof urlValue !== "string") return null;

  try {
    const url = new URL(urlValue);
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;

    const path = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    if (path.split("/")[0] !== organizationId) return null;
    return path || null;
  } catch {
    return null;
  }
}

Deno.serve(serveEdge(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireRolePermission(req, "settings.manage", CORS_HEADERS);
  if (auth instanceof Response) return auth;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "Logo ontbreekt" }, 400);
  if (file.size <= 0) return json({ error: "Logo is leeg" }, 400);
  if (file.size > MAX_LOGO_BYTES) return json({ error: "Logo mag maximaal 2 MB zijn" }, 400);

  const { mime, ext } = normalizeImageType(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("logo_url")
    .eq("id", auth.organizationId)
    .maybeSingle();
  if (orgError) throw orgError;

  const path = `${auth.organizationId}/logo-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, {
      cacheControl: "31536000",
      contentType: mime,
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(path);
  const logoUrl = publicUrlData.publicUrl;

  const { error: updateError } = await admin
    .from("organizations")
    .update({ logo_url: logoUrl })
    .eq("id", auth.organizationId);

  if (updateError) {
    await admin.storage.from(BUCKET).remove([path]);
    throw updateError;
  }

  const oldPath = logoPathFromPublicUrl(org?.logo_url, auth.organizationId);
  if (oldPath && oldPath !== path) {
    await admin.storage.from(BUCKET).remove([oldPath]);
  }

  return json({ logo_url: logoUrl, path });
}));
