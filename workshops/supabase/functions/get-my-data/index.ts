// supabase/functions/get-my-data/index.ts
//
// Deploy: supabase functions deploy get-my-data --no-verify-jwt
//
// Powers the public Student Dashboard (student-dashboard.html). Takes a
// staff number and returns only that person's own registrations + issued
// certificates — never anyone else's. issued_certificates is RLS-locked
// (no anon policies), so this is the only way the browser can see it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { staff_number } = await req.json();
        if (!staff_number) {
            return jsonResponse({ error: "Missing staff_number." }, 400);
        }
        const normalizedStaffNumber = String(staff_number).trim();

        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const { data: registrations } = await supabase
            .from("registrations")
            .select("designation_snapshot, institution_name_snapshot, created_at, courses(name, course_date)")
            .ilike("staff_number", escapeLike(normalizedStaffNumber));

        const { data: certificates } = await supabase
            .from("issued_certificates")
            .select("certificate_number, sent_at, pdf_path, courses(name)")
            .ilike("participant_staff_number", escapeLike(normalizedStaffNumber))
            .eq("status", "issued");

        // pdf_path is just a filename (the bucket is private) — sign each one
        // so the browser gets a working, time-limited download link.
        const paths = (certificates || []).map((c: any) => c.pdf_path).filter(Boolean);
        const signedByPath = new Map<string, string>();
        if (paths.length > 0) {
            const { data: signedUrls } = await supabase.storage
                .from("certificates-generated")
                .createSignedUrls(paths, 3600);
            (signedUrls || []).forEach((s: any) => {
                if (s.signedUrl) signedByPath.set(s.path, s.signedUrl);
            });
        }

        return jsonResponse({
            registrations: (registrations || []).map((r: any) => ({
                course_name: r.courses?.name || "Deleted Course",
                course_date: r.courses?.course_date || null,
                registered_on: r.created_at,
                designation: r.designation_snapshot,
            })),
            certificates: (certificates || []).map((c: any) => ({
                course_name: c.courses?.name || "Deleted Course",
                certificate_number: c.certificate_number,
                sent_at: c.sent_at,
                pdf_path: signedByPath.get(c.pdf_path) || null,
            })),
        });
    } catch (err) {
        return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 500);
    }
});

// Prepares a typed staff number for .ilike(): removes invisible direction/zero-width marks, converts Arabic digits
// to 0-9, then escapes LIKE wildcards so "%" or "_" match only themselves (exact, case-insensitive match).
function escapeLike(value: unknown): string {
    const cleaned = String(value == null ? "" : value)
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g, "")
        .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
        .trim();
    return cleaned.replace(/[\\%_]/g, (m) => "\\" + m);
}

