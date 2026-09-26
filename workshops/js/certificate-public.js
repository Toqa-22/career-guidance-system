import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const publicSlug = params.get('c');

// Set once verification succeeds — never re-read from an editable input again,
// so the participant cannot switch to a different staff number after verification.
let verifiedStaffNumber = null;
let courseName = '';

// The evaluations/exams this staff number still needs to complete before
// the certificate can be issued — walked through one at a time. See
// renderPendingState()/recheckPending() below.
let pendingList = [];
// Set right before opening a requirement in a new tab; when this tab
// regains focus with the flag set, that's the cue to re-check whether it
// was completed — see the 'focus' listener near the bottom of this file.
let awaitingReturnCheck = false;

// Shows/hides small circles drifting inside a button (same floating style
// as the sidebar's decorative circles, scaled down), alongside a "Loading"
// label — used for every "this is now in flight" state on this page.
function setBtnLoading(btn, isLoading, restoreLabel) {
    if (isLoading) {
        btn.dataset.restoreLabel = restoreLabel || btn.textContent;
        btn.disabled = true;
        btn.innerHTML = `<span class="btn-loading-circles"><span class="btn-loading-circle btn-loading-circle-1"></span><span class="btn-loading-circle btn-loading-circle-2"></span><span class="btn-loading-circle btn-loading-circle-3"></span><span class="btn-loading-circle btn-loading-circle-4"></span><span class="btn-loading-circle btn-loading-circle-5"></span><span class="btn-loading-circle btn-loading-circle-6"></span><span class="btn-loading-circle btn-loading-circle-7"></span><span class="btn-loading-circle btn-loading-circle-8"></span></span> Loading`;
    } else {
        btn.disabled = false;
        btn.textContent = restoreLabel || btn.dataset.restoreLabel || btn.textContent;
    }
}

// One bounded retry (not infinite) for a certificate request that fails at
// the network level or with a transient 5xx — useful during a burst right
// after a course ends, when the Edge Function may be cold-starting or the
// connection may just blip. A real 4xx (not registered, bad request) is
// never retried, since retrying won't change that answer.
async function fetchWithOneRetry(url, options) {
    try {
        const res = await fetch(url, options);
        if (res.status >= 500 && res.status < 600) throw new Error(`Server error (${res.status})`);
        return res;
    } catch (err) {
        await new Promise(r => setTimeout(r, 1200));
        return fetch(url, options);
    }
}

async function init() {
    if (!publicSlug) {
        showFatalError('This certificate link is invalid or incomplete.');
        return;
    }

    const { data: cert, error } = await client
        .from('certificates')
        .select('*, courses(name)')
        .eq('public_slug', publicSlug)
        .maybeSingle();

    if (error || !cert) {
        showFatalError('This certificate link could not be found. Please check the link and try again.');
        return;
    }

    courseName = cert.courses?.name || 'this course';
}

function showFatalError(message) {
    document.getElementById('staffNumberStep').innerHTML = `
        <div style="background:#fff5f5; border:1px solid #fed7d7; color:#b91c1c; padding:18px; border-radius:12px; font-size:14px; line-height:1.5;">${message}</div>
    `;
}

