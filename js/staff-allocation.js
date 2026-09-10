import { requireSession, client } from '../js/admin-shared.js';

requireSession();

let institutionsCached = [];
let courseNamesById = new Map();
let departmentsList = [];
let otherInstitutionsList = [];
let allGroups = [];
let currentFilteredGroups = [];
let currentPage = 1;
const PAGE_SIZE = 10;

// A registration's institution_name_snapshot is either "Ibra - X" (an
// Ibra department), a plain institution name (a Health Center), or
// "Other (Please Specify): custom text" (free text, no fixed department
// list to reassign into by name).
function splitInstitutionSnapshot(snapshot) {
    const snap = (snapshot || '').trim();
    if (!snap) return { institution: '—', department: '—', category: null };
    if (snap.startsWith('Ibra - ')) return { institution: 'Ibra', department: snap.slice('Ibra - '.length), category: 'IBRA' };
    if (snap.startsWith('Other (Please Specify):')) return { institution: 'Health Center', department: snap.slice('Other (Please Specify):'.length).trim() || 'Other', category: 'OTHER' };
    return { institution: 'Health Center', department: snap, category: 'OTHER' };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function load() {
    const [{ data: regs, error: regErr }, { data: insts, error: instErr }, { data: courses, error: courseErr }] = await Promise.all([
        fetchAllRegistrations(),
        client.from('institutions').select('name'),
        client.from('courses').select('id, name')
    ]);

    if (regErr || instErr || courseErr) {
        document.getElementById('staffAllocBody').innerHTML =
            `<tr class="admin-empty-row"><td colspan="6" style="color:#b91c1c;">Could not load data: ${(regErr || instErr || courseErr).message} — try reloading the page.</td></tr>`;
        document.getElementById('staffAllocTable').classList.remove('hidden-element');
        return;
    }

    institutionsCached = insts || [];
    courseNamesById = new Map((courses || []).map(c => [c.id, c.name]));
    departmentsList = institutionsCached.filter(i => i.name.startsWith('Ibra - ')).map(i => i.name.replace('Ibra - ', ''));
    otherInstitutionsList = institutionsCached.filter(i => !i.name.startsWith('Ibra - ') && i.name !== 'Other (Please Specify)').map(i => i.name);
    populateDepartmentFilterOptions();

    // One participant shows once, regardless of how many activities/
    // departments they're associated with — grouped by normalized staff
    // number, same identity rule used for reassignment and duplicate
    // detection elsewhere in this app (phone/staff-number based, not name
    // based, since names can be typed inconsistently).
    const groups = new Map();
    (regs || []).filter(r => r.staff_number).forEach(r => {
        const key = r.staff_number.trim().toLowerCase();
        if (!groups.has(key)) groups.set(key, { staff_name: r.staff_name, staff_number: r.staff_number, registrations: [] });
        groups.get(key).registrations.push(r);
    });

    allGroups = Array.from(groups.values())
        .sort((a, b) => (a.staff_number || '').localeCompare(b.staff_number || '') || (a.staff_name || '').localeCompare(b.staff_name || ''));

    renderTable(allGroups);
}

// Same pagination reasoning as fix-institutions.js and Training's own
// student-fetching fix earlier in this project — an unbounded query
// silently truncates at Supabase's default row limit as the table grows.
async function fetchAllRegistrations() {
    const PAGE_SIZE = 1000;
    let allData = [];
    let from = 0;
    while (true) {
        const { data, error } = await client
            .from('registrations')
            .select('id, course_id, staff_name, staff_number, institution_name_snapshot, attended')
            .range(from, from + PAGE_SIZE - 1);
        if (error) return { data: null, error };
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }
    return { data: allData, error: null };
}

function populateDepartmentFilterOptions() {
    const sel = document.getElementById('staffAllocDepartmentFilter');
    const currentCategory = document.getElementById('staffAllocInstitutionFilter').value;
    const options = currentCategory === 'OTHER' ? otherInstitutionsList : departmentsList;

    // A brief fade rather than an instant option-list swap, which is what
    // "not smooth" was about — a native <select>'s own option changes
    // can't be animated directly, so this fades the element itself around
    // the swap instead.
    sel.classList.add('dept-filter-updating');
    setTimeout(() => {
        sel.innerHTML = '<option value="">All Departments</option>' +
            options.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        sel.classList.remove('dept-filter-updating');
    }, 120);
}

function renderTable(groups) {
    currentFilteredGroups = groups;
    const emptyBox = document.getElementById('staffAllocEmpty');
    const table = document.getElementById('staffAllocTable');
    const tbody = document.getElementById('staffAllocBody');
    const paginationBox = document.getElementById('staffAllocPagination');

    if (groups.length === 0) {
        emptyBox.classList.remove('hidden-element');
        table.classList.add('hidden-element');
        paginationBox.innerHTML = '';
        return;
    }
    emptyBox.classList.add('hidden-element');
    table.classList.remove('hidden-element');

    const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageGroups = groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    tbody.innerHTML = pageGroups.map(g => {
        const parts = g.registrations.map(r => splitInstitutionSnapshot(r.institution_name_snapshot));
        const institutionsText = [...new Set(parts.map(p => p.institution))].join(', ');
        const deptBadges = [...new Set(parts.map(p => p.department))].map(d => `<span class="dept-badge">${escapeHtml(d)}</span>`).join('');
        const staffKey = escapeHtml(g.staff_number.trim().toLowerCase());
        // "Participant → Staff Number → Courses registered", at a glance —
        // each course this staff number has a registration for, with
        // whether attendance has been marked yet (same 'attended' flag the
        // Registrations Dashboard already uses).
        const courseBadges = g.registrations
            .map(r => `<span class="dept-badge">${escapeHtml(courseNamesById.get(r.course_id) || 'Deleted Activity')} — ${r.attended ? 'Attended' : 'Registered'}</span>`)
            .join('');

        return `
        <tr data-staff-key="${staffKey}">
            <td>${escapeHtml(g.staff_name || '—')}</td>
            <td>${escapeHtml(g.staff_number || '—')}</td>
            <td>${escapeHtml(institutionsText || '—')}</td>
            <td><div class="dept-badge-list">${deptBadges}</div></td>
            <td><div class="dept-badge-list">${courseBadges}</div></td>
            <td>
                <div class="reassign-cell">
                    <button type="button" class="admin-btn admin-btn-small edit-info-btn" data-staff-key="${staffKey}" style="margin-bottom:6px;">Edit Name / Number</button>
                    <select class="reassign-category-select" data-staff-key="${staffKey}">
                        <option value="">-- Choose category --</option>
                        <option value="IBRA">Ibra Department</option>
                        <option value="OTHER">Other Institution</option>
                    </select>
                    <select class="reassign-name-select hidden-element" data-staff-key="${staffKey}"></select>
                    <button type="button" class="admin-btn admin-btn-small reassign-save-btn hidden-element" data-staff-key="${staffKey}">Update All</button>
                </div>
            </td>
        </tr>
    `;
    }).join('');

    tbody.querySelectorAll('.reassign-category-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const row = sel.closest('tr');
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
        btn.addEventListener('click', () => saveReassignment(btn.dataset.staffKey));
    });
    tbody.querySelectorAll('.edit-info-btn').forEach(btn => {
        btn.addEventListener('click', () => editParticipantInfo(btn.dataset.staffKey));
    });

    renderPagination(currentPage, totalPages);
}

