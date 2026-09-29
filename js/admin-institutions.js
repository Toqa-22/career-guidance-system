import { requireSession, client } from '../js/admin-shared.js';

requireSession();

// Exact same "Ibra - " department list Create Course uses to split
// Ibra vs. Other institutions (see js/create-course.js's
// masterInstitutionsAndDepartments) — offered here as autocomplete
// suggestions, without the "Ibra - " prefix since the admin only types the
// department name itself; the prefix is added automatically on save.
const IBRA_DEPARTMENT_NAMES = [
    "Emergency Department Doctor", "Emergency Department Nurse", "Internal Medicine Department",
    "General Surgery Department", "Paediatrician", "Obstetrics and Gynecology Department",
    "Orthopedics Department", "Ophthalmology Department", "ENT Department",
    "Anesthesia Department", "Dialysis Unit Nurse", "Radiology Department",
    "Laboratory Department", "Physiotherapy Department", "Clinical Nutrition Department",
    "Pharmacy Department", "Male Medical and Surgical Ward", "Female Medical and Surgical Ward",
    "Pediatrics Ward", "Obstetrics and Gynecology Ward", "Adult Intensive Care Unit (ICU)",
    "Special Care Baby Unit (SCBU)", "OPD", "Nephrologist", "DS Nurse",
    "OT Nurse", "RT"
];
const IBRA_PREFIX = 'Ibra - ';

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setAddNote(message, isError) {
    const note = document.getElementById('addInstNote');
    note.textContent = message || '';
    note.className = `admin-note${isError ? ' error' : ' success'}`;
}

// Ibra departments are offered as autocomplete SUGGESTIONS (a <datalist>),
// not a locked list — typing any other department name is allowed too.
function populateSuggestions(existingBareNames) {
    const datalist = document.getElementById('ibraDeptSuggestions');
    const remaining = IBRA_DEPARTMENT_NAMES.filter(name => !existingBareNames.has(name));
    datalist.innerHTML = remaining.map(name => `<option value="${name}"></option>`).join('');
}

async function loadInstitutions() {
    const tbody = document.getElementById('instTableBody');
    // This page is Ibra Department only — an "Ibra - " prefixed name is
    // what makes an institution show up here at all; anything else (a
    // different kind of institution added elsewhere) stays out of this list.
    const { data, error } = await client.from('institutions').select('id, name, staff_count')
        .like('name', `${IBRA_PREFIX}%`).order('name', { ascending: true });

    if (error) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="3">Couldn't load departments: ${error.message}</td></tr>`;
        return;
    }

    populateSuggestions(new Set((data || []).map(i => i.name.slice(IBRA_PREFIX.length))));

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="3">No Ibra departments yet — add one above.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(inst => `
        <tr data-id="${inst.id}">
            <td><input type="text" class="inst-name-input" value="${escapeHtml(inst.name.slice(IBRA_PREFIX.length))}" placeholder="Department name"></td>
            <td><input type="number" min="0" class="inst-staff-input" value="${inst.staff_count ?? ''}" placeholder="—"></td>
            <td>
                <div class="admin-row-actions">
                    <button type="button" class="admin-btn admin-btn-small" data-action="save">Save</button>
                    <button type="button" class="admin-btn-danger-gradient" data-action="remove">Remove</button>
                </div>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="remove"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('tr');
            const id = row.dataset.id;
            const name = row.querySelector('.inst-name-input').value;
            if (!(await confirmCard(`Remove "${IBRA_PREFIX}${name}"? This cannot be undone.`))) return;

            btn.disabled = true;
            btn.textContent = 'Removing…';
            const { error: delErr } = await client.from('institutions').delete().eq('id', id);
            if (delErr) {
                alert('Could not remove: ' + delErr.message);
                btn.disabled = false;
                btn.textContent = 'Remove';
                return;
            }
            alert('Removed successfully!');
            loadInstitutions();
        });
    });

    tbody.querySelectorAll('[data-action="save"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('tr');
            const id = row.dataset.id;
            const nameInput = row.querySelector('.inst-name-input');
            const staffInput = row.querySelector('.inst-staff-input');
            const bareName = nameInput.value.trim();
            const staff_count = staffInput.value === '' ? null : parseInt(staffInput.value, 10);

            if (!bareName) {
                alert('Department name cannot be empty.');
                return;
            }
            // Renaming is safe: course seat allocations (course_institutions)
            // link by institution_id, not by name, so a rename here is
            // picked up automatically wherever that link is joined — no
            // re-configuration needed on any course. Historical
            // registrations keep their own frozen institution_name_snapshot
            // regardless (by design, for accurate old reports), so a rename
            // never rewrites past records.
            const name = `${IBRA_PREFIX}${bareName}`;
            if (!(await confirmCard(`Save "${name}"?`))) return;

            btn.disabled = true;
            btn.textContent = 'Saving…';
            const { error: saveErr } = await client.from('institutions').update({ name, staff_count }).eq('id', id);
            btn.disabled = false;
            btn.textContent = 'Save';
            if (saveErr) {
                alert('Could not save: ' + saveErr.message);
                return;
            }
            alert('Saved successfully!');
            loadInstitutions();
        });
    });
}

document.getElementById('addInstBtn').addEventListener('click', async () => {
    const bareName = document.getElementById('newInstName').value.trim();
    const staffCountRaw = document.getElementById('newInstStaffCount').value;
    const staff_count = staffCountRaw === '' ? null : parseInt(staffCountRaw, 10);
    setAddNote('', false);

    if (!bareName) {
        setAddNote('Please enter a department name.', true);
        return;
    }
    // The admin only ever types the department name itself — the "Ibra - "
    // prefix is applied here, not something they need to type or remember.
    const name = bareName.startsWith(IBRA_PREFIX) ? bareName : IBRA_PREFIX + bareName;
    if (!(await confirmCard(`Add department "${name}"?`))) return;

    const btn = document.getElementById('addInstBtn');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
        const { error } = await client.from('institutions').insert({ name, staff_count });
        if (error) throw error;
        setAddNote(`"${name}" added successfully!`, false);
        document.getElementById('newInstName').value = '';
        document.getElementById('newInstStaffCount').value = '';
        loadInstitutions();
    } catch (err) {
        setAddNote('Could not add: ' + err.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = '+ Add';
    }
});

loadInstitutions();
