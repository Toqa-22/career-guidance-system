import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
}

function renderRegistrations(registrations) {
    const box = document.getElementById('myRegistrationsList');
    if (!registrations || registrations.length === 0) {
        box.innerHTML = '<div style="color:#64748b; font-size:14px;">No registrations found for this staff number.</div>';
        return;
    }
    box.innerHTML = registrations.map(r => `
        <div style="background:white; border-radius:16px; padding:20px 24px; box-shadow:0 4px 16px rgba(17,17,17,.05); border-left:3px solid #3B82F6; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
                <div style="font-size:17px; font-weight:800; color:#111111;">${r.course_name}</div>
                <div style="font-size:13px; color:#64748b; margin-top:4px;">📅 ${formatDate(r.course_date)} &nbsp;•&nbsp; Registered ${formatDate(r.registered_on)}</div>
            </div>
            <span style="background:#EFF6FF; color:#3B82F6; font-size:12px; font-weight:700; padding:6px 12px; border-radius:8px;">${r.designation || 'Registered'}</span>
        </div>
    `).join('');
}

function renderCertificates(certificates) {
    const box = document.getElementById('myCertificatesList');
    if (!certificates || certificates.length === 0) {
        box.innerHTML = '<div style="color:#64748b; font-size:14px;">No certificates issued yet.</div>';
        return;
    }
    box.innerHTML = certificates.map(c => `
        <div style="background:white; border-radius:16px; padding:20px 24px; box-shadow:0 4px 16px rgba(17,17,17,.05); border-left:3px solid #7C3AED; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
                <div style="font-size:17px; font-weight:800; color:#111111;">🏅 ${c.course_name}</div>
                <div style="font-size:13px; color:#64748b; margin-top:4px;">${c.certificate_number} &nbsp;•&nbsp; Issued ${formatDate(c.sent_at)}</div>
            </div>
            ${c.pdf_path ? `<a href="${c.pdf_path}" target="_blank" class="btn-register" style="padding:10px 18px; font-size:13px; width:auto;">Download</a>` : ''}
        </div>
    `).join('');
}

document.getElementById('viewDashboardBtn').addEventListener('click', async () => {
    const staffNumber = document.getElementById('studentStaffNumberInput').value.trim();
    const errorBox = document.getElementById('studentDashboardError');
    const resultsBox = document.getElementById('studentDashboardResults');
    errorBox.classList.add('hidden-element');
    resultsBox.classList.add('hidden-element');

    if (!staffNumber) {
        errorBox.textContent = 'Please enter your staff number.';
        errorBox.classList.remove('hidden-element');
        return;
    }

    const btn = document.getElementById('viewDashboardBtn');
    btn.disabled = true;
    btn.textContent = 'Loading...';

    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-my-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ staff_number: staffNumber })
        });
        const result = await res.json();

        if (!res.ok) {
            errorBox.textContent = result.error || 'Something went wrong loading your dashboard.';
            errorBox.classList.remove('hidden-element');
            return;
        }

        renderRegistrations(result.registrations || []);
        renderCertificates(result.certificates || []);
        resultsBox.classList.remove('hidden-element');
    } catch (err) {
        errorBox.textContent = 'Something went wrong. Please try again shortly.';
        errorBox.classList.remove('hidden-element');
    } finally {
        btn.disabled = false;
        btn.textContent = 'View My Dashboard';
    }
});
