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

    for (const rect of rectangles) {
        const value = String(rect.value || "");
        if (!value) continue;

        const font = await getFont(rect.font, !!rect.bold, !!rect.italic);
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
