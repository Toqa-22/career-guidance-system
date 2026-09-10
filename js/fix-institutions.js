import { requireSession, client } from '../js/admin-shared.js';

requireSession();
const OTHER_CATCHALL_NAME = 'Other (Please Specify)';

let institutionsCached = [];
let departmentsList = [];
let otherInstitutionsList = [];

async function fetchAllRegistrations() {
    // Supabase/PostgREST caps a single request at a default row limit
    // (commonly 1000) -- an unbounded .select() on a table that has grown
    // past that silently returns only the first page, with no error at
    // all. This table has no natural ordering that would make a partial
    // result predictable either, so paginating here is what guarantees
    // every registration is actually checked, not just whichever page
    // came back first -- otherwise an orphaned registration sitting
    // outside that first page would never be found at all.
    const PAGE_SIZE = 1000;
    let allRows = [];
    let from = 0;
    while (true) {
        const { data, error } = await client
            .from('registrations')
            .select('id, staff_name, staff_number, institution_name_snapshot, course_id')
            .range(from, from + PAGE_SIZE - 1);
        if (error) return { data: null, error };
        if (!data || data.length === 0) break;
        allRows = allRows.concat(data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }
    return { data: allRows, error: null };
}

async function load() {
    const [{ data: regs, error: regErr }, { data: courses, error: courseErr }, { data: insts, error: instErr }] = await Promise.all([
        fetchAllRegistrations(),
        client.from('courses').select('id, name'),
        client.from('institutions').select('name')
    ]);

    if (regErr || courseErr || instErr) {
        const err = regErr || courseErr || instErr;
        console.error('[fix-institutions] load failed:', err);
        // Visible in the page itself, not just a dismissible alert() that's
        // easy to miss or that leaves no trace once closed — this stays on
        // screen until the page is reloaded, so a failed load is obvious
        // rather than silently leaving the "Loading…" row sitting there.
        document.getElementById('fixInstitutionsBody').innerHTML =
            `<tr class="admin-empty-row"><td colspan="5" style="color:#b91c1c;">Could not load data: ${err.message} — try reloading the page.</td></tr>`;
        document.getElementById('fixInstitutionsTable').classList.remove('hidden-element');
        document.getElementById('fixInstitutionsEmpty').classList.add('hidden-element');
        return;
    }

    institutionsCached = insts || [];
    const liveNames = new Set(institutionsCached.map(i => i.name));
    departmentsList = institutionsCached.filter(i => i.name.startsWith('Ibra - ')).map(i => i.name.replace('Ibra - ', ''));
    otherInstitutionsList = institutionsCached.filter(i => !i.name.startsWith('Ibra - ') && i.name !== OTHER_CATCHALL_NAME).map(i => i.name);

    const courseNameById = new Map((courses || []).map(c => [c.id, c.name]));

    // A registration is "orphaned" only if its snapshot doesn't match any
    // CURRENTLY existing institution name — free-text "Other (Please
    // Specify): ..." entries are never orphaned by this check, since
    // they were never tied to a specific institution row to begin with
    // (that catch-all option itself isn't expected to ever be removed).
    const orphaned = (regs || []).filter(r => {
        const snap = (r.institution_name_snapshot || '').trim();
        if (!snap) return false;
        if (snap.startsWith(OTHER_CATCHALL_NAME + ':')) return false;
        return !liveNames.has(snap);
    });
    console.log(`[fix-institutions] fetched ${(regs || []).length} registrations, ${institutionsCached.length} live institutions, found ${orphaned.length} orphaned`);

    const emptyBox = document.getElementById('fixInstitutionsEmpty');
    const table = document.getElementById('fixInstitutionsTable');
    const tbody = document.getElementById('fixInstitutionsBody');

    if (orphaned.length === 0) {
        emptyBox.classList.remove('hidden-element');
        table.classList.add('hidden-element');
        return;
    }
    emptyBox.classList.add('hidden-element');
    table.classList.remove('hidden-element');

    tbody.innerHTML = orphaned.map(r => `
        <tr data-reg-id="${r.id}">
            <td>${escapeHtml(r.staff_name || '—')}</td>
            <td>${escapeHtml(r.staff_number || '—')}</td>
            <td>${escapeHtml(courseNameById.get(r.course_id) || 'Unknown activity')}</td>
            <td><span class="missing-institution-badge">${escapeHtml(r.institution_name_snapshot)}</span></td>
            <td>
                <div class="reassign-cell">
                    <select class="reassign-category-select" data-reg-id="${r.id}">
                        <option value="">-- Choose category --</option>
                        <option value="IBRA">Ibra Department</option>
                        <option value="OTHER">Other Institution</option>
                    </select>
                    <select class="reassign-name-select hidden-element" data-reg-id="${r.id}"></select>
                    <button type="button" class="admin-btn admin-btn-small reassign-save-btn hidden-element" data-reg-id="${r.id}">Save</button>
                </div>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.reassign-category-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const regId = sel.dataset.regId;
            const row = tbody.querySelector(`tr[data-reg-id="${regId}"]`);
            const nameSelect = row.querySelector('.reassign-name-select');
            const saveBtn = row.querySelector('.reassign-save-btn');

            if (!sel.value) {
                nameSelect.classList.add('hidden-element');
                saveBtn.classList.add('hidden-element');
                return;
            }
            const options = sel.value === 'IBRA' ? departmentsList : otherInstitutionsList;
            nameSelect.innerHTML = '<option value="">-- Choose --</option>' +
                options.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
            nameSelect.classList.remove('hidden-element');
            saveBtn.classList.remove('hidden-element');
        });
    });

    tbody.querySelectorAll('.reassign-save-btn').forEach(btn => {
        btn.addEventListener('click', () => saveReassignment(btn.dataset.regId));
    });
}

async function saveReassignment(regId) {
    const row = document.querySelector(`tr[data-reg-id="${regId}"]`);
    const category = row.querySelector('.reassign-category-select').value;
    const nameSelect = row.querySelector('.reassign-name-select');
    const chosenName = nameSelect.value;

    if (!category || !chosenName) {
        alert('Please choose both a category and an institution.');
        return;
    }
    const newSnapshot = category === 'IBRA' ? `Ibra - ${chosenName}` : chosenName;
    const matchingInstitution = institutionsCached.find(i => i.name === newSnapshot);

    if (!(await confirmCard(`Reassign this registration to "${newSnapshot}"?`))) return;

    const { error } = await client.from('registrations').update({
        institution_name_snapshot: newSnapshot,
        institution_id: matchingInstitution ? matchingInstitution.id : null
    }).eq('id', regId);

    if (error) {
        alert('Could not save: ' + error.message);
        return;
    }
    row.remove();
    if (!document.querySelector('#fixInstitutionsBody tr')) {
        document.getElementById('fixInstitutionsEmpty').classList.remove('hidden-element');
        document.getElementById('fixInstitutionsTable').classList.add('hidden-element');
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

load();
