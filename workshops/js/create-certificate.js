import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================================
// Data fields available for placement on the certificate. Base list from the
// spec, plus the extra fields this project's registrations/courses tables
// already track (job level, nationality, organization, etc.) so nothing new
// has to be built just to expose them here.
// ============================================================================
const DATA_FIELDS = [
    { key: 'participant_name', label: 'Participant Name' },
    { key: 'staff_number', label: 'Staff Number' },
    { key: 'course_name', label: 'Activity Name' },
    { key: 'course_description', label: 'Course Description' },
    { key: 'course_date', label: 'Course Date' },
    { key: 'course_start_date', label: 'Course Start Date' },
    { key: 'course_end_date', label: 'Course End Date' },
    { key: 'instructor_name', label: 'Instructor Name' },
    { key: 'certificate_id', label: 'Certificate ID' },
    { key: 'registration_date', label: 'Registration Date' },
    { key: 'organization', label: 'Organization' },
    { key: 'department', label: 'Department (Directorate)' },
    { key: 'job_level', label: 'Job Level' },
    { key: 'nationality', label: 'Nationality' },
    { key: 'designation', label: 'Designation' },
    { key: 'custom_text', label: 'Custom Text' }
];

let coursesCache = [];
let currentCourseId = null;
let previewImageFile = null;
let existingPreviewPath = null;
let previewNaturalWidth = 0;
let previewNaturalHeight = 0;
let rectangles = [];
let selectedRectId = null;
let rectIdCounter = 1;
// Bumped every time a course is selected — lets an in-flight fetch tell
// whether it's still the most recent request before applying its result,
// so switching courses quickly can't let an older, slower response
// overwrite a newer one's data (which is exactly how one course's
// certificate could silently end up saved with a DIFFERENT course's
// template image).
let loadRequestToken = 0;

function resetEditorState() {
    previewImageFile = null;
    existingPreviewPath = null;
    previewNaturalWidth = 0;
    previewNaturalHeight = 0;
    rectangles = [];
    selectedRectId = null;
    document.getElementById('templateFilesStatus').innerHTML = '';
    document.getElementById('certificateNameInput').value = '';
    document.getElementById('rectangleConfigPanel').classList.add('hidden-element');
    document.getElementById('previewImageInput').value = '';
    showPreviewImage(null);
}

async function loadCourses() {
    const { data, error } = await client.from('courses').select('id, name').order('id', { ascending: true });
    const select = document.getElementById('certCourseSelect');
    if (error) {
        select.innerHTML = '<option value="">-- Error loading courses --</option>';
        return;
    }
    coursesCache = data || [];
    select.innerHTML = '<option value="">-- Select Course --</option>' +
        coursesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    const params = new URLSearchParams(window.location.search);
    const preselectId = params.get('course_id');
    if (preselectId) {
        select.value = preselectId;
        await loadCertificateForCourse(Number(preselectId));
    }
}

async function loadCertificateForCourse(courseId) {
    const myToken = ++loadRequestToken;
    currentCourseId = courseId;
    resetEditorState();
    if (!courseId) return;

    const course = coursesCache.find(c => c.id === courseId);

    const { data: cert } = await client.from('certificates').select('*').eq('course_id', courseId).maybeSingle();

    // Something newer superseded this request while it was in flight (the
    // admin picked a different course before this one finished loading) —
    // discard this result entirely rather than let it clobber whatever the
    // newer request already set.
    if (myToken !== loadRequestToken) return;

    if (!cert) {
        // New certificate for this course — default the name so the admin
        // doesn't have to type it, but it's still fully editable.
        if (course) document.getElementById('certificateNameInput').value = `Certificate for ${course.name}`;
        return;
    }

    document.getElementById('certificateNameInput').value = cert.certificate_name || (course ? `Certificate for ${course.name}` : '');
    existingPreviewPath = cert.preview_image_path || null;
    previewNaturalWidth = cert.preview_width || 0;
    previewNaturalHeight = cert.preview_height || 0;

    try {
        rectangles = Array.isArray(cert.rectangles) ? cert.rectangles : JSON.parse(cert.rectangles || '[]');
    } catch (e) {
        rectangles = [];
    }
    rectIdCounter = rectangles.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1;

    if (existingPreviewPath) {
        showPreviewImage(existingPreviewPath, previewNaturalWidth, previewNaturalHeight);
    }
}

