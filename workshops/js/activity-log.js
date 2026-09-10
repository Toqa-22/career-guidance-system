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
let currentStaffNumber = null;

// The hero starts hidden (see the "theme-loading" class) so the visitor
// never sees the default purple flash before the real course color loads —
// this timeout is just a failsafe in case that fetch is ever slow.
setTimeout(() => document.body.classList.remove('theme-loading'), 1800);

if (!courseId) {
    document.getElementById('courseNameLine').textContent = 'This link is missing its activity — please use the link shared for your specific activity.';
    document.getElementById('checkBtn').disabled = true;
    document.body.classList.remove('theme-loading');
} else {
    client.from('courses').select('name, theme_color, description, course_date, instructor_name, seats, unlimited_seats, links_closed').eq('id', courseId).maybeSingle().then(({ data, error }) => {
        if (error || !data) {
            document.getElementById('courseNameLine').textContent = 'This activity could not be found.';
            document.getElementById('checkBtn').disabled = true;
            document.body.classList.remove('theme-loading');
            return;
        }
        if (data.links_closed) {
            document.getElementById('courseNameLine').textContent = 'The activity log for this activity is currently closed.';
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
        const logDescription = (data.description || '').trim();
        const logDescEl = document.getElementById('featuredDescription');
        logDescEl.textContent = logDescription ? `📌 ${logDescription}` : 'Log your sessions for this activity below.';
        logDescEl.classList.toggle('has-comment', Boolean(logDescription));
        const metaParts = [`<span>📅 ${data.course_date || 'Date TBA'}</span>`];
        if ((data.instructor_name || '').trim()) metaParts.push(`<span>🎓 ${data.instructor_name}</span>`);
        document.getElementById('featuredMeta').innerHTML = metaParts.join('');
    });
}

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

// Ibra departments only, matching "choose department from Ibra
// institution" — same "Ibra - " name-prefix convention used everywhere
// else institutions are split this way in the app. This one populates the
// REGULAR entry form's own department field — every new entry requires
// choosing one, going forward, separate from the one-time backfill card
// below (which is only for entries logged before this feature existed).
async function populateEntryDeptSelect() {
    const select = document.getElementById('entryDept');
    const { data, error } = await client.from('institutions').select('name');
    if (error || !data) return;
    const departments = data.filter(i => i.name.startsWith('Ibra - ')).map(i => i.name.replace('Ibra - ', ''));
    select.innerHTML = '<option value="">-- Choose Organized By --</option>' +
        departments.map(d => `<option value="${d}">${d}</option>`).join('');
}

// Ibra departments only, matching "choose department from Ibra
// institution" — same "Ibra - " name-prefix convention used everywhere
// else institutions are split this way in the app.
async function populateDeptBackfillSelect() {
    const select = document.getElementById('deptBackfillSelect');
    const { data, error } = await client.from('institutions').select('name');
    if (error || !data) return;
    const departments = data.filter(i => i.name.startsWith('Ibra - ')).map(i => i.name.replace('Ibra - ', ''));
    select.innerHTML = '<option value="">-- Choose Organized By --</option>' +
        departments.map(d => `<option value="${d}">${d}</option>`).join('');
}

// Shows the entry the participant already logged before this feature
// existed, above the department picker — same rendering as loadEntries()
// below, just into the backfill card's own box instead.
async function loadBackfillEntries() {
    const box = document.getElementById('deptBackfillEntriesBox');
    const { data, error } = await client
        .from('activity_log_entries')
        .select('title, entry_date, entry_time')
        .eq('registration_id', currentRegistrationId)
        .order('entry_date', { ascending: false })
        .order('entry_time', { ascending: false })
        .limit(1);

    if (error || !data || data.length === 0) { box.innerHTML = ''; return; }
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

document.getElementById('deptBackfillContinueBtn').addEventListener('click', async () => {
    const dept = document.getElementById('deptBackfillSelect').value;
    const note = document.getElementById('deptBackfillNote');
    note.textContent = '';
    note.style.color = '';

    if (!dept) {
        note.textContent = 'Please choose Organized By.';
        note.style.color = '#b91c1c';
        return;
    }

    const btn = document.getElementById('deptBackfillContinueBtn');
    btn.disabled = true;
    btn.textContent = 'Please wait...';

    try {
        const newSnapshot = `Ibra - ${dept}`;
        const { data: matchingInst } = await client.from('institutions').select('id').eq('name', newSnapshot).maybeSingle();
        const { error: updateErr } = await client.from('registrations').update({
            institution_name_snapshot: newSnapshot,
            institution_id: matchingInst ? matchingInst.id : null,
            // Marks this as done for good — this card never shows for
            // this registration again after this, even for later entries.
            department_chosen_via_log: true
        }).eq('id', currentRegistrationId);
        if (updateErr) throw updateErr;

        document.getElementById('departmentBackfillCard').classList.add('hidden-element');
        document.getElementById('loggedForName').textContent = `Logging for: ${currentStaffName} (Staff #: ${currentStaffNumber})`;
        document.getElementById('logCard').classList.remove('hidden-element');
        await populateEntryDeptSelect();
        await loadEntries();
    } catch (err) {
        note.textContent = 'Something went wrong: ' + err.message;
        note.style.color = '#b91c1c';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Continue';
    }
});

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
        const { data: freshCourse } = await client.from('courses').select('links_closed').eq('id', courseId).maybeSingle();
        if (freshCourse && freshCourse.links_closed) {
            note.textContent = 'The activity log for this activity is currently closed.';
            note.style.color = '#b91c1c';
            btn.disabled = false;
            btn.textContent = 'Check';
            return;
        }

        // Case-insensitive, same as certificate lookup and attendance check-in.
        const { data: reg, error: findErr } = await client
            .from('registrations')
            .select('id, staff_name, staff_number, department_chosen_via_log')
            .eq('course_id', courseId)
            .ilike('staff_number', staffNumber)
            .maybeSingle();

        if (findErr) throw findErr;

        if (!reg) {
            // Straight to the registration page — no separate "not
            // registered, click here" confirmation card. They already told
            // us their staff number isn't registered by nature of the
            // lookup failing; asking them to click again just to get to
            // where they clearly need to go is a redundant extra step.
            // Carrying the staff number itself over via ?staff= too, so
            // register.html's own Staff Number step can skip straight
            // through instead of asking for the same number a second time.
            const url = new URL('register.html', window.location.href);
            url.searchParams.set('course', courseId);
            url.searchParams.set('staff', staffNumber);
            window.location.href = url.toString();
            return;
        }

        currentRegistrationId = reg.id;
        currentStaffName = reg.staff_name;
        currentStaffNumber = reg.staff_number;
        document.getElementById('staffCheckCard').classList.add('hidden-element');

        // The department backfill card is a ONE-TIME step for people who
        // logged entries before this feature existed — gated on the
        // flag itself, not just "has an existing entry", so once someone
        // completes it, it's marked done for good and every future visit
        // goes straight to the normal form. A brand new participant with
        // no entries yet also skips it entirely (there's nothing of
        // theirs to backfill).
        if (!reg.department_chosen_via_log) {
            const { count: entryCount } = await client
                .from('activity_log_entries')
                .select('id', { count: 'exact', head: true })
                .eq('registration_id', reg.id);

            if (entryCount && entryCount > 0) {
                document.getElementById('deptBackfillForName').textContent = `Logging for: ${reg.staff_name} (Staff #: ${reg.staff_number})`;
                document.getElementById('departmentBackfillCard').classList.remove('hidden-element');
                await populateDeptBackfillSelect();
                await loadBackfillEntries();
                return;
            }
        }

        document.getElementById('loggedForName').textContent = `Logging for: ${reg.staff_name} (Staff #: ${reg.staff_number})`;
        document.getElementById('logCard').classList.remove('hidden-element');
        await populateEntryDeptSelect();
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
    const dept = document.getElementById('entryDept').value;
    const title = document.getElementById('entryTitle').value.trim();
    const entryDate = document.getElementById('entryDate').value;
    const entryTime = document.getElementById('entryTime').value;
    const note = document.getElementById('entryNote');
    note.textContent = '';
    note.style.color = '';

    if (!dept) {
        note.textContent = 'Please choose Organized By.';
        note.style.color = '#b91c1c';
        return;
    }
    if (!title || !entryDate || !entryTime) {
        note.textContent = 'Please fill in the title, date, and time.';
        note.style.color = '#b91c1c';
        return;
    }

    const btn = document.getElementById('addEntryBtn');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
        // Every new entry, going forward, updates the participant's
        // current department — separate from the one-time backfill card,
        // which only ever covers entries logged before this feature
        // existed. Also unconditionally marks department_chosen_via_log
        // true here, so a brand new participant (who has nothing to
        // backfill and never sees that card) still counts correctly in
        // the "Courses per Department" report from their very first entry.
        const newSnapshot = `Ibra - ${dept}`;
        const { data: matchingInst } = await client.from('institutions').select('id').eq('name', newSnapshot).maybeSingle();
        const { error: regUpdateErr } = await client.from('registrations').update({
            institution_name_snapshot: newSnapshot,
            institution_id: matchingInst ? matchingInst.id : null,
            department_chosen_via_log: true
        }).eq('id', currentRegistrationId);
        if (regUpdateErr) throw regUpdateErr;

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
        document.getElementById('entryDept').value = '';
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
