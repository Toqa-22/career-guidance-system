import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Same HSL shading helpers as workshops.js, so this page derives the exact
// same light/dark shades from a course's chosen color — previously this
// page only ever set --course-theme itself, leaving --course-theme-light
// and --course-theme-dark undefined, which is what the hero and the
// featured card's gradients actually depend on.
function hexToHsl(hex) {
    hex = (hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4;
        }
        h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function shadeColor(hex, lightnessDeltaPct) {
    const hsl = hexToHsl(hex);
    if (!hsl) return hex;
    const l = Math.min(96, Math.max(6, hsl.l + lightnessDeltaPct));
    return hslToHex(hsl.h, hsl.s, l);
}
const DEFAULT_THEME_COLOR = '#7C3AED';

function applyCourseTheme(rawColor) {
    const base = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(rawColor || '') ? rawColor : DEFAULT_THEME_COLOR;
    const root = document.documentElement.style;
    root.setProperty('--course-theme', base);
    root.setProperty('--course-theme-light', shadeColor(base, 16));
    root.setProperty('--course-theme-dark', shadeColor(base, -16));
}

const params = new URLSearchParams(window.location.search);
const courseId = params.get('course_id');
let currentRegistrationId = null;
let currentStaffName = null;

// The hero starts hidden (see the "theme-loading" class) so the visitor
// never sees the default purple flash before the real course color loads —
// this timeout is just a failsafe in case that fetch is ever slow.
setTimeout(() => document.body.classList.remove('theme-loading'), 1800);

if (!courseId) {
    document.getElementById('courseNameLine').textContent = 'This link is missing its activity — please use the link shared for your specific activity.';
    document.getElementById('checkBtn').disabled = true;
    document.body.classList.remove('theme-loading');
} else {
    client.from('courses').select('name, theme_color, description, course_date, instructor_name, seats, unlimited_seats').eq('id', courseId).maybeSingle().then(({ data, error }) => {
        if (error || !data) {
            document.getElementById('courseNameLine').textContent = 'This activity could not be found.';
            document.getElementById('checkBtn').disabled = true;
            document.body.classList.remove('theme-loading');
            return;
        }
        // Matches the same background this activity's registration page
        // uses, so the two feel like the same place rather than a jump to
        // something generic.
        if (data.theme_color) applyCourseTheme(data.theme_color);
        document.body.classList.remove('theme-loading');
        document.getElementById('courseNameLine').textContent = `${data.name} — enter your staff number to check in.`;

        // Same course-info card style as the registration page, so this
        // still feels like the same activity rather than a generic form.
        document.getElementById('featuredSection').classList.remove('hidden-element');
        document.getElementById('featuredTitle').textContent = data.name;
        document.getElementById('featuredDescription').textContent = (data.description || '').trim() || 'Log your sessions for this activity below.';
        const metaParts = [`<span>📅 ${data.course_date || 'Date TBA'}</span>`];
        if ((data.instructor_name || '').trim()) metaParts.push(`<span>🎓 ${data.instructor_name}</span>`);
        document.getElementById('featuredMeta').innerHTML = metaParts.join('');
    });
}

document.getElementById('goRegisterBtn').addEventListener('click', (e) => {
    e.preventDefault();
    const url = new URL('register.html', window.location.href);
    url.searchParams.set('course', courseId);
    window.location.href = url.toString();
});

document.getElementById('closeLogBtn').addEventListener('click', () => {
    // A page opened via a shared link (not something the visitor navigated
    // to themselves) usually CAN be closed with window.close() — but
    // browsers don't allow scripted closing of a tab they didn't open via
    // script, so this falls back to a plain "you're done" message instead
    // of silently doing nothing.
    window.close();
    document.getElementById('logCard').innerHTML = '<p style="text-align:center; color:#16a34a; font-weight:bold;">All done — you can close this page now.</p>';
});

function formatEntryDate(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatEntryTime(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

async function loadEntries() {
    const box = document.getElementById('existingEntriesBox');
    // Only the single most recent entry is shown here — a public
    // self-check-in view, not a full audit trail (admins can still see the
    // complete history from Participant Registrations).
    const { data, error } = await client
        .from('activity_log_entries')
        .select('title, entry_date, entry_time')
        .eq('registration_id', currentRegistrationId)
        .order('entry_date', { ascending: false })
        .order('entry_time', { ascending: false })
        .limit(1);

    if (error) {
        box.innerHTML = `<p style="color:#b91c1c; font-size:13px;">Couldn't load your entries: ${error.message}</p>`;
        return;
    }
    if (!data || data.length === 0) {
        box.innerHTML = '<p style="color:#94a3b8; font-size:13px;">No entries logged yet.</p>';
        return;
    }
    box.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:13.5px;">
            <thead><tr style="text-align:left; color:#64748b; font-size:12px;">
                <th style="padding:6px 8px; border-bottom:2px solid #f1f5f9;">Title</th>
                <th style="padding:6px 8px; border-bottom:2px solid #f1f5f9;">Date</th>
                <th style="padding:6px 8px; border-bottom:2px solid #f1f5f9;">Time</th>
            </tr></thead>
            <tbody>
                ${data.map(e => `
                    <tr>
                        <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${e.title}</td>
                        <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${formatEntryDate(e.entry_date)}</td>
                        <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${formatEntryTime(e.entry_time)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

document.getElementById('checkBtn').addEventListener('click', async () => {
    const staffNumber = document.getElementById('staffNumberInput').value.trim();
    const note = document.getElementById('checkNote');
    note.textContent = '';
    note.style.color = '';

    if (!staffNumber) {
        note.textContent = 'Please enter your staff number.';
        note.style.color = '#b91c1c';
        return;
    }

    const btn = document.getElementById('checkBtn');
    btn.disabled = true;
    btn.textContent = 'Checking...';

    try {
        // Case-insensitive, same as certificate lookup and attendance check-in.
        const { data: reg, error: findErr } = await client
            .from('registrations')
            .select('id, staff_name')
            .eq('course_id', courseId)
            .ilike('staff_number', staffNumber)
            .maybeSingle();

        if (findErr) throw findErr;

        if (!reg) {
            document.getElementById('staffCheckCard').classList.add('hidden-element');
            document.getElementById('notRegisteredCard').classList.remove('hidden-element');
            return;
        }

        currentRegistrationId = reg.id;
        currentStaffName = reg.staff_name;
        document.getElementById('loggedForName').textContent = `Logging for: ${reg.staff_name}`;
        document.getElementById('staffCheckCard').classList.add('hidden-element');
        document.getElementById('logCard').classList.remove('hidden-element');
        await loadEntries();
    } catch (err) {
        note.textContent = 'Something went wrong: ' + err.message;
        note.style.color = '#b91c1c';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Check';
    }
});

document.getElementById('addEntryBtn').addEventListener('click', async () => {
    const title = document.getElementById('entryTitle').value.trim();
    const entryDate = document.getElementById('entryDate').value;
    const entryTime = document.getElementById('entryTime').value;
    const note = document.getElementById('entryNote');
    note.textContent = '';
    note.style.color = '';

    if (!title || !entryDate || !entryTime) {
        note.textContent = 'Please fill in the title, date, and time.';
        note.style.color = '#b91c1c';
        return;
    }

    const btn = document.getElementById('addEntryBtn');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
        // Always an INSERT — this is intentionally append-only. Previous
        // entries are never touched, so checking in again later just adds
        // more rows rather than replacing anything already logged.
        const { error } = await client.from('activity_log_entries').insert({
            registration_id: currentRegistrationId,
            title, entry_date: entryDate, entry_time: entryTime
        });
        if (error) throw error;

        note.textContent = 'Entry added!';
        note.style.color = '#16a34a';
        document.getElementById('entryTitle').value = '';
        document.getElementById('entryDate').value = '';
        document.getElementById('entryTime').value = '';
        await loadEntries();
    } catch (err) {
        note.textContent = 'Could not add entry: ' + err.message;
        note.style.color = '#b91c1c';
    } finally {
        btn.disabled = false;
        btn.textContent = '+ Add Entry';
    }
});