document.getElementById('checkEmailBtn').addEventListener('click', async () => {
    const staffNumber = document.getElementById('certStaffNumberInput').value.trim();
    const errorBox = document.getElementById('checkEmailError');
    errorBox.classList.add('hidden-element');

    if (!staffNumber) {
        errorBox.textContent = 'Please enter your staff number.';
        errorBox.classList.remove('hidden-element');
        return;
    }

    const btn = document.getElementById('checkEmailBtn');
    setBtnLoading(btn, true);

    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/check-registration`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ public_slug: publicSlug, staff_number: staffNumber })
        });
        const result = await res.json();

        if (!res.ok || !result.found) {
            errorBox.innerHTML = 'Staff number not found.<br><br>This staff number is not registered for this course.<br>Please use the same staff number you used during registration.';
            errorBox.classList.remove('hidden-element');
            return;
        }

        // Registered, but never confirmed via the Attendance link — caught
        // here (right after the staff number check) rather than only after
        // tapping Get Certificate, so it's clear this isn't the same as
        // "not registered". generate-certificate re-checks this server-side
        // too regardless (never trust this client-side gate alone).
        if (result.not_attended) {
            errorBox.innerHTML = `You are registered${result.name ? `, ${result.name}` : ''} — but you have not been marked as attended for this activity yet.<br><br>Please confirm your attendance first (using the Attendance link shared for this activity), then come back here for your certificate.`;
            errorBox.classList.remove('hidden-element');
            return;
        }

        verifiedStaffNumber = staffNumber;
        document.getElementById('verifiedName').textContent = result.name;
        document.getElementById('verifiedCourse').textContent = result.course_name || courseName;
        document.getElementById('staffNumberStep').classList.add('hidden-element');
        document.getElementById('verifiedStep').classList.remove('hidden-element');

        // This certificate template requires one or more evaluations/exams
        // to be completed first (Create Certificate -> "Required
        // Evaluation(s) / Exam(s)") and this staff number hasn't submitted
        // all of them yet — show that instead of the Get Certificate
        // button, one requirement at a time. generate-certificate re-checks
        // this server-side regardless (never trust this client-side gate alone).
        pendingList = result.pending_evaluations || (result.pending_evaluation ? [result.pending_evaluation] : []);
        renderPendingState();
    } catch (err) {
        errorBox.textContent = 'Something went wrong checking your registration. Please try again in a moment.';
        errorBox.classList.remove('hidden-element');
    } finally {
        setBtnLoading(btn, false, 'Check');
    }
});

// Shows just the NEXT outstanding requirement as a single button (opened in
// a new tab) — once pendingList is empty, hides the notice and reveals Get
// Certificate instead. Called after every fetch/re-check of pendingList.
function renderPendingState() {
    const pendingBox = document.getElementById('pendingEvaluationNotice');
    const linksBox = document.getElementById('pendingEvaluationLinks');
    const remainingBox = document.getElementById('pendingEvaluationRemaining');
    const getBtn = document.getElementById('getCertificateBtn');

    if (pendingList.length === 0) {
        pendingBox.classList.add('hidden-element');
        getBtn.classList.remove('hidden-element');
        return;
    }

    getBtn.classList.add('hidden-element');
    pendingBox.classList.remove('hidden-element');

    const next = pendingList[0];
    const evalUrl = new URL('evaluation.html', window.location.href);
    evalUrl.searchParams.set('e', next.public_slug);
    // Staff number is already verified on this page — carry it over so
    // evaluation.html skips its own staff-number step entirely instead of
    // asking the participant to type it again (see carriedStaffNumber in
    // init() in js/evaluation-public.js).
    if (verifiedStaffNumber) evalUrl.searchParams.set('s', verifiedStaffNumber);
    linksBox.innerHTML = `<button type="button" class="btn-register" id="pendingRequirementBtn" style="width:auto; padding:9px 18px;">Complete "${next.title}" →</button>`;
    document.getElementById('pendingRequirementBtn').addEventListener('click', () => {
        window.open(evalUrl.toString(), '_blank');
        awaitingReturnCheck = true;
    });

    if (pendingList.length > 1) {
        remainingBox.textContent = `${pendingList.length - 1} more requirement${pendingList.length - 1 > 1 ? 's' : ''} after this one.`;
        remainingBox.classList.remove('hidden-element');
    } else {
        remainingBox.classList.add('hidden-element');
    }
}

// Re-checks this staff number's outstanding requirements — called when this
// tab regains focus after a requirement was opened in another tab. If the
// list got shorter, the participant just solved one, so the "Successfully
// completed" card is shown before moving on to whatever's next (or to Get
// Certificate, if that was the last one).
async function recheckPending() {
    if (!verifiedStaffNumber) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/check-registration`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ public_slug: publicSlug, staff_number: verifiedStaffNumber })
        });
        const result = await res.json();
        if (!res.ok || !result.found) return;

        const newList = result.pending_evaluations || (result.pending_evaluation ? [result.pending_evaluation] : []);
        const justCompletedOne = newList.length < pendingList.length;
        pendingList = newList;
        renderPendingState();
        if (justCompletedOne) showRequirementSuccessOverlay();
    } catch (err) {
        // Silent — nothing here is load-bearing: Get Certificate (once
        // shown) still re-validates everything server-side regardless.
    }
}

