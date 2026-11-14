import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function buildPublicLink(slug) {
    const url = new URL('../certificate.html', window.location.href);
    url.searchParams.set('c', slug);
    return url.toString();
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadCertificates() {
    const tbody = document.getElementById('certificatesTableBody');
    const { data, error } = await client
        .from('certificates')
        .select('*, courses(name)')
        .order('created_at', { ascending: false });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:#dc2626; text-align:center; padding:20px;">Error loading certificates: ${error.message}</td></tr>`;
        return;
    }

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#64748b; padding:20px;">No certificate templates created yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(cert => {
        const courseName = cert.courses?.name || 'Deleted Course';
        const link = cert.public_slug ? buildPublicLink(cert.public_slug) : null;
        const certTitleClean = (cert.certificate_name || `Certificate for ${courseName}`).replace(/"/g, '&quot;');
        const linkCell = link
            ? `<a href="${link}" target="_blank" class="btn-tbl-view" style="margin-right:6px;">Open</a>
               <button type="button" class="btn-tbl-edit" data-copy="${link}">Copy Link</button>
               <button type="button" class="btn-tbl-edit" style="background:#eff6ff; border-color:#bfdbfe; color:#2563eb;" data-qr-link="${link}" data-qr-title="${certTitleClean}">QR Code</button>`
            : '<span style="color:#94a3b8; font-size:12px;">Not published</span>';
        const previewCell = cert.preview_image_path
            ? `<a href="${cert.preview_image_path}" target="_blank" class="btn-tbl-view">Preview</a>`
            : '<span style="color:#94a3b8; font-size:12px;">No preview</span>';

        return `
            <tr>
                <td><b>${cert.certificate_name || `Certificate for ${courseName}`}</b><br><span style="font-size:11px; color:#94a3b8;">${courseName}</span></td>
                <td style="max-width:220px; white-space:pre-wrap;">${cert.comment ? escapeHtml(cert.comment) : '<span style="color:#94a3b8; font-size:12px;">—</span>'}</td>
                <td>${previewCell}</td>
                <td>${formatDate(cert.created_at)}</td>
                <td>${linkCell}</td>
                <td class="action-cell">
                    <a class="btn-tbl-edit" href="create-certificate.html?cert_id=${cert.id}">Edit</a>
                    <button class="btn-tbl-delete" data-id="${cert.id}">Delete</button>
                </td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(btn.getAttribute('data-copy'));
                alert('Link copied to clipboard!');
            } catch (e) {
                prompt('Copy this link:', btn.getAttribute('data-copy'));
            }
        });
    });

    document.querySelectorAll('.btn-tbl-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!(await confirmCard('Delete this certificate template? This cannot be undone.'))) return;
            const { error: delErr } = await client.from('certificates').delete().eq('id', btn.getAttribute('data-id'));
            if (delErr) {
                alert('Delete failed: ' + delErr.message);
            } else {
                alert('Certificate template deleted.');
                loadCertificates();
            }
        });
    });

    document.querySelectorAll('[data-qr-link]').forEach(btn => {
        btn.addEventListener('click', () => {
            showLinkQrModal(btn.getAttribute('data-qr-link'), btn.getAttribute('data-qr-title'));
        });
    });
}

// ============================================================================
// QR Code popup for a certificate's Public Link — same modal/library used on
// the Activity Dashboard (js/dashboard.js). Uses the "qrcode" library,
// vendored locally at js/vendor/qrcode.min.js (built from the qrcode npm
// package, not loaded from an external CDN — some hosting/network setups
// block third-party CDN domains) and loaded as a plain global (QRCode) in
// certificates.html, not the module import.
// ============================================================================
function showLinkQrModal(link, title) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,15,25,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff; border-radius:16px; padding:28px; max-width:360px; width:100%; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    box.innerHTML = `
        <h3 style="margin:0 0 4px; font-size:16px; color:#25233A;">${title}</h3>
        <p style="margin:0 0 16px; font-size:12px; color:#64748b;">Scan to open this link.</p>
        <canvas id="linkQrCanvas" style="max-width:100%; height:auto;"></canvas>
        <p id="linkQrNote" style="margin:8px 0 0; font-size:11.5px; color:#dc2626;"></p>
        <p style="margin:14px 0 0; font-size:11px; word-break:break-all; color:#94a3b8;">${link}</p>
        <div style="display:flex; gap:10px; margin-top:18px;">
            <button type="button" id="linkQrDownloadBtn" class="btn-flex btn-primary-action" style="flex:1;">Download PNG</button>
            <button type="button" id="linkQrCloseBtn" class="btn-flex btn-secondary" style="flex:1;">Close</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    box.querySelector('#linkQrCloseBtn').addEventListener('click', close);

    const canvas = box.querySelector('#linkQrCanvas');
    const note = box.querySelector('#linkQrNote');
    if (typeof QRCode === 'undefined') {
        note.textContent = 'QR image is unavailable right now. You can still copy the link below.';
        box.querySelector('#linkQrDownloadBtn').disabled = true;
        return;
    }
    QRCode.toCanvas(canvas, link, { width: 260, margin: 2 }, (err) => {
        if (err) {
            console.error('QR code generation failed:', err);
            note.textContent = 'Could not generate the QR image. You can still copy the link below.';
        }
    });

    box.querySelector('#linkQrDownloadBtn').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `qr-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
        a.click();
    });
}

loadCertificates();
