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
            .select("id, course_id, courses(name, attendance_required)")
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
            .select("staff_name, attended")
            .eq("course_id", cert.course_id)
            .ilike("staff_number", normalizedStaffNumber)
            .maybeSingle();

        if (!registration) {
            return new Response(JSON.stringify({ found: false }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Registered, but never confirmed via the Attendance link — same
        // rule generate-certificate re-checks server-side before actually
        // building the PDF, surfaced here too so the participant sees this
        // clearly right after entering their staff number instead of only
        // after tapping "Get Certificate".
        const attendanceRequired = cert.courses?.attendance_required !== false;
        if (attendanceRequired && !registration.attended) {
            return new Response(JSON.stringify({
                found: true,
                not_attended: true,
                name: registration.staff_name,
                course_name: cert.courses?.name || null,
            }), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Surface still-pending required evaluations here too (not just at
        // generate-certificate) so the public certificate page can show a
        // clear "complete these first" message, with links, before the
        // participant even taps "Get Certificate". A certificate can now
        // require several evaluations — every one not yet completed by this
        // staff number is reported, not just the first.
        const { data: requiredRows } = await supabase
            .from("certificate_required_evaluations")
            .select("activity_evaluations(id, title, public_slug)")
            .eq("certificate_id", cert.id);

        const pendingEvaluations: { title: string; public_slug: string }[] = [];
        for (const row of requiredRows || []) {
            const evaluation = (row as any).activity_evaluations;
            if (!evaluation) continue;
            const { data: evalResponse } = await supabase
                .from("activity_evaluation_responses")
                .select("id")
                .eq("evaluation_id", evaluation.id)
                .ilike("staff_number", normalizedStaffNumber)
                .maybeSingle();

            if (!evalResponse) {
                pendingEvaluations.push({ title: evaluation.title, public_slug: evaluation.public_slug });
            }
        }

        return new Response(JSON.stringify({
            found: true,
            name: registration.staff_name,
            course_name: cert.courses?.name || null,
            // Kept alongside the array for any older page still reading a
            // single value — the first pending one, or null once all are done.
            pending_evaluation: pendingEvaluations[0] || null,
            pending_evaluations: pendingEvaluations,
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
