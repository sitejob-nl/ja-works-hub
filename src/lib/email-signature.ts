const SIGNATURE_MARKER = 'ja-werkt-signature';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function plaintextToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

export function buildSignatureBlock(senderName: string): string {
  const name = senderName.trim() || 'Het JA Werkt team';
  return `<div data-signature="${SIGNATURE_MARKER}" style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;color:#334155;font-size:14px;line-height:1.5;">
  <p style="margin:0;">Met vriendelijke groet,</p>
  <p style="margin:4px 0 0;font-weight:600;">${escapeHtml(name)}</p>
  <p style="margin:8px 0 0;color:#94a3b8;font-size:12px;">Verstuurd via JA Werkt</p>
</div>`;
}

/**
 * Build an HTML email body with signature appended. Plain-text input is converted
 * to HTML (newlines → <br>). Signature is suppressed when the body already contains
 * one (idempotent for forwards/replies).
 */
export function buildEmailHtmlWithSignature(plainBody: string, senderName: string): string {
  const html = plaintextToHtml(plainBody.trimEnd());
  if (html.includes(`data-signature="${SIGNATURE_MARKER}"`)) return html;
  return html + buildSignatureBlock(senderName);
}
