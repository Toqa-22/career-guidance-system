// supabase/functions/check-registration/index.ts
//
// Deploy: supabase functions deploy check-registration
// No extra secrets needed beyond the ones Supabase provides automatically
// (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { public_slug, staff_number } = await req.json();
        if (!public_slug || !staff_number) {
            return new Response(JSON.stringify({ found: false, error: "Missing public_slug or staff_number." }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Service role client — bypasses RLS, but this function only ever
        // returns the minimal fields needed, never the raw table.
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const { data: cert, error: certErr } = await supabase
            .from("certificates")
            .select("course_id, courses(name)")
            .eq("public_slug", public_slug)
            .maybeSingle();

        if (certErr || !cert) {
            return new Response(JSON.stringify({ found: false, error: "Certificate link not found." }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const normalizedStaffNumber = String(staff_number).trim();

        const { data: registration } = await supabase
            .from("registrations")
            .select("staff_name")
            .eq("course_id", cert.course_id)
            .ilike("staff_number", normalizedStaffNumber)
            .maybeSingle();

        if (!registration) {
            return new Response(JSON.stringify({ found: false }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({
            found: true,
            name: registration.staff_name,
            course_name: cert.courses?.name || null,
        }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ found: false, error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
