import type { MailAccountRow } from "./outlook-accounts.ts";

export const SIGNATURE_MARKER = "ja-werkt-signature";

export type SignatureContext = {
  senderName?: string | null;
  senderEmail?: string | null;
  mailboxEmail?: string | null;
  organizationName?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|form|input|button|meta|link)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|form|input|button|meta|link)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, "");
}

function replaceSignatureVariables(html: string, context: SignatureContext): string {
  const values: Record<string, string> = {
    "{{afzender_naam}}": context.senderName || "Het JA Werkt team",
    "{{afzender_email}}": context.senderEmail || "",
    "{{mailbox_email}}": context.mailboxEmail || context.senderEmail || "",
    "{{organisatie_naam}}": context.organizationName || "JA Werkt",
  };

  let result = html;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), escapeHtml(value));
  }
  return result;
}

function wrapSignature(html: string): string {
  if (html.includes(`data-signature="${SIGNATURE_MARKER}"`)) return html;
  return `<div data-signature="${SIGNATURE_MARKER}" style="margin-top:24px;">${html}</div>`;
}

function fallbackSignature(context: SignatureContext): string {
  const name = context.senderName?.trim() || "Het JA Werkt team";
  return `<div data-signature="${SIGNATURE_MARKER}" style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;color:#334155;font-size:14px;line-height:1.5;">
  <p style="margin:0;">Met vriendelijke groet,</p>
  <p style="margin:4px 0 0;font-weight:600;">${escapeHtml(name)}</p>
  <p style="margin:8px 0 0;color:#94a3b8;font-size:12px;">Verstuurd via JA Werkt</p>
</div>`;
}

export function signatureHtmlForAccount(account: MailAccountRow, context: SignatureContext): string | null {
  if (account.signature_enabled === false) return null;
  const customHtml = sanitizeEmailHtml(String(account.signature_html ?? "")).trim();
  if (customHtml) {
    return wrapSignature(replaceSignatureVariables(customHtml, {
      ...context,
      mailboxEmail: context.mailboxEmail || account.mailbox_email || account.from_email,
    }));
  }
  return fallbackSignature(context);
}

export function appendAccountSignatureIfMissing(html: string, account: MailAccountRow, context: SignatureContext): string {
  if (html.includes(`data-signature="${SIGNATURE_MARKER}"`)) return html;
  const signature = signatureHtmlForAccount(account, context);
  return signature ? `${html}${signature}` : html;
}
