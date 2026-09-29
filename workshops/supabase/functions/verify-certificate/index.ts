// supabase/functions/verify-certificate/index.ts
//
// Deploy: supabase functions deploy verify-certificate

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatDate(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${d.getFullYear()}`;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { certificate_number } = await req.json();
        if (!certificate_number) {
            return new Response(JSON.stringify({ valid: false, error: "Missing certificate_number." }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const { data: issued } = await supabase
            .from("issued_certificates")
            .select("status, sent_at, created_at, courses(name)")
            .eq("certificate_number", certificate_number.trim())
            .maybeSingle();

        if (!issued || issued.status !== "issued") {
            return new Response(JSON.stringify({ valid: false }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({
            valid: true,
            course_name: issued.courses?.name || null,
            issued_date: formatDate(issued.sent_at || issued.created_at),
        }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ valid: false, error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
