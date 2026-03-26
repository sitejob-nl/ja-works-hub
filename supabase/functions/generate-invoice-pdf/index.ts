import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatEUR(amount: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(amount);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeHtml(str: string): string {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function generateInvoiceHtml(org: any, company: any, invoice: any, lines: any[]): string {
  const linesHtml = lines.map((l: any) => `
    <tr>
      <td style="padding:8px 4px;border-bottom:1px solid #eee">${escapeHtml(l.description)}</td>
      <td style="padding:8px 4px;border-bottom:1px solid #eee;text-align:right">${Number(l.hours) || 0}</td>
      <td style="padding:8px 4px;border-bottom:1px solid #eee;text-align:right">${formatEUR(Number(l.hourly_rate) || 0)}</td>
      <td style="padding:8px 4px;border-bottom:1px solid #eee;text-align:right">${Number(l.overtime_hours) > 0 ? `${l.overtime_hours}u` : "—"}</td>
      <td style="padding:8px 4px;border-bottom:1px solid #eee;text-align:right">${Number(l.travel_amount) > 0 ? formatEUR(l.travel_amount) : "—"}</td>
      <td style="padding:8px 4px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${formatEUR(Number(l.line_total))}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"><style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 40px; font-size: 13px; }
  .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
  .company-info { font-size: 12px; color: #666; line-height: 1.6; }
  .invoice-title { font-size: 28px; font-weight: 700; color: #111; margin-bottom: 4px; }
  .invoice-number { font-size: 14px; color: #666; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
  .meta-box { background: #f8f9fa; padding: 16px; border-radius: 8px; }
  .meta-label { font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .meta-value { font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  th { background: #f1f3f5; padding: 10px 4px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; }
  th:not(:first-child) { text-align: right; }
  .totals { margin-left: auto; width: 280px; }
  .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
  .total-final { font-size: 18px; font-weight: 700; border-top: 2px solid #111; padding-top: 8px; margin-top: 4px; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }
  .bank-info { margin-top: 30px; background: #f8f9fa; padding: 16px; border-radius: 8px; font-size: 12px; }
</style></head>
<body>
  <div class="header">
    <div>
      ${org.logo_url ? `<img src="${org.logo_url}" alt="" style="max-height:60px;margin-bottom:8px">` : ""}
      <div class="invoice-title">FACTUUR</div>
      <div class="invoice-number">${escapeHtml(invoice.invoice_number)}</div>
    </div>
    <div class="company-info" style="text-align:right">
      <strong>${escapeHtml(org.name)}</strong><br>
      ${org.address_street ? escapeHtml(org.address_street) + "<br>" : ""}
      ${org.address_postal ? escapeHtml(org.address_postal) + " " : ""}${org.address_city ? escapeHtml(org.address_city) + "<br>" : ""}
      ${org.kvk_number ? "KVK: " + escapeHtml(org.kvk_number) + "<br>" : ""}
      ${org.btw_number ? "BTW: " + escapeHtml(org.btw_number) + "<br>" : ""}
      ${org.email ? escapeHtml(org.email) + "<br>" : ""}
      ${org.phone ? escapeHtml(org.phone) : ""}
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <div class="meta-label">Factuur aan</div>
      <div class="meta-value"><strong>${escapeHtml(company.name)}</strong></div>
      ${company.address ? `<div>${escapeHtml(company.address)}</div>` : ""}
      ${company.postal_code || company.city ? `<div>${escapeHtml(company.postal_code || "")} ${escapeHtml(company.city || "")}</div>` : ""}
      ${company.kvk_number ? `<div style="margin-top:4px;color:#666">KVK: ${escapeHtml(company.kvk_number)}</div>` : ""}
    </div>
    <div class="meta-box">
      <div class="meta-label">Factuurgegevens</div>
      <div>Factuurdatum: <strong>${formatDate(invoice.invoice_date)}</strong></div>
      <div>Periode: ${formatDate(invoice.period_start)} — ${formatDate(invoice.period_end)}</div>
      <div>Vervaldatum: <strong>${formatDate(invoice.due_date)}</strong></div>
      ${invoice.reference ? `<div>Referentie: ${escapeHtml(invoice.reference)}</div>` : ""}
    </div>
  </div>

  <table>
    <thead><tr>
      <th>Omschrijving</th><th>Uren</th><th>Tarief</th><th>Overwerk</th><th>Reiskosten</th><th>Bedrag</th>
    </tr></thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <div class="totals">
    <div class="total-row"><span>Subtotaal</span><span>${formatEUR(Number(invoice.subtotal))}</span></div>
    <div class="total-row"><span>BTW (${invoice.vat_rate}%)</span><span>${formatEUR(Number(invoice.vat_amount))}</span></div>
    <div class="total-row total-final"><span>Totaal</span><span>${formatEUR(Number(invoice.total))}</span></div>
  </div>

  ${invoice.notes ? `<div style="margin-top:20px;font-size:12px;color:#666"><strong>Opmerking:</strong> ${escapeHtml(invoice.notes)}</div>` : ""}

  <div class="bank-info">
    <strong>Betalingsgegevens</strong><br>
    Gelieve het bedrag van ${formatEUR(Number(invoice.total))} over te maken onder vermelding van factuurnummer ${escapeHtml(invoice.invoice_number)}
    ${invoice.due_date ? ` vóór ${formatDate(invoice.due_date)}` : ""}.
  </div>

  <div class="footer">
    ${escapeHtml(org.name)}${org.kvk_number ? " | KVK " + escapeHtml(org.kvk_number) : ""}${org.btw_number ? " | BTW " + escapeHtml(org.btw_number) : ""}
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const orgId = profile.organization_id;
    const body = await req.json();
    const { invoice_id } = body;

    if (!invoice_id) {
      return new Response(JSON.stringify({ error: "invoice_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch invoice + company + org + lines
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [invoiceRes, orgRes] = await Promise.all([
      serviceClient.from("invoices").select("*, companies(*)").eq("id", invoice_id).eq("organization_id", orgId).single(),
      serviceClient.from("organizations").select("*").eq("id", orgId).single(),
    ]);

    if (invoiceRes.error || !invoiceRes.data) {
      return new Response(JSON.stringify({ error: "Factuur niet gevonden" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: lines } = await serviceClient.from("invoice_lines").select("*").eq("invoice_id", invoice_id).order("sort_order");

    const invoice = invoiceRes.data;
    const company = invoice.companies;
    const org = orgRes.data;

    // Generate HTML
    const html = generateInvoiceHtml(org, company, invoice, lines || []);

    // Convert HTML to PDF using an external service or return HTML for client-side rendering
    // For now, we store the HTML and use client-side jsPDF or print-to-PDF
    // Upload HTML to storage
    const fileName = `invoices/${orgId}/${invoice.invoice_number.replace(/\//g, "-")}.html`;

    const { error: uploadError } = await serviceClient.storage
      .from("documents")
      .upload(fileName, new Blob([html], { type: "text/html" }), {
        upsert: true,
        contentType: "text/html",
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      // If bucket doesn't exist, still return the HTML
    }

    // Get public URL
    const { data: urlData } = serviceClient.storage.from("documents").getPublicUrl(fileName);

    // Update invoice with PDF URL
    await serviceClient.from("invoices").update({
      pdf_url: urlData?.publicUrl || null,
      updated_at: new Date().toISOString(),
    }).eq("id", invoice_id);

    return new Response(JSON.stringify({
      success: true,
      html,
      pdf_url: urlData?.publicUrl || null,
      invoice_number: invoice.invoice_number,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Invoice PDF error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