function showRequirementSuccessOverlay() {
    const msg = document.getElementById('requirementDoneMessage');
    msg.textContent = pendingList.length === 0
        ? 'All requirements are complete — you can now get your certificate!'
        : `${pendingList.length} more requirement${pendingList.length > 1 ? 's' : ''} to go before you can get your certificate.`;
    document.getElementById('requirementDoneOverlay').classList.remove('hidden-element');
}

document.getElementById('requirementDoneCloseBtn').addEventListener('click', () => {
    document.getElementById('requirementDoneOverlay').classList.add('hidden-element');
});

// The participant opens each requirement in a NEW tab (see
// renderPendingState above), so this tab has to detect completion on its
// own once they come back — regaining focus is the signal to re-check.
window.addEventListener('focus', () => {
    if (!awaitingReturnCheck) return;
    awaitingReturnCheck = false;
    recheckPending();
});

document.getElementById('getCertificateBtn').addEventListener('click', async () => {
    if (!verifiedStaffNumber) return; // safety net — should never happen since this button is only visible post-verification

    const btn = document.getElementById('getCertificateBtn');
    const statusBox = document.getElementById('generateStatus');
    setBtnLoading(btn, true);
    statusBox.textContent = 'Building your certificate — this can take a moment.';

    try {
        const res = await fetchWithOneRetry(`${SUPABASE_URL}/functions/v1/generate-certificate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ public_slug: publicSlug, staff_number: verifiedStaffNumber })
        });
        const result = await res.json();

        if (!res.ok || !result.success) {
            statusBox.innerHTML = `<span style="color:#b91c1c;">${result.error || 'Something went wrong generating your certificate. Please try again shortly.'}</span>`;
            setBtnLoading(btn, false, 'Get Certificate');
            return;
        }

        // The PDF now comes back directly (base64) instead of a storage
        // link — nothing is saved anywhere, so it's built into a Blob here
        // in the browser for the download.
        const byteChars = atob(result.pdf_base64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
        const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
        const pdfUrl = URL.createObjectURL(blob);

        // Trigger the download automatically
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = `certificate_${result.certificate_number}.pdf`;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        statusBox.innerHTML = `
            <span style="color:#16a34a; font-weight:bold;">✓ Your certificate is ready!</span><br><br>
            <a href="${pdfUrl}" target="_blank" class="btn-register" style="display:inline-block; text-decoration:none; padding:12px 24px;">⬇ Download Certificate Again</a>
        `;
        btn.style.display = 'none';
    } catch (err) {
        statusBox.innerHTML = `<span style="color:#b91c1c;">Something went wrong. Please try again shortly.</span>`;
        setBtnLoading(btn, false, 'Get Certificate');
    }
});

document.getElementById('closeCertBtn').addEventListener('click', () => {
    // A page opened via a shared link (not something the visitor navigated
    // to themselves) usually CAN be closed with window.close() — but
    // browsers don't allow scripted closing of a tab they didn't open via
    // script, so this falls back to a plain "you're done" message instead
    // of silently doing nothing.
    window.close();
    document.querySelector('.simple-page-container').innerHTML = '<p style="text-align:center; color:#16a34a; font-weight:bold; padding:40px 0;">All done — you can close this page now.</p>';
});

init();