// ============================================================================
// Preview image + rectangle rendering
// ============================================================================

function showPreviewImage(src, natW, natH) {
    const img = document.getElementById('certPreviewImg');
    const emptyState = document.getElementById('certEditorEmptyState');
    if (!src) {
        img.classList.add('hidden-element');
        img.src = '';
        emptyState.style.display = 'block';
        clearRectangleElements();
        return;
    }
    img.src = src;
    img.classList.remove('hidden-element');
    emptyState.style.display = 'none';

    const onReady = () => {
        if (natW && natH) {
            previewNaturalWidth = natW;
            previewNaturalHeight = natH;
        } else {
            previewNaturalWidth = img.naturalWidth;
            previewNaturalHeight = img.naturalHeight;
        }
        renderRectangles();
    };
    if (img.complete && img.naturalWidth) {
        onReady();
    } else {
        img.onload = onReady;
    }
}

function getScale() {
    const img = document.getElementById('certPreviewImg');
    if (!previewNaturalWidth || !img.clientWidth) return 1;
    return img.clientWidth / previewNaturalWidth;
}

function clearRectangleElements() {
    document.querySelectorAll('.cert-rect').forEach(el => el.remove());
}

function fieldLabel(key) {
    const f = DATA_FIELDS.find(f => f.key === key);
    return f ? f.label : '(choose data)';
}

function renderRectangles() {
    clearRectangleElements();
    const stage = document.getElementById('certEditorStage');
    const scale = getScale();

    rectangles.forEach(rect => {
        const el = document.createElement('div');
        el.className = 'cert-rect' + (rect.id === selectedRectId ? ' selected' : '');
        el.style.left = (rect.x * scale) + 'px';
        el.style.top = (rect.y * scale) + 'px';
        el.style.width = (rect.width * scale) + 'px';
        el.style.height = (rect.height * scale) + 'px';
        el.dataset.rectId = rect.id;

        const previewValue = rect.data_field === 'custom_text'
            ? (rect.custom_text || 'Custom text')
            : (rect.data_field ? `{{${fieldLabel(rect.data_field)}}}` : '');

        el.innerHTML = `
            <span class="cert-rect-label">${rect.data_field ? fieldLabel(rect.data_field) : 'No data selected'}</span>
            <div class="cert-rect-preview-text" style="
                font-family:${rect.font || 'Arial'};
                font-size:${Math.max(6, (rect.font_size || 24) * scale)}px;
                font-weight:${rect.bold ? 'bold' : 'normal'};
                font-style:${rect.italic ? 'italic' : 'normal'};
                color:${rect.color || '#000000'};
                justify-content:${rect.h_align === 'left' ? 'flex-start' : rect.h_align === 'right' ? 'flex-end' : 'center'};
                align-items:${rect.v_align === 'top' ? 'flex-start' : rect.v_align === 'bottom' ? 'flex-end' : 'center'};
                text-align:${rect.h_align || 'center'};
            ">${previewValue}</div>
            <div class="cert-rect-resize-handle"></div>
        `;

        wireRectangleInteractions(el, rect);
        stage.appendChild(el);
    });
}

function wireRectangleInteractions(el, rect) {
    el.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('cert-rect-resize-handle')) return;
        e.preventDefault();
        selectRectangle(rect.id);
        const scale = getScale();
        const startX = e.clientX, startY = e.clientY;
        const origX = rect.x, origY = rect.y;

        function onMove(ev) {
            const dx = (ev.clientX - startX) / scale;
            const dy = (ev.clientY - startY) / scale;
            rect.x = Math.max(0, Math.round(origX + dx));
            rect.y = Math.max(0, Math.round(origY + dy));
            renderRectangles();
            syncConfigPanelFromRect(rect);
        }
        function onUp() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    });

    const handle = el.querySelector('.cert-rect-resize-handle');
    handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectRectangle(rect.id);
        const scale = getScale();
        const startX = e.clientX, startY = e.clientY;
        const origW = rect.width, origH = rect.height;

        function onMove(ev) {
            const dx = (ev.clientX - startX) / scale;
            const dy = (ev.clientY - startY) / scale;
            rect.width = Math.max(20, Math.round(origW + dx));
            rect.height = Math.max(16, Math.round(origH + dy));
            renderRectangles();
            syncConfigPanelFromRect(rect);
        }
        function onUp() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    });
}

