import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
        if (data.theme_color) document.documentElement.style.setProperty('--course-theme', data.theme_color);
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
