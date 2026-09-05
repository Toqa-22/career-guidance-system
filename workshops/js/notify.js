(function () {
    function ensureContainer() {
        let c = document.getElementById('toastContainer');
        if (!c) {
            c = document.createElement('div');
            c.id = 'toastContainer';
            document.body.appendChild(c);
        }
        return c;
    }

    // Best-guess styling based on the message text, so every existing
    // alert(...) call in the app automatically gets the right look with
    // no other code changes needed.
    function classify(message) {
        const m = String(message).toLowerCase();
        if (/(error|fail|denied|incorrect|wrong|rejection)/.test(m)) {
            return { type: 'error', icon: '⚠️' };
        }
        if (/(success|successfully|verified and|logged and)/.test(m)) {
            return { type: 'success', icon: '✅' };
        }
        if (/(please|required|sure you want|no records)/.test(m)) {
            return { type: 'warning', icon: '✋' };
        }
        return { type: 'info', icon: 'ℹ️' };
    }

    function showNotification(message, options) {
        options = options || {};
        const container = ensureContainer();
        const guess = classify(message);
        const type = options.type || guess.type;
        const icon = options.icon || guess.icon;
        const duration = options.duration || 4500;

        const card = document.createElement('div');
        card.className = 'toast-card toast-' + type;
        card.innerHTML =
            '<div class="toast-icon">' + icon + '</div>' +
            '<div class="toast-message"></div>' +
            '<button class="toast-close" type="button" aria-label="Dismiss">×</button>' +
            '<div class="toast-progress"></div>';

        card.querySelector('.toast-message').textContent = message;
        card.querySelector('.toast-progress').style.animationDuration = duration + 'ms';

        let timer;
        function remove() {
            clearTimeout(timer);
            card.classList.add('toast-leaving');
            setTimeout(() => card.remove(), 250);
        }
        card.querySelector('.toast-close').addEventListener('click', remove);

        // Pause the countdown while the user is reading it
        card.addEventListener('mouseenter', () => {
            clearTimeout(timer);
            card.querySelector('.toast-progress').style.animationPlayState = 'paused';
        });
        card.addEventListener('mouseleave', () => {
            card.querySelector('.toast-progress').style.animationPlayState = 'running';
            timer = setTimeout(remove, duration);
        });

        container.appendChild(card);
        timer = setTimeout(remove, duration);
    }

    // Replace the native, top-of-page browser alert() with the card notification
    // everywhere in the app — no other files need to change.
    window.alert = function (message) {
        showNotification(message);
    };

    // A styled, centered confirm card — used in place of window.confirm(),
    // which shows a native browser dialog prefixed with the page's own URL
    // ("127.0.0.1:3000 says..."). Returns a Promise<boolean> since a custom
    // modal can't block synchronously the way the native confirm() does —
    // call sites need `await confirmCard(...)` inside an async function.
    // A small confirm card — same size, position, and animation as the
    // toast notifications (not a full-page dark-overlay modal), used in
    // place of window.confirm() which shows a native "page says" dialog.
    // Returns a Promise<boolean> since it can't block synchronously the
    // way native confirm() does — call sites need `await confirmCard(...)`
    // inside an async function. It stays open until the user picks Yes or
    // Cancel (a decision like this shouldn't auto-dismiss on a timer).
    function confirmCard(message, options) {
        options = options || {};
        return new Promise((resolve) => {
            const container = ensureContainer();
            const card = document.createElement('div');
            card.className = 'toast-card confirm-toast-card';
            card.innerHTML =
                '<div class="toast-icon">❔</div>' +
                '<div class="confirm-toast-body">' +
                    '<div class="toast-message"></div>' +
                    '<div class="confirm-actions">' +
                        '<button type="button" class="confirm-btn confirm-cancel"></button>' +
                        '<button type="button" class="confirm-btn confirm-ok"></button>' +
                    '</div>' +
                '</div>';

            card.querySelector('.toast-message').textContent = message;
            card.querySelector('.confirm-cancel').textContent = options.cancelLabel || 'Cancel';
            card.querySelector('.confirm-ok').textContent = options.okLabel || 'Yes';

            function close(result) {
                card.classList.add('toast-leaving');
                setTimeout(() => card.remove(), 250);
                document.removeEventListener('keydown', onKey);
                resolve(result);
            }
            function onKey(e) { if (e.key === 'Escape') close(false); }

            card.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
            card.querySelector('.confirm-ok').addEventListener('click', () => close(true));
            document.addEventListener('keydown', onKey);

            container.appendChild(card);
            card.querySelector('.confirm-ok').focus();
        });
    }

    // A small card with one or more input fields — replaces window.prompt(),
    // which shows the same native "page says" dialog as confirm(). Same
    // toast container/size/animation as everything else here. `fields` is
    // an array of { name, label, value, type, placeholder }. Resolves with
    // an object keyed by field name, or null if cancelled.
    // A centered modal card — unlike the toast notifications and
    // confirmCard (which stay small, in the corner, non-blocking), this one
    // is deliberately front-and-center: filling in a reason is a real pause
    // in the task, not a passing notification.
    function formCard(title, fields, options) {
        options = options || {};
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'form-modal-overlay';

            const fieldsHtml = fields.map((f, i) => `
                <label class="form-toast-label">${f.label}</label>
                <input type="${f.type || 'text'}" class="form-toast-input" data-field="${f.name}"
                       value="${(f.value || '').toString().replace(/"/g, '&quot;')}"
                       placeholder="${f.placeholder || ''}" ${i === 0 ? 'autofocus' : ''}>
            `).join('');

            overlay.innerHTML =
                '<div class="form-modal-card">' +
                    '<div class="form-toast-title"></div>' +
                    fieldsHtml +
                    '<div class="confirm-actions">' +
                        '<button type="button" class="confirm-btn confirm-cancel"></button>' +
                        '<button type="button" class="confirm-btn confirm-ok"></button>' +
                    '</div>' +
                '</div>';

            overlay.querySelector('.form-toast-title').textContent = title;
            overlay.querySelector('.confirm-cancel').textContent = options.cancelLabel || 'Cancel';
            overlay.querySelector('.confirm-ok').textContent = options.okLabel || 'Save';

            function close(result) {
                overlay.classList.add('form-modal-leaving');
                setTimeout(() => overlay.remove(), 180);
                document.removeEventListener('keydown', onKey);
                resolve(result);
            }
            function collect() {
                const result = {};
                overlay.querySelectorAll('.form-toast-input').forEach(input => {
                    result[input.dataset.field] = input.value.trim();
                });
                return result;
            }
            function onKey(e) {
                if (e.key === 'Escape') close(null);
                if (e.key === 'Enter' && e.target.classList.contains('form-toast-input')) close(collect());
            }

            overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(null));
            overlay.querySelector('.confirm-ok').addEventListener('click', () => close(collect()));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
            document.addEventListener('keydown', onKey);

            document.body.appendChild(overlay);
            const firstInput = overlay.querySelector('.form-toast-input');
            if (firstInput) { firstInput.focus(); firstInput.select(); }
        });
    }

    window.showNotification = showNotification;
    window.confirmCard = confirmCard;
    window.formCard = formCard;
})();