// ============================================================================
// Rectangle config panel
// ============================================================================

function selectRectangle(id) {
    selectedRectId = id;
    renderRectangles();
    const rect = rectangles.find(r => r.id === id);
    if (!rect) {
        document.getElementById('rectangleConfigPanel').classList.add('hidden-element');
        return;
    }
    document.getElementById('rectangleConfigPanel').classList.remove('hidden-element');
    syncConfigPanelFromRect(rect);
}

function syncConfigPanelFromRect(rect) {
    document.getElementById('rectX').value = rect.x;
    document.getElementById('rectY').value = rect.y;
    document.getElementById('rectWidth').value = rect.width;
    document.getElementById('rectHeight').value = rect.height;
    document.getElementById('rectDataField').value = rect.data_field || '';
    document.getElementById('rectCustomText').value = rect.custom_text || '';
    document.getElementById('rectCustomText').classList.toggle('hidden-element', rect.data_field !== 'custom_text');
    document.getElementById('rectFont').value = rect.font || 'Arial';
    document.getElementById('rectFontSize').value = rect.font_size || 24;
    document.getElementById('rectColor').value = rect.color || '#000000';
    document.getElementById('rectHAlign').value = rect.h_align || 'center';
    document.getElementById('rectVAlign').value = rect.v_align || 'middle';
    document.getElementById('rectBold').checked = !!rect.bold;
    document.getElementById('rectItalic').checked = !!rect.italic;
}

function currentSelectedRect() {
    return rectangles.find(r => r.id === selectedRectId);
}

function wireConfigPanelInputs() {
    const bind = (id, prop, parse = v => v) => {
        document.getElementById(id).addEventListener('input', () => {
            const rect = currentSelectedRect();
            if (!rect) return;
            rect[prop] = parse(document.getElementById(id).value);
            renderRectangles();
        });
    };
    bind('rectX', 'x', v => Math.max(0, parseInt(v, 10) || 0));
    bind('rectY', 'y', v => Math.max(0, parseInt(v, 10) || 0));
    bind('rectWidth', 'width', v => Math.max(20, parseInt(v, 10) || 20));
    bind('rectHeight', 'height', v => Math.max(16, parseInt(v, 10) || 16));
    bind('rectFont', 'font');
    bind('rectFontSize', 'font_size', v => Math.max(6, parseInt(v, 10) || 24));
    bind('rectColor', 'color');
    bind('rectHAlign', 'h_align');
    bind('rectVAlign', 'v_align');
    bind('rectCustomText', 'custom_text');

    document.getElementById('rectDataField').addEventListener('change', (e) => {
        const rect = currentSelectedRect();
        if (!rect) return;
        rect.data_field = e.target.value;
        document.getElementById('rectCustomText').classList.toggle('hidden-element', rect.data_field !== 'custom_text');
        renderRectangles();
    });
    document.getElementById('rectBold').addEventListener('change', (e) => {
        const rect = currentSelectedRect();
        if (rect) { rect.bold = e.target.checked; renderRectangles(); }
    });
    document.getElementById('rectItalic').addEventListener('change', (e) => {
        const rect = currentSelectedRect();
        if (rect) { rect.italic = e.target.checked; renderRectangles(); }
    });

    document.getElementById('deleteRectangleBtn').addEventListener('click', async () => {
        if (!selectedRectId) return;
        if (!(await confirmCard('Delete this rectangle?'))) return;
        rectangles = rectangles.filter(r => r.id !== selectedRectId);
        selectedRectId = null;
        document.getElementById('rectangleConfigPanel').classList.add('hidden-element');
        renderRectangles();
    });
}

