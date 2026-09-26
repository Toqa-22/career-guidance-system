// supabase/functions/generate-certificate/index.ts
//
// Deploy: supabase functions deploy generate-certificate --no-verify-jwt
// No email secrets needed — this function just verifies the registration,
// builds the certificate PDF right here (using pdf-lib — pure JavaScript,
// no native dependencies, so it runs fine in Deno), stores it, and returns
// a download link. No external service, no email provider, no separate
// hosting needed for any of it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";

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

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${d.getFullYear()}`;
}

function resolveFieldValue(
    dataField: string,
    customText: string,
    course: Record<string, any>,
    registration: Record<string, any>,
    certificateNumber: string
): string {
    switch (dataField) {
        case "participant_name": return registration.staff_name || "";
        case "staff_number": return registration.staff_number || "";
        case "course_name": return course.name || "";
        case "course_description": return course.description || "";
        case "course_date": return formatDate(course.course_date);
        case "course_start_date": return formatDate(course.course_date);
        case "course_end_date": return formatDate(course.course_end_date);
        case "instructor_name": return course.instructor_name || "";
        case "certificate_id": return certificateNumber;
        case "registration_date": return formatDate(registration.created_at);
        case "organization": return registration.organization_snapshot || "";
        case "department": return registration.directorate_snapshot || "";
        case "job_level": return registration.job_level_snapshot || "";
        case "nationality": return registration.nationality_snapshot || "";
        case "designation": return registration.designation_snapshot || "";
        case "custom_text": return customText || "";
        default: return "";
    }
}

// ---------------------------------------------------------------------
// Arabic support for certificate text
// ---------------------------------------------------------------------
// pdf-lib's built-in StandardFonts (Helvetica/Times/Courier) only support
// WinAnsi encoding (~Latin-1) — any Arabic letter, and even a lone Arabic
// diacritic like KASRA (U+0650), throws "WinAnsi cannot encode...". So a
// rectangle whose resolved value (e.g. an Arabic participant name) isn't
// fully WinAnsi-encodable is drawn with an embedded Unicode font instead
// (see getUnicodeFont in buildCertificatePdf below).
//
// A plain Unicode font alone isn't enough for Arabic to look right,
// though: text is drawn left-to-right, glyph by glyph, with no
// contextual shaping — the same limitation documented on the client
// side in arabic-reshaper-bridge.js's reshapeArabicForPdf(), which this
// mirrors so certificates match the look of every other Arabic PDF this
// project already generates (reports, etc.).
function isWinAnsiEncodable(text: string): boolean {
    for (const ch of text) {
        if (ch.codePointAt(0)! > 0xFF) return false;
    }
    return true;
}

// code, isolated, initial, medial, final
const ARABIC_CHAR_MAP: Record<number, [number, number | null, number | null, number | null]> = {
    0x0621: [0xFE80, null, null, null],
    0x0622: [0xFE81, null, null, 0xFE82],
    0x0623: [0xFE83, null, null, 0xFE84],
    0x0624: [0xFE85, null, null, 0xFE86],
    0x0625: [0xFE87, null, null, 0xFE88],
    0x0626: [0xFE89, 0xFE8B, 0xFE8C, 0xFE8A],
    0x0627: [0xFE8D, null, null, 0xFE8E],
    0x0628: [0xFE8F, 0xFE91, 0xFE92, 0xFE90],
    0x0629: [0xFE93, null, null, 0xFE94],
    0x062A: [0xFE95, 0xFE97, 0xFE98, 0xFE96],
    0x062B: [0xFE99, 0xFE9B, 0xFE9C, 0xFE9A],
    0x062C: [0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E],
    0x062D: [0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2],
    0x062E: [0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6],
    0x062F: [0xFEA9, null, null, 0xFEAA],
    0x0630: [0xFEAB, null, null, 0xFEAC],
    0x0631: [0xFEAD, null, null, 0xFEAE],
    0x0632: [0xFEAF, null, null, 0xFEB0],
    0x0633: [0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2],
    0x0634: [0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6],
    0x0635: [0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA],
    0x0636: [0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE],
    0x0637: [0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2],
    0x0638: [0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6],
    0x0639: [0xFEC9, 0xFECB, 0xFECC, 0xFECA],
    0x063A: [0xFECD, 0xFECF, 0xFED0, 0xFECE],
    0x0640: [0x0640, 0x0640, 0x0640, 0x0640],
    0x0641: [0xFED1, 0xFED3, 0xFED4, 0xFED2],
    0x0642: [0xFED5, 0xFED7, 0xFED8, 0xFED6],
    0x0643: [0xFED9, 0xFEDB, 0xFEDC, 0xFEDA],
    0x0644: [0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE],
    0x0645: [0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2],
    0x0646: [0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6],
    0x0647: [0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA],
    0x0648: [0xFEED, null, null, 0xFEEE],
    0x0649: [0xFEEF, null, null, 0xFEF0],
    0x064A: [0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2],
    0x067E: [0xFB56, 0xFB58, 0xFB59, 0xFB57],
    0x06CC: [0xFBFC, 0xFBFE, 0xFBFF, 0xFBFD],
    0x0686: [0xFB7A, 0xFB7C, 0xFB7D, 0xFB7B],
    0x06A9: [0xFB8E, 0xFB90, 0xFB91, 0xFB8F],
    0x06AF: [0xFB92, 0xFB94, 0xFB95, 0xFB93],
    0x0698: [0xFB8A, null, null, 0xFB8B],
};
const ARABIC_LAM_ALEF_MAP: Record<number, [number, number]> = {
    0x0622: [0xFEF5, 0xFEF6], 0x0623: [0xFEF7, 0xFEF8],
    0x0625: [0xFEF9, 0xFEFA], 0x0627: [0xFEFB, 0xFEFC],
};
const ARABIC_TRANSPARENT_CHARS = new Set([
    0x0610, 0x0612, 0x0613, 0x0614, 0x0615, 0x064B, 0x064C, 0x064D, 0x064E,
    0x064F, 0x0650, 0x0651, 0x0652, 0x0653, 0x0654, 0x0655, 0x0656, 0x0657,
    0x0658, 0x0670, 0x06D6, 0x06D7, 0x06D8, 0x06D9, 0x06DA, 0x06DB, 0x06DC,
    0x06DF, 0x06E0, 0x06E1, 0x06E2, 0x06E3, 0x06E4, 0x06E7, 0x06E8, 0x06EA,
    0x06EB, 0x06EC, 0x06ED,
]);

function convertArabicToPresentationForms(input: string): string {
    let shaped = "";
    for (let i = 0; i < input.length; i++) {
        const current = input.charCodeAt(i);
        const crep = ARABIC_CHAR_MAP[current];
        if (!crep) { shaped += input[i]; continue; }

        // Tuple layout here is [isolated, initial, medial, final] (the map
        // key already holds the code point, unlike the 5-element
        // [code, isolated, initial, medial, final] arrays in the original
        // arabic-reshaper-bridge.js this is ported from) — so "does prev
        // connect forward into current" checks prev's initial/medial
        // slots (indices 1 and 2), and "does next connect back into
        // current" checks next's medial/final slots (indices 2 and 3).
        let prevID = i - 1;
        while (prevID >= 0 && ARABIC_TRANSPARENT_CHARS.has(input.charCodeAt(prevID))) prevID--;
        let prev: number | null = prevID >= 0 ? input.charCodeAt(prevID) : null;
        const prevRep = prev !== null ? ARABIC_CHAR_MAP[prev] : null;
        if (!prevRep || (prevRep[1] == null && prevRep[2] == null)) prev = null;

        let nextID = i + 1;
        while (nextID < input.length && ARABIC_TRANSPARENT_CHARS.has(input.charCodeAt(nextID))) nextID++;
        let next: number | null = nextID < input.length ? input.charCodeAt(nextID) : null;
        const nextRep = next !== null ? ARABIC_CHAR_MAP[next] : null;
        if (!nextRep || (nextRep[2] == null && nextRep[3] == null)) next = null;

        // LAM + ALEF ligatures
        if (current === 0x0644 && next != null && ARABIC_LAM_ALEF_MAP[next]) {
            const [isolated, final] = ARABIC_LAM_ALEF_MAP[next];
            shaped += String.fromCharCode(prev != null ? final : isolated);
            i++; // consume the following alef too
            continue;
        }

        if (prev != null && next != null && crep[2] != null) shaped += String.fromCharCode(crep[2]); // medial
        else if (prev != null && crep[3] != null) shaped += String.fromCharCode(crep[3]); // final
        else if (next != null && crep[1] != null) shaped += String.fromCharCode(crep[1]); // initial
        else shaped += String.fromCharCode(crep[0]); // isolated
    }
    return shaped;
}

function isArabicChar(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return (code >= 0x0600 && code <= 0x06FF) || (code >= 0x0750 && code <= 0x077F);
}

// Splits mixed Arabic/non-Arabic text into runs, reshapes+reverses each
// Arabic run (so it reads correctly when drawn left-to-right), and
// reverses the run order — the same practical RTL approximation used
// client-side for jsPDF-based reports.
function reshapeArabicForPdf(text: string): string {
    if (!text) return text;
    const runs: { text: string; arabic: boolean }[] = [];
    let current = "";
    let currentIsArabic: boolean | null = null;
    for (const ch of text) {
        const chIsArabic = isArabicChar(ch);
        if (currentIsArabic === null || chIsArabic === currentIsArabic) {
            current += ch;
            currentIsArabic = chIsArabic;
        } else {
            runs.push({ text: current, arabic: currentIsArabic! });
            current = ch;
            currentIsArabic = chIsArabic;
        }
    }
    if (current) runs.push({ text: current, arabic: currentIsArabic! });

    if (!runs.some((r) => r.arabic)) return text;

    const processed = runs.map((r) =>
        r.arabic ? convertArabicToPresentationForms(r.text).split("").reverse().join("") : r.text
    );
    return processed.reverse().join("");
}

function hexToRgb01(hex: string) {
    const clean = (hex || "#000000").replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return rgb(r || 0, g || 0, b || 0);
}

function pickStandardFont(fontFamily: string, bold: boolean, italic: boolean): StandardFonts {
    const family = (fontFamily || "").toLowerCase();
    if (family.includes("times") || family.includes("georgia")) {
        if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
        if (bold) return StandardFonts.TimesRomanBold;
        if (italic) return StandardFonts.TimesRomanItalic;
        return StandardFonts.TimesRoman;
    }
    if (family.includes("courier")) {
        if (bold && italic) return StandardFonts.CourierBoldOblique;
        if (bold) return StandardFonts.CourierBold;
        if (italic) return StandardFonts.CourierOblique;
        return StandardFonts.Courier;
    }
    // Arial / Verdana / anything else -> Helvetica (the standard Arial substitute in PDFs)
    if (bold && italic) return StandardFonts.HelveticaBoldOblique;
    if (bold) return StandardFonts.HelveticaBold;
    if (italic) return StandardFonts.HelveticaOblique;
    return StandardFonts.Helvetica;
}

// Builds the actual certificate PDF: the image as a full-page background,
// plus each rectangle's resolved text drawn at the right spot.
async function buildCertificatePdf(imageUrl: string, imageWidth: number, imageHeight: number, rectangles: any[]): Promise<Uint8Array> {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Failed to download certificate image (status ${imgRes.status}).`);
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") || "";

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit); // needed to embed a custom (non-Standard) font below

    let embeddedImage;
    if (contentType.includes("png") || imageUrl.toLowerCase().endsWith(".png")) {
        embeddedImage = await pdfDoc.embedPng(imgBytes);
    } else {
        embeddedImage = await pdfDoc.embedJpg(imgBytes);
    }

    const width = imageWidth || embeddedImage.width;
    const height = imageHeight || embeddedImage.height;
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(embeddedImage, { x: 0, y: 0, width, height });

    // Cache embedded fonts so we don't re-embed the same one repeatedly
    const fontCache = new Map();
    async function getFont(fontFamily: string, bold: boolean, italic: boolean) {
        const key = pickStandardFont(fontFamily, bold, italic);
        if (!fontCache.has(key)) {
            fontCache.set(key, await pdfDoc.embedFont(key));
        }
        return fontCache.get(key);
    }

    // Fetched and embedded once, lazily, only if some rectangle's text
    // actually needs it (an Arabic name, for example) — see
    // isWinAnsiEncodable above for why a StandardFont can't draw it at all.
    //
    // This is Noto Naskh Arabic, NOT the actual "Amiri" font — the same
    // substitution already made client-side (see the comment at the top
    // of workshops/js/amiri-font.js): the real Amiri font relies entirely
    // on OpenType GSUB shaping and has no glyphs mapped to the Arabic
    // Presentation Forms block (U+FE70-FEFF, U+FB50-FDFF) that
    // reshapeArabicForPdf() above converts text into, so real Amiri
    // renders Arabic text as blank/invisible here for the same reason it
    // did in jsPDF. Noto Naskh Arabic does have those glyphs mapped
    // directly (confirmed the same way as that file: inspecting its cmap).
    //
    // subset MUST stay off (pdf-lib defaults to no subsetting when the
    // option is omitted) — passing {subset: true} was tried and silently
    // corrupts this particular font on subsetting (it's a variable font),
    // dropping most Arabic glyphs and leaving only a few stray marks. This
    // was confirmed by rendering both ways and comparing the output.
    let unicodeFont: any = null;
    async function getUnicodeFont() {
        if (!unicodeFont) {
            const fontRes = await fetch("https://raw.githubusercontent.com/google/fonts/main/ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf");
            if (!fontRes.ok) throw new Error(`Failed to download Arabic font for certificate text (status ${fontRes.status}).`);
            const fontBytes = new Uint8Array(await fontRes.arrayBuffer());
            unicodeFont = await pdfDoc.embedFont(fontBytes);
        }
        return unicodeFont;
    }

    for (const rect of rectangles) {
        const rawValue = String(rect.value || "");
        if (!rawValue) continue;

        // A StandardFont can only draw WinAnsi (~Latin-1) text; Arabic —
        // including a lone diacritic like KASRA (U+0650) — isn't in that
        // set and throws "WinAnsi cannot encode..." if drawn with one, so
        // that text is reshaped for correct Arabic letter joining/RTL
        // order and drawn with the embedded Amiri font instead.
        const isArabic = !isWinAnsiEncodable(rawValue);
        const value = isArabic ? reshapeArabicForPdf(rawValue) : rawValue;
        const font = isArabic ? await getUnicodeFont() : await getFont(rect.font, !!rect.bold, !!rect.italic);
        const fontSize = rect.font_size || 24;
        const textWidth = font.widthOfTextAtSize(value, fontSize);

        let x;
        if (rect.h_align === "left") x = rect.x;
        else if (rect.h_align === "right") x = rect.x + rect.width - textWidth;
        else x = rect.x + (rect.width - textWidth) / 2; // center

        // Rectangles are stored in top-left image coordinates; PDF coordinates
        // start from the bottom-left, so flip the Y axis here.
        let topY;
        if (rect.v_align === "top") topY = rect.y + fontSize;
        else if (rect.v_align === "bottom") topY = rect.y + rect.height - fontSize * 0.25;
        else topY = rect.y + rect.height / 2 + fontSize * 0.35; // middle
        const pdfY = height - topY;

        page.drawText(value, {
            x, y: pdfY, size: fontSize, font,
            color: hexToRgb01(rect.color),
        });
    }

    return await pdfDoc.save();
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    try {
        const { public_slug, staff_number } = await req.json();
        if (!public_slug || !staff_number) {
            return jsonResponse({ success: false, error: "Missing public_slug or staff_number." }, 400);
        }
        const normalizedStaffNumber = String(staff_number).trim();

        const { data: cert } = await supabase
            .from("certificates")
            .select("*, courses(*)")
            .eq("public_slug", public_slug)
            .maybeSingle();
        if (!cert) return jsonResponse({ success: false, error: "Certificate not found." }, 404);

        const course = cert.courses;

        // Re-verify registration server-side — never trust client-side "verified" state
        const { data: registration } = await supabase
            .from("registrations")
            .select("*")
            .eq("course_id", cert.course_id)
            .ilike("staff_number", normalizedStaffNumber)
            .maybeSingle();
        if (!registration) {
            return jsonResponse({ success: false, error: "This staff number is not registered for this course." }, 403);
        }
        if (course.attendance_required !== false && !registration.attended) {
            return jsonResponse({ success: false, error: "Certificates are only available to participants marked as attended. Please confirm your attendance first, or contact the training team if you believe this is a mistake." }, 403);
        }

        // This certificate template can optionally require completing
        // several Activity Evaluations/Exams first (set from Create
        // Certificate -> "Required Evaluation(s) / Exam(s)"). Re-checked
        // here server-side — never trust client-side state — against
        // evaluation_responses, which is exactly what evaluation.html
        // inserts into on a successful submit. ALL of them must be done;
        // the first one still missing is reported (a deleted evaluation is
        // just skipped, same as never having been required).
        const { data: requiredRows } = await supabase
            .from("certificate_required_evaluations")
            .select("activity_evaluations(id, title, public_slug)")
            .eq("certificate_id", cert.id);

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
                return jsonResponse({
                    success: false,
                    error: `Please complete "${evaluation.title}" before getting this certificate.`,
                    required_evaluation_slug: evaluation.public_slug,
                }, 403);
            }
        }

        // No issued_certificates tracking anymore — every request rebuilds
        // the PDF fresh from the template and hands it back directly. The
        // certificate number is derived deterministically from the
        // registration itself (not randomly generated + looked up), so the
        // same student always sees the same number on repeat downloads
        // without needing any database record to remember it by.
        const certificateNumber = `CERT-${new Date(registration.created_at).getFullYear()}-${String(registration.id).padStart(6, "0")}`;

        const rectangles: any[] = Array.isArray(cert.rectangles) ? cert.rectangles : JSON.parse(cert.rectangles || "[]");
        const resolvedRectangles = rectangles.map((r) => ({
            x: r.x, y: r.y, width: r.width, height: r.height,
            font: r.font, font_size: r.font_size, bold: r.bold, italic: r.italic,
            color: r.color, h_align: r.h_align, v_align: r.v_align,
            value: resolveFieldValue(r.data_field, r.custom_text, course, registration, certificateNumber),
        }));

        // Build the PDF right here — no external service needed, and
        // nothing is uploaded or saved anywhere; it's returned directly.
        const pdfBytes = await buildCertificatePdf(
            cert.preview_image_path,
            cert.preview_width,
            cert.preview_height,
            resolvedRectangles
        );

        // Deno's runtime has no btoa-friendly bulk conversion for large
        // byte arrays in one call without risking a stack-size error on
        // very large inputs, so this chunks the conversion.
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < pdfBytes.length; i += chunkSize) {
            binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunkSize));
        }
        const pdfBase64 = btoa(binary);

        return jsonResponse({ success: true, certificate_number: certificateNumber, pdf_base64: pdfBase64 });
    } catch (err) {
        return jsonResponse({ success: false, error: String(err instanceof Error ? err.message : err) }, 500);
    }
});
