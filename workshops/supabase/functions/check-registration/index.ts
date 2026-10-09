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

// An exam only counts as completed for the certificate when the staff
// number has a 'submitted' attempt AND every question of the exam has a
// real saved answer. A submitted attempt with missing answers (empty
// auto-submit, cut off by the timer, answers lost) does NOT count — the
// participant has to take the exam again (exam.html restarts it).
function isAnswerFilled(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return true;
}

async function isExamCompleted(supabase: any, exam: any, staffNumber: string): Promise<boolean> {
    const examId = exam.id;
    const { data: attempt } = await supabase
        .from("activity_exam_attempts")
        .select("id, submitted_at, expires_at")
        .eq("exam_id", examId)
        .eq("status", "submitted")
        .ilike("staff_number", escapeLike(staffNumber))
        .limit(1)
        .maybeSingle();
    if (!attempt) return false;
    // A pre-registration exam accepts a partly answered submission (blanks
    // score 0) — only exams that are NOT pre-registration need every answer.
    if (exam.require_before_registration) return true;

    const { data: questions } = await supabase
        .from("activity_exam_questions")
        .select("id")
        .eq("exam_id", examId);
    const { data: answers } = await supabase
        .from("activity_exam_answers")
        .select("question_id, answer_value")
        .eq("attempt_id", attempt.id);

    const answered = new Set((answers || []).filter((a: any) => isAnswerFilled(a.answer_value)).map((a: any) => a.question_id));
    if ((questions || []).every((q: any) => answered.has(q.id))) return true;
    // Time ran out and the exam page auto-submitted what had been answered:
    // that counts as finished (blanks score 0) provided something was
    // answered. submitted_at at/after the deadline marks a timeout submission.
    const submittedAtMs = attempt.submitted_at ? new Date(attempt.submitted_at).getTime() : NaN;
    const deadlineMs = attempt.expires_at ? new Date(attempt.expires_at).getTime() : NaN;
    const timedOut = Number.isFinite(submittedAtMs) && Number.isFinite(deadlineMs) && submittedAtMs >= deadlineMs - 1000;
    return timedOut && answered.size > 0;
}

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
            .select("id, course_id, courses(*)")
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
            .select("id, staff_name, attended")
            .eq("course_id", cert.course_id)
            .ilike("staff_number", escapeLike(normalizedStaffNumber))
            .order("attended", { ascending: false, nullsFirst: false })
            .order("id", { ascending: false })
            .limit(1)
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
        const attendanceStatus = await getAttendanceStatus(supabase, cert.id, cert.courses, registration);
        if (!attendanceStatus.ok) {
            return new Response(JSON.stringify({
                found: true,
                not_attended: true,
                missing_days: attendanceStatus.missingDays,
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
                .ilike("staff_number", escapeLike(normalizedStaffNumber))
                .limit(1)
                .maybeSingle();

            if (!evalResponse) {
                pendingEvaluations.push({ title: evaluation.title, public_slug: evaluation.public_slug });
            }
        }

        // Same idea, for the newer Exam feature (sql/activity-exams.sql) —
        // every required exam this staff number hasn't submitted yet
        // (activity_exam_attempts.status = 'submitted') is collected, same
        // "all pending ones are reported" shape as the evaluations above,
        // kept in its own list since exam.html needs different link
        // parameters than evaluation.html does (see js/certificate-public.js).
        const { data: requiredExamRows } = await supabase
            .from("certificate_required_exams")
            .select("activity_exams(id, title, public_slug, require_before_registration)")
            .eq("certificate_id", cert.id);

        const pendingExams: { title: string; public_slug: string }[] = [];
        for (const row of requiredExamRows || []) {
            const exam = (row as any).activity_exams;
            if (!exam) continue;
            if (!(await isExamCompleted(supabase, exam, normalizedStaffNumber))) {
                pendingExams.push({ title: exam.title, public_slug: exam.public_slug });
            }
        }

        return new Response(JSON.stringify({
            found: true,
            name: registration.staff_name,
            course_name: cert.courses?.name || null,
            // Kept alongside the arrays for any older page still reading a
            // single value — the first pending one of each kind, or null
            // once all of that kind are done.
            pending_evaluation: pendingEvaluations[0] || null,
            pending_evaluations: pendingEvaluations,
            pending_exam: pendingExams[0] || null,
            pending_exams: pendingExams,
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

// Attendance rule for a certificate. A 1-day activity (or a certificate with no required days ticked) keeps the
// original rule: the registration must be marked attended. For multi-day activities a certificate can require
// specific days (certificate_required_attendance_days): ALL required days must be attended. Any read problem with
// the new tables (e.g. the SQL not run yet) falls back to the original rule instead of blocking anyone.
// deno-lint-ignore no-explicit-any
async function getAttendanceStatus(supabase: any, certId: number, course: any, registration: any): Promise<{ ok: boolean; missingDays: number[] }> {
    if (!course || course.attendance_required === false) return { ok: true, missingDays: [] };
    const totalDays = Math.max(1, parseInt(course.attendance_days, 10) || 1);
    const { data: reqRows, error: reqErr } = await supabase
        .from("certificate_required_attendance_days")
        .select("day_number")
        .eq("certificate_id", certId);
    const required: number[] = reqErr ? [] : Array.from(new Set(
        // deno-lint-ignore no-explicit-any
        (reqRows || []).map((r: any) => Number(r.day_number)).filter((d: number) => Number.isInteger(d) && d >= 1 && d <= totalDays)
    )).sort((a, b) => a - b);
    if (required.length === 0) return { ok: !!registration.attended, missingDays: [] };

    const attendedDays = new Set<number>();
    const { data: dayRows } = await supabase
        .from("registration_attendance_days")
        .select("day_number")
        .eq("registration_id", registration.id);
    // deno-lint-ignore no-explicit-any
    (dayRows || []).forEach((r: any) => attendedDays.add(Number(r.day_number)));
    // Attendance recorded before multi-day existed has no day rows: it counts as day 1.
    if (attendedDays.size === 0 && registration.attended) attendedDays.add(1);
    const missingDays = required.filter((d) => !attendedDays.has(d));
    return { ok: missingDays.length === 0, missingDays };
}