// column of that row, since a single row can now represent several
// registrations at once and there's no single "the" institution to change
// for the row as a whole.
function renderPagination(page, totalPages) {
    const container = document.getElementById('staffAllocPagination');
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `<button type="button" class="pg-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹ Prev</button>`;
    for (let p = 1; p <= totalPages; p++) {
        html += `<button type="button" class="pg-btn${p === page ? ' active' : ''}" data-page="${p}">${p}</button>`;
    }
    html += `<button type="button" class="pg-btn" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>Next ›</button>`;
    container.innerHTML = html;

    container.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = Number(btn.dataset.page);
            if (p >= 1 && p <= totalPages) {
                currentPage = p;
                renderTable(currentFilteredGroups);
            }
        });
    });
}

async function saveReassignment(staffKey) {
    const changeCell = document.querySelector(`.reassign-save-btn[data-staff-key="${staffKey}"]`).closest('td');
    const category = changeCell.querySelector('.reassign-category-select').value;
    const chosenName = changeCell.querySelector('.reassign-name-select').value;

    if (!category || !chosenName) {
        alert('Please choose both a category and a department/institution.');
        return;
    }
    const group = allGroups.find(g => g.staff_number.trim().toLowerCase() === staffKey);
    if (!group) return;

    const newSnapshot = category === 'IBRA' ? `Ibra - ${chosenName}` : chosenName;
    const matchingInstitution = institutionsCached.find(i => i.name === newSnapshot);
    const regIds = group.registrations.map(r => r.id);
    const count = regIds.length;

    if (!(await confirmCard(`Change ALL ${count} of ${group.staff_name}'s department${count === 1 ? '' : 's'} to "${newSnapshot}"?`))) return;

    // Updates EVERY registration for this staff number at once — a
    // single choice now applies across all of a person's activities,
    // whether they had one department or several.
    const { error } = await client.from('registrations').update({
        institution_name_snapshot: newSnapshot,
        institution_id: matchingInstitution ? matchingInstitution.id : null
    }).in('id', regIds);

    if (error) {
        alert('Could not save: ' + error.message);
        return;
    }

    // Reflect the change immediately without a full reload.
    group.registrations.forEach(r => { r.institution_name_snapshot = newSnapshot; });
    applyFilter();
}