document.getElementById('rectDataField').innerHTML =
    '<option value="">-- Select Data --</option>' +
    DATA_FIELDS.map(f => `<option value="${f.key}">${f.label}</option>`).join('');

document.getElementById('addRectangleBtn').addEventListener('click', () => {
    if (!previewNaturalWidth) {
        alert('Upload a preview image first.');
        return;
    }
    const newRect = {
        id: rectIdCounter++,
        x: Math.round(previewNaturalWidth * 0.3),
        y: Math.round(previewNaturalHeight * 0.4),
        width: Math.round(previewNaturalWidth * 0.4),
        height: Math.round(previewNaturalHeight * 0.12),
        data_field: '',
        custom_text: '',
        font: 'Arial',
        font_size: 24,
        bold: false,
        italic: false,
        color: '#000000',
        h_align: 'center',
        v_align: 'middle'
    };
    rectangles.push(newRect);
    renderRectangles();
    selectRectangle(newRect.id);
});

// ============================================================================
// File inputs
// ============================================================================

document.getElementById('certCourseSelect').addEventListener('change', (e) => {
    loadCertificateForCourse(e.target.value ? Number(e.target.value) : null);
});

document.getElementById('previewImageInput').addEventListener('change', (e) => {
    previewImageFile = e.target.files[0] || null;
    if (previewImageFile) {
        const localUrl = URL.createObjectURL(previewImageFile);
        showPreviewImage(localUrl);
        document.getElementById('templateFilesStatus').innerHTML = `<div>🖼️ Ready to upload: ${previewImageFile.name}</div>`;
    }
});

window.addEventListener('resize', () => renderRectangles());

// ============================================================================
// Save
// ============================================================================

document.getElementById('saveCertificateBtn').addEventListener('click', async () => {
    if (!currentCourseId) {
        alert('Please select a course.');
        return;
    }
    if (rectangles.some(r => !r.data_field)) {
        alert('Every rectangle needs a "Select Data" value before saving.');
        return;
    }
    if (rectangles.some(r => r.data_field === 'custom_text' && !r.custom_text.trim())) {
        alert('Fill in the custom text for every rectangle set to "Custom Text".');
        return;
    }

    const saveBtn = document.getElementById('saveCertificateBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        let previewPath = existingPreviewPath;
        if (previewImageFile) {
            const ext = previewImageFile.name.split('.').pop();
            const fileName = `course_${currentCourseId}_${Date.now()}.${ext}`;
            const { error: upErr } = await client.storage.from('certificate-previews').upload(fileName, previewImageFile, { upsert: true });
            if (upErr) throw new Error('Certificate image upload failed: ' + upErr.message);
            previewPath = client.storage.from('certificate-previews').getPublicUrl(fileName).data.publicUrl;
        }

        if (!previewPath) {
            alert('Please upload a certificate image.');
            return;
        }

        // Check for an existing row to preserve its public_slug
        const { data: existingCert } = await client.from('certificates').select('id, public_slug').eq('course_id', currentCourseId).maybeSingle();
        const publicSlug = existingCert?.public_slug || Math.random().toString(36).slice(2, 10);

        const course = coursesCache.find(c => c.id === currentCourseId);
        const certificateName = document.getElementById('certificateNameInput').value.trim()
            || (course ? `Certificate for ${course.name}` : 'Certificate');

        const payload = {
            course_id: currentCourseId,
            certificate_name: certificateName,
            preview_image_path: previewPath,
            preview_width: previewNaturalWidth,
            preview_height: previewNaturalHeight,
            rectangles: rectangles,
            public_slug: publicSlug,
            updated_at: new Date().toISOString()
        };

        const { error: saveErr } = await client.from('certificates').upsert(payload, { onConflict: 'course_id' });
        if (saveErr) throw new Error('Save failed: ' + saveErr.message);

        alert('Certificate saved successfully!');
        window.location.href = 'certificates.html';
    } catch (err) {
        alert(err.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Certificate';
    }
});

wireConfigPanelInputs();
loadCourses();
