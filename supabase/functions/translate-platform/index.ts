import { getAuthenticatedProfile, jsonResponse } from "../_shared/auth.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const DEEPL_API_URL = "https://api.deepl.com/v2/translate";
const DEEPL_FREE_API_URL = "https://api-free.deepl.com/v2/translate";
const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 1000;
const ALLOWED_TARGETS = new Set(["EN", "EN-US", "EN-GB", "NL"]);
const ALLOWED_SOURCES = new Set(["NL", "EN"]);

function cleanTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const texts: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim();
    if (!text || text.length > MAX_TEXT_LENGTH || seen.has(text)) continue;
    seen.add(text);
    texts.push(text);
    if (texts.length >= MAX_ITEMS) break;
  }

  return texts;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  const auth = await getAuthenticatedProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const apiKey = Deno.env.get("DEEPL_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "DeepL API key niet geconfigureerd" }, 500, corsHeaders);
  }

  try {
    const body = await req.json();
    const sourceLang = String(body.source_lang ?? "NL").toUpperCase();
    const targetLang = String(body.target_lang ?? "EN-US").toUpperCase();
    const texts = cleanTexts(body.texts);

    if (!ALLOWED_SOURCES.has(sourceLang)) {
      return jsonResponse({ error: "source_lang wordt niet ondersteund" }, 400, corsHeaders);
    }

    if (!ALLOWED_TARGETS.has(targetLang)) {
      return jsonResponse({ error: "target_lang wordt niet ondersteund" }, 400, corsHeaders);
    }

    if (texts.length === 0) {
      return jsonResponse({ translations: [] }, 200, corsHeaders);
    }

    const params = new URLSearchParams();
    texts.forEach((text) => params.append("text", text));
    params.set("source_lang", sourceLang);
    params.set("target_lang", targetLang);
    params.set("tag_handling", "html");
    params.set("preserve_formatting", "1");

    const apiUrl = Deno.env.get("DEEPL_API_URL") ?? (apiKey.endsWith(":fx") ? DEEPL_FREE_API_URL : DEEPL_API_URL);
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    if (!response.ok) {
      const details = await response.text();
      console.error("DeepL API error", response.status, details);
      return jsonResponse({ error: "DeepL vertaling mislukt" }, response.status, corsHeaders);
    }

    const deepl = await response.json();
    const translations = (deepl.translations ?? []).map((item: { text?: string }, index: number) => ({
      source: texts[index],
      text: item.text ?? texts[index],
    }));

    return jsonResponse({ translations }, 200, corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("translate-platform error", error);
    return jsonResponse({ error: "Vertaling mislukt", details: message }, 500, corsHeaders);
  }
});
