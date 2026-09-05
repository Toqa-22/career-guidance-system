import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const courseId = params.get('course_id');
const noteEl = document.getElementById('attendanceNote');

if (!courseId) {
    document.getElementById('courseNameLine').textContent = 'This link is missing its activity — please use the link shared for your specific activity.';
    document.getElementById('confirmBtn').disabled = true;
} else {
    client.from('courses').select('name').eq('id', courseId).maybeSingle().then(({ data, error }) => {
        if (error || !data) {
            document.getElementById('courseNameLine').textContent = 'This activity could not be found.';
            document.getElementById('confirmBtn').disabled = true;
            return;
        }
        document.getElementById('courseNameLine').textContent = `${data.name} — enter your staff number to confirm you're here.`;
    });
}

document.getElementById('confirmBtn').addEventListener('click', async () => {
    const staffNumber = document.getElementById('staffNumberInput').value.trim();
    noteEl.textContent = '';
    noteEl.style.color = '';

    if (!staffNumber) {
        noteEl.textContent = 'Please enter your staff number.';
        noteEl.style.color = '#b91c1c';
        return;
    }

    const btn = document.getElementById('confirmBtn');
    btn.disabled = true;
    btn.textContent = 'Checking...';

    try {
        // Case-insensitive, same as certificate lookup — a staff number
        // typed in a different case than it was registered with still matches.
        const { data: reg, error: findErr } = await client
            .from('registrations')
            .select('id, staff_name, attended')
            .eq('course_id', courseId)
            .ilike('staff_number', staffNumber)
            .maybeSingle();

        if (findErr) throw findErr;

        if (!reg) {
            noteEl.textContent = "We couldn't find a registration for this staff number on this activity. Please check the number or contact the training team.";
            noteEl.style.color = '#b91c1c';
            return;
        }

        if (reg.attended) {
            noteEl.textContent = `You're already marked as attended, ${reg.staff_name}.`;
            noteEl.style.color = '#16a34a';
            return;
        }

        const { error: updErr } = await client
            .from('registrations')
            .update({ attended: true, attended_at: new Date().toISOString() })
            .eq('id', reg.id);
        if (updErr) throw updErr;

        noteEl.textContent = `Thanks, ${reg.staff_name} — your attendance is confirmed!`;
        noteEl.style.color = '#16a34a';
    } catch (err) {
        noteEl.textContent = 'Something went wrong: ' + err.message;
        noteEl.style.color = '#b91c1c';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirm Attendance';
    }
});
