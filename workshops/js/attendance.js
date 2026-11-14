import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const courseId = params.get('course_id');
const noteEl = document.getElementById('attendanceNote');

// Multi-day activities (courses.attendance_days > 1) have one link per day: attendance.html?course_id=X&day=N.
// A 1-day activity ignores ?day= completely, so every link already shared keeps working exactly as before.
let attendanceDays = 1;
let dayNumber = null; // only set for a valid multi-day link

function dayLabel() {
    return attendanceDays > 1 && dayNumber ? ` (Day ${dayNumber} of ${attendanceDays})` : '';
}

if (!courseId) {
    document.getElementById('courseNameLine').textContent = 'This link is missing its activity — please use the link shared for your specific activity.';
    document.getElementById('confirmBtn').disabled = true;
} else {
    client.from('courses').select('*').eq('id', courseId).maybeSingle().then(({ data, error }) => {
        if (error || !data) {
            document.getElementById('courseNameLine').textContent = 'This activity could not be found.';
            document.getElementById('confirmBtn').disabled = true;
            return;
        }
        attendanceDays = Math.max(1, parseInt(data.attendance_days, 10) || 1);
        if (attendanceDays > 1) {
            const requested = Number(params.get('day'));
            if (Number.isInteger(requested) && requested >= 1 && requested <= attendanceDays) {
                dayNumber = requested;
            } else {
                document.getElementById('courseNameLine').textContent = `${data.name} has ${attendanceDays} attendance days — this link is missing a valid day. Please use the link shared for your specific day.`;
                document.getElementById('confirmBtn').disabled = true;
                return;
            }
        }
        if (data.links_closed) {
            document.getElementById('courseNameLine').textContent = 'Attendance check-in for this activity is currently closed.';
            document.getElementById('confirmBtn').disabled = true;
            return;
        }
        document.getElementById('courseNameLine').textContent = `${data.name}${dayLabel()} — enter your staff number to confirm you're here.`;
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
        // select('*') so this keeps working before sql/multi-day-attendance.sql adds attendance_days.
        const { data: freshCourse } = await client.from('courses').select('*').eq('id', courseId).maybeSingle();
        if (freshCourse) {
            attendanceDays = Math.max(1, parseInt(freshCourse.attendance_days, 10) || 1);
            const requestedDay = Number(params.get('day'));
            dayNumber = (attendanceDays > 1 && Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= attendanceDays) ? requestedDay : null;
            if (attendanceDays > 1 && !dayNumber) {
                noteEl.textContent = 'This link is missing a valid day — please use the link shared for your specific day.';
                noteEl.style.color = '#b91c1c';
                btn.disabled = false;
                btn.textContent = 'Confirm Attendance';
                return;
            }
        }
        if (freshCourse && freshCourse.links_closed) {
            noteEl.textContent = 'Attendance check-in for this activity is currently closed.';
            noteEl.style.color = '#b91c1c';
            btn.disabled = false;
            btn.textContent = 'Confirm Attendance';
            return;
        }

        // Case-insensitive, same as certificate lookup — a staff number
        // typed in a different case than it was registered with still matches.
        // limit(1) instead of maybeSingle(): a stray duplicate row must never turn into a "Something went wrong" error.
        const { data: regRows, error: findErr } = await client
            .from('registrations')
            .select('id, staff_name, attended')
            .eq('course_id', courseId)
            .ilike('staff_number', escapeLike(staffNumber))
            .order('attended', { ascending: false, nullsFirst: false })
            .order('id', { ascending: false })
            .limit(1);
        const reg = (regRows && regRows[0]) || null;

        if (findErr) throw findErr;

        if (!reg) {
            noteEl.textContent = "We couldn't find a registration for this staff number on this activity. Please check the number or contact the training team.";
            noteEl.style.color = '#b91c1c';
            return;
        }

        if (attendanceDays > 1) {
            // Multi-day activity: one row per person per day. registrations.attended stays "attended at least one day"
            // so every existing report/filter keeps working; the per-day rows decide which days a certificate needs.
            if (!dayNumber) throw new Error('This link is missing its day.');
            const { data: existingDay, error: dayFindErr } = await client
                .from('registration_attendance_days')
                .select('id')
                .eq('registration_id', reg.id)
                .eq('day_number', dayNumber)
                .limit(1);
            if (dayFindErr) throw dayFindErr;
            if (existingDay && existingDay.length > 0) {
                noteEl.textContent = `You're already marked as attended for Day ${dayNumber}, ${reg.staff_name}.`;
                noteEl.style.color = '#16a34a';
                return;
            }
            const { error: dayInsErr } = await client
                .from('registration_attendance_days')
                .insert({ registration_id: reg.id, course_id: Number(courseId), day_number: dayNumber });
            if (dayInsErr && dayInsErr.code !== '23505') throw dayInsErr; // 23505 = same day confirmed twice at once: already recorded
            if (!reg.attended) {
                const { error: flagErr } = await client
                    .from('registrations')
                    .update({ attended: true, attended_at: new Date().toISOString() })
                    .eq('id', reg.id);
                if (flagErr) throw flagErr;
            }
            noteEl.textContent = `Thanks, ${reg.staff_name} — your attendance for Day ${dayNumber} is confirmed!`;
            noteEl.style.color = '#16a34a';
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

// Prepares a typed staff number for .ilike(): removes invisible direction/zero-width marks, converts Arabic digits
// to 0-9, then escapes LIKE wildcards so "%" or "_" match only themselves (exact, case-insensitive match).
function escapeLike(value) {
    const cleaned = String(value == null ? "" : value)
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g, "")
        .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
        .trim();
    return cleaned.replace(/[\\%_]/g, (m) => "\\" + m);
}

