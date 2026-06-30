import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";
import { assertPasswordAcceptable } from "../_shared/password-policy.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? "").trim();
    const action = String(body.action ?? "activate");
    if (!token) return json({ error: "Token is verplicht" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: invite, error: inviteError } = await admin
      .from("internal_user_invites")
      .select("*, organization:organization_id(name)")
      .eq("token", token)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (inviteError || !invite) {
      return json({ error: "Ongeldige of verlopen uitnodiging" }, 400);
    }

    if (action === "inspect") {
      return json({
        success: true,
        email: invite.email,
        full_name: invite.full_name,
        role: invite.role,
        organization_name: (invite.organization as any)?.name ?? "JA Werkt",
        expires_at: invite.expires_at,
      });
    }

    const password = String(body.password ?? "");
    if (!password) return json({ error: "Wachtwoord is verplicht" }, 400);

    const pwError = await assertPasswordAcceptable(password, "nl");
    if (pwError) return json({ error: pwError }, 400);

    const { data: existingProfile, error: existingProfileError } = await admin
      .from("profiles")
      .select("id")
      .eq("organization_id", invite.organization_id)
      .eq("email", invite.email)
      .maybeSingle();
    if (existingProfileError) throw existingProfileError;
    if (existingProfile) {
      return json({ error: "Er bestaat al een account met dit e-mailadres. Probeer in te loggen." }, 409);
    }

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: invite.full_name,
        organization_id: invite.organization_id,
        role: invite.role,
      },
    });

    if (authError) {
      if (authError.message?.includes("already been registered")) {
        return json({ error: "Er bestaat al een account met dit e-mailadres. Probeer in te loggen." }, 409);
      }
      throw authError;
    }

    const userId = authData.user.id;

    const { error: profileError } = await admin.from("profiles").insert({
      id: userId,
      organization_id: invite.organization_id,
      email: invite.email,
      full_name: invite.full_name,
      role: invite.role,
      is_active: true,
    });

    if (profileError) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      throw profileError;
    }

    const { error: usedError } = await admin
      .from("internal_user_invites")
      .update({ used_at: new Date().toISOString(), accepted_user_id: userId })
      .eq("id", invite.id);
    if (usedError) throw usedError;

    await admin.from("audit_log").insert({
      organization_id: invite.organization_id,
      user_id: userId,
      action: "accept",
      table_name: "internal_user_invites",
      record_id: invite.id,
      new_values: { email: invite.email, role: invite.role },
      reason: "internal_user_invite_accepted",
    });

    return json({ success: true, user_id: userId });
  } catch (err) {
    console.error("internal-user-activate error:", err);
    return json({ error: (err as Error).message || "Activatie mislukt" }, 500);
  }
});
