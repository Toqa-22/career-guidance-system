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
        const linkCell = link
            ? `<a href="${link}" target="_blank" class="btn-tbl-view" style="margin-right:6px;">Open</a>
               <button type="button" class="btn-tbl-edit" data-copy="${link}">Copy Link</button>`
            : '<span style="color:#94a3b8; font-size:12px;">Not published</span>';
        const previewCell = cert.preview_image_path
            ? `<a href="${cert.preview_image_path}" target="_blank" class="btn-tbl-view">Preview</a>`
            : '<span style="color:#94a3b8; font-size:12px;">No preview</span>';

        return `
            <tr>
                <td><b>${cert.certificate_name || `Certificate for ${courseName}`}</b><br><span style="font-size:11px; color:#94a3b8;">${courseName}</span></td>
                <td>${previewCell}</td>
                <td>${formatDate(cert.created_at)}</td>
                <td>${linkCell}</td>
                <td class="action-cell">
                    <a class="btn-tbl-edit" href="create-certificate.html?course_id=${cert.course_id}">Edit</a>
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
}

loadCertificates();