// Edits the Participant Name and/or Staff Number for every registration
// under this staff key at once — same "one identity, several activities"
// model as saveReassignment above. Uses formCard (from notify.js) rather
// than two separate window.prompt() calls, so both fields are edited and
// saved together.
async function editParticipantInfo(staffKey) {
    const group = allGroups.find(g => g.staff_number.trim().toLowerCase() === staffKey);
    if (!group) return;

    const result = await formCard('Edit Participant Info', [
        { name: 'staff_name', label: 'Participant Name', value: group.staff_name || '' },
        { name: 'staff_number', label: 'Staff Number', value: group.staff_number || '' }
    ], { okLabel: 'Save' });

    if (!result) return;

    const newName = (result.staff_name || '').trim();
    const newNumber = (result.staff_number || '').trim();

    if (!newName || !newNumber) {
        alert('Both Participant Name and Staff Number are required.');
        return;
    }
    if (newName.trim().split(/\s+/).filter(Boolean).length < 2) {
        alert('Please enter a first and last name — a single name is not enough.');
        return;
    }

    // Changing the staff number onto one that already belongs to a
    // different participant would effectively merge the two identities
    // going forward (they'd group under the same row on next reload) —
    // worth a distinct warning rather than silently allowing it.
    const newKey = newNumber.toLowerCase();
    if (newKey !== staffKey) {
        const conflict = allGroups.find(g => g !== group && g.staff_number.trim().toLowerCase() === newKey);
        if (conflict) {
            const proceed = await confirmCard(`Staff number "${newNumber}" already belongs to ${conflict.staff_name}. Continuing will merge this participant's activities under that same staff number. Continue?`);
            if (!proceed) return;
        }
    }

    const regIds = group.registrations.map(r => r.id);
    if (!(await confirmCard(`Update Participant Name and Staff Number across all ${regIds.length} of this participant's registration${regIds.length === 1 ? '' : 's'}?`))) return;

    // The database's real unique constraint (one registration per staff
    // number per activity) still applies here — if the new number
    // collides with a different participant's registration on the same
    // course, this update is rejected and the error surfaces below rather
    // than silently overwriting anything.
    const { error } = await client.from('registrations').update({
        staff_name: newName,
        staff_number: newNumber
    }).in('id', regIds);

    if (error) {
        alert('Could not save: ' + error.message);
        return;
    }

    group.staff_name = newName;
    group.staff_number = newNumber;
    group.registrations.forEach(r => { r.staff_name = newName; r.staff_number = newNumber; });
    applyFilter();
}

function applyFilter() {
    const q = document.getElementById('staffAllocSearch').value.trim().toLowerCase();
    const instFilter = document.getElementById('staffAllocInstitutionFilter').value;
    const deptFilter = document.getElementById('staffAllocDepartmentFilter').value.toLowerCase();

    const filtered = allGroups.filter(g => {
        const parts = g.registrations.map(r => splitInstitutionSnapshot(r.institution_name_snapshot));

        if (instFilter && !parts.some(p => p.category === instFilter)) return false;
        if (deptFilter && !parts.some(p => p.department.toLowerCase() === deptFilter)) return false;

        if (!q) return true;
        return (g.staff_name || '').toLowerCase().includes(q) ||
            (g.staff_number || '').toLowerCase().includes(q) ||
            parts.some(p => p.institution.toLowerCase().includes(q) || p.department.toLowerCase().includes(q));
    });

    renderTable(filtered);
}

document.getElementById('staffAllocSearch').addEventListener('input', () => {
    // Reset to page 1 only when a filter itself changes (changing which
    // rows match at all) — NOT every time applyFilter() is re-run after a
    // save, which would otherwise bump an admin back to page 1 even if
    // they were reviewing page 3+ when they made the change.
    currentPage = 1;
    applyFilter();
});
document.getElementById('staffAllocInstitutionFilter').addEventListener('change', () => {
    currentPage = 1;
    populateDepartmentFilterOptions();
    applyFilter();
});
document.getElementById('staffAllocDepartmentFilter').addEventListener('change', () => {
    currentPage = 1;
    applyFilter();
});

load();
