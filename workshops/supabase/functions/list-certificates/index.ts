// supabase/functions/list-certificates/index.ts
//
// Deploy: supabase functions deploy list-certificates --no-verify-jwt
//
// Powers the admin Student Dashboard's "Download Certificate" button per
// row. issued_certificates is RLS-locked (no anon policies) since it holds
// participant names/staff numbers, so this is the only way the admin
// table can find out which registrations already have a certificate.
// Only returns the minimal fields needed to link a registration to its
// certificate download — never the full table. pdf_path in the response is
// a short-lived signed URL (the storage bucket is private), not a
// permanent public link.

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
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const { data, error } = await supabase
            .from("issued_certificates")
            .select("registration_id, certificate_number, pdf_path")
            .eq("status", "issued");

        if (error) throw error;

        // pdf_path is now just a filename (the bucket is private) — sign
        // every one in a single batch call rather than one request per row.
        const paths = (data || []).map((c) => c.pdf_path).filter(Boolean);
        const signedByPath = new Map<string, string>();
        if (paths.length > 0) {
            const { data: signedUrls, error: signErr } = await supabase.storage
                .from("certificates-generated")
                .createSignedUrls(paths, 3600);
            if (signErr) throw signErr;
            (signedUrls || []).forEach((s: any) => {
                if (s.signedUrl) signedByPath.set(s.path, s.signedUrl);
            });
        }

        const certificates = (data || []).map((c) => ({
            registration_id: c.registration_id,
            certificate_number: c.certificate_number,
            pdf_path: signedByPath.get(c.pdf_path) || null,
        }));

        return new Response(JSON.stringify({ certificates }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ certificates: [], error: String(err instanceof Error ? err.message : err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
