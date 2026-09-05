import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';
import { requireSession } from '../js/admin-shared.js';

requireSession();
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const IBRA_PREFIX = 'Ibra - ';

// Same suggestion list as the Ibra Department page — offered only when
// "Ibra" category is selected, since these names don't apply to "Other".
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

function setAddNote(message, isError) {
    const note = document.getElementById('addInstNote');
    note.textContent = message || '';
    note.className = `admin-note${isError ? ' error' : ' success'}`;
}

function updateFormForCategory() {
    const category = document.getElementById('newInstCategory').value;
    const label = document.getElementById('newInstNameLabel');
    const input = document.getElementById('newInstName');
    const datalist = document.getElementById('ibraDeptSuggestions');

    if (category === 'ibra') {
        label.textContent = 'Name (saved as "Ibra - ...")';
        input.placeholder = 'e.g. Radiology Department';
        datalist.innerHTML = IBRA_DEPARTMENT_NAMES.map(name => `<option value="${name}"></option>`).join('');
    } else {
        label.textContent = 'Name';
        input.placeholder = 'e.g. Ministry of Health - Ibri';
        datalist.innerHTML = '';
    }
}
document.querySelectorAll('#newInstCategoryToggle .admin-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#newInstCategoryToggle .admin-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('newInstCategory').value = btn.dataset.value;
        updateFormForCategory();
    });
});
updateFormForCategory();

async function loadInstitutions() {
    const tbody = document.getElementById('instTableBody');
    const { data, error } = await client.from('institutions').select('id, name').order('name', { ascending: true });

    if (error) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="2">Couldn't load institutions: ${error.message}</td></tr>`;
        return;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="2">No institutions yet — add one above.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(inst => {
        const isIbra = inst.name.startsWith(IBRA_PREFIX);
        return `
        <tr data-id="${inst.id}">
            <td><span class="admin-badge ${isIbra ? 'admin-badge-ibra' : 'admin-badge-other'}">${isIbra ? 'Ibra' : 'Other'}</span></td>
            <td>${inst.name} <button type="button" class="admin-btn admin-btn-small admin-btn-danger" data-action="remove" style="float:right;">Remove</button></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-action="remove"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('tr');
            const id = row.dataset.id;
            const name = row.children[1].firstChild.textContent.trim();
            if (!(await confirmCard(`Remove "${name}"? This does not affect past registrations already recorded under it.`))) return;
            const { error: delErr } = await client.from('institutions').delete().eq('id', id);
            if (delErr) { alert('Could not remove: ' + delErr.message); return; }
            alert('Removed successfully!');
            loadInstitutions();
        });
    });
}

document.getElementById('addInstBtn').addEventListener('click', async () => {
    const category = document.getElementById('newInstCategory').value;
    const typed = document.getElementById('newInstName').value.trim();
    setAddNote('', false);

    if (!typed) {
        setAddNote('Please enter a name.', true);
        return;
    }

    // Ibra always gets the prefix applied (even if the admin already typed
    // it) — Other is saved exactly as typed, with no prefix added.
    const name = category === 'ibra'
        ? (typed.startsWith(IBRA_PREFIX) ? typed : IBRA_PREFIX + typed)
        : typed;

    if (!(await confirmCard(`Add "${name}"?`))) return;

    const btn = document.getElementById('addInstBtn');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
        const { error } = await client.from('institutions').insert({ name });
        if (error) throw error;
        setAddNote(`"${name}" added successfully!`, false);
        document.getElementById('newInstName').value = '';
        document.querySelectorAll('#newInstCategoryToggle .admin-pill-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
        document.getElementById('newInstCategory').value = 'ibra';
        updateFormForCategory();
        loadInstitutions();
    } catch (err) {
        setAddNote('Could not add: ' + err.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = '+ Add';
    }
});

loadInstitutions();
