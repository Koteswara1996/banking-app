const CONFIG = {
    BASE_STORAGE_KEY: 'pureEnergyTasks',
    BASE_LISTS_KEY: 'pureEnergyBankingLists',
    SYNC_URL_KEY: 'pureEnergySyncUrl',
    TOKEN_KEY: 'pureEnergyAuthToken',
    GMAIL_INDEX_KEY: 'pureEnergyGmailIndex',
    LEGACY_MIGRATED_KEY: 'pureEnergyLegacyMigratedTo',
    BASE_LISTS_TS_KEY: 'pureEnergyListsUpdatedAt',
    BASE_HOLIDAYS_KEY: 'pureEnergyHolidaysCustom',
    // Public half of the VAPID key pair for Web Push (see PUSH_SETUP.md).
    // Safe to be public — it's what identifies this app to the push service,
    // not a secret. The private half lives only in the Cloudflare Worker.
    VAPID_PUBLIC_KEY: 'BPhpwyza70t8kNJFT28ZUC7xNi_ycIJEi3ZlEsHfxCf9_EFtEHgBtRaeQbNiO9fwJ54RGiVTS-0zM2jBTHUsTak',
    get STORAGE_KEY() { return `${this.BASE_STORAGE_KEY}_${app.currentUser}`; },
    get LISTS_KEY() { return `${this.BASE_LISTS_KEY}_${app.currentUser}`; },
    get LISTS_TS_KEY() { return `${this.BASE_LISTS_TS_KEY}_${app.currentUser}`; },
    get HOLIDAYS_KEY() { return `${this.BASE_HOLIDAYS_KEY}_${app.currentUser}`; }
};

// Web Push requires the VAPID key as a raw Uint8Array, not the base64url
// string form it's issued in.
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const output = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
    return output;
}

const app = {
    currentUser: null,
    tasks: [], lists: {}, holidays: [], editingHolidayId: null, currentTab: 'Dashboard',
    _awayFromDashboard: false, _fromPopstate: false,
    editingId: null, editingListKey: null, sortCol: 'dateLogged', sortAsc: false,
    engineInterval: null,
    audioCtx: null, alarmInterval: null, alarmSoundTimeout: null, audioUnlocked: false,

    isAlarming: false, alarmingTasks: [], alarmSignature: '',
    lastSyncJSON: "", syncInProgress: false, userClearedAll: false, listsUpdatedAt: 0,
    fetchedEmails: [], storedEmailId: null, _searchTimer: null,

    // Initial Bank Holidays Data (USD & Indian AP/TS) — seed data only.
    // The working list lives in this.holidays, loaded from localStorage by
    // loadHolidays() so additions/deletions/alert toggles persist per device.
    DEFAULT_HOLIDAYS: [
        { date: '2026-01-01', name: 'New Year\'s Day', nextWorkingDay: '2026-01-02', type: 'USD Holiday' },
        { date: '2026-01-14', name: 'Bhogi', nextWorkingDay: '2026-01-16', type: 'Indian Bank Holiday' },
        { date: '2026-01-15', name: 'Makar Sankranti', nextWorkingDay: '2026-01-16', type: 'Indian Bank Holiday' },
        { date: '2026-01-19', name: 'Martin Luther King Jr. Day', nextWorkingDay: '2026-01-20', type: 'USD Holiday' },
        { date: '2026-01-26', name: 'Republic Day', nextWorkingDay: '2026-01-27', type: 'Indian Bank Holiday' },
        { date: '2026-02-16', name: 'Washington\'s Birthday', nextWorkingDay: '2026-02-17', type: 'USD Holiday' },
        { date: '2026-03-19', name: 'Ugadi', nextWorkingDay: '2026-03-20', type: 'Indian Bank Holiday' },
        { date: '2026-05-25', name: 'Memorial Day', nextWorkingDay: '2026-05-26', type: 'USD Holiday' },
        { date: '2026-07-03', name: 'Independence Day (Observed)', nextWorkingDay: '2026-07-06', type: 'USD Holiday' },
        { date: '2026-08-15', name: 'Independence Day (India)', nextWorkingDay: '2026-08-17', type: 'Indian Bank Holiday' },
        { date: '2026-09-07', name: 'Labor Day', nextWorkingDay: '2026-09-08', type: 'USD Holiday' },
        { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti', nextWorkingDay: '2026-10-05', type: 'Indian Bank Holiday' },
        { date: '2026-10-12', name: 'Columbus Day', nextWorkingDay: '2026-10-13', type: 'USD Holiday' },
        { date: '2026-11-11', name: 'Veterans Day', nextWorkingDay: '2026-11-12', type: 'USD Holiday' },
        { date: '2026-11-26', name: 'Thanksgiving Day', nextWorkingDay: '2026-11-27', type: 'USD Holiday' },
        { date: '2026-12-25', name: 'Christmas Day', nextWorkingDay: '2026-12-28', type: 'USD Holiday' }
    ],

    // Shared Icons for Space-Saving Buttons
    SVGS: {
        edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>',
        done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        reopen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>',
        bin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
        restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>',
        mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>',
        copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
        copied: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    },

    /* ---------- SMALL HELPERS ---------- */
    sanitize(str) { const div = document.createElement('div'); div.textContent = (str === undefined || str === null) ? '' : str; return div.innerHTML; },

    escAttr(str) {
        return String(str === undefined || str === null ? '' : str)
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    newId() {
        try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
        return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    },

    findTask(id) { return this.tasks.find(t => String(t.id) === String(id)); },

    debouncedRender() {
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this.renderTable(), 200);
    },

    gmailUrl(id) {
        const idx = localStorage.getItem(CONFIG.GMAIL_INDEX_KEY) || '0';
        return 'https://mail.google.com/mail/u/' + encodeURIComponent(idx) + '/#all/' + encodeURIComponent(id);
    },

    getLocalDateStr(d) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    formatDateStr(dateStr, opts) {
        if (!dateStr) return '-';
        const p = String(dateStr).split('-').map(Number);
        if (p.length < 3 || !p[0] || !p[1] || !p[2]) return this.sanitize(String(dateStr));
        return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short', year: 'numeric' });
    },

    formatTimeStr(timeStr) {
        if (!timeStr) return '';
        const parts = String(timeStr).split(':');
        const h24 = Number(parts[0]);
        if (!isFinite(h24)) return '';
        const mm = String(parts[1] === undefined ? '00' : parts[1]).padStart(2, '0').slice(0, 2);
        const ampm = h24 >= 12 ? 'PM' : 'AM';
        return `${h24 % 12 || 12}:${mm} ${ampm}`;
    },

    getTaskDueDateTime(t) {
        if (!t || !t.dueDate) return null;
        const [year, month, day] = String(t.dueDate).split('-').map(Number);
        if (!year || !month || !day) return null;
        let hours = 23, minutes = 59, seconds = 59;
        if (t.dueTime) {
            const parts = String(t.dueTime).split(':').map(Number);
            hours = parts[0] || 0;
            minutes = parts[1] || 0;
            seconds = 0;
        }
        return new Date(year, month - 1, day, hours, minutes, seconds);
    },

    /* ---------- AUTH & 5 GLASS THEMES ---------- */
    checkAuthOnStart() {
        this.currentUser = localStorage.getItem('currentUser') || 'default';
        localStorage.setItem('currentUser', this.currentUser);
        this.applyTheme();

        document.getElementById('mainAppHeader').style.display = 'flex';
        document.getElementById('tabBar').style.display = 'flex';
        
        this.initApp();
        this.hideSplash();

        if (!(localStorage.getItem(CONFIG.SYNC_URL_KEY) || '').trim()) {
            setTimeout(() => this.showToast('Add your sheet link in Config → Cloud Sync', 'info'), 1400);
        }
    },

    THEME_KEY: 'pureEnergyTheme',

    /* Boot splash: hold it just long enough for the mark to finish drawing,
       then fade out and let the shell animate in behind it. */
    BOOT_MIN_MS: 1350,

    hideSplash() {
        const el = document.getElementById('bootSplash');
        if (!el || el.classList.contains('gone')) return;

        const started = Number(window.__bootAt) || Date.now();
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const wait = reduce ? 0 : Math.max(0, this.BOOT_MIN_MS - (Date.now() - started));

        setTimeout(() => {
            el.classList.add('gone');
            document.body.classList.add('booted');
            setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 700);
        }, wait);
    },

    THEMES: {
        pearl:  '#f2f2f7',
        glass:  '#bfc9f5',
        neuo:   '#e6ebf2',
        clay:   '#e7ecff',
        hero3d: '#10142a'
    },

    applyTheme(mode) {
        // Defaults to the pure light 'pearl' theme. Anything unrecognised —
        // including a theme saved before this build — falls back to it.
        let pick = mode || localStorage.getItem(this.THEME_KEY) || 'pearl';
        if (!Object.prototype.hasOwnProperty.call(this.THEMES, pick)) pick = 'pearl';

        localStorage.setItem(this.THEME_KEY, pick);
        document.documentElement.setAttribute('data-theme', pick);

        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', this.THEMES[pick]);

        document.querySelectorAll('.theme-btn').forEach(b => {
            b.classList.toggle('on', b.dataset.theme === pick);
        });
    },

    cloudRequest(payload) {
        const SCRIPT_URL = (localStorage.getItem(CONFIG.SYNC_URL_KEY) || "").trim();
        if (!SCRIPT_URL) return Promise.reject(new Error("Cloud URL is not configured (Setup)"));
        const body = Object.assign({}, payload, {
            username: payload.username || this.currentUser
        });
        return fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(body)
        }).then(res => res.json());
    },

    /* ---------- BOOT ---------- */
    /* Stop the browser offering "Saved info" / past entries in any field.
       Runs once on start and again for fields added later (alarm cards, modals). */
    noAutofill(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const els = [];
        if (scope.matches && scope.matches('form, input, textarea')) els.push(scope);
        scope.querySelectorAll('form, input, textarea').forEach(el => els.push(el));
        els.forEach(el => {
            const type = (el.getAttribute('type') || '').toLowerCase();
            if (type === 'file' || type === 'checkbox' || type === 'radio' || type === 'hidden') return;
            if (el.getAttribute('autocomplete') !== 'off') el.setAttribute('autocomplete', 'off');
            el.setAttribute('data-lpignore', 'true');
            el.setAttribute('data-1p-ignore', 'true');
            el.setAttribute('data-form-type', 'other');
        });
    },

    watchAutofill() {
        this.noAutofill(document);
        if (!window.MutationObserver) return;
        new MutationObserver((muts) => {
            muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) this.noAutofill(n); }));
        }).observe(document.body, { childList: true, subtree: true });
    },

    initApp() {
        this.watchAutofill();
        this.loadLists();
        this.loadData();
        this.loadHolidays();
        this.purgeOldBin();
        this.initViewMode();
        this.initCardSwipe();
        this.initTabSwipe();
        this.initBackNav();
        this.detachDropdowns();
        this.populateDropdowns();
        this.initColumnResize();
        ['register', 'completed', 'bin', 'holidays'].forEach(t => this.restoreColumnWidths(t));
        this.updateStats();
        this.updateHeader();
        this.renderAlarmSoundOptions();
        this.renderNudgeSettings();
        this.renderSlotSettings();
        this.renderPushStatus();
        this.switchTab('Dashboard');
        this.setupEventListeners();

        if (this.tasks.length === 0) this.pullTasksFromCloud(false);

        this.checkHolidayAlerts();

        this.engineInterval = setInterval(() => { this.processEngine(); }, 5000);
        setInterval(() => { this.updateHeader(); this.renderNudgeSettings(); this.checkHolidayAlerts(); }, 60000);
        setInterval(() => { this.syncCycle(); }, this.SYNC_EVERY_MS);
        setTimeout(() => this.syncCycle(), 2500);

        const unlock = () => this.initAudio();
        document.addEventListener('click', unlock, { passive: true });
        document.addEventListener('keydown', unlock, { passive: true });
        document.addEventListener('touchstart', unlock, { passive: true });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) { this.initAudio(); this.processEngine(); this.syncCycle(); }
        });
        window.addEventListener('online', () => this.syncCycle());

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.multi-select') && !e.target.closest('.ms-options')
                && !e.target.closest('#sortMenuPanel') && !e.target.closest('[id^="sortToggle"]')) {
                this.closeDropdowns();
            }
        });

        document.addEventListener('click', (e) => this.handleDelegatedClick(e));

        const reposition = () => {
            const open = document.querySelector('.multi-select.open');
            if (open) this.positionDropdown(open.id);
            else this.closeDropdowns();
        };
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        this.updateNotifyState();
    },

    handleDelegatedClick(e) {
        const el = e.target.closest('[data-action]');
        if (!el) { this.handleRecordClick(e); return; }
        const action = el.dataset.action;
        const id = el.dataset.id;

        switch (action) {
            case 'edit': this.openTaskModal(id); break;
            case 'done': this.markComplete(id); break;
            case 'reopen': this.reopenTask(id); break;
            case 'bin': this.softDelete(id); break;
            case 'restore': this.restoreTask(id); break;
            case 'hard-delete': this.hardDelete(id); break;
            case 'copy-mail': {
                const t = this.findTask(id);
                if (t) this.copyToClipboard(t.mailChain || '', el);
                break;
            }
            case 'open-mail': {
                const t = this.findTask(id);
                if (t && t.emailId) window.open(this.gmailUrl(t.emailId), '_blank');
                break;
            }
            case 'email-open': window.open(this.gmailUrl(id), '_blank'); break;
            case 'email-ignore': this.ignoreEmail(id); break;
            case 'email-task': this.convertEmailToTask(id); break;
            case 'alarm-done': this.alarmAction('done', id); break;
            case 'alarm-ack': this.alarmAction('ack', id); break;
            case 'alarm-snooze': this.alarmAction('snooze', id); break;
            case 'alarm-reschedule': this.alarmAction('reschedule', id); break;
            case 'dash-filter': this.filterFromDashboard(el.dataset.ftype, el.dataset.fvalue); break;
            case 'dash-holidays': this.filterHolidaysFromDashboard(el.dataset.fvalue); break;
            case 'list-delete': this.deleteListOption(Number(el.dataset.index)); break;
            case 'sort-pick': this.pickSort(el.dataset.col); break;
            case 'holiday-edit': this.openHolidayModal(id); break;
            case 'holiday-delete': this.deleteHoliday(id); break;
            case 'holiday-alert-toggle': this.toggleHolidayAlert(id); break;
        }
    },

    /* ---------- CLOUD SYNC ---------- */
    mergeTasks(remoteTasks) {
        const byId = new Map();
        this.tasks.forEach(t => byId.set(String(t.id), t));
        let added = 0, updated = 0;

        (remoteTasks || []).forEach(r => {
            if (!r || r.id === undefined || r.id === null || r.id === '') return;
            const key = String(r.id);
            const local = byId.get(key);
            if (!local) { byId.set(key, r); added++; return; }
            const localTime = Number(local.updatedAt) || 0;
            const remoteTime = Number(r.updatedAt) || 0;
            if (remoteTime > localTime) { byId.set(key, Object.assign({}, local, r)); updated++; }
        });

        this.tasks = Array.from(byId.values());
        return { added, updated };
    },

    mergeLists(remoteLists) {
        let changed = false;
        Object.keys(remoteLists || {}).forEach(key => {
            if (!Array.isArray(remoteLists[key])) return;
            if (!Array.isArray(this.lists[key])) this.lists[key] = [];
            remoteLists[key].forEach(v => {
                if (v && !this.lists[key].includes(v)) { this.lists[key].push(v); changed = true; }
            });
        });
        if (changed) this.saveLists(false);
    },

    pullTasksFromCloud(manual = false, silent = false) {
        if (!this.currentUser) return Promise.resolve();
        const saver = document.getElementById('saveStatus');
        if (saver && !silent) saver.innerHTML = '<span class="dot" style="background:var(--blue)"></span> pulling...';

        return this.cloudRequest({ action: "fetchTasks" })
            .then(data => {
                if (!data || data.status !== 'success') throw new Error((data && data.message) || "Failed to pull tasks");

                const result = this.mergeTasks(data.tasks);
                this.applyRemoteLists(data.lists, data.listsUpdatedAt);
                this.saveData();
                this.populateDropdowns();
                this.renderTable();

                const moved = result.added + result.updated;
                if (manual) {
                    this.showToast(moved ? `Merged from cloud: ${result.added} new, ${result.updated} updated` : "Already up to date with cloud.", moved ? "success" : "info");
                } else if (moved) {
                    this.showToast(`Updated from another device: ${moved} ${moved === 1 ? 'entry' : 'entries'}`, "info");
                }
                const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                if (saver) saver.innerHTML = `<span class="dot" style="background:var(--green)"></span> synced ${timeStr}`;
            })
            .catch(err => {
                if (saver) saver.innerHTML = '<span class="dot" style="background:var(--red)"></span> pull failed';
                if (manual) this.showToast(err.message || "Cloud pull failed", "error");
            });
    },

    restoreFromCloud() {
        if (!confirm("This REPLACES every entry on this device with the cloud copy.\n\nA CSV backup of your current data will be downloaded first.\n\nContinue?")) return;
        this.exportData('csv', true);

        this.cloudRequest({ action: "fetchTasks" })
            .then(data => {
                if (!data || data.status !== 'success') throw new Error((data && data.message) || "Failed to fetch cloud copy");
                this.tasks = (data.tasks || []).map(t => {
                    if (!t.id) t.id = this.newId();
                    if (!t.updatedAt) t.updatedAt = 0;
                    return t;
                });
                this.applyRemoteLists(data.lists, data.listsUpdatedAt);
                this.userClearedAll = true;
                this.saveData();
                this.renderTable();
                this.showToast(`Restored ${this.tasks.length} entries from cloud`, "success");
            })
            .catch(err => this.showToast(err.message || "Restore failed", "error"));
    },

    applyRemoteLists(remoteLists, remoteTs) {
        if (!remoteLists) return;
        const ts = Number(remoteTs) || 0;
        const mine = Number(this.listsUpdatedAt) || 0;

        if (ts > mine) {
            this.lists = Object.assign({}, this.lists, remoteLists);
            this.listsUpdatedAt = ts;
            localStorage.setItem(CONFIG.LISTS_TS_KEY, String(ts));
            this.saveLists(false);
        } else if (!ts) {
            this.mergeLists(remoteLists);
        }
    },

    syncToGoogleSheets(manual = false) {
        if (!this.currentUser) return Promise.resolve();
        if (this.syncInProgress) return Promise.resolve();
        if ((localStorage.getItem(CONFIG.SYNC_URL_KEY) || "").trim() === "") return Promise.resolve();

        const snapshot = JSON.stringify({ t: this.tasks, l: this.lists, ts: this.listsUpdatedAt });
        if (!manual && snapshot === this.lastSyncJSON) return Promise.resolve();

        const payload = {
            action: "syncTasks",
            lists: this.lists,
            listsUpdatedAt: this.listsUpdatedAt || 0
        };

        if (this.tasks.length > 0 || this.userClearedAll) {
            payload.tasks = this.tasks;
        } else if (manual) {
            this.showToast("No entries on this device — syncing your lists only.", "warning");
        }

        this.syncInProgress = true;
        const mark = document.getElementById('appMark');
        if (mark) mark.classList.add('busy');
        const saver = document.getElementById('saveStatus');
        if (saver) saver.innerHTML = '<span class="dot" style="background:var(--blue)"></span> syncing...';

        return this.cloudRequest(payload)
            .then(data => {
                this.syncInProgress = false;
                if (mark) mark.classList.remove('busy');
                if (!data || data.status !== 'success') throw new Error((data && data.message) ? data.message : "Unknown sync failure");
                this.lastSyncJSON = snapshot;
                if (data.listsSaved === undefined && !this._listsWarned) {
                    this._listsWarned = true;
                    this.showToast('Your Apps Script is out of date — category changes are not saving to the sheet.', 'warning');
                }
                const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                if (saver) saver.innerHTML = `<span class="dot" style="background:var(--green)"></span> synced ${timeStr}`;
                if (manual) this.showToast("Cloud sync successful!", "success");
            })
            .catch(error => {
                this.syncInProgress = false;
                if (mark) mark.classList.remove('busy');
                console.error('Cloud Sync Error:', error);
                if (saver) saver.innerHTML = '<span class="dot" style="background:var(--red)"></span> not synced — saved locally';
                if (manual) this.showToast(error.message || "Sync failed. Your data is safe on this device.", "error");
            });
    },

    SYNC_EVERY_MS: 15000,
    cycleBusy: false,

    syncCycle(manual = false) {
        if (!this.currentUser) return;
        if ((localStorage.getItem(CONFIG.SYNC_URL_KEY) || "").trim() === "") return;
        if (this.cycleBusy) return;

        if (!manual && document.hidden) return;
        if (!manual && document.querySelector('.modal.open')) return;

        this.cycleBusy = true;
        Promise.resolve()
            .then(() => this.pullTasksFromCloud(manual, !manual))
            .catch(() => {})
            .then(() => this.syncToGoogleSheets(manual))
            .catch(() => {})
            .then(() => { this.cycleBusy = false; });
    },

    openSyncSetup() {
        document.getElementById('syncUrlInput').value = localStorage.getItem(CONFIG.SYNC_URL_KEY) || '';
        document.getElementById('gmailIndexInput').value = localStorage.getItem(CONFIG.GMAIL_INDEX_KEY) || '0';
        document.getElementById('profileInput').value = this.currentUser || 'default';
        document.getElementById('syncSetupModal').classList.add('open');
    },

    saveSyncUrlModal() {
        const url = document.getElementById('syncUrlInput').value.trim();
        const idx = document.getElementById('gmailIndexInput').value.trim() || '0';
        if (url && !/\/exec$/.test(url)) {
            this.showToast("The Apps Script URL must end in /exec", "warning");
            return;
        }
        if (url) localStorage.setItem(CONFIG.SYNC_URL_KEY, url);
        localStorage.setItem(CONFIG.GMAIL_INDEX_KEY, idx);

        const profile = (document.getElementById('profileInput').value || '').trim().toLowerCase() || 'default';
        if (profile !== this.currentUser) {
            localStorage.setItem('currentUser', profile);
            this.showToast('Profile changed — reloading', 'info');
            setTimeout(() => window.location.reload(), 700);
            return;
        }
        document.getElementById('syncSetupModal').classList.remove('open');
        this.showToast("Settings saved", "success");
    },

    /* ---------- EMAIL INTEGRATION ---------- */
    openEmailModal() {
        document.getElementById('emailListModal').classList.add('open');
        document.getElementById('emailSearchInput').value = '';
        if (this.fetchedEmails.length > 0) this.renderEmailList();
    },

    fetchEmails() {
        const SCRIPT_URL = (localStorage.getItem(CONFIG.SYNC_URL_KEY) || "").trim();
        if (!SCRIPT_URL) { this.showToast("Cloud URL missing — open Setup.", "warning"); return; }

        const btn = document.getElementById('btnFetchMails');
        btn.innerText = "Fetching...";
        document.getElementById('emailListContainer').innerHTML =
            '<div class="empty-state"><strong>Loading...</strong><span>Fetching your unread mail.</span></div>';

        const q = "?action=fetchEmails&username=" + encodeURIComponent(this.currentUser || '');

        fetch(SCRIPT_URL + q, { method: 'GET' })
            .then(res => res.json())
            .then(data => {
                btn.innerText = "Fetch Unread Mail";
                if (data.status !== 'success') throw new Error(data.message || data.error);
                this.fetchedEmails = data.emails || [];
                document.getElementById('emailSearchInput').value = '';
                this.renderEmailList();
                this.showToast(`Fetched ${this.fetchedEmails.length} unread emails`, "success");
            })
            .catch(err => {
                btn.innerText = "Fetch Unread Mail";
                this.showToast("Failed to fetch emails.", "error");
            });
    },

    renderEmailList() {
        const container = document.getElementById('emailListContainer');
        const query = (document.getElementById('emailSearchInput').value || "").toLowerCase();

        let list = this.fetchedEmails;
        if (query) {
            list = this.fetchedEmails.filter(e =>
                (e.subject || "").toLowerCase().includes(query) ||
                (e.sender || "").toLowerCase().includes(query)
            );
        }

        container.innerHTML = '';
        if (list.length === 0) {
            container.innerHTML = `<div class="empty-state"><strong>No matches</strong><span>${query ? 'Nothing matches your search.' : 'You have no unread mail.'}</span></div>`;
            return;
        }

        list.forEach(email => {
            const idAttr = this.escAttr(email.id);
            const subject = email.subject || '(No subject)';
            const el = document.createElement('div');
            el.className = 'mail-item';
            el.style = 'display: flex; flex-direction: column; gap: 8px; padding: 14px; margin-bottom: 10px; border-radius: 16px; background: var(--glass-card); border: 1px solid var(--glass-border-subtle);';
            el.innerHTML = `
                <div class="mail-subject" style="font-size: 0.92rem; font-weight: 700; color: var(--label);">${this.sanitize(subject)}</div>
                <div class="mail-row" style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                    <div class="mail-from" style="flex: 1; min-width: 0; font-size: 0.78rem; color: var(--label-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${this.escAttr(email.sender)}">${this.sanitize(email.sender)}</div>
                    <div class="mail-actions" style="display: flex; gap: 6px; flex-shrink: 0;">
                        <button type="button" class="btn-row bad" data-action="email-ignore" data-id="${idAttr}">Ignore</button>
                        <button type="button" class="btn-row go" data-action="email-open" data-id="${idAttr}">Open</button>
                        <button type="button" class="btn-row ok" data-action="email-task" data-id="${idAttr}">Add task</button>
                    </div>
                </div>
            `;
            container.appendChild(el);
        });
    },

    ignoreEmail(id) {
        this.fetchedEmails = this.fetchedEmails.filter(e => String(e.id) !== String(id));
        this.renderEmailList();
        this.showToast("Mail marked as read", "info");

        const SCRIPT_URL = (localStorage.getItem(CONFIG.SYNC_URL_KEY) || "").trim();
        if (SCRIPT_URL) {
            fetch(SCRIPT_URL + "?action=markEmailRead&id=" + encodeURIComponent(id) +
                  "&username=" + encodeURIComponent(this.currentUser || ''), { method: 'GET' })
                .catch(err => console.error("Failed to mark read:", err));
        }
    },

    convertEmailToTask(id) {
        const email = this.fetchedEmails.find(e => String(e.id) === String(id));
        if (!email) return;

        document.getElementById('emailListModal').classList.remove('open');
        this.openTaskModal(null, email.id);

        document.getElementById('taskDescription').value = email.subject || '(No Subject)';
        document.getElementById('taskMailChain').value = email.subject || '';

        const notes = document.getElementById('taskNotes');
        const header = "From: " + (email.sender || '') + "\n\n";

        if (email.body) {
            notes.value = header + (email.body.length > 500 ? email.body.substring(0, 500) + "..." : email.body);
            return;
        }

        notes.value = header + "Loading the mail…";
        const SCRIPT_URL = (localStorage.getItem(CONFIG.SYNC_URL_KEY) || "").trim();
        fetch(SCRIPT_URL + "?action=emailBody&id=" + encodeURIComponent(email.id) +
              "&username=" + encodeURIComponent(this.currentUser || ''), { method: 'GET' })
            .then(res => res.json())
            .then(data => {
                const text = (data && data.status === 'success') ? (data.body || '') : '';
                email.body = text;
                if (notes.value.indexOf("Loading the mail…") !== -1) {
                    notes.value = header + (text.length > 500 ? text.substring(0, 500) + "..." : text);
                }
            })
            .catch(() => {
                if (notes.value.indexOf("Loading the mail…") !== -1) notes.value = header;
            });
    },

    openStoredEmail() {
        if (this.storedEmailId) window.open(this.gmailUrl(this.storedEmailId), '_blank');
    },

    /* ---------- AUDIO / NOTIFICATIONS ---------- */
    initAudio() {
        try {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioCtx && this.audioCtx.state !== 'running') this.audioCtx.resume();
            this.audioUnlocked = true;
        } catch (e) {}
    },

    sendDesktopNotification(title, body, requireInteraction = false, tag = 'btw-overdue') {
        if (!("Notification" in window)) return;

        const opts = {
            body: body,
            icon: './icon-192.png',
            badge: './icon-192.png',
            tag: tag,
            renotify: true,
            requireInteraction: requireInteraction,
            vibrate: [200, 100, 200, 100, 200]
        };

        const direct = () => { try { new Notification(title, opts); } catch (e) { console.warn('Notification failed', e); } };

        const show = () => {
            if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration) {
                navigator.serviceWorker.getRegistration()
                    .then(reg => { if (reg && reg.showNotification) reg.showNotification(title, opts); else direct(); })
                    .catch(direct);
            } else {
                direct();
            }
        };

        if (Notification.permission === "granted") show();
        else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(p => { if (p === "granted") show(); });
        }
    },

    enableNotifications() {
        if (!("Notification" in window)) { this.showToast('This browser cannot show notifications', 'warning'); return; }

        if (Notification.permission === 'granted') {
            this.sendDesktopNotification('Alerts are on', 'Overdue tasks will appear here.');
            this.showToast('Alerts already enabled — sent a test', 'success');
            return;
        }
        if (Notification.permission === 'denied') {
            this.showToast('Blocked. Chrome menu, Settings, Site settings, Notifications — allow this site.', 'error');
            return;
        }
        Notification.requestPermission().then(p => {
            this.updateNotifyState();
            if (p === 'granted') {
                this.sendDesktopNotification('Alerts are on', 'Overdue tasks will appear here.');
                this.showToast('Alerts enabled', 'success');
            } else {
                this.showToast('Alerts not enabled', 'warning');
            }
        });
    },

    updateNotifyState() {
        const hint = document.getElementById('notifyHint');
        const btn = document.getElementById('notifyBtn');
        if (!hint) return;
        const perm = ("Notification" in window) ? Notification.permission : 'unsupported';
        if (perm === 'granted') {
            hint.innerHTML = 'Alerts are <b>on</b>. You will get a notification while the app is open or in the background.';
            if (btn) btn.style.opacity = '0.6';
        } else if (perm === 'denied') {
            hint.innerHTML = 'Alerts are <b>blocked</b>. Enable them in your browser settings.';
        } else {
            hint.innerHTML = 'Turn on alerts to get a notification when a deadline passes.';
        }
    },

    /* ---------- WEB PUSH — alerts even with the app fully closed ----------
       This is a genuinely different mechanism from the notifications above:
       those fire from JS running on the page, so they stop the moment the
       app is closed. This subscribes the device with the push service
       (Chrome/FCM etc.), and a Cloudflare Worker (see PUSH_SETUP.md) checks
       your tasks on a schedule and pushes to that subscription directly —
       the OS wakes this service worker for just that message, app or no
       app. Requires Cloud Sync to already be set up, since the Worker reads
       your tasks and stores subscriptions through the same Apps Script. */
    async getPushSubscription() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
        try {
            const reg = (pwa && pwa.reg) || await navigator.serviceWorker.ready;
            return await reg.pushManager.getSubscription();
        } catch (e) { return null; }
    },

    async togglePush() {
        const sub = await this.getPushSubscription();
        if (sub) this.unsubscribeFromPush();
        else this.subscribeToPush();
    },

    async subscribeToPush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            this.showToast('Push notifications are not supported in this browser', 'warning');
            return;
        }
        const scriptUrl = (localStorage.getItem(CONFIG.SYNC_URL_KEY) || '').trim();
        if (!scriptUrl) {
            this.showToast('Set up Cloud Sync first (Connection, above) — push alerts go through the same Apps Script.', 'warning');
            return;
        }
        if (Notification.permission === 'denied') {
            this.showToast('Notifications are blocked for this site — allow them in your browser/site settings first.', 'error');
            return;
        }
        if (Notification.permission !== 'granted') {
            const perm = await Notification.requestPermission();
            this.updateNotifyState();
            if (perm !== 'granted') { this.showToast('Push notifications need permission to work.', 'warning'); return; }
        }

        try {
            const reg = (pwa && pwa.reg) || await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY)
                });
            }
            const res = await this.cloudRequest({ action: 'saveSubscription', subscription: sub.toJSON() });
            if (!res || res.status !== 'success') throw new Error((res && res.message) || 'The Apps Script rejected the subscription — has it been updated with the push code from PUSH_SETUP.md?');
            this.renderPushStatus();
            this.showToast("Push is on — you'll get task alerts even with the app closed.", 'success');
        } catch (e) {
            console.warn('Push subscribe failed', e);
            this.showToast('Could not enable push: ' + (e.message || e), 'error');
            this.renderPushStatus();
        }
    },

    async unsubscribeFromPush() {
        try {
            const sub = await this.getPushSubscription();
            if (sub) {
                await this.cloudRequest({ action: 'removeSubscription', endpoint: sub.endpoint }).catch(() => {});
                await sub.unsubscribe();
            }
            this.renderPushStatus();
            this.showToast('Push notifications turned off on this device.', 'info');
        } catch (e) {
            this.showToast('Could not turn off push notifications.', 'error');
        }
    },

    async renderPushStatus() {
        const btn = document.getElementById('pushToggle');
        const label = document.getElementById('pushToggleLabel');
        const hint = document.getElementById('pushHint');
        if (!btn || !label) return;

        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            label.textContent = 'Not supported here';
            btn.classList.add('is-off');
            if (hint) hint.textContent = 'This browser doesn\'t support push notifications.';
            return;
        }

        const sub = await this.getPushSubscription();
        btn.classList.toggle('is-off', !sub);
        label.textContent = sub ? 'Push alerts on' : 'Push alerts off';
        if (hint) {
            hint.textContent = sub
                ? 'Subscribed on this device. Make sure the Cloudflare Worker (PUSH_SETUP.md) is deployed so alerts actually get sent.'
                : (localStorage.getItem(CONFIG.SYNC_URL_KEY) ? 'Tap to turn on.' : 'Set up Cloud Sync above first, then tap to turn on.');
        }
    },

    testAlarmSound() {
        this.initAudio();
        this.playBeepPair();
        setTimeout(() => this.playBeepPair(), 800);
        this.sendDesktopNotification("🔔 System Alert Test", "Notifications are working!", false);
        this.showToast("🔔 Testing alarm sound!", "info");
    },

    playBeepPair() {
        this.initAudio();
        if (!this.audioCtx) return;

        if (this.audioCtx.state !== 'running') {
            this.audioCtx.resume().then(() => this.emitBeep()).catch(() => {});
            return;
        }
        this.emitBeep();
    },

    /* Each sound is its own small WebAudio recipe — no audio files to
       ship, so this keeps working offline like the rest of the app. */
    ALARM_SOUNDS: {
        classic: { label: 'Classic Beep', build(ctx, t) {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(880, t);
            osc.frequency.setValueAtTime(1320, t + 0.15);
            osc.frequency.setValueAtTime(880, t + 0.3);
            gain.gain.setValueAtTime(0.55, t); gain.gain.setValueAtTime(0, t + 0.12);
            gain.gain.setValueAtTime(0.55, t + 0.15); gain.gain.setValueAtTime(0, t + 0.27);
            gain.gain.setValueAtTime(0.55, t + 0.3);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(t); osc.stop(t + 0.62);
        } },
        chime: { label: 'Gentle Chime', build(ctx, t) {
            [660, 990].forEach((f, i) => {
                const s = t + i * 0.16;
                const osc = ctx.createOscillator(); const gain = ctx.createGain();
                osc.type = 'sine'; osc.frequency.setValueAtTime(f, s);
                gain.gain.setValueAtTime(0.0001, s);
                gain.gain.linearRampToValueAtTime(0.42, s + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, s + 0.55);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(s); osc.stop(s + 0.6);
            });
        } },
        pulse: { label: 'Alert Pulse', build(ctx, t) {
            for (let i = 0; i < 4; i++) {
                const s = t + i * 0.16;
                const osc = ctx.createOscillator(); const gain = ctx.createGain();
                osc.type = 'square'; osc.frequency.setValueAtTime(1046, s);
                gain.gain.setValueAtTime(0.35, s);
                gain.gain.exponentialRampToValueAtTime(0.001, s + 0.09);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(s); osc.stop(s + 0.1);
            }
        } },
        bell: { label: 'Soft Bell', build(ctx, t) {
            [[523.25, 0.5], [784, 0.16]].forEach(([f, vol]) => {
                const osc = ctx.createOscillator(); const gain = ctx.createGain();
                osc.type = 'sine'; osc.frequency.setValueAtTime(f, t);
                gain.gain.setValueAtTime(vol, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(t); osc.stop(t + 1.15);
            });
        } },
        siren: { label: 'Rising Siren', build(ctx, t) {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, t);
            osc.frequency.linearRampToValueAtTime(880, t + 0.35);
            osc.frequency.linearRampToValueAtTime(440, t + 0.7);
            gain.gain.setValueAtTime(0.38, t);
            gain.gain.setValueAtTime(0.38, t + 0.65);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(t); osc.stop(t + 0.8);
        } }
    },
    ALARM_SOUND_KEY: 'pureEnergyAlarmSound',

    getAlarmSound() {
        const saved = localStorage.getItem(this.ALARM_SOUND_KEY);
        return (saved && this.ALARM_SOUNDS[saved]) ? saved : 'classic';
    },

    setAlarmSound(name) {
        if (!this.ALARM_SOUNDS[name]) return;
        localStorage.setItem(this.ALARM_SOUND_KEY, name);
        this.renderAlarmSoundOptions();
        this.previewAlarmSound(name);
    },

    previewAlarmSound(name) {
        this.initAudio();
        if (!this.audioCtx) return;
        const fire = () => {
            const def = this.ALARM_SOUNDS[name] || this.ALARM_SOUNDS.classic;
            try { def.build(this.audioCtx, this.audioCtx.currentTime); } catch (e) {}
        };
        if (this.audioCtx.state !== 'running') this.audioCtx.resume().then(fire).catch(() => {});
        else fire();
    },

    renderAlarmSoundOptions() {
        const box = document.getElementById('alarmSoundList');
        if (!box) return;
        const current = this.getAlarmSound();
        box.innerHTML = '';

        Object.keys(this.ALARM_SOUNDS).forEach(key => {
            const def = this.ALARM_SOUNDS[key];
            const row = document.createElement('div');
            row.className = 'sound-row' + (key === current ? ' is-on' : '');
            row.addEventListener('click', () => this.setAlarmSound(key));

            const dot = document.createElement('span');
            dot.className = 'sound-dot';

            const name = document.createElement('span');
            name.className = 'sound-name';
            name.textContent = def.label;

            const play = document.createElement('button');
            play.type = 'button';
            play.className = 'sound-play';
            play.setAttribute('aria-label', 'Preview ' + def.label);
            play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
            play.addEventListener('click', (e) => { e.stopPropagation(); this.previewAlarmSound(key); });

            row.appendChild(dot);
            row.appendChild(name);
            row.appendChild(play);
            box.appendChild(row);
        });
    },

    emitBeep() {
        if (!this.audioCtx) return;
        try {
            const t = this.audioCtx.currentTime;
            const def = this.ALARM_SOUNDS[this.getAlarmSound()] || this.ALARM_SOUNDS.classic;
            def.build(this.audioCtx, t);
            if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
        } catch (e) {}
    },

    /* ---------- ALARM ENGINE ---------- */
    processEngine() {
        const now = new Date();
        const localTodayStr = this.getLocalDateStr(now);
        const activeOverdue = [];

        this.tasks.forEach(t => {
            if (t.deleted || t.status === 'Completed' || !t.dueDate) return;

            const dueDateTime = this.getTaskDueDateTime(t);
            if (!dueDateTime) return;

            let dueHours = 23, dueMins = 59;
            if (t.dueTime) {
                const parts = String(t.dueTime).split(':').map(Number);
                dueHours = parts[0] || 0;
                dueMins = parts[1] || 0;
            }

            const todayAtDueTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dueHours, dueMins, 0);
            const snoozeUntil = Number(t.snoozeUntil) || 0;

            if (now >= dueDateTime && now >= todayAtDueTime &&
                t.lastAckDate !== localTodayStr && now.getTime() >= snoozeUntil) {
                activeOverdue.push(t);
            }
        });

        const signature = activeOverdue.map(t => String(t.id)).sort().join('|');

        if (activeOverdue.length > 0) {
            if (!this.isAlarming || signature !== this.alarmSignature) {
                this.alarmSignature = signature;
                this.triggerPersistentAlarm(activeOverdue);
            }
        } else if (this.isAlarming) {
            this.stopPersistentAlarm(false);
        }

        this.checkNudges(now);
    },

    triggerPersistentAlarm(tasks) {
        this.initAudio();
        this.isAlarming = true;
        this.alarmingTasks = tasks;

        let alarmModal = document.getElementById('alarmModal');
        if (!alarmModal) {
            alarmModal = document.createElement('div');
            alarmModal.className = 'modal';
            alarmModal.id = 'alarmModal';
            alarmModal.style.zIndex = '10500';
            alarmModal.innerHTML = `
                <div class="modal-content" style="border-color: rgba(255,59,48,0.4);">
                    <div class="modal-header" style="border-bottom-color: rgba(255,59,48,0.25);">
                        <h2 style="color:var(--red-ink);">🚨 Past Due Alert</h2>
                        <button class="modal-close" title="Silence all" onclick="app.stopPersistentAlarm(true)">✕</button>
                    </div>
                    <p style="color:var(--label-2); font-size:0.86rem; margin-bottom:14px;">These tasks missed their deadline and are still open.</p>
                    <div id="alarmTasksContainer" style="max-height:55vh; overflow-y:auto;"></div>
                    <div class="modal-buttons">
                        <button class="btn-modal secondary" onclick="app.stopPersistentAlarm(true)">Silence All For Today</button>
                    </div>
                </div>
            `;
            document.body.appendChild(alarmModal);
        }
        this.renderAlarmTasks();
        alarmModal.classList.add('open');

        const taskNames = tasks.map(t => `"${t.description}"`).join(', ');
        this.sendDesktopNotification("🚨 OVERDUE DEADLINE ALERT", `Missed deadline: ${taskNames}`, true);

        if (!this.alarmInterval) {
            this.playBeepPair();
            this.alarmInterval = setInterval(() => { this.playBeepPair(); }, 1800);
            if (this.alarmSoundTimeout) clearTimeout(this.alarmSoundTimeout);
            this.alarmSoundTimeout = setTimeout(() => {
                if (this.alarmInterval) { clearInterval(this.alarmInterval); this.alarmInterval = null; }
            }, 120000);
        }
    },

    renderAlarmTasks() {
        const container = document.getElementById('alarmTasksContainer');
        if (!container) return;
        container.innerHTML = '';

        this.alarmingTasks.forEach(task => {
            const idAttr = this.escAttr(task.id);
            const priority = (task.priority || '').toString();
            const isRecurring = task.recurrence && task.recurrence !== 'None';

            const chips = [];
            if (priority) chips.push(`<span class="chip pri-${this.escAttr(priority.replace(/\s+/g, '-'))}" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; font-weight:600; border-radius:20px; color:var(--red-ink); background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.2);">${this.sanitize(priority)}</span>`);
            if (task.category) chips.push(`<span class="chip cat" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; font-weight:600; border-radius:20px; color:var(--blue-ink); background:rgba(37, 99, 235, 0.1); border:1px solid rgba(37, 99, 235, 0.2);">${this.sanitize(task.category)}</span>`);
            if (task.pendingWith) chips.push(`<span class="chip person" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; font-weight:600; border-radius:20px; color:var(--amber-ink); background:rgba(245, 158, 11, 0.1); border:1px solid rgba(245, 158, 11, 0.25);">Pending with: ${this.sanitize(task.pendingWith)}</span>`);
            chips.push(`<span class="chip rec" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; font-size:0.75rem; font-weight:600; border-radius:20px; color:var(--violet-ink); background:rgba(139, 92, 246, 0.1); border:1px solid rgba(139, 92, 246, 0.2);">${isRecurring ? this.sanitize(task.recurrence) : 'One-time'}</span>`);
            
            const el = document.createElement('div');
            el.className = 'alarm-card';
            el.style = 'padding: 14px 16px; margin-bottom: 12px; border-radius: 16px; background: rgba(255, 59, 48, 0.09); border: 1px solid rgba(255, 59, 48, 0.25);';
            el.innerHTML = `
                <div class="alarm-title" style="font-size: 0.96rem; font-weight: 700; color: var(--label);">${this.sanitize(task.description)}</div>
                <div class="alarm-due" style="margin-top: 3px; font-size: 0.78rem; font-weight: 600; color: var(--red-ink); font-family: var(--font-num);">Due ${this.formatDateStr(task.dueDate)} at ${task.dueTime ? this.formatTimeStr(task.dueTime) : '11:59 PM'}</div>
                <div class="alarm-meta" style="display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0;">${chips.join('')}</div>
                <div class="alarm-actions" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                    <button type="button" class="btn-row ok" data-action="alarm-done" data-id="${idAttr}" style="padding: 6px 12px; font-size: 0.78rem; font-weight: 600; color: var(--green-ink); background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 10px; cursor: pointer;">Mark done</button>
                    <button type="button" class="btn-row warn" data-action="alarm-ack" data-id="${idAttr}" style="padding: 6px 12px; font-size: 0.78rem; font-weight: 600; color: var(--amber-ink); background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 10px; cursor: pointer;">Silence today</button>
                    <span class="alarm-field" style="display: flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; background: var(--input-bg); border: 1px solid var(--line);">
                        <input type="number" min="1" id="snoozeMins_${idAttr}" placeholder="Min" style="font-size: 0.84rem; color: var(--label); background: transparent; border: none; outline: none; padding: 4px; width: 50px; text-align: center;">
                        <button type="button" class="btn-row go" data-action="alarm-snooze" data-id="${idAttr}" style="padding: 6px 12px; font-size: 0.78rem; font-weight: 600; color: var(--blue-ink); background: rgba(37, 99, 235, 0.1); border: 1px solid rgba(37, 99, 235, 0.2); border-radius: 10px; cursor: pointer;">Snooze</button>
                    </span>
                    <span class="alarm-field" style="display: flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; background: var(--input-bg); border: 1px solid var(--line);">
                        <input type="date" id="reschedDate_${idAttr}" value="${this.escAttr(task.dueDate)}" style="font-size: 0.84rem; color: var(--label); background: transparent; border: none; outline: none; padding: 4px;">
                        <input type="time" id="reschedTime_${idAttr}" value="${this.escAttr(task.dueTime)}" style="font-size: 0.84rem; color: var(--label); background: transparent; border: none; outline: none; padding: 4px;">
                        <button type="button" class="btn-row go" data-action="alarm-reschedule" data-id="${idAttr}" style="padding: 6px 12px; font-size: 0.78rem; font-weight: 600; color: var(--blue-ink); background: rgba(37, 99, 235, 0.1); border: 1px solid rgba(37, 99, 235, 0.2); border-radius: 10px; cursor: pointer;">Move</button>
                    </span>
                </div>
            `;
            container.appendChild(el);
        });
    },

    alarmAction(action, taskId) {
        const task = this.findTask(taskId);
        if (!task) return;

        if (action === 'done') {
            this.markComplete(taskId);
        } else if (action === 'ack') {
            task.lastAckDate = this.getLocalDateStr(new Date());
            task.updatedAt = Date.now();
            this.saveData(); this.renderTable();
            this.showToast("Task silenced for today.", "info");
        } else if (action === 'snooze') {
            const input = document.getElementById('snoozeMins_' + taskId);
            const mins = parseInt(input ? input.value : '', 10) || 0;
            if (mins <= 0) { this.showToast("Please enter minutes to snooze.", "warning"); return; }
            task.snoozeUntil = Date.now() + (mins * 60000);
            task.updatedAt = Date.now();
            this.saveData();
            this.showToast(`Snoozed for ${mins} minutes.`, "info");
        } else if (action === 'reschedule') {
            const dateEl = document.getElementById('reschedDate_' + taskId);
            const timeEl = document.getElementById('reschedTime_' + taskId);
            const newDate = dateEl ? dateEl.value : '';
            const newTime = timeEl ? timeEl.value : '';
            if (!newDate) { this.showToast("Please select a valid date.", "warning"); return; }
            const taken = this.slotClash(newDate, newTime, task.id);
            if (taken) {
                const free = this.nextFreeTime(newDate, newTime, task.id);
                this.showToast(
                    '"' + taken.description + '" already holds ' + this.formatTimeStr(taken.dueTime) + '.',
                    'warning',
                    free ? { label: 'Use ' + this.formatTimeStr(free), onClick: () => { if (timeEl) timeEl.value = free; } } : null
                );
                return;
            }
            task.dueDate = newDate;
            task.dueTime = newTime || '';
            task.lastAckDate = null;
            task.snoozeUntil = null;
            task.updatedAt = Date.now();
            this.saveData(); this.renderTable();
            this.showToast("Task rescheduled successfully.", "success");
        }

        this.alarmingTasks = this.alarmingTasks.filter(t => String(t.id) !== String(taskId));
        this.alarmSignature = this.alarmingTasks.map(t => String(t.id)).sort().join('|');

        if (this.alarmingTasks.length === 0) this.stopPersistentAlarm(false);
        else this.renderAlarmTasks();
    },

    stopPersistentAlarm(acknowledgeAllRemaining = false) {
        const alarmModal = document.getElementById('alarmModal');
        if (alarmModal) alarmModal.classList.remove('open');

        if (this.alarmInterval) { clearInterval(this.alarmInterval); this.alarmInterval = null; }
        if (this.alarmSoundTimeout) { clearTimeout(this.alarmSoundTimeout); this.alarmSoundTimeout = null; }
        this.isAlarming = false;

        if (acknowledgeAllRemaining && this.alarmingTasks.length > 0) {
            const localTodayStr = this.getLocalDateStr(new Date());
            this.alarmingTasks.forEach(t => {
                const task = this.findTask(t.id);
                if (task) { task.lastAckDate = localTodayStr; task.updatedAt = Date.now(); }
            });
            this.saveData();
            this.renderTable();
            this.showToast("All overdue alerts silenced for today.", "info");
        }

        this.alarmingTasks = [];
        this.alarmSignature = '';
    },

    /* ---------- HEALTH NUDGES (walk / water) ----------
       Standing reminders to leave the chair and to drink water. Same look and
       sound as the past-due alert, but on a clock instead of a deadline: one
       alert per slot between a start and end time, all set in Config. */
    NUDGES: {
        walk: {
            icon: '🚶', title: 'Time To Walk',
            line: 'Stand up, stretch and take a few minutes away from the desk.',
            slotWord: 'walk break',
            notifyTitle: '🚶 Time to walk', notifyBody: 'Stand up and move for a few minutes.',
            doneLabel: 'I walked', tag: 'btw-walk', zIndex: 10400,
            defaults: { on: true, start: '11:00', end: '19:30', every: 90, snooze: 10 }
        },
        water: {
            icon: '💧', title: 'Time To Drink Water',
            line: 'Take a drink and top up your bottle before the next task.',
            slotWord: 'water break',
            notifyTitle: '💧 Time to drink water', notifyBody: 'Have a glass of water.',
            doneLabel: 'I drank', tag: 'btw-water', zIndex: 10300,
            defaults: { on: true, start: '10:00', end: '19:30', every: 60, snooze: 10 }
        }
    },

    nudgeKeys(kind) {
        const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
        return {
            cfg: 'pureEnergy' + cap + 'Cfg',
            last: 'pureEnergy' + cap + 'Last',
            skip: 'pureEnergy' + cap + 'Skip'
        };
    },

    nudgeState: {},

    nudgeCfg(kind) {
        const def = this.NUDGES[kind].defaults;
        let saved = {};
        try {
            const raw = JSON.parse(localStorage.getItem(this.nudgeKeys(kind).cfg) || '{}');
            if (raw && typeof raw === 'object') saved = raw;
        } catch (e) {}
        const cfg = Object.assign({}, def, saved);
        cfg.every = Math.max(10, Number(cfg.every) || def.every);
        cfg.snooze = Math.max(1, Number(cfg.snooze) || def.snooze);
        return cfg;
    },

    saveNudgeCfg(kind, patch) {
        const cfg = Object.assign(this.nudgeCfg(kind), patch || {});
        localStorage.setItem(this.nudgeKeys(kind).cfg, JSON.stringify(cfg));
        this.renderNudgeSettings(kind);
        return cfg;
    },

    toggleNudge(kind) {
        const cfg = this.saveNudgeCfg(kind, { on: !this.nudgeCfg(kind).on });
        if (cfg.on) localStorage.removeItem(this.nudgeKeys(kind).skip);
        this.renderNudgeSettings(kind);
        this.showToast(this.NUDGES[kind].title.replace('Time To ', '') + ' reminder ' + (cfg.on ? 'on' : 'off'), 'info');
    },

    nudgeToMinutes(hhmm, fallback) {
        const parts = String(hhmm || '').split(':');
        const h = Number(parts[0]), m = Number(parts[1]);
        if (!isFinite(h) || !isFinite(m)) return fallback;
        return Math.max(0, Math.min(1439, h * 60 + m));
    },

    nudgeToClock(mins) {
        const h = Math.floor(mins / 60), m = mins % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    },

    // Every slot in the window, e.g. 11:00, 12:30, 14:00 … up to the end time.
    nudgeSlots(cfg) {
        const start = this.nudgeToMinutes(cfg.start, 660);
        const end = this.nudgeToMinutes(cfg.end, 1170);
        const out = [];
        for (let m = start; m <= end; m += cfg.every) out.push(m);
        return out;
    },

    nudgeNextSlot(cfg, nowMins) {
        const slots = this.nudgeSlots(cfg);
        for (let i = 0; i < slots.length; i++) if (slots[i] > nowMins) return slots[i];
        return null;
    },

    checkNudges(now) {
        // One alert on screen at a time: an overdue task comes first, and a
        // second nudge waits its turn instead of stacking on top.
        if (this.isAlarming) return;
        if (Object.keys(this.nudgeState).some(k => this.nudgeState[k] && this.nudgeState[k].showing)) return;
        Object.keys(this.NUDGES).forEach(kind => {
            if (Object.keys(this.nudgeState).some(k => this.nudgeState[k] && this.nudgeState[k].showing)) return;
            this.checkNudge(kind, now);
        });
    },

    checkNudge(kind, now) {
        const cfg = this.nudgeCfg(kind);
        const keys = this.nudgeKeys(kind);
        const state = this.nudgeState[kind] || (this.nudgeState[kind] = {});
        if (!cfg.on || state.showing) return;

        const todayStr = this.getLocalDateStr(now);
        if (localStorage.getItem(keys.skip) === todayStr) return;
        if (Date.now() < (state.snoozeUntil || 0)) return;

        const nowMins = now.getHours() * 60 + now.getMinutes();
        const due = this.nudgeSlots(cfg).filter(m => m <= nowMins);
        if (!due.length) return;

        const slot = due[due.length - 1];
        const stamp = todayStr + ' ' + this.nudgeToClock(slot);
        if (localStorage.getItem(keys.last) === stamp) return;
        localStorage.setItem(keys.last, stamp);

        // If the app was closed through the slot, let it pass quietly rather
        // than nudging for a break that was due an hour ago.
        if (nowMins - slot > 45) { this.renderNudgeSettings(kind); return; }
        this.triggerNudge(kind, slot);
    },

    triggerNudge(kind, slotMins) {
        const def = this.NUDGES[kind];
        if (!def) return;
        this.initAudio();
        const state = this.nudgeState[kind] || (this.nudgeState[kind] = {});
        state.showing = true;

        const modalId = 'nudgeModal_' + kind;
        let modal = document.getElementById(modalId);
        if (!modal) {
            modal = document.createElement('div');
            modal.className = 'modal';
            modal.id = modalId;
            modal.style.zIndex = String(def.zIndex);
            modal.innerHTML = `
                <div class="modal-content modal-sm" style="border-color: rgba(52,199,89,0.4);">
                    <div class="modal-header" style="border-bottom-color: rgba(52,199,89,0.25);">
                        <h2 style="color:var(--green-ink);">${def.icon} ${this.sanitize(def.title)}</h2>
                        <button class="modal-close" title="Dismiss" onclick="app.nudgeDone('${kind}')">✕</button>
                    </div>
                    <p style="color:var(--label-2); font-size:0.86rem; margin-bottom:14px;">${this.sanitize(def.line)}</p>
                    <div class="walk-card" id="nudgeBody_${kind}"></div>
                    <div class="modal-buttons">
                        <button class="btn-modal primary" onclick="app.nudgeDone('${kind}')">${this.sanitize(def.doneLabel)}</button>
                        <button class="btn-modal secondary" id="nudgeSnooze_${kind}" onclick="app.snoozeNudge('${kind}')">Snooze</button>
                        <button class="btn-modal danger" onclick="app.nudgeOffForToday('${kind}')">Skip today</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const cfg = this.nudgeCfg(kind);
        const now = new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const at = this.formatTimeStr(this.nudgeToClock(typeof slotMins === 'number' ? slotMins : nowMins));
        const next = this.nudgeNextSlot(cfg, nowMins);
        const body = document.getElementById('nudgeBody_' + kind);
        if (body) {
            body.innerHTML =
                '<div class="walk-card-time">' + this.sanitize(at) + ' ' + this.sanitize(def.slotWord) + '</div>' +
                '<div class="walk-card-sub">Every ' + cfg.every + ' minutes, ' +
                this.sanitize(this.formatTimeStr(cfg.start)) + ' to ' + this.sanitize(this.formatTimeStr(cfg.end)) +
                (next ? ' · next at ' + this.sanitize(this.formatTimeStr(this.nudgeToClock(next))) : ' · last one today') +
                '</div>';
        }
        const snoozeBtn = document.getElementById('nudgeSnooze_' + kind);
        if (snoozeBtn) snoozeBtn.textContent = 'Snooze ' + cfg.snooze + ' min';

        modal.classList.add('open');
        this.sendDesktopNotification(def.notifyTitle, def.notifyBody, false, def.tag);

        if (!state.soundInterval) {
            this.playBeepPair();
            state.soundInterval = setInterval(() => { this.playBeepPair(); }, 1800);
            if (state.soundTimeout) clearTimeout(state.soundTimeout);
            state.soundTimeout = setTimeout(() => {
                if (state.soundInterval) { clearInterval(state.soundInterval); state.soundInterval = null; }
            }, 30000);
        }
    },

    stopNudge(kind) {
        const state = this.nudgeState[kind] || (this.nudgeState[kind] = {});
        const modal = document.getElementById('nudgeModal_' + kind);
        if (modal) modal.classList.remove('open');
        if (state.soundInterval) { clearInterval(state.soundInterval); state.soundInterval = null; }
        if (state.soundTimeout) { clearTimeout(state.soundTimeout); state.soundTimeout = null; }
        state.showing = false;
        this.renderNudgeSettings(kind);
    },

    nudgeDone(kind) {
        this.stopNudge(kind);
        (this.nudgeState[kind] || {}).snoozeUntil = 0;
    },

    snoozeNudge(kind) {
        const mins = this.nudgeCfg(kind).snooze;
        (this.nudgeState[kind] || (this.nudgeState[kind] = {})).snoozeUntil = Date.now() + mins * 60000;
        this.stopNudge(kind);
        this.showToast('Reminder snoozed for ' + mins + ' minutes', 'info');
    },

    nudgeOffForToday(kind) {
        localStorage.setItem(this.nudgeKeys(kind).skip, this.getLocalDateStr(new Date()));
        this.stopNudge(kind);
        this.showToast('No more reminders today', 'info');
    },

    renderNudgeSettings(kind) {
        if (!kind) { Object.keys(this.NUDGES).forEach(k => this.renderNudgeSettings(k)); return; }
        const cfg = this.nudgeCfg(kind);
        const set = (id, val) => { const el = document.getElementById(id); if (el && el.value !== String(val)) el.value = val; };
        set(kind + 'Start', cfg.start);
        set(kind + 'End', cfg.end);
        set(kind + 'Every', cfg.every);

        const btn = document.getElementById(kind + 'Toggle');
        const lbl = document.getElementById(kind + 'ToggleLabel');
        if (btn) btn.classList.toggle('is-off', !cfg.on);
        if (lbl) lbl.textContent = cfg.on ? 'Reminder on' : 'Reminder off';

        const hint = document.getElementById(kind + 'NextHint');
        if (!hint) return;
        if (!cfg.on) { hint.textContent = 'Reminders are off.'; return; }
        const now = new Date();
        if (localStorage.getItem(this.nudgeKeys(kind).skip) === this.getLocalDateStr(now)) {
            hint.textContent = 'Skipped for the rest of today.';
            return;
        }
        const next = this.nudgeNextSlot(cfg, now.getHours() * 60 + now.getMinutes());
        const slots = this.nudgeSlots(cfg);
        hint.textContent = (next
            ? 'Next nudge at ' + this.formatTimeStr(this.nudgeToClock(next)) + '.'
            : 'Done for today — next one tomorrow at ' + this.formatTimeStr(cfg.start) + '.') +
            ' ' + slots.length + ' a day: ' + slots.map(m => this.formatTimeStr(this.nudgeToClock(m))).join(', ') + '.';
    },

    copyToClipboard(text, btnEl) {
        if (!text) { this.showToast('Nothing to copy', 'info'); return; }
        navigator.clipboard.writeText(text).then(() => {
            if (!btnEl) { this.showToast('Copied', 'success'); return; }
            const original = btnEl.innerHTML;
            btnEl.innerHTML = this.SVGS.copied;
            btnEl.classList.add('done');
            setTimeout(() => { btnEl.innerHTML = original; btnEl.classList.remove('done'); }, 1600);
        }).catch(() => this.showToast('Could not copy', 'error'));
    },

    /* ---------- LISTS ---------- */
    loadLists() {
        const defaultLists = {
            categories: [],
            priorities: ['High', 'Medium', 'Low'],
            statuses: ['Pending', 'In-Progress', 'Completed'],
            pendingWith: ['Self', 'Banking Team', 'Finance Manager', 'Vendor', 'Customer']
        };
        try {
            let stored = localStorage.getItem(CONFIG.LISTS_KEY);
            if (!stored) {
                const legacy = localStorage.getItem(CONFIG.BASE_LISTS_KEY);
                const migratedTo = localStorage.getItem(CONFIG.LEGACY_MIGRATED_KEY);
                if (legacy && (!migratedTo || migratedTo === this.currentUser)) stored = legacy;
            }
            this.lists = stored ? Object.assign({}, defaultLists, JSON.parse(stored)) : defaultLists;
        } catch (e) { this.lists = defaultLists; }
        this.listsUpdatedAt = Number(localStorage.getItem(CONFIG.LISTS_TS_KEY)) || 0;

        if (!localStorage.getItem('pureEnergyCatsCleared')) {
            localStorage.setItem('pureEnergyCatsCleared', '1');
            if (this.lists.categories && this.lists.categories.length) {
                this.lists.categories = [];
                this.listsUpdatedAt = Date.now();
                localStorage.setItem(CONFIG.LISTS_TS_KEY, String(this.listsUpdatedAt));
                localStorage.setItem(CONFIG.LISTS_KEY, JSON.stringify(this.lists));
            }
        }
    },

    saveLists(bump = true) {
        if (bump) {
            this.listsUpdatedAt = Date.now();
            localStorage.setItem(CONFIG.LISTS_TS_KEY, String(this.listsUpdatedAt));
        }
        localStorage.setItem(CONFIG.LISTS_KEY, JSON.stringify(this.lists));
        this.populateDropdowns();
        this.renderTable();
        if (bump) this.syncToGoogleSheets();
    },

    openListManager(key) {
        this.editingListKey = key;
        document.getElementById('listSelector').value = key;
        const titles = { categories: "Categories", priorities: "Priorities", statuses: "Status Options", pendingWith: "Pending With" };
        document.getElementById('listManagerTitle').textContent = `Manage ${titles[key]}`;
        this.renderListManagerItems();
        document.getElementById('listManagerModal').classList.add('open');
    },

    switchListManager() {
        this.editingListKey = document.getElementById('listSelector').value;
        const titles = { categories: "Categories", priorities: "Priorities", statuses: "Status Options", pendingWith: "Pending With" };
        document.getElementById('listManagerTitle').textContent = `Manage ${titles[this.editingListKey]}`;
        this.renderListManagerItems();
    },

    closeListManager() {
        document.getElementById('listManagerModal').classList.remove('open');
        this.editingListKey = null;
    },

    renderListManagerItems() {
        const container = document.getElementById('listManagerItems');
        container.innerHTML = '';
        (this.lists[this.editingListKey] || []).forEach((item, index) => {
            container.innerHTML += `<div class="lm-item"><span class="lm-name">${this.sanitize(item)}</span><button type="button" class="lm-del" data-action="list-delete" data-index="${index}">Delete</button></div>`;
        });
    },

    addListOption() {
        const input = document.getElementById('newListOptionInput');
        const val = input.value.trim();
        if (val && !this.lists[this.editingListKey].includes(val)) {
            this.lists[this.editingListKey].push(val);
            this.saveLists();
            this.renderListManagerItems();
            input.value = '';
        }
    },

    clearList() {
        const key = this.editingListKey;
        if (key === 'priorities' || key === 'statuses') {
            this.showToast('Priorities and statuses cannot be emptied.', 'warning');
            return;
        }
        const count = (this.lists[key] || []).length;
        if (!count) { this.showToast('Already empty', 'info'); return; }
        if (!confirm(`Remove all ${count} options from this list?`)) return;

        this.lists[key] = [];
        this.saveLists();
        this.renderListManagerItems();
        this.showToast('List cleared', 'success');
    },

    deleteListOption(index) {
        if (this.editingListKey === 'statuses' && this.lists.statuses[index] === 'Completed') {
            this.showToast("'Completed' status cannot be deleted.", "error");
            return;
        }
        const removed = this.lists[this.editingListKey][index];
        const inUse = this.tasks.filter(t => !t.deleted && (
            (this.editingListKey === 'categories' && t.category === removed) ||
            (this.editingListKey === 'priorities' && t.priority === removed) ||
            (this.editingListKey === 'statuses' && t.status === removed) ||
            (this.editingListKey === 'pendingWith' && t.pendingWith === removed)
        )).length;
        if (inUse > 0 && !confirm(`"${removed}" is used by ${inUse} entries. Delete anyway?`)) return;

        this.lists[this.editingListKey].splice(index, 1);
        this.saveLists();
        this.renderListManagerItems();
    },

    /* ---------- DATA ---------- */
    loadData() {
        try {
            let stored = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (!stored || stored === '[]') {
                const legacy = localStorage.getItem('pureEnergyBankingTasks');
                const migratedTo = localStorage.getItem(CONFIG.LEGACY_MIGRATED_KEY);
                if (legacy && legacy !== '[]' && (!migratedTo || migratedTo === this.currentUser)) {
                    stored = legacy;
                    localStorage.setItem(CONFIG.STORAGE_KEY, legacy);
                    localStorage.setItem(CONFIG.LEGACY_MIGRATED_KEY, this.currentUser);
                }
            }
            this.tasks = stored ? JSON.parse(stored) : [];
            if (!Array.isArray(this.tasks)) this.tasks = [];
            this.tasks.forEach(t => {
                if (!t.id) t.id = this.newId();
                if (!t.updatedAt) t.updatedAt = 0;
            });
        } catch (e) {
            console.error('Could not read local data:', e);
            this.tasks = [];
        }
    },

    saveData() {
        try {
            const blob = JSON.stringify(this.tasks);
            localStorage.setItem(CONFIG.STORAGE_KEY, blob);
            this.checkStorageHeadroom(blob.length);
        } catch (e) {
            this.showToast("Local storage full — export a CSV backup and empty the Bin.", "error");
        }
        this.updateStats();
        if (this.currentTab === 'Dashboard') this.renderDashboard();
    },

    updateHeader() {
        document.getElementById('headerDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },

    updateStats() {
        const active = this.tasks.filter(t => !t.deleted);
        const completed = active.filter(t => t.status === 'Completed').length;
        const binned = this.tasks.filter(t => t.deleted && !t.purged).length;
        document.getElementById('entryCount').textContent = active.length;
        document.getElementById('badgeCompleted').textContent = completed;
        document.getElementById('badgeCompletedTab').textContent = completed;
        document.getElementById('badgeBin').textContent = binned;
        document.getElementById('badgeBinTab').textContent = binned;
        document.getElementById('badgeRegister').textContent = active.filter(t => t.status !== 'Completed').length;

        // Mirror the two badges that moved into the "More" popup, plus a
        // combined indicator on the More button itself (mobile bottom bar).
        const bC = document.getElementById('badgeCompletedTabMore'); if (bC) bC.textContent = completed;
        const bB = document.getElementById('badgeBinTabMore'); if (bB) bB.textContent = binned;
        const moreBadge = document.getElementById('badgeMoreTab');
        if (moreBadge) {
            moreBadge.textContent = binned;
            moreBadge.style.display = binned > 0 ? '' : 'none';
        }
    },

    /* ---------- MULTI SELECT FILTERS ---------- */
    msPairs: {
        'ms-category': 'filterCategoryOpts',
        'ms-priority': 'filterPriorityOpts',
        'ms-status': 'filterStatusOpts',
        'ms-category-completed': 'filterCategoryCompletedOpts'
    },

    detachDropdowns() {
        Object.keys(this.msPairs).forEach(wrapId => {
            const panel = document.getElementById(this.msPairs[wrapId]);
            if (panel && panel.parentElement !== document.body) {
                panel.dataset.owner = wrapId;
                document.body.appendChild(panel);
            }
        });
    },

    closeDropdowns() {
        Object.keys(this.msPairs).forEach(wrapId => {
            const wrap = document.getElementById(wrapId);
            const panel = document.getElementById(this.msPairs[wrapId]);
            if (wrap) wrap.classList.remove('open');
            if (panel) panel.classList.remove('open');
        });
        const sortPanel = document.getElementById('sortMenuPanel');
        if (sortPanel) sortPanel.classList.remove('open');
    },

    toggleDropdown(id) {
        const panel = document.getElementById(this.msPairs[id]);
        const wrap = document.getElementById(id);
        if (!panel || !wrap) return;

        const wasOpen = panel.classList.contains('open');
        this.closeDropdowns();
        if (!wasOpen) {
            wrap.classList.add('open');
            panel.classList.add('open');
            this.positionDropdown(id);
        }
    },

    positionDropdown(id) {
        const wrap = document.getElementById(id);
        if (!wrap || !wrap.classList.contains('open')) return;

        const header = wrap.querySelector('.ms-header');
        const panel = document.getElementById(this.msPairs[id]);
        if (!header || !panel) return;

        const r = header.getBoundingClientRect();
        const gap = 6;
        const below = window.innerHeight - r.bottom - 12;
        const above = r.top - 12;
        const dropDown = below >= 200 || below >= above;

        const width = Math.max(r.width, 210);
        let left = r.left;
        if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
        if (left < 8) left = 8;

        panel.style.width = width + 'px';
        panel.style.left = left + 'px';
        panel.style.maxHeight = Math.max(150, Math.min(320, dropDown ? below : above)) + 'px';

        if (dropDown) {
            panel.style.top = (r.bottom + gap) + 'px';
            panel.style.bottom = 'auto';
        } else {
            panel.style.top = 'auto';
            panel.style.bottom = (window.innerHeight - r.top + gap) + 'px';
        }
    },

    renderMultiSelect(containerId, labelPrefix, options) {
        const cont = document.getElementById(containerId);
        if (!cont) return;

        const currentVals = Array.from(cont.querySelectorAll('input[type="checkbox"]:checked')).map(b => b.value);
        const hasSelection = currentVals.length > 0;
        const isChecked = (val) => {
            if (!hasSelection && val === 'All') return 'checked';
            return currentVals.includes(val) ? 'checked' : '';
        };

        cont.innerHTML = `<label><input type="checkbox" value="All" onchange="app.handleMultiChange('${containerId}', this)" ${isChecked('All')}> All ${labelPrefix}</label>` +
            options.map(o => `<label><input type="checkbox" value="${this.escAttr(o)}" onchange="app.handleMultiChange('${containerId}', this)" ${isChecked(o)}> ${this.sanitize(o)}</label>`).join('');

        this.updateMultiHeader(containerId, labelPrefix);
    },

    SORT_COLUMNS: {
        Register: [
            ['dateLogged', 'Logged'], ['description', 'Task'], ['category', 'Category'],
            ['priority', 'Priority'], ['status', 'Status'], ['pendingWith', 'Pending with'], ['dueDate', 'Due date']
        ],
        Completed: [
            ['dateLogged', 'Logged'], ['description', 'Task'], ['category', 'Category'], ['completedDate', 'Completed on']
        ],
        Bin: [
            ['dateDeleted', 'Deleted on'], ['description', 'Task'], ['category', 'Category']
        ]
    },

    openSortMenu(tab, btnEl) {
        const panel = document.getElementById('sortMenuPanel');
        if (!panel) return;

        const wasOpenForThis = panel.classList.contains('open') && panel.dataset.owner === btnEl.id;
        this.closeDropdowns();
        if (wasOpenForThis) return;

        const cols = this.SORT_COLUMNS[tab] || [];
        panel.innerHTML = cols.map(([col, label]) => {
            const active = this.sortCol === col;
            const arrow = active ? (this.sortAsc ? '↑' : '↓') : '';
            return `<label class="${active ? 'active' : ''}" data-action="sort-pick" data-col="${this.escAttr(col)}" style="display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:0.88rem; cursor:pointer; border-radius:10px;">
                <span>${this.sanitize(label)}</span><span class="sort-dir" style="color:var(--accent); font-weight:700;">${arrow}</span>
            </label>`;
        }).join('');

        panel.dataset.owner = btnEl.id;
        panel.classList.add('open');

        const r = btnEl.getBoundingClientRect();
        const width = Math.max(r.width, 190);
        let left = r.left;
        if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
        panel.style.width = width + 'px';
        panel.style.left = Math.max(8, left) + 'px';

        const below = window.innerHeight - r.bottom - 12;
        const above = r.top - 12;
        if (below >= 180 || below >= above) {
            panel.style.top = (r.bottom + 6) + 'px';
            panel.style.bottom = 'auto';
            panel.style.maxHeight = Math.max(140, Math.min(320, below)) + 'px';
        } else {
            panel.style.top = 'auto';
            panel.style.bottom = (window.innerHeight - r.top + 6) + 'px';
            panel.style.maxHeight = Math.max(140, Math.min(320, above)) + 'px';
        }
    },

    pickSort(col) {
        if (this.sortCol === col) this.sortAsc = !this.sortAsc;
        else { this.sortCol = col; this.sortAsc = true; }
        this.closeDropdowns();
        this.renderTable();
    },

    COL_WIDTHS_KEY: 'pureEnergyColWidths',

    colWidthsStore() {
        try { return JSON.parse(localStorage.getItem(this.COL_WIDTHS_KEY) || '{}'); }
        catch (e) { return {}; }
    },

    saveColWidth(table, col, px) {
        const store = this.colWidthsStore();
        store[table] = store[table] || {};
        store[table][col] = px;
        localStorage.setItem(this.COL_WIDTHS_KEY, JSON.stringify(store));
    },

    clearColWidth(table, col) {
        const store = this.colWidthsStore();
        if (store[table]) { delete store[table][col]; }
        localStorage.setItem(this.COL_WIDTHS_KEY, JSON.stringify(store));
    },

    restoreColumnWidths(table) {
        const store = this.colWidthsStore();
        const saved = store[table];
        const colgroup = document.getElementById(table + 'Colgroup');
        if (!saved || !colgroup) return;
        const cols = colgroup.querySelectorAll('col');
        Object.keys(saved).forEach(i => {
            if (cols[i]) cols[i].style.width = saved[i] + 'px';
        });
    },

    fitColumns(table) {
        const store = this.colWidthsStore();
        delete store[table];
        localStorage.setItem(this.COL_WIDTHS_KEY, JSON.stringify(store));
        const colgroup = document.getElementById(table + 'Colgroup');
        if (colgroup) colgroup.querySelectorAll('col').forEach(c => { c.style.width = ''; });
        this.showToast('Columns sized to fit your data', 'success');
    },

    initColumnResize() {
        if (window.matchMedia('(max-width: 768px)').matches) return;

        let drag = null; 

        document.addEventListener('mousedown', (e) => {
            const handle = e.target.closest('.col-resize');
            if (!handle) return;
            e.preventDefault();

            const table = handle.dataset.table;
            const colIndex = Number(handle.dataset.col);
            const th = handle.closest('th');
            const colgroup = document.getElementById(table + 'Colgroup');
            const colEl = colgroup ? colgroup.querySelectorAll('col')[colIndex] : null;
            if (!th || !colEl) return;

            drag = { table, colIndex, colEl, startX: e.clientX, startWidth: th.getBoundingClientRect().width };
            handle.classList.add('active');
            document.body.classList.add('resizing');
        });

        document.addEventListener('mousemove', (e) => {
            if (!drag) return;
            const next = Math.max(60, Math.round(drag.startWidth + (e.clientX - drag.startX)));
            drag.colEl.style.width = next + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!drag) return;
            const width = parseInt(drag.colEl.style.width, 10);
            if (width) this.saveColWidth(drag.table, drag.colIndex, width);
            document.querySelectorAll('.col-resize.active').forEach(h => h.classList.remove('active'));
            document.body.classList.remove('resizing');
            drag = null;
        });

        document.addEventListener('dblclick', (e) => {
            const handle = e.target.closest('.col-resize');
            if (!handle) return;
            const table = handle.dataset.table;
            const colIndex = Number(handle.dataset.col);
            const colgroup = document.getElementById(table + 'Colgroup');
            const colEl = colgroup ? colgroup.querySelectorAll('col')[colIndex] : null;
            if (!colEl) return;
            colEl.style.width = '';
            this.clearColWidth(table, colIndex);
        });
    },

    handleMultiChange(containerId, checkbox) {
        const cont = document.getElementById(containerId);
        const boxes = Array.from(cont.querySelectorAll('input[type="checkbox"]'));
        const allBox = boxes.find(b => b.value === 'All');

        if (checkbox.value === 'All') {
            if (checkbox.checked) boxes.forEach(b => { if (b !== checkbox) b.checked = false; });
            else checkbox.checked = true;
        } else {
            if (checkbox.checked) { if (allBox) allBox.checked = false; }
            else {
                const anyChecked = boxes.some(b => b.value !== 'All' && b.checked);
                if (!anyChecked && allBox) allBox.checked = true;
            }
        }
        this.updateMultiHeader(containerId);
        this.renderTable();
    },

    updateMultiHeader(containerId, labelPrefix = '') {
        const cont = document.getElementById(containerId);
        if (!cont) return;

        if (!labelPrefix) {
            if (containerId.includes('Category')) labelPrefix = 'Categories';
            else if (containerId.includes('Priority')) labelPrefix = 'Priorities';
            else if (containerId.includes('Status')) labelPrefix = 'Statuses';
        }

        const boxes = Array.from(cont.querySelectorAll('input[type="checkbox"]:checked'));
        const owner = cont.dataset.owner ? document.getElementById(cont.dataset.owner) : cont.parentElement;
        const header = owner ? owner.querySelector('.ms-header') : null;
        if (!header) return;

        if (boxes.length === 0 || (boxes.length === 1 && boxes[0].value === 'All')) {
            header.textContent = `All ${labelPrefix}`;
            header.style.color = '';
            header.style.borderColor = '';
        } else {
            const vals = boxes.filter(b => b.value !== 'All').map(b => b.value);
            header.textContent = vals.length === 1 ? vals[0] : `${vals.length} Selected`;
            header.style.color = 'var(--accent)';
            header.style.borderColor = 'var(--accent)';
        }
    },

    getMultiValues(containerId) {
        const cont = document.getElementById(containerId);
        if (!cont) return ['All'];
        const checked = Array.from(cont.querySelectorAll('input[type="checkbox"]:checked')).map(b => b.value);
        if (checked.includes('All') || checked.length === 0) return ['All'];
        return checked;
    },

    setMultiValue(containerId, val) {
        const cont = document.getElementById(containerId);
        if (!cont) return;
        let boxes = Array.from(cont.querySelectorAll('input[type="checkbox"]'));

        if (val && val !== 'All' && !boxes.some(b => b.value === val)) {
            const label = document.createElement('label');
            label.innerHTML = '<input type="checkbox" value="' + this.escAttr(val) + '" onchange="app.handleMultiChange(\'' + containerId + '\', this)"> ' + this.sanitize(val);
            cont.appendChild(label);
            boxes = Array.from(cont.querySelectorAll('input[type="checkbox"]'));
        }

        boxes.forEach(b => { b.checked = (b.value === val); });
        this.updateMultiHeader(containerId);
    },

    refreshFilterOptions() {
        const sig = JSON.stringify([
            this.lists,
            Array.from(new Set(this.tasks.map(t => [t.category, t.priority, t.status, t.pendingWith].join('|')))).sort()
        ]);
        if (sig === this._filterSig) return;
        if (document.querySelector('.multi-select.open')) return;
        this._filterSig = sig;
        this.populateDropdowns();
    },

    populateDropdowns() {
        const opt = (v) => `<option value="${this.escAttr(v)}">${this.sanitize(v)}</option>`;
        document.getElementById('taskCategory').innerHTML = '<option value="">Select Category</option>' + this.lists.categories.map(opt).join('');
        document.getElementById('taskPriority').innerHTML = this.lists.priorities.map(opt).join('');
        document.getElementById('taskStatus').innerHTML = this.lists.statuses.map(opt).join('');
        document.getElementById('taskPendingWith').innerHTML = '<option value="">Select Person</option>' + this.lists.pendingWith.map(opt).join('');

        const union = (base, field) => {
            const out = [].concat(base);
            this.tasks.forEach(t => {
                const v = t[field];
                if (v && out.indexOf(v) === -1) out.push(v);
            });
            return out;
        };
        const allCats = union(this.lists.categories, 'category');

        this.renderMultiSelect('filterCategoryOpts', 'Categories', allCats);
        this.renderMultiSelect('filterPriorityOpts', 'Priorities', union(this.lists.priorities, 'priority'));
        this.renderMultiSelect('filterStatusOpts', 'Statuses', union(this.lists.statuses, 'status'));
        this.renderMultiSelect('filterCategoryCompletedOpts', 'Categories', allCats);

        // Rebuilding a <select> wipes its value, so remember and restore it —
        // otherwise a background sync silently drops the filter you just set.
        const keepValue = (elId, html) => {
            const el = document.getElementById(elId);
            if (!el) return;
            const previous = el.value;
            el.innerHTML = html;
            if (previous && Array.from(el.options).some(o => o.value === previous)) el.value = previous;
        };

        keepValue('filterPending', '<option value="All">All Pending With</option>' + union(this.lists.pendingWith, 'pendingWith').map(opt).join(''));
    },

    setupEventListeners() {
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (document.getElementById('listManagerModal').classList.contains('open')) { this.closeListManager(); return; }
            if (document.getElementById('taskModal').classList.contains('open')) { this.closeTaskModal(); return; }
            if (document.getElementById('emailListModal').classList.contains('open')) { document.getElementById('emailListModal').classList.remove('open'); return; }
            if (document.getElementById('syncSetupModal').classList.contains('open')) { document.getElementById('syncSetupModal').classList.remove('open'); return; }
        });
    },

    clearFilters(silent = false) {
        document.getElementById('searchInput').value = '';
        const doneSearch = document.getElementById('searchCompleted');
        if (doneSearch) doneSearch.value = '';
        this.setMultiValue('filterCategoryOpts', 'All');
        this.setMultiValue('filterPriorityOpts', 'All');
        this.setMultiValue('filterStatusOpts', 'All');
        this.setMultiValue('filterCategoryCompletedOpts', 'All');

        document.getElementById('filterPending').value = 'All';
        document.getElementById('filterDue').value = 'All';
        document.getElementById('filterPending').classList.remove('active-filter');
        document.getElementById('filterDue').classList.remove('active-filter');

        this.renderTable();
        if (silent !== true) this.showToast('Filters cleared', 'success');
    },

    SORT_DEFAULTS: {
        Register:  ['dueDate', true],
        Completed: ['completedDate', false],
        Bin:       ['dateDeleted', false]
    },
    _sortChosen: {},

    // Visual order of the tabs in the bottom/segmented tabbar — also the
    // order swipe-left/right steps through.
    TAB_ORDER: ['Dashboard', 'Register', 'Completed', 'Holidays', 'Bin', 'Config'],

    switchTab(tab, dir) {
        if (tab !== this.currentTab) this.exitSelectMode();
        this.closeMoreMenu();

        // Work out a swipe direction automatically when the caller didn't
        // pass one (e.g. a tab-bar tap), so the animation always makes sense.
        if (!dir) {
            const from = this.TAB_ORDER.indexOf(this.currentTab);
            const to = this.TAB_ORDER.indexOf(tab);
            if (from !== -1 && to !== -1 && from !== to) dir = to > from ? 'next' : 'prev';
        }

        this.currentTab = tab;

        // Device/browser back button: keep exactly one "away from Dashboard"
        // history entry, so back always returns to Dashboard in a single
        // press first — then a second press exits, like a native app.
        if (tab !== 'Dashboard' && !this._awayFromDashboard) {
            history.pushState({ btwAway: true }, '');
            this._awayFromDashboard = true;
        } else if (tab === 'Dashboard' && this._awayFromDashboard && !this._fromPopstate) {
            this._awayFromDashboard = false;
            history.back();
        }
        this._fromPopstate = false;

        // Each tab opens on the sort that actually makes sense for it —
        // Tasks by what is due next — until you pick your own for that tab.
        const chosen = this._sortChosen[tab];
        const preset = chosen || this.SORT_DEFAULTS[tab];
        if (preset) { this.sortCol = preset[0]; this.sortAsc = preset[1]; }

        document.querySelectorAll('.content-area').forEach(el => el.classList.remove('active', 'tab-swipe-next', 'tab-swipe-prev'));
        document.querySelectorAll('.tabbar-btn').forEach(btn => btn.classList.remove('active'));

        const tabMap = { 'Dashboard': 'dashboardTab', 'Register': 'registerTab', 'Holidays': 'holidaysTab', 'Config': 'configTab', 'Completed': 'completedTab', 'Bin': 'binTab' };
        const titles = { 'Dashboard': 'Overview', 'Register': 'Tasks', 'Holidays': 'Bank Holidays', 'Config': 'Configuration', 'Completed': 'Done', 'Bin': 'Bin' };

        const screen = document.getElementById(tabMap[tab]);
        if (screen) {
            screen.classList.add('active');
            if (dir === 'next') screen.classList.add('tab-swipe-next');
            else if (dir === 'prev') screen.classList.add('tab-swipe-prev');
            screen.scrollTop = 0;
        }

        const btn = document.querySelector(`.tabbar-btn[data-tab="${tab}"]`);
        if (btn) btn.classList.add('active');
        document.getElementById('screenTitle').textContent = titles[tab] || tab;

        // The "More" bottom-bar button represents Done/Holidays/Bin/Config —
        // light it up (and the matching popup row) whenever one of those is open.
        const moreTabs = ['Completed', 'Holidays', 'Bin', 'Config'];
        const moreBtn = document.getElementById('moreTabBtn');
        if (moreBtn) moreBtn.classList.toggle('active', moreTabs.includes(tab));
        document.querySelectorAll('.more-menu-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));

        this.renderTable();
    },

    /* ---------- "MORE" POPUP (mobile bottom bar) ---------- */
    toggleMoreMenu() {
        const menu = document.getElementById('moreMenu');
        if (!menu) return;
        if (menu.classList.contains('open')) this.closeMoreMenu();
        else this.openMoreMenu();
    },

    openMoreMenu() {
        document.getElementById('moreMenu')?.classList.add('open');
        document.getElementById('moreMenuBackdrop')?.classList.add('open');
    },

    closeMoreMenu() {
        document.getElementById('moreMenu')?.classList.remove('open');
        document.getElementById('moreMenuBackdrop')?.classList.remove('open');
    },

    /* ---------- SWIPE LEFT/RIGHT TO CHANGE TABS (mobile) ---------- */
    initTabSwipe() {
        let startX = 0, startY = 0, tracking = false, axis = null;

        const ignoreTarget = (el) => el.closest(
            '.card-list .tcard[data-record-id], .modal, .multi-select, .ms-options, ' +
            '#sortMenuPanel, .table-container, input, textarea, select, .col-resize'
        );

        document.addEventListener('touchstart', (e) => {
            if (this.resolvedShell() !== 'mobile') return;
            if (e.touches.length !== 1) return;
            const el = e.target.closest('.content-area.active');
            if (!el || ignoreTarget(e.target)) { tracking = false; return; }
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            tracking = true;
            axis = null;
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!tracking || e.touches.length !== 1) return;
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;
            if (!axis) axis = Math.abs(dx) > Math.abs(dy) + 6 ? 'x' : (Math.abs(dy) > Math.abs(dx) + 6 ? 'y' : null);
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            if (!tracking) return;
            tracking = false;
            if (axis !== 'x') return;
            const dx = (e.changedTouches[0].clientX - startX);
            if (Math.abs(dx) < 60) return;

            const order = this.TAB_ORDER;
            const idx = order.indexOf(this.currentTab);
            if (idx === -1) return;

            if (dx < 0 && idx < order.length - 1) this.switchTab(order[idx + 1], 'next');
            else if (dx > 0 && idx > 0) this.switchTab(order[idx - 1], 'prev');
        }, { passive: true });
    },

    /* ---------- DEVICE BACK BUTTON → DASHBOARD ---------- */
    initBackNav() {
        window.addEventListener('popstate', () => {
            // The More popup's backdrop is a full-screen layer — if it's
            // left open, it silently blocks every tap and scroll underneath
            // it. The backdrop's own click handler closes it, but the
            // physical/hardware back button fires this event instead of a
            // click, so it has to be closed here too or it can get stuck.
            this.closeMoreMenu();

            if (this.currentTab !== 'Dashboard') {
                this._fromPopstate = true;
                this._awayFromDashboard = false;
                this.switchTab('Dashboard', 'prev');
            }
            // Already on Dashboard — let the browser's own back navigation
            // (leaving/closing the app) proceed as normal.
        });
    },

    toggleFilters() {
        const bar = document.getElementById('registerFilters');
        if (bar) {
            const on = bar.classList.toggle('open');
            const toggle = document.getElementById('filterToggle');
            if (toggle) toggle.classList.toggle('is-on', on);
        }
    },

    isDateInRange(t, mode) {
        if (!t.dueDate) return false;
        if (mode === 'Overdue') {
            const dt = this.getTaskDueDateTime(t);
            return !!dt && dt < new Date();
        }
        const [y, m, d] = String(t.dueDate).split('-').map(Number);
        if (!y || !m || !d) return false;
        const target = new Date(y, m - 1, d);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));

        if (mode === 'Today') return diffDays === 0;
        if (mode === 'Tomorrow') return diffDays === 1;
        if (mode === 'Next7Days') return diffDays >= 1 && diffDays <= 7;

        const dayOfWeek = today.getDay() || 7;
        const mondayThis = new Date(today); mondayThis.setDate(today.getDate() - dayOfWeek + 1);
        const sundayThis = new Date(mondayThis); sundayThis.setDate(mondayThis.getDate() + 6);
        const mondayNext = new Date(sundayThis); mondayNext.setDate(sundayThis.getDate() + 1);
        const sundayNext = new Date(mondayNext); sundayNext.setDate(mondayNext.getDate() + 6);

        if (mode === 'ThisWeek') return target >= mondayThis && target <= sundayThis;
        if (mode === 'NextWeek') return target >= mondayNext && target <= sundayNext;
        if (mode === 'ThisMonth') return target.getMonth() === today.getMonth() && target.getFullYear() === today.getFullYear();
        return false;
    },

    /* ---------- SORTING & RENDERING ---------- */
    updateSortHeaders() {
        const getIcon = (col) => this.sortCol === col ? (this.sortAsc ? '↑' : '↓') : '↕';
        const handle = (table, i) => `<span class="col-resize" data-table="${table}" data-col="${i}"></span>`;

        if (this.currentTab === 'Register') {
            document.getElementById('registerTableHead').innerHTML = `
                <tr>
                    <th onclick="app.sortTable('dateLogged')">Logged<span>${getIcon('dateLogged')}</span>${handle('register', 0)}</th>
                    <th onclick="app.sortTable('description')">Task<span>${getIcon('description')}</span>${handle('register', 1)}</th>
                    <th onclick="app.sortTable('category')">Category<span>${getIcon('category')}</span>${handle('register', 2)}</th>
                    <th onclick="app.sortTable('priority')">Priority<span>${getIcon('priority')}</span>${handle('register', 3)}</th>
                    <th onclick="app.sortTable('status')">Status<span>${getIcon('status')}</span>${handle('register', 4)}</th>
                    <th onclick="app.sortTable('pendingWith')">Pending With<span>${getIcon('pendingWith')}</span>${handle('register', 5)}</th>
                    <th onclick="app.sortTable('dueDate')">Due Date<span>${getIcon('dueDate')}</span>${handle('register', 6)}</th>
                    <th>Actions${handle('register', 7)}</th>
                </tr>`;
        } else if (this.currentTab === 'Completed') {
            document.getElementById('completedTableHead').innerHTML = `
                <tr>
                    <th onclick="app.sortTable('dateLogged')">Logged<span>${getIcon('dateLogged')}</span>${handle('completed', 0)}</th>
                    <th onclick="app.sortTable('description')">Task<span>${getIcon('description')}</span>${handle('completed', 1)}</th>
                    <th onclick="app.sortTable('category')">Category<span>${getIcon('category')}</span>${handle('completed', 2)}</th>
                    <th onclick="app.sortTable('completedDate')">Completed On<span>${getIcon('completedDate')}</span>${handle('completed', 3)}</th>
                    <th>Actions${handle('completed', 4)}</th>
                </tr>`;
        } else if (this.currentTab === 'Bin') {
            document.getElementById('binTableHead').innerHTML = `
                <tr>
                    <th onclick="app.sortTable('dateDeleted')">Deleted On<span>${getIcon('dateDeleted')}</span>${handle('bin', 0)}</th>
                    <th onclick="app.sortTable('description')">Task<span>${getIcon('description')}</span>${handle('bin', 1)}</th>
                    <th onclick="app.sortTable('category')">Category<span>${getIcon('category')}</span>${handle('bin', 2)}</th>
                    <th>Actions${handle('bin', 3)}</th>
                </tr>`;
        }
    },

    sortTable(col) {
        if (this.sortCol === col) this.sortAsc = !this.sortAsc;
        else { this.sortCol = col; this.sortAsc = true; }
        this._sortChosen[this.currentTab] = [this.sortCol, this.sortAsc];
        this.renderTable();
    },

    compareTasks(a, b) {
        const col = this.sortCol;
        const dir = this.sortAsc ? 1 : -1;
        let valA, valB;

        if (col === 'priority') {
            const rank = (v) => { const i = this.lists.priorities.indexOf(v); return i === -1 ? 999 : i; };
            valA = rank(a.priority); valB = rank(b.priority);
        } else if (col === 'dueDate') {
            const dt = (t) => { const d = this.getTaskDueDateTime(t); return d ? d.getTime() : Number.MAX_SAFE_INTEGER; };
            valA = dt(a); valB = dt(b);
        } else {
            valA = (a[col] || '').toString().toLowerCase();
            valB = (b[col] || '').toString().toLowerCase();
        }

        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    },

    renderTable() {
        this.updateSortHeaders();
        this.refreshFilterOptions();
        if (this.currentTab === 'Register') this.renderRegister();
        else if (this.currentTab === 'Completed') this.renderCompleted();
        else if (this.currentTab === 'Bin') this.renderBin();
        else if (this.currentTab === 'Holidays') this.renderHolidays();
        else if (this.currentTab === 'Dashboard') this.renderDashboard();
    },

    /* ---------- HOLIDAYS: STORAGE ---------- */
    loadHolidays() {
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem(CONFIG.HOLIDAYS_KEY) || 'null'); } catch (e) { stored = null; }

        if (Array.isArray(stored) && stored.length) {
            this.holidays = stored;
        } else {
            this.holidays = this.DEFAULT_HOLIDAYS.map(h => Object.assign(
                { id: this.newId(), alert: true, custom: false }, h
            ));
            this.saveHolidays(false);
        }
    },

    saveHolidays(toast) {
        localStorage.setItem(CONFIG.HOLIDAYS_KEY, JSON.stringify(this.holidays));
        if (toast) this.showToast('Holiday saved', 'success');
    },

    holidayCalendars() {
        const set = new Set(['USD Holiday', 'Indian Bank Holiday']);
        this.holidays.forEach(h => { if (h.type) set.add(h.type); });
        return Array.from(set);
    },

    holidayChipClass(type) {
        if (type === 'USD Holiday') return 'hol-usd';
        if (type === 'Indian Bank Holiday') return 'hol-ind';
        return 'hol-other';
    },

    /* ---------- HOLIDAYS: DATE HELPERS ---------- */
    addDaysStr(dateStr, n) {
        const [y, m, d] = String(dateStr).split('-').map(Number);
        const dt = new Date(y, (m || 1) - 1, d || 1);
        dt.setDate(dt.getDate() + n);
        return this.getLocalDateStr(dt);
    },

    isWeekendStr(dateStr) {
        const [y, m, d] = String(dateStr).split('-').map(Number);
        const day = new Date(y, (m || 1) - 1, d || 1).getDay();
        return day === 0 || day === 6;
    },

    // Skips weekends and any listed holiday of the given calendar to find the
    // next working day after dateStr.
    computeNextWorkingDay(dateStr, type) {
        let next = this.addDaysStr(dateStr, 1);
        let guard = 0;
        const isHolidayFor = (d) => this.holidays.some(h => h.date === d && (!type || h.type === type));
        while ((this.isWeekendStr(next) || isHolidayFor(next)) && guard < 14) {
            next = this.addDaysStr(next, 1);
            guard++;
        }
        return next;
    },

    suggestHolidayNextWorking() {
        const dateInput = document.getElementById('holDate');
        const typeInput = document.getElementById('holType');
        const nextInput = document.getElementById('holNextWorking');
        if (!dateInput || !nextInput || !dateInput.value) return;
        if (nextInput.value && nextInput.dataset.userSet === '1') return;
        nextInput.value = this.computeNextWorkingDay(dateInput.value, typeInput ? typeInput.value : '');
    },

    // Merges actual holidays with adjacent weekends into "continuous" blocks —
    // e.g. Friday holiday + Sat + Sun → one 3-day block. Holidays tab only.
    computeContinuousHolidayBlocks(list) {
        const source = list !== undefined ? list : this.holidays;
        if (!source.length) return [];

        const byDate = new Map();
        source.forEach(h => {
            if (!byDate.has(h.date)) byDate.set(h.date, []);
            byDate.get(h.date).push(h);
        });

        const dates = Array.from(byDate.keys()).sort();
        let cursor = this.addDaysStr(dates[0], -3);
        const end = this.addDaysStr(dates[dates.length - 1], 3);

        const blocks = [];
        let cur = null;
        let guard = 0;

        while (cursor <= end && guard < 5000) {
            guard++;
            const hasHoliday = byDate.has(cursor);
            const off = hasHoliday || this.isWeekendStr(cursor);

            if (off) {
                if (!cur) cur = { start: cursor, end: cursor, items: [], hasHoliday: false };
                cur.end = cursor;
                if (hasHoliday) { cur.hasHoliday = true; cur.items.push(...byDate.get(cursor)); }
            } else if (cur) {
                if (cur.hasHoliday) blocks.push(cur);
                cur = null;
            }
            cursor = this.addDaysStr(cursor, 1);
        }
        if (cur && cur.hasHoliday) blocks.push(cur);

        // Only genuinely "continuous" blocks — 2+ calendar days off in a row.
        return blocks.filter(b => b.start !== b.end);
    },

    renderContinuousHolidayBanner(list) {
        const box = document.getElementById('continuousHolidayBanner');
        if (!box) return;
        const blocks = this.computeContinuousHolidayBlocks(list);
        if (!blocks.length) { box.innerHTML = ''; return; }

        box.innerHTML = '<div class="cont-hol-wrap">' + blocks.map(b => {
            const days = this.dateDiffDays(b.start, b.end) + 1;
            const names = Array.from(new Set(b.items.map(h => h.name))).join(', ');
            const range = b.start === b.end
                ? this.formatDateStr(b.start, { day: 'numeric', month: 'short' })
                : this.formatDateStr(b.start, { day: 'numeric', month: 'short' }) + ' – ' + this.formatDateStr(b.end, { day: 'numeric', month: 'short' });
            return '<div class="cont-hol-card"><span class="cont-hol-ico">🎉</span>' +
                '<div class="cont-hol-body"><div class="cont-hol-title">' + days + '-day continuous holiday · ' + range + '</div>' +
                '<div class="cont-hol-sub">' + this.sanitize(names) + '</div></div></div>';
        }).join('') + '</div>';
    },

    dateDiffDays(a, b) {
        const [y1, m1, d1] = a.split('-').map(Number);
        const [y2, m2, d2] = b.split('-').map(Number);
        const t1 = new Date(y1, m1 - 1, d1).getTime();
        const t2 = new Date(y2, m2 - 1, d2).getTime();
        return Math.round((t2 - t1) / 86400000);
    },

    /* ---------- HOLIDAYS: FILTER + RENDER ---------- */
    populateHolidayTypeFilter() {
        const sel = document.getElementById('filterHolidayType');
        const list = document.getElementById('holCalendarList');
        if (!sel) return;
        const calendars = this.holidayCalendars();
        const current = sel.value || 'All';

        sel.innerHTML = '<option value="All">All Calendars</option>' +
            calendars.map(c => `<option value="${this.escAttr(c)}">${this.sanitize(c)}</option>`).join('');
        sel.value = calendars.includes(current) || current === 'All' ? current : 'All';

        if (list) list.innerHTML = calendars.map(c => `<option value="${this.escAttr(c)}"></option>`).join('');
    },

    holidayMatchesWhen(h, when, todayStr) {
        if (when === 'All' || !when) return true;
        if (when === 'Upcoming') return h.date >= todayStr;
        if (when === 'Past') return h.date < todayStr;
        if (when === 'Next7Days') return h.date >= todayStr && h.date <= this.addDaysStr(todayStr, 7);
        if (when === 'ThisMonth') {
            const [y, m] = todayStr.split('-');
            return String(h.date).startsWith(`${y}-${m}`);
        }
        return true;
    },

    filterHolidaysFromDashboard(when) {
        this.switchTab('Holidays');
        const whenSel = document.getElementById('filterHolidayWhen');
        if (whenSel) whenSel.value = when || 'Next7Days';
        this.renderHolidays();
        this.showToast('Showing holidays in the next 7 days', 'info');
    },

    renderHolidays() {
        this.populateHolidayTypeFilter();

        const search = (document.getElementById('searchHolidays')?.value || '').toLowerCase();
        const typeFilter = document.getElementById('filterHolidayType')?.value || 'All';
        const whenFilter = document.getElementById('filterHolidayWhen')?.value || 'All';
        const todayStr = this.getLocalDateStr(new Date());

        let filtered = this.holidays.filter(h => {
            const matchSearch = !search || h.name.toLowerCase().includes(search) || h.date.includes(search);
            const matchType = typeFilter === 'All' || h.type === typeFilter;
            const matchWhen = this.holidayMatchesWhen(h, whenFilter, todayStr);
            return matchSearch && matchType && matchWhen;
        });

        filtered.sort((a, b) => {
            const aPast = a.date < todayStr;
            const bPast = b.date < todayStr;
            if (aPast !== bPast) return aPast ? 1 : -1; // past holidays sink to the bottom
            // upcoming: soonest first · past: most recently gone first
            return aPast ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
        });

        const countEl = document.getElementById('entriesHolidaysText');
        if (countEl) countEl.textContent = filtered.length + (filtered.length === 1 ? ' holiday shown' : ' holidays shown');

        this.renderContinuousHolidayBanner(typeFilter === 'All' ? this.holidays : this.holidays.filter(h => h.type === typeFilter));

        const tbody = document.getElementById('holidaysTableBody');
        if (tbody) {
            tbody.innerHTML = '';
            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--label-2);">No holidays found.</td></tr>`;
            } else {
                const frag = document.createDocumentFragment();
                filtered.forEach(h => {
                    const row = document.createElement('tr');
                    const cls = this.holidayChipClass(h.type);
                    row.innerHTML = `
                        <td style="font-family: var(--font-num); font-weight: 600; white-space:nowrap;">${this.formatDateStr(h.date)}</td>
                        <td style="font-weight: 700; color: var(--label);">${this.sanitize(h.name)}</td>
                        <td style="font-family: var(--font-num); color: var(--label-2); white-space:nowrap;">${this.formatDateStr(h.nextWorkingDay)}</td>
                        <td><span class="chip ${cls}">${this.sanitize(h.type)}</span></td>
                        <td class="action-cell">
                            <button type="button" class="btn-icon" data-action="holiday-edit" data-id="${this.escAttr(h.id)}" title="Edit">${this.SVGS.edit}</button>
                            <button type="button" class="btn-icon bad" data-action="holiday-delete" data-id="${this.escAttr(h.id)}" title="Delete">${this.SVGS.bin}</button>
                        </td>
                    `;
                    frag.appendChild(row);
                });
                tbody.appendChild(frag);
            }
        }

        this.renderHolidayCards(filtered);
    },

    renderHolidayCards(list) {
        const box = document.getElementById('holidaysCardList');
        if (!box) return;
        box.innerHTML = '';

        if (!list.length) {
            box.innerHTML = `<div class="empty-state"><strong>No holidays found</strong><span>Tap + to add one.</span></div>`;
            return;
        }

        const frag = document.createDocumentFragment();
        list.forEach(h => {
            const idAttr = this.escAttr(h.id);
            const cls = this.holidayChipClass(h.type);
            const card = document.createElement('article');
            card.className = 'tcard';
            card.dataset.recordId = h.id;
            card.dataset.recordMode = 'holiday';
            card.innerHTML = `
                <div class="tcard-row">
                    <div class="tcard-title">${this.sanitize(h.name)}</div>
                    <button type="button" class="hol-bell${h.alert !== false ? ' on' : ''}" data-action="holiday-alert-toggle" data-id="${idAttr}" title="Toggle alert">${h.alert !== false ? '🔔' : '🔕'}</button>
                </div>
                <div class="tcard-body">
                <div class="tcard-chips">
                    <span class="chip ${cls}">${this.sanitize(h.type)}</span>
                    <span class="chip">${this.formatDateStr(h.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                <div class="tcard-foot">
                    <span class="tcard-due">Next working: ${this.formatDateStr(h.nextWorkingDay, { day: 'numeric', month: 'short' })}</span>
                    <div class="tcard-actions">
                        <button type="button" class="btn-icon" data-action="holiday-edit" data-id="${idAttr}" title="Edit">${this.SVGS.edit}</button>
                        <button type="button" class="btn-icon bad" data-action="holiday-delete" data-id="${idAttr}" title="Delete">${this.SVGS.bin}</button>
                    </div>
                </div>
                </div>`;
            frag.appendChild(card);
        });
        box.appendChild(frag);
    },

    /* ---------- HOLIDAYS: ADD / EDIT / DELETE MODAL ---------- */
    openHolidayModal(id) {
        this.editingHolidayId = id || null;
        this.populateHolidayTypeFilter();

        const h = id ? this.holidays.find(x => String(x.id) === String(id)) : null;

        document.getElementById('holidayModalTitle').textContent = h ? 'Edit Holiday' : 'Add Holiday';
        document.getElementById('holDate').value = h ? h.date : '';
        document.getElementById('holName').value = h ? h.name : '';
        document.getElementById('holType').value = h ? h.type : '';
        const nextInput = document.getElementById('holNextWorking');
        nextInput.value = h ? h.nextWorkingDay : '';
        nextInput.dataset.userSet = h ? '1' : '0';
        document.getElementById('holAlert').checked = h ? h.alert !== false : true;
        document.getElementById('deleteHolidayBtn').style.display = h ? '' : 'none';

        document.getElementById('holidayModal').classList.add('open');
    },

    closeHolidayModal() {
        document.getElementById('holidayModal').classList.remove('open');
        this.editingHolidayId = null;
    },

    saveHolidayForm(e) {
        e.preventDefault();
        const date = document.getElementById('holDate').value;
        const name = document.getElementById('holName').value.trim();
        const type = document.getElementById('holType').value.trim();
        let nextWorking = document.getElementById('holNextWorking').value;
        const alert = document.getElementById('holAlert').checked;

        if (!date || !name || !type) { this.showToast('Date, name and calendar are required.', 'warning'); return; }
        if (!nextWorking) nextWorking = this.computeNextWorkingDay(date, type);

        if (this.editingHolidayId) {
            const h = this.holidays.find(x => String(x.id) === String(this.editingHolidayId));
            if (h) Object.assign(h, { date, name, type, nextWorkingDay: nextWorking, alert });
        } else {
            this.holidays.push({ id: this.newId(), date, name, type, nextWorkingDay: nextWorking, alert, custom: true });
        }

        this.saveHolidays();
        this.renderHolidays();
        this.closeHolidayModal();
        this.showToast('Holiday saved', 'success');
    },

    deleteHoliday(id) {
        if (!id) return;
        if (!confirm('Delete this holiday?')) return;
        this.holidays = this.holidays.filter(h => String(h.id) !== String(id));
        this.saveHolidays();
        this.renderHolidays();
        this.closeHolidayModal();
        this.showToast('Holiday deleted', 'info');
    },

    toggleHolidayAlert(id) {
        const h = this.holidays.find(x => String(x.id) === String(id));
        if (!h) return;
        h.alert = h.alert === false ? true : false;
        this.saveHolidays(false);
        this.renderHolidays();
    },

    /* ---------- HOLIDAYS: ALERTS ---------- */
    checkHolidayAlerts() {
        if (!this.holidays || !this.holidays.length) return;
        const todayStr = this.getLocalDateStr(new Date());
        const tomorrowStr = this.addDaysStr(todayStr, 1);

        let seen = {};
        try { seen = JSON.parse(localStorage.getItem('pureEnergyHolidayAlertSeen') || '{}'); } catch (e) { seen = {}; }
        if (seen.date !== todayStr) seen = { date: todayStr, ids: [] };

        const due = this.holidays.filter(h => h.alert !== false && (h.date === todayStr || h.date === tomorrowStr));
        due.forEach(h => {
            if (seen.ids.includes(h.id)) return;
            const when = h.date === todayStr ? 'today' : 'tomorrow';
            this.sendDesktopNotification('📅 ' + h.name, (h.type || 'Holiday') + ' — banks closed ' + when + '.', false, 'holiday-' + h.id);
            this.showToast(h.name + ' is ' + when + ' (' + h.type + ')', 'info');
            seen.ids.push(h.id);
        });

        if (due.length) localStorage.setItem('pureEnergyHolidayAlertSeen', JSON.stringify(seen));
    },

    renderRegister() {
        let filtered = this.tasks.filter(t => !t.deleted && !t.purged && t.status !== 'Completed');
        const search = document.getElementById('searchInput').value.toLowerCase();

        const catVals = this.getMultiValues('filterCategoryOpts');
        const priVals = this.getMultiValues('filterPriorityOpts');
        const statVals = this.getMultiValues('filterStatusOpts');
        const pend = document.getElementById('filterPending');
        const dueMode = document.getElementById('filterDue');

        pend.classList.toggle('active-filter', pend.value !== 'All');
        dueMode.classList.toggle('active-filter', dueMode.value !== 'All');

        filtered = filtered.filter(t => {
            const matchSearch = !search ||
                (t.description || '').toLowerCase().includes(search) ||
                (t.mailChain || '').toLowerCase().includes(search) ||
                (t.notes || '').toLowerCase().includes(search);
            const matchDue = dueMode.value === 'NoDue' ? !t.dueDate : (dueMode.value !== 'All' ? this.isDateInRange(t, dueMode.value) : true);
            const matchCat = catVals.includes('All') || catVals.includes(t.category);
            const matchPri = priVals.includes('All') || priVals.includes(t.priority);
            const matchStat = statVals.includes('All') || statVals.includes(t.status);
            return matchSearch && matchCat && matchPri && matchStat &&
                (pend.value === 'All' || t.pendingWith === pend.value) && matchDue;
        });

        filtered.sort((a, b) => this.compareTasks(a, b));

        document.getElementById('entriesShownText').textContent =
            `${filtered.length} of ${this.tasks.filter(t => !t.deleted && t.status !== 'Completed').length} entries shown`;
        this.renderTaskRows('taskTableBody', filtered, 'register');
        this.renderTaskCards('taskCardList', filtered, 'register');
    },

    renderCompleted() {
        let filtered = this.tasks.filter(t => !t.deleted && !t.purged && t.status === 'Completed');
        const search = document.getElementById('searchCompleted').value.toLowerCase();
        const catVals = this.getMultiValues('filterCategoryCompletedOpts');

        filtered = filtered.filter(t =>
            (!search || (t.description || '').toLowerCase().includes(search)) &&
            (catVals.includes('All') || catVals.includes(t.category))
        );

        filtered.sort((a, b) => this.compareTasks(a, b));

        document.getElementById('entriesCompletedText').textContent = `${filtered.length} completed entries`;
        this.renderTaskRows('completedTableBody', filtered, 'completed');
        this.renderTaskCards('completedCardList', filtered, 'completed');
    },

    renderBin() {
        let filtered = this.tasks.filter(t => t.deleted && !t.purged);
        filtered.sort((a, b) => this.compareTasks(a, b));
        document.getElementById('entriesBinText').textContent = `${filtered.length} entries in bin`;
        this.renderTaskRows('binTableBody', filtered, 'bin');
        this.renderTaskCards('binCardList', filtered, 'bin');
    },

    renderTaskRows(containerId, tasks, mode) {
        const tbody = document.getElementById(containerId);
        tbody.innerHTML = '';

        if (tasks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${mode === 'bin' ? 4 : (mode === 'completed' ? 5 : 8)}" style="text-align:center; padding:40px; color:var(--label-2);">No entries found.</td></tr>`;
            return;
        }

        const fragment = document.createDocumentFragment();

        tasks.forEach(t => {
            const row = document.createElement('tr');
            const idAttr = this.escAttr(t.id);
            row.dataset.recordId = t.id;
            row.dataset.recordMode = mode;
            if (this.selectMode && this.isSelected(t.id)) row.classList.add('is-selected');

            const recBadge = (t.recurrence && t.recurrence !== 'None')
                ? `<span class="rec-badge">${this.sanitize(t.recurrence)}</span>` : '';

            const mailChainHtml = t.mailChain ? `
                <div class="mailchain">
                    <span title="${this.escAttr(t.mailChain)}">${this.sanitize(t.mailChain)}</span>
                    <button type="button" class="btn-copy" data-action="copy-mail" data-id="${idAttr}"
                            title="Copy reference" aria-label="Copy reference">${this.SVGS.copy}</button>
                </div>` : '';

            const descHtml = `<div class="task-line" title="${this.escAttr(t.description)}">${this.sanitize(t.description)}${recBadge}</div>${mailChainHtml}`;
            const viewMailBtn = t.emailId
                ? `<button type="button" class="btn-icon go" data-action="open-mail" data-id="${idAttr}" title="Open Mail">${this.SVGS.mail}</button>` : '';

            if (mode === 'register') {
                const logDate = t.dateLogged ? this.formatDateStr(t.dateLogged, { day: 'numeric', month: 'short' }) : '-';
                let dueString = '-';

                if (t.dueDate) {
                    const dt = this.getTaskDueDateTime(t);
                    const isOverdue = dt && dt < new Date();
                    dueString = this.formatDateStr(t.dueDate, { day: 'numeric', month: 'short' });
                    if (t.dueTime) dueString += ` <span class="due-time">${this.formatTimeStr(t.dueTime)}</span>`;
                    if (isOverdue) dueString = `<span class="due-flag" title="Past its deadline">${dueString}</span>`;
                }

                const priorityVal = (t.priority || '').toString();
                const statusVal = (t.status || 'Pending').toString();

                row.innerHTML = `
                    <td class="td-clip">${logDate}</td>
                    <td class="td-task">${descHtml}</td>
                    <td class="td-clip${t.category ? '' : ' td-empty'}" title="${this.escAttr(t.category || '')}">${this.sanitize(t.category || '—')}</td>
                    <td class="td-clip"><span class="dot-priority dot-${this.escAttr(priorityVal.replace(/\s+/g, '-'))}"></span>${this.sanitize(priorityVal || '—')}</td>
                    <td class="td-clip"><span class="status-pill ${this.escAttr(statusVal.replace(/\s+/g, '-'))}" title="${this.escAttr(statusVal)}">${this.sanitize(statusVal)}</span></td>
                    <td class="td-clip${t.pendingWith ? '' : ' td-empty'}" title="${this.escAttr(t.pendingWith || '')}">${this.sanitize(t.pendingWith || '—')}</td>
                    <td class="due-text">${dueString}</td>
                    <td class="action-cell">
                        ${viewMailBtn}
                        <button type="button" class="btn-icon" data-action="edit" data-id="${idAttr}" title="Edit Task">${this.SVGS.edit}</button>
                        <button type="button" class="btn-icon ok" data-action="done" data-id="${idAttr}" title="Mark Done">${this.SVGS.done}</button>
                    </td>`;
            } else if (mode === 'completed') {
                row.innerHTML = `
                    <td class="td-clip">${this.formatDateStr(t.dateLogged, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td class="td-task">${descHtml}</td>
                    <td class="td-clip${t.category ? '' : ' td-empty'}" title="${this.escAttr(t.category || '')}">${this.sanitize(t.category || '—')}</td>
                    <td class="td-clip">${this.formatDateStr(t.completedDate || this.getLocalDateStr(new Date()))}</td>
                    <td class="action-cell">
                        ${viewMailBtn}
                        <button type="button" class="btn-icon warn" data-action="reopen" data-id="${idAttr}" title="Reopen Task">${this.SVGS.reopen}</button>
                        <button type="button" class="btn-icon bad" data-action="bin" data-id="${idAttr}" title="Move to Bin">${this.SVGS.bin}</button>
                    </td>`;
            } else {
                row.innerHTML = `
                    <td class="td-clip">${this.formatDateStr(t.dateDeleted || this.getLocalDateStr(new Date()))}</td>
                    <td class="td-task">${descHtml}</td>
                    <td class="td-clip${t.category ? '' : ' td-empty'}" title="${this.escAttr(t.category || '')}">${this.sanitize(t.category || '—')}</td>
                    <td class="action-cell">
                        <button type="button" class="btn-icon ok" data-action="restore" data-id="${idAttr}" title="Restore Task">${this.SVGS.restore}</button>
                        <button type="button" class="btn-icon bad" data-action="hard-delete" data-id="${idAttr}" title="Delete Permanently">${this.SVGS.bin}</button>
                    </td>`;
            }

            fragment.appendChild(row);
        });

        tbody.appendChild(fragment);
    },

    renderTaskCards(containerId, tasks, mode) {
        const box = document.getElementById(containerId);
        if (!box) return;
        box.innerHTML = '';

        if (tasks.length === 0) {
            const msg = mode === 'bin'
                ? ['Bin is empty', 'Deleted entries land here first.']
                : (mode === 'completed'
                    ? ['Nothing completed yet', 'Finished entries move here.']
                    : ['No tasks match', 'Clear the filters or add a new entry.']);
            box.innerHTML = `<div class="empty-state"><strong>${msg[0]}</strong><span>${msg[1]}</span></div>`;
            return;
        }

        const frag = document.createDocumentFragment();

        tasks.forEach(t => {
            const idAttr = this.escAttr(t.id);
            const card = document.createElement('article');
            card.className = 'tcard';
            card.dataset.recordId = t.id;
            card.dataset.recordMode = mode;
            if (this.selectMode && this.isSelected(t.id)) card.classList.add('is-selected');

            const chips = [];
            if (t.priority) chips.push(`<span class="chip pri-${this.escAttr(String(t.priority).replace(/\s+/g, '-'))}">${this.sanitize(t.priority)}</span>`);
            if (t.category) chips.push(`<span class="chip cat">${this.sanitize(t.category)}</span>`);
            if (t.recurrence && t.recurrence !== 'None') chips.push(`<span class="chip rec">${this.sanitize(t.recurrence)}</span>`);
            if (t.pendingWith) chips.push(`<span class="chip person">${this.sanitize(t.pendingWith)}</span>`);
            if (t.mailChain) chips.push(`<button type="button" class="chip mail" data-action="copy-mail" data-id="${idAttr}" title="${this.escAttr(t.mailChain)}">${this.SVGS.copy}<span class="chip-txt">${this.sanitize(t.mailChain)}</span></button>`);

            const mailBtn = t.emailId
                ? `<button type="button" class="btn-icon go" data-action="open-mail" data-id="${idAttr}" title="Open Mail">${this.SVGS.mail}</button>` : '';

            if (mode === 'register') {
                card.dataset.priority = (t.priority || '').toString();
                const dt = this.getTaskDueDateTime(t);
                const overdue = dt && dt < new Date();
                if (overdue) card.classList.add('is-overdue');

                let due = 'No due date';
                if (t.dueDate) {
                    due = this.formatDateStr(t.dueDate, { day: 'numeric', month: 'short' });
                    if (t.dueTime) due += ' · ' + this.formatTimeStr(t.dueTime);
                    if (overdue) due = '⚠ ' + due;
                }

                const statusVal = (t.status || 'Pending').toString();
                card.innerHTML = `
                    <div class="tcard-row">
                        <div class="tcard-title">${this.sanitize(t.description)}</div>
                        <span class="status-pill ${this.escAttr(statusVal.replace(/\s+/g, '-'))}">${this.sanitize(statusVal)}</span>
                    </div>
                    <div class="tcard-body">
                    <div class="tcard-chips">${chips.join('')}</div>
                    <div class="tcard-foot">
                        <span class="tcard-due${overdue ? ' overdue' : ''}">${due}</span>
                        <div class="tcard-actions">
                            ${mailBtn}
                            <button type="button" class="btn-icon" data-action="edit" data-id="${idAttr}" title="Edit Task">${this.SVGS.edit}</button>
                            <button type="button" class="btn-icon ok" data-action="done" data-id="${idAttr}" title="Mark Done">${this.SVGS.done}</button>
                        </div>
                    </div>
                    </div>`;
            } else if (mode === 'completed') {
                card.innerHTML = `
                    <div class="tcard-title">${this.sanitize(t.description)}</div>
                    <div class="tcard-body">
                    <div class="tcard-chips">${chips.join('')}</div>
                    <div class="tcard-foot">
                        <span class="tcard-due">Completed ${this.formatDateStr(t.completedDate || this.getLocalDateStr(new Date()), { day: 'numeric', month: 'short' })}</span>
                        <div class="tcard-actions">
                            ${mailBtn}
                            <button type="button" class="btn-icon warn" data-action="reopen" data-id="${idAttr}" title="Reopen Task">${this.SVGS.reopen}</button>
                            <button type="button" class="btn-icon bad" data-action="bin" data-id="${idAttr}" title="Move to Bin">${this.SVGS.bin}</button>
                        </div>
                    </div>
                    </div>`;
            } else {
                card.innerHTML = `
                    <div class="tcard-title">${this.sanitize(t.description)}</div>
                    <div class="tcard-body">
                    <div class="tcard-chips">${chips.join('')}</div>
                    <div class="tcard-foot">
                        <span class="tcard-due">Deleted ${this.formatDateStr(t.dateDeleted || this.getLocalDateStr(new Date()), { day: 'numeric', month: 'short' })}</span>
                        <div class="tcard-actions">
                            <button type="button" class="btn-icon ok" data-action="restore" data-id="${idAttr}" title="Restore Task">${this.SVGS.restore}</button>
                            <button type="button" class="btn-icon bad" data-action="hard-delete" data-id="${idAttr}" title="Delete Permanently">${this.SVGS.bin}</button>
                        </div>
                    </div>
                    </div>`;
            }

            frag.appendChild(card);
        });

        box.appendChild(frag);
    },


    /* ---------- WHOLE-RECORD TAP TO EDIT ---------- */
    handleRecordClick(e) {
        // A swipe ends in a click event; don't open the editor on the way out.
        if (this._swipeAt && Date.now() - this._swipeAt < 500) return;

        // Ignore anything that is already interactive in its own right.
        if (e.target.closest('a, button, input, textarea, select, label, .col-resize, .ms-options, .modal, #sortMenuPanel')) return;

        // Ignore a click that was really the end of a text selection / drag.
        const sel = window.getSelection && window.getSelection();
        if (sel && String(sel).trim().length > 2) return;

        const host = e.target.closest('tr[data-record-id], .tcard[data-record-id]');
        if (!host) return;

        const mode = host.dataset.recordMode;

        if (mode === 'holiday') { this.openHolidayModal(host.dataset.recordId); return; }

        if (this.selectMode) { this.toggleSelect(host.dataset.recordId); return; }

        if (mode === 'bin') {
            this.showToast('Restore this entry before editing it.', 'info');
            return;
        }
        this.openTaskModal(host.dataset.recordId);
    },

    /* ---------- TASK MODAL & CRUD ---------- */
    setSelectValue(elId, val) {
        const el = document.getElementById(elId);
        if (!el) return;
        const v = (val === undefined || val === null) ? '' : String(val);
        if (v && !Array.from(el.options).some(o => o.value === v)) el.add(new Option(v, v));
        el.value = v;
    },

    openTaskModal(id = null, emailIdForNew = null) {
        const modal = document.getElementById('taskModal');
        const form = document.getElementById('taskForm');
        if (!modal || !form) return;

        this.populateDropdowns();
        form.reset();

        const delBtn = document.getElementById('deleteTaskBtn');
        const mailBtn = document.getElementById('viewOriginalEmailBtn');
        const hasId = id !== null && id !== undefined && id !== '';

        if (hasId) {
            const t = this.findTask(id);
            if (!t) { this.showToast('That entry is no longer available.', 'warning'); return; }

            this.editingId = String(t.id);
            this.storedEmailId = t.emailId || null;

            document.getElementById('modalTitle').textContent = 'Edit Entry';
            document.getElementById('taskDescription').value = t.description || '';
            this.setSelectValue('taskCategory', t.category || '');
            this.setSelectValue('taskPriority', t.priority || '');
            this.setSelectValue('taskStatus', t.status || '');
            this.setSelectValue('taskPendingWith', t.pendingWith || '');
            document.getElementById('taskDueDate').value = t.dueDate || '';
            document.getElementById('taskDueTime').value = t.dueTime || '';
            document.getElementById('taskMailChain').value = t.mailChain || '';
            document.getElementById('taskRecurrence').value = t.recurrence || 'None';
            document.getElementById('taskNotes').value = t.notes || '';
            if (delBtn) delBtn.style.display = t.deleted ? 'none' : '';
        } else {
            this.editingId = null;
            this.storedEmailId = emailIdForNew || null;

            document.getElementById('modalTitle').textContent = 'New Entry';
            const pri = this.lists.priorities.indexOf('Medium') !== -1 ? 'Medium' : (this.lists.priorities[0] || '');
            const stat = this.lists.statuses.indexOf('Pending') !== -1 ? 'Pending' : (this.lists.statuses[0] || '');
            this.setSelectValue('taskPriority', pri);
            this.setSelectValue('taskStatus', stat);
            document.getElementById('taskRecurrence').value = 'None';
            if (delBtn) delBtn.style.display = 'none';
        }

        if (mailBtn) mailBtn.style.display = this.storedEmailId ? '' : 'none';
        this.checkDueHoliday();
        this.checkSlotAvailability();

        modal.classList.add('open');
        setTimeout(() => { const d = document.getElementById('taskDescription'); if (d) d.focus(); }, 80);
    },

    closeTaskModal() {
        const modal = document.getElementById('taskModal');
        if (modal) modal.classList.remove('open');
        const hint = document.getElementById('dueHolidayHint');
        if (hint) { hint.style.display = 'none'; hint.innerHTML = ''; }
        const slotHint = document.getElementById('dueSlotHint');
        if (slotHint) { slotHint.style.display = 'none'; slotHint.innerHTML = ''; slotHint.classList.remove('clash', 'ok'); }
        const form = document.getElementById('taskForm');
        if (form) form.reset();
        this.editingId = null;
        this.storedEmailId = null;
    },

    saveTask(e) {
        if (e && e.preventDefault) e.preventDefault();

        const desc = document.getElementById('taskDescription').value.trim();
        if (!desc) { this.showToast('Please enter a task description.', 'warning'); return; }

        const fields = {
            description: desc,
            category: document.getElementById('taskCategory').value,
            priority: document.getElementById('taskPriority').value,
            status: document.getElementById('taskStatus').value || 'Pending',
            pendingWith: document.getElementById('taskPendingWith').value,
            dueDate: document.getElementById('taskDueDate').value,
            dueTime: document.getElementById('taskDueTime').value,
            mailChain: document.getElementById('taskMailChain').value.trim(),
            recurrence: document.getElementById('taskRecurrence').value || 'None',
            notes: document.getElementById('taskNotes').value,
            updatedAt: Date.now()
        };

        const clash = this.slotClash(fields.dueDate, fields.dueTime, this.editingId);
        if (clash) {
            const free = this.nextFreeTime(fields.dueDate, fields.dueTime, this.editingId);
            this.checkSlotAvailability();
            this.showToast(
                '"' + clash.description + '" already holds ' + this.formatTimeStr(clash.dueTime) + '.',
                'warning',
                free ? { label: 'Use ' + this.formatTimeStr(free), onClick: () => this.useSlotTime(free) } : null
            );
            return;
        }

        const todayStr = this.getLocalDateStr(new Date());
        const editing = !!this.editingId;

        if (editing) {
            const task = this.findTask(this.editingId);
            if (!task) { this.showToast('That entry is no longer available.', 'error'); this.closeTaskModal(); return; }

            const dueChanged = (task.dueDate || '') !== fields.dueDate || (task.dueTime || '') !== fields.dueTime;
            Object.assign(task, fields);
            if (dueChanged) { task.lastAckDate = null; task.snoozeUntil = null; }
            if (this.storedEmailId) task.emailId = this.storedEmailId;

            if (task.status === 'Completed') {
                if (!task.completedDate) task.completedDate = todayStr;
            } else {
                task.completedDate = null;
            }
        } else {
            const task = Object.assign({
                id: this.newId(),
                dateLogged: todayStr,
                deleted: false,
                purged: false,
                completedDate: null,
                lastAckDate: null,
                snoozeUntil: null,
                emailId: this.storedEmailId || null
            }, fields);
            if (task.status === 'Completed') task.completedDate = todayStr;
            this.tasks.push(task);
        }

        this.closeTaskModal();
        this.saveData();
        this.renderTable();
        this.processEngine();
        this.showToast(editing ? 'Entry updated.' : 'Entry added.', 'success');
        this.syncToGoogleSheets();
    },

    binCurrentTask() {
        if (!this.editingId) { this.closeTaskModal(); return; }
        const id = this.editingId;
        this.closeTaskModal();
        this.softDelete(id);
    },

    nextOccurrence(t) {
        if (!t.recurrence || t.recurrence === 'None' || !t.dueDate) return null;

        const parts = String(t.dueDate).split('-').map(Number);
        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;

        const next = new Date(parts[0], parts[1] - 1, parts[2]);
        if (t.recurrence === 'Daily') next.setDate(next.getDate() + 1);
        else if (t.recurrence === 'Weekly') next.setDate(next.getDate() + 7);
        else if (t.recurrence === 'Monthly') next.setMonth(next.getMonth() + 1);
        else return null;

        const nextDue = this.getLocalDateStr(next);
        const seriesId = t.seriesId || String(t.id);

        // Don't spawn a second copy if this occurrence already exists.
        const exists = this.tasks.some(x => !x.purged && String(x.seriesId || '') === seriesId && x.dueDate === nextDue);
        if (exists) return null;

        const statusVal = this.lists.statuses.indexOf('Pending') !== -1 ? 'Pending' : (this.lists.statuses[0] || 'Pending');

        return Object.assign({}, t, {
            id: this.newId(),
            seriesId: seriesId,
            status: statusVal,
            dueDate: nextDue,
            dateLogged: this.getLocalDateStr(new Date()),
            completedDate: null,
            dateDeleted: null,
            deleted: false,
            purged: false,
            lastAckDate: null,
            snoozeUntil: null,
            updatedAt: Date.now()
        });
    },

    markComplete(id) {
        const t = this.findTask(id);
        if (!t) return;

        t.status = 'Completed';
        t.completedDate = this.getLocalDateStr(new Date());
        t.lastAckDate = null;
        t.snoozeUntil = null;
        t.updatedAt = Date.now();

        const repeat = this.nextOccurrence(t);
        if (repeat) {
            if (!t.seriesId) t.seriesId = repeat.seriesId;
            this.tasks.push(repeat);
        }

        this.saveData();
        this.renderTable();
        this.processEngine();
        this.showToast(
            repeat ? 'Done — next occurrence scheduled.' : 'Marked complete.',
            'success',
            { label: 'Undo', onClick: () => this.undoComplete(id, repeat ? repeat.id : null) }
        );
        this.syncToGoogleSheets();
    },

    undoComplete(id, spawnedId) {
        if (spawnedId) {
            const spawned = this.findTask(spawnedId);
            // Only drop the auto-created occurrence if it is still untouched.
            if (spawned && !spawned.completedDate && !spawned.deleted) {
                this.tasks = this.tasks.filter(t => String(t.id) !== String(spawnedId));
            }
        }
        this.reopenTask(id);
    },

    reopenTask(id) {
        const t = this.findTask(id);
        if (!t) return;

        t.status = this.lists.statuses.indexOf('Pending') !== -1 ? 'Pending' : (this.lists.statuses[0] || 'Pending');
        t.completedDate = null;
        t.lastAckDate = null;
        t.snoozeUntil = null;
        t.updatedAt = Date.now();

        this.saveData();
        this.renderTable();
        this.processEngine();
        this.showToast('Entry reopened.', 'success');
        this.syncToGoogleSheets();
    },

    softDelete(id) {
        const t = this.findTask(id);
        if (!t) return;

        t.deleted = true;
        t.dateDeleted = this.getLocalDateStr(new Date());
        t.updatedAt = Date.now();

        this.alarmingTasks = this.alarmingTasks.filter(a => String(a.id) !== String(id));
        if (this.alarmingTasks.length === 0 && this.isAlarming) this.stopPersistentAlarm(false);

        this.saveData();
        this.renderTable();
        this.showToast('Moved to Bin.', 'success', { label: 'Undo', onClick: () => this.restoreTask(id) });
        this.syncToGoogleSheets();
    },

    restoreTask(id) {
        const t = this.findTask(id);
        if (!t) return;

        t.deleted = false;
        t.dateDeleted = null;
        t.updatedAt = Date.now();

        this.saveData();
        this.renderTable();
        this.processEngine();
        this.showToast('Entry restored.', 'success');
        this.syncToGoogleSheets();
    },

    hardDelete(id) {
        const t = this.findTask(id);
        if (!t) return;
        if (!confirm('Delete this entry permanently? This cannot be undone.')) return;

        t.deleted = true;
        t.purged = true;
        t.updatedAt = Date.now();

        this.saveData();
        this.renderTable();
        this.showToast('Entry deleted permanently.', 'success');
        this.syncToGoogleSheets();
    },

    findDuplicates() {
        const active = this.tasks.filter(t => !t.deleted && !t.purged);
        const groups = new Map();

        active.forEach(t => {
            const desc = (t.description || '').trim().toLowerCase().replace(/\s+/g, ' ');
            if (!desc) return;
            const key = desc + '||' + (t.category || '').trim().toLowerCase();
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(t);
        });

        const dupes = Array.from(groups.values()).filter(g => g.length > 1);
        if (dupes.length === 0) { this.showToast('No duplicate entries found.', 'success'); return; }

        const extra = dupes.reduce((sum, g) => sum + g.length - 1, 0);
        const msg = 'Found ' + extra + ' duplicate ' + (extra === 1 ? 'copy' : 'copies') +
            ' across ' + dupes.length + ' ' + (dupes.length === 1 ? 'task' : 'tasks') +
            '.\n\nMove the older copies to the Bin and keep the most recent of each?';
        if (!confirm(msg)) return;

        const todayStr = this.getLocalDateStr(new Date());
        dupes.forEach(g => {
            g.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
            g.slice(1).forEach(t => {
                t.deleted = true;
                t.dateDeleted = todayStr;
                t.updatedAt = Date.now();
            });
        });

        this.saveData();
        this.renderTable();
        this.showToast(extra + ' duplicate ' + (extra === 1 ? 'copy' : 'copies') + ' moved to the Bin.', 'success');
        this.syncToGoogleSheets();
    },

    /* ---------- DASHBOARD ---------- */
    DASH_PALETTE: ['#007aff', '#34c759', '#ff9500', '#af52de', '#5ac8fa', '#ff2d55', '#30b0c7', '#ffcc00'],

    dashPriorityColour(name) {
        const n = String(name).toLowerCase();
        if (n.indexOf('critical') !== -1 || n.indexOf('urgent') !== -1 || n.indexOf('high') !== -1) return 'var(--red)';
        if (n.indexOf('medium') !== -1 || n.indexOf('normal') !== -1) return 'var(--amber)';
        if (n.indexOf('low') !== -1) return 'var(--green)';
        return 'var(--slate)';
    },

    dashStatusColour(name) {
        const n = String(name).toLowerCase();
        if (n.indexOf('progress') !== -1) return 'var(--amber)';
        if (n.indexOf('hold') !== -1 || n.indexOf('block') !== -1 || n.indexOf('reject') !== -1) return 'var(--red)';
        if (n.indexOf('complete') !== -1 || n.indexOf('done') !== -1 || n.indexOf('closed') !== -1) return 'var(--green)';
        if (n.indexOf('pending') !== -1 || n.indexOf('open') !== -1 || n.indexOf('new') !== -1) return 'var(--blue)';
        return 'var(--violet)';
    },

    // Returns [label, count, rawValue] sorted by count. rawValue is '' for blanks,
    // which the chart renders as a non-clickable row.
    dashGroup(tasks, field, blankLabel, order) {
        const map = new Map();
        tasks.forEach(t => {
            const raw = (t[field] === undefined || t[field] === null) ? '' : String(t[field]).trim();
            const key = raw || '\u0000blank';
            if (!map.has(key)) map.set(key, { label: raw || blankLabel, raw: raw, n: 0 });
            map.get(key).n++;
        });

        const rank = (o) => {
            if (!order) return null;
            const i = order.indexOf(o.raw);
            return i === -1 ? order.length + (o.raw ? 0 : 1) : i;
        };

        return Array.from(map.values())
            .sort((a, b) => {
                if (order) {
                    const d = rank(a) - rank(b);
                    if (d !== 0) return d;
                }
                return b.n - a.n || a.label.localeCompare(b.label);
            })
            .map(o => [o.label, o.n, o.raw]);
    },

    dashTile(cfg) {
        return '' +
            '<button type="button" class="stat-tile" style="--tint:' + cfg.colour + '"' +
            ' data-action="dash-filter" data-ftype="' + this.escAttr(cfg.ftype) + '"' +
            ' data-fvalue="' + this.escAttr(cfg.fvalue) + '" title="Show these in Tasks">' +
            '<span class="stat-num">' + cfg.count + '</span>' +
            '<span class="stat-label">' + this.sanitize(cfg.title) + '</span>' +
            '<span class="stat-sub">' + this.sanitize(cfg.sub) + '</span>' +
            '</button>';
    },

    dashHolidayTile() {
        const todayStr = this.getLocalDateStr(new Date());
        const in7 = this.addDaysStr(todayStr, 7);
        const upcoming = (this.holidays || [])
            .filter(h => h.date >= todayStr && h.date <= in7)
            .sort((a, b) => a.date.localeCompare(b.date));

        const sub = upcoming.length
            ? upcoming.slice(0, 2).map(h => h.name).join(', ') + (upcoming.length > 2 ? '…' : '')
            : 'Nothing coming up';

        return '' +
            '<button type="button" class="stat-tile" style="--tint:var(--green)"' +
            ' data-action="dash-holidays" data-fvalue="Next7Days" title="View in Holidays">' +
            '<span class="stat-num">' + upcoming.length + '</span>' +
            '<span class="stat-label">Holidays (7d)</span>' +
            '<span class="stat-sub">' + this.sanitize(sub) + '</span>' +
            '</button>';
    },

    dashSection(cfg) {
        const head = '<h3>' + this.sanitize(cfg.title) +
            (cfg.rows.length ? '<b>' + cfg.total + ' open</b>' : '') + '</h3>';

        if (!cfg.rows.length) {
            return '<section class="dash-section">' + head +
                '<div class="dash-none">' + this.sanitize(cfg.empty) + '</div></section>';
        }

        const tiles = cfg.rows.map((r, i) => {
            const colour = cfg.colourFor ? cfg.colourFor(r[0], i) : this.DASH_PALETTE[i % this.DASH_PALETTE.length];
            const clickable = r[2] !== '';
            const attrs = clickable
                ? ' data-action="dash-filter" data-ftype="' + this.escAttr(cfg.ftype) + '" data-fvalue="' + this.escAttr(r[2]) + '"'
                : '';
            return '<button type="button" class="mini-tile' + (clickable ? '' : ' is-static') + '"' +
                ' style="--tint:' + colour + '"' + attrs + ' title="' + this.escAttr(r[0]) + '">' +
                '<span class="mini-name">' + this.sanitize(r[0]) + '</span>' +
                '<span class="mini-num">' + r[1] + '</span>' +
                '</button>';
        }).join('');

        return '<section class="dash-section">' + head + '<div class="mini-grid">' + tiles + '</div></section>';
    },

    renderDashboard() {
        const heroBox = document.getElementById('dashHero');
        const chartBox = document.getElementById('dashCharts');
        const greetBox = document.getElementById('dashGreeting');
        if (!heroBox || !chartBox) return;

        const live = this.tasks.filter(t => !t.deleted && !t.purged);

        const open = live.filter(t => t.status !== 'Completed');
        const done = live.filter(t => t.status === 'Completed');

        const overdue = open.filter(t => this.isDateInRange(t, 'Overdue'));
        const dueToday = open.filter(t => this.isDateInRange(t, 'Today'));
        const next7 = open.filter(t => this.isDateInRange(t, 'Next7Days'));
        const thisMonth = open.filter(t => this.isDateInRange(t, 'ThisMonth'));
        const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });
        const noDue = open.filter(t => !t.dueDate);

        /* ---- greeting ---- */
        if (greetBox) {
            const hr = new Date().getHours();
            const part = hr < 12 ? 'Good morning' : (hr < 17 ? 'Good afternoon' : 'Good evening');
            const who = (this.currentUser && this.currentUser !== 'default') ? ', ' + this.sanitize(this.currentUser) : '';

            let line;
            if (open.length === 0) {
                line = done.length
                    ? 'Nothing open — ' + done.length + ' ' + (done.length === 1 ? 'entry is' : 'entries are') + ' already done.'
                    : 'Nothing logged yet. Add your first entry from the Tasks tab.';
            } else {
                const bits = [];
                if (overdue.length) bits.push('<b>' + overdue.length + '</b> past the deadline');
                if (dueToday.length) bits.push('<b>' + dueToday.length + '</b> due today');
                if (next7.length) bits.push('<b>' + next7.length + '</b> in the next 7 days');
                line = 'You have <b>' + open.length + '</b> open ' + (open.length === 1 ? 'entry' : 'entries') +
                    (bits.length ? ' — ' + bits.join(', ') : '') + '.';
            }
            greetBox.innerHTML = '<div class="greet-top"><h1>' + part + who + '</h1>' +
                '<span class="greet-hint">Tap any card to open it in Tasks</span></div><p>' + line + '</p>';
        }

        /* ---- due-date cards ---- */
        heroBox.innerHTML = [
            this.dashTile({
                title: 'Due Today', count: dueToday.length, colour: 'var(--blue)',
                ftype: 'due', fvalue: 'Today',
                sub: dueToday.length ? 'On the clock' : 'Nothing due'
            }),
            this.dashTile({
                title: 'Overdue', count: overdue.length, colour: 'var(--red)',
                ftype: 'due', fvalue: 'Overdue',
                sub: overdue.length ? 'Needs attention' : 'All clear'
            }),
            this.dashTile({
                title: 'Next 7 Days', count: next7.length, colour: 'var(--amber)',
                ftype: 'due', fvalue: 'Next7Days',
                sub: next7.length ? 'Coming up' : 'Week is clear'
            }),
            this.dashTile({
                title: 'This Month', count: thisMonth.length, colour: 'var(--violet)',
                ftype: 'due', fvalue: 'ThisMonth',
                sub: thisMonth.length ? 'Due in ' + monthName : 'Nothing in ' + monthName
            }),
            this.dashTile({
                title: 'No Due Date', count: noDue.length, colour: 'var(--slate)',
                ftype: 'due', fvalue: 'NoDue',
                sub: noDue.length ? 'Needs a deadline' : 'All dated'
            }),
            this.dashHolidayTile()
        ].join('');

        /* ---- breakdowns, as small tiles ---- */
        const total = open.length;
        chartBox.innerHTML = [
            this.dashSection({
                title: 'By Category', ftype: 'category', total: total,
                rows: this.dashGroup(open, 'category', 'Uncategorised'),
                empty: 'Nothing open to break down.'
            }),
            this.dashSection({
                title: 'By Status', ftype: 'status', total: total,
                rows: this.dashGroup(open, 'status', 'No status', this.lists.statuses),
                colourFor: (name) => this.dashStatusColour(name),
                empty: 'Nothing open to break down.'
            }),
            this.dashSection({
                title: 'By Priority', ftype: 'priority', total: total,
                rows: this.dashGroup(open, 'priority', 'No priority', this.lists.priorities),
                colourFor: (name) => this.dashPriorityColour(name),
                empty: 'Nothing open to break down.'
            }),
            this.dashSection({
                title: 'Pending Assignments', ftype: 'pending', total: total,
                rows: this.dashGroup(open, 'pendingWith', 'Unassigned'),
                empty: 'Set "Pending With" to see who owes what.'
            })
        ].join('');
    },

    filterFromDashboard(ftype, fvalue) {
        if (!ftype) return;

        this.clearFilters(true);

        if (ftype === 'due') {
            document.getElementById('filterDue').value = fvalue;
        } else if (ftype === 'category') {
            this.setMultiValue('filterCategoryOpts', fvalue);
        } else if (ftype === 'status') {
            this.setMultiValue('filterStatusOpts', fvalue);
        } else if (ftype === 'priority') {
            this.setMultiValue('filterPriorityOpts', fvalue);
        } else if (ftype === 'pending') {
            const pend = document.getElementById('filterPending');
            if (!Array.from(pend.options).some(o => o.value === fvalue)) pend.add(new Option(fvalue, fvalue));
            pend.value = fvalue;
        }

        this.switchTab('Register');

        const labels = { due: 'Due', category: 'Category', status: 'Status', priority: 'Priority', pending: 'Pending with' };
        const pretty = { Today: 'Due today', Overdue: 'Overdue', Next7Days: 'Next 7 days', ThisMonth: 'This month', NoDue: 'No due date' };
        this.showToast((labels[ftype] || ftype) + ': ' + (pretty[fvalue] || fvalue), 'info');
    },


    /* ---------- TABLE vs CARD VIEW (mobile and desktop together) ---------- */
    VIEW_KEY: 'pureEnergyView',
    viewMode: 'auto',

    /* Which shell to wear: 'mobile' puts the tabs in a floating bar at the
       bottom, 'desktop' keeps them inline in the header. Decided by the device
       alone — never by the table/card toggle, so you can read a table on a
       phone and still get bottom tabs. */
    resolvedShell() {
        if (typeof window.__shell === 'function') return window.__shell();
        const w = window.innerWidth || 1024;
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (w <= 900) return 'mobile';
        if (coarse && w <= 1180) return 'mobile';
        return 'desktop';
    },

    applyShell() {
        const shell = this.resolvedShell();
        document.documentElement.setAttribute('data-shell', shell);
        return shell;
    },

    resolvedView() {
        if (this.viewMode === 'cards' || this.viewMode === 'table') return this.viewMode;
        return this.resolvedShell() === 'mobile' ? 'cards' : 'table';
    },

    applyViewMode() {
        const view = this.resolvedView();
        if (document.body.dataset.view === view) return view;
        document.body.dataset.view = view;
        document.querySelectorAll('.view-toggle').forEach(btn => {
            btn.textContent = view === 'cards' ? '\u25a6' : '\u2630';
            btn.title = view === 'cards' ? 'Card view — tap for the table' : 'Table view — tap for cards';
        });
        return view;
    },

    toggleViewMode() {
        this.viewMode = this.resolvedView() === 'cards' ? 'table' : 'cards';
        localStorage.setItem(this.VIEW_KEY, this.viewMode);
        this.applyViewMode();
        this.renderTable();
        this.showToast(this.viewMode === 'cards' ? 'Card view' : 'Table view', 'info');
    },

    initViewMode() {
        const saved = localStorage.getItem(this.VIEW_KEY);
        this.viewMode = (saved === 'cards' || saved === 'table') ? saved : 'auto';
        this.applyShell();
        this.applyViewMode();

        let t = null;
        const onResize = () => {
            clearTimeout(t);
            t = setTimeout(() => {
                this.applyShell();
                if (this.viewMode !== 'auto') return;
                const before = document.body.dataset.view;
                if (this.applyViewMode() !== before) this.renderTable();
            }, 180);
        };
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
    },

    /* ---------- SWIPE A CARD: RIGHT = DONE, LEFT = BIN ---------- */
    initCardSwipe() {
        let card = null, startX = 0, startY = 0, dx = 0, axis = null;

        document.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            const el = e.target.closest('.card-list .tcard[data-record-id]');
            if (!el || el.dataset.recordMode !== 'register') return;
            if (e.target.closest('button, a, input, select, textarea')) return;
            card = el; startX = e.touches[0].clientX; startY = e.touches[0].clientY;
            dx = 0; axis = null;
            card.style.transition = 'none';
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!card || e.touches.length !== 1) return;
            dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;

            if (axis === null) {
                if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
                axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            }
            if (axis !== 'x') return;

            this._swipeAt = Date.now();
            const capped = Math.max(-150, Math.min(150, dx));
            card.style.transform = 'translateX(' + capped + 'px)';
            card.classList.toggle('swipe-done', capped > 62);
            card.classList.toggle('swipe-bin', capped < -62);
        }, { passive: true });

        const release = () => {
            if (!card) return;
            const el = card, moved = dx, wasX = axis === 'x';
            card = null; axis = null;

            el.style.transition = '';
            el.style.transform = '';
            el.classList.remove('swipe-done', 'swipe-bin');
            if (!wasX) return;

            if (moved > 95) this.markComplete(el.dataset.recordId);
            else if (moved < -95) this.softDelete(el.dataset.recordId);
        };
        document.addEventListener('touchend', release, { passive: true });
        document.addEventListener('touchcancel', release, { passive: true });
    },

    /* ---------- BIN HOUSEKEEPING ---------- */
    BIN_KEEP_DAYS: 30,

    purgeOldBin() {
        const cutoff = Date.now() - (this.BIN_KEEP_DAYS * 86400000);
        let cleared = 0;

        this.tasks.forEach(t => {
            if (!t.deleted || t.purged || !t.dateDeleted) return;
            const p = String(t.dateDeleted).split('-').map(Number);
            if (p.length < 3 || !p[0] || !p[1] || !p[2]) return;
            if (new Date(p[0], p[1] - 1, p[2]).getTime() >= cutoff) return;
            t.purged = true;
            t.updatedAt = Date.now();
            cleared++;
        });

        if (cleared > 0) {
            this.saveData();
            this.showToast(cleared + ' bin ' + (cleared === 1 ? 'entry' : 'entries') +
                ' older than ' + this.BIN_KEEP_DAYS + ' days cleared out.', 'info');
        }
        return cleared;
    },

    /* ---------- BANK-HOLIDAY AWARE DUE DATES ---------- */
    holidayOn(dateStr) {
        if (!dateStr) return null;
        return this.holidays.find(h => h.date === dateStr) || null;
    },

    checkDueHoliday() {
        const hint = document.getElementById('dueHolidayHint');
        if (!hint) return;

        const input = document.getElementById('taskDueDate');
        const holiday = this.holidayOn(input ? input.value : '');

        if (!holiday) { hint.style.display = 'none'; hint.innerHTML = ''; return; }

        const next = holiday.nextWorkingDay;
        hint.innerHTML = '<span>' + this.sanitize(holiday.name) + ' — banks are closed that day.</span>' +
            (next ? '<button type="button" onclick="app.useNextWorkingDay(\'' + this.escAttr(next) +
                '\')">Move to ' + this.formatDateStr(next, { day: 'numeric', month: 'short' }) + '</button>' : '');
        hint.style.display = 'flex';
    },

    useNextWorkingDay(dateStr) {
        const input = document.getElementById('taskDueDate');
        if (input) input.value = dateStr;
        this.checkDueHoliday();
    },

    /* ---------- TIME SLOTS ----------
       A task with a due time holds the clock for the next few minutes, so two
       jobs can't be booked on top of each other. Window length set in Config. */
    SLOT_KEY: 'pureEnergySlotCfg',
    SLOT_DEFAULTS: { on: true, minutes: 10 },

    slotCfg() {
        let saved = {};
        try {
            const raw = JSON.parse(localStorage.getItem(this.SLOT_KEY) || '{}');
            if (raw && typeof raw === 'object') saved = raw;
        } catch (e) {}
        const cfg = Object.assign({}, this.SLOT_DEFAULTS, saved);
        cfg.minutes = Math.max(1, Math.min(240, Number(cfg.minutes) || this.SLOT_DEFAULTS.minutes));
        return cfg;
    },

    saveSlotCfg(patch) {
        const cfg = Object.assign(this.slotCfg(), patch || {});
        localStorage.setItem(this.SLOT_KEY, JSON.stringify(cfg));
        this.renderSlotSettings();
        this.checkSlotAvailability();
        return cfg;
    },

    toggleSlots() {
        const cfg = this.saveSlotCfg({ on: !this.slotCfg().on });
        this.showToast(cfg.on ? 'Slot holding on' : 'Slot holding off', 'info');
    },

    // The task already holding this date and time, if any.
    slotClash(dateStr, timeStr, ignoreId) {
        const cfg = this.slotCfg();
        if (!cfg.on || !dateStr || !timeStr) return null;
        const want = this.nudgeToMinutes(timeStr, -1);
        if (want < 0) return null;

        return this.tasks.find(t => {
            if (!t || t.deleted || t.purged || t.status === 'Completed') return false;
            if (ignoreId && String(t.id) === String(ignoreId)) return false;
            if ((t.dueDate || '') !== dateStr || !t.dueTime) return false;
            const held = this.nudgeToMinutes(t.dueTime, -1);
            if (held < 0) return false;
            return Math.abs(held - want) < cfg.minutes;
        }) || null;
    },

    // First time from this one onwards where nothing else is booked.
    nextFreeTime(dateStr, timeStr, ignoreId) {
        const cfg = this.slotCfg();
        let mins = this.nudgeToMinutes(timeStr, -1);
        if (mins < 0) return null;
        for (let guard = 0; guard < 300; guard++) {
            const clash = this.slotClash(dateStr, this.nudgeToClock(mins), ignoreId);
            if (!clash) return this.nudgeToClock(mins);
            mins = this.nudgeToMinutes(clash.dueTime, mins) + cfg.minutes;
            if (mins > 1439) return null;
        }
        return null;
    },

    // Live hint under the due date and time in the task modal.
    checkSlotAvailability() {
        const hint = document.getElementById('dueSlotHint');
        if (!hint) return;

        const dateEl = document.getElementById('taskDueDate');
        const timeEl = document.getElementById('taskDueTime');
        const dateStr = dateEl ? dateEl.value : '';
        const timeStr = timeEl ? timeEl.value : '';
        const cfg = this.slotCfg();

        const clash = this.slotClash(dateStr, timeStr, this.editingId);
        if (!clash) {
            hint.classList.remove('clash');
            hint.classList.add('ok');
            if (!cfg.on || !dateStr || !timeStr) { hint.style.display = 'none'; hint.innerHTML = ''; return; }
            hint.innerHTML = '<span>Slot free — this entry holds ' + this.formatTimeStr(timeStr) +
                ' to ' + this.formatTimeStr(this.nudgeToClock(this.nudgeToMinutes(timeStr, 0) + cfg.minutes)) + '.</span>';
            hint.style.display = 'flex';
            return;
        }

        const free = this.nextFreeTime(dateStr, timeStr, this.editingId);
        hint.classList.remove('ok');
        hint.classList.add('clash');
        hint.innerHTML = '<span>' + this.sanitize(clash.description) + ' already holds ' +
            this.formatTimeStr(clash.dueTime) + '.</span>' +
            (free ? '<button type="button" onclick="app.useSlotTime(\'' + this.escAttr(free) + '\')">Use ' +
                this.formatTimeStr(free) + '</button>' : '');
        hint.style.display = 'flex';
    },

    useSlotTime(timeStr) {
        const timeEl = document.getElementById('taskDueTime');
        if (timeEl) timeEl.value = timeStr;
        this.checkSlotAvailability();
    },

    renderSlotSettings() {
        const cfg = this.slotCfg();
        const mins = document.getElementById('slotMinutes');
        if (mins && mins.value !== String(cfg.minutes)) mins.value = cfg.minutes;

        const btn = document.getElementById('slotToggle');
        const lbl = document.getElementById('slotToggleLabel');
        if (btn) btn.classList.toggle('is-off', !cfg.on);
        if (lbl) lbl.textContent = cfg.on ? 'Holding on' : 'Holding off';

        const hint = document.getElementById('slotHint');
        if (hint) {
            hint.textContent = cfg.on
                ? 'A task due at 11:15 AM holds the clock until ' +
                  this.formatTimeStr(this.nudgeToClock(675 + cfg.minutes)) + '. Nothing else can be scheduled inside that window.'
                : 'Two tasks can share the same time.';
        }
    },

    /* ---------- LOCAL STORAGE HEADROOM ---------- */
    STORAGE_LIMIT: 5 * 1024 * 1024,

    checkStorageHeadroom(bytes) {
        const used = bytes / this.STORAGE_LIMIT;
        if (used < 0.8) { this._quotaWarned = false; return; }
        if (this._quotaWarned) return;
        this._quotaWarned = true;
        this.showToast('Local storage is about ' + Math.round(used * 100) +
            '% full — export a CSV backup and empty the Bin.', 'warning');
    },


    /* ---------- BULK SELECT ---------- */
    selectMode: false,
    selected: [],

    isSelected(id) { return this.selected.indexOf(String(id)) !== -1; },

    toggleSelectMode() {
        this.selectMode = !this.selectMode;
        this.selected = [];
        document.body.classList.toggle('selecting', this.selectMode);
        document.querySelectorAll('.select-toggle').forEach(b => b.classList.toggle('is-on', this.selectMode));
        this.renderTable();
        this.updateSelectBar();
        if (this.selectMode) this.showToast('Tap entries to select them.', 'info');
    },

    exitSelectMode() {
        if (!this.selectMode) return;
        this.selectMode = false;
        this.selected = [];
        document.body.classList.remove('selecting');
        document.querySelectorAll('.select-toggle').forEach(b => b.classList.remove('is-on'));
        this.updateSelectBar();
    },

    toggleSelect(id) {
        const key = String(id);
        const at = this.selected.indexOf(key);
        if (at === -1) this.selected.push(key); else this.selected.splice(at, 1);
        this.renderTable();
        this.updateSelectBar();
    },

    updateSelectBar() {
        const bar = document.getElementById('bulkBar');
        if (!bar) return;

        bar.classList.toggle('open', this.selectMode);
        if (!this.selectMode) return;

        const n = this.selected.length;
        document.getElementById('bulkCount').textContent = n + ' selected';

        const tab = this.currentTab;
        const show = (elId, on) => {
            const el = document.getElementById(elId);
            if (el) el.style.display = (on && n > 0) ? '' : 'none';
        };
        show('bulkDone', tab === 'Register');
        show('bulkReopen', tab === 'Completed');
        show('bulkBin', tab === 'Register' || tab === 'Completed');
        show('bulkRestore', tab === 'Bin');
    },

    bulkAction(kind) {
        const ids = this.selected.slice();
        if (!ids.length) { this.showToast('Nothing selected.', 'info'); return; }

        const todayStr = this.getLocalDateStr(new Date());
        const pending = this.lists.statuses.indexOf('Pending') !== -1 ? 'Pending' : (this.lists.statuses[0] || 'Pending');
        const spawned = [];
        let n = 0;

        ids.forEach(id => {
            const t = this.findTask(id);
            if (!t) return;

            if (kind === 'done') {
                t.status = 'Completed';
                t.completedDate = todayStr;
                t.lastAckDate = null; t.snoozeUntil = null;
                t.updatedAt = Date.now();
                const repeat = this.nextOccurrence(t);
                if (repeat) { if (!t.seriesId) t.seriesId = repeat.seriesId; spawned.push(repeat); }
            } else if (kind === 'reopen') {
                t.status = pending;
                t.completedDate = null; t.lastAckDate = null; t.snoozeUntil = null;
                t.updatedAt = Date.now();
            } else if (kind === 'bin') {
                t.deleted = true;
                t.dateDeleted = todayStr;
                t.updatedAt = Date.now();
            } else if (kind === 'restore') {
                t.deleted = false;
                t.dateDeleted = null;
                t.updatedAt = Date.now();
            } else {
                return;
            }
            n++;
        });

        spawned.forEach(s => this.tasks.push(s));
        this.exitSelectMode();

        this.saveData();
        this.renderTable();
        this.processEngine();

        const verb = { done: 'completed', reopen: 'reopened', bin: 'moved to the Bin', restore: 'restored' }[kind];
        this.showToast(n + ' ' + (n === 1 ? 'entry' : 'entries') + ' ' + verb + '.', 'success');
        this.syncToGoogleSheets();
    },

    /* ---------- BACKUP ---------- */
    exportData(format, silent = false) {
        if (format !== 'csv') return;
        const headers = ['id', 'dateLogged', 'description', 'category', 'priority', 'status', 'pendingWith',
            'dueDate', 'dueTime', 'mailChain', 'notes', 'recurrence', 'deleted', 'dateDeleted',
            'lastAckDate', 'snoozeUntil', 'completedDate', 'emailId', 'updatedAt', 'purged', 'seriesId'];
        const rows = [headers.join(',')];

        this.tasks.forEach(t => {
            rows.push(headers.map(h => `"${(t[h] !== undefined && t[h] !== null ? t[h] : '').toString().replace(/"/g, '""')}"`).join(','));
        });

        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `banking_tasks_backup_${this.getLocalDateStr(new Date())}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 2000);

        if (!silent) this.showToast('CSV backup exported', 'success');
    },

    importCSV(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                let p = '', row = [''], ret = [row], i = 0, r = 0, s = !0, l;
                for (l of evt.target.result) {
                    if ('"' === l) { if (s && l === p) row[i] += l; s = !s; }
                    else if (',' === l && s) l = row[++i] = '';
                    else if ('\n' === l && s) { if ('\r' === p) row[i] = row[i].slice(0, -1); row = ret[++r] = [l = '']; i = 0; }
                    else row[i] += l;
                    p = l;
                }
                if (ret.length && ret[ret.length - 1].length === 1 && ret[ret.length - 1][0] === '') ret.pop();
                if (ret.length < 2) { this.showToast("CSV file is empty or invalid.", "error"); return; }

                const headers = ret[0];
                const importedTasks = [];

                for (let j = 1; j < ret.length; j++) {
                    const vals = ret[j];
                    const task = {};
                    headers.forEach((h, idx) => {
                        let val = vals[idx] !== undefined ? vals[idx] : "";
                        if (h === "deleted" || h === "purged") val = (val === "true");
                        task[h] = val;
                    });
                    if (!task.id) task.id = this.newId();
                    if (task.deleted === undefined) task.deleted = false;
                    if (task.purged === undefined) task.purged = false;
                    if (!task.recurrence) task.recurrence = 'None';
                    task.updatedAt = Number(task.updatedAt) || Date.now();
                    delete task.overdueAlerted; delete task.overdueAcknowledged;
                    delete task.alerted; delete task.reminderSent;
                    importedTasks.push(task);
                }

                this.exportData('csv', true);

                const merge = confirm(
                    `Importing ${importedTasks.length} entries.\n\n` +
                    `A backup of your current data has just been downloaded.\n\n` +
                    `OK = MERGE with what you already have (recommended)\n` +
                    `Cancel = REPLACE everything`
                );

                if (merge) {
                    const res = this.mergeTasks(importedTasks);
                    this.showToast(`Merged: ${res.added} new, ${res.updated} updated`, 'success');
                } else {
                    if (!confirm("REPLACE all current entries with the imported file? This cannot be undone.")) {
                        this.showToast('Import cancelled', 'info');
                        return;
                    }
                    this.tasks = importedTasks;
                    this.userClearedAll = true;
                    this.showToast('CSV backup restored (replaced)', 'success');
                }

                this.saveData();
                this.renderTable();
            } catch (err) {
                console.error(err);
                this.showToast('Error parsing CSV file', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    },

    printRegister() { window.print(); },

    showToast(msg, type = 'info', action = null) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const label = document.createElement('span');
        label.textContent = msg;
        toast.appendChild(label);

        let life = 3000;
        if (action && action.label && typeof action.onClick === 'function') {
            life = 6500;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'toast-action';
            btn.textContent = action.label;
            btn.addEventListener('click', () => { toast.remove(); action.onClick(); });
            toast.appendChild(btn);
        }

        container.appendChild(toast);
        setTimeout(() => {
            if (!toast.isConnected) return;
            toast.style.transform = 'translateY(-14px)';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 350);
        }, life);
    }
};

document.addEventListener('DOMContentLoaded', () => app.checkAuthOnStart());

/* Keep --toolbar-h in sync with whichever sticky toolbar is on screen, so the
   sticky table header parks just under it instead of sliding behind it. */
document.addEventListener('DOMContentLoaded', () => {
    const bars = document.querySelectorAll('.toolbar-row');
    if (!bars.length) return;
    const sync = () => {
        let h = 0;
        bars.forEach((b) => { if (b.offsetParent !== null) h = Math.max(h, b.offsetHeight); });
        document.documentElement.style.setProperty('--toolbar-h', h + 'px');
    };
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(sync);
        bars.forEach((b) => ro.observe(b));
    }
    window.addEventListener('resize', sync);
    sync();
});

/* ---------------- PWA glue ---------------- */
window.app = app;

const pwa = {
    deferred: null,
    waitingWorker: null,

    init() {
        const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const hint = document.getElementById('installHint');

        if (standalone) {
            if (hint) hint.textContent = 'Running as an installed app. Entries stay on this device and sync to your sheet.';
        } else if (isIOS && hint) {
            hint.innerHTML = 'On iPhone or iPad: tap <b>Share</b>, then <b>Add to Home Screen</b>.';
        }

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => this.registerWorker());

            // A new worker taking over means new files are live: reload once so
            // the running page and the cache are the same version. The very
            // first install claims an uncontrolled page — nothing to reload.
            this.hadController = !!navigator.serviceWorker.controller;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (this.reloading || !this.hadController) return;
                this.reloading = true;
                window.location.reload();
            });

            navigator.serviceWorker.addEventListener('message', (event) => {
                const data = event.data || {};
                if (data.type === 'SW_ACTIVATED' || data.type === 'VERSION') {
                    this.version = data.version || this.version;
                    this.renderVersion();
                }
                if (data.type === 'PUSH_RESUBSCRIBED' && data.subscription && typeof app !== 'undefined') {
                    app.cloudRequest({ action: 'saveSubscription', subscription: data.subscription }).catch(() => {});
                }
            });
        } else {
            this.renderVersion();
        }

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferred = e;
            const btn = document.getElementById('installBtn');
            if (btn) btn.style.display = 'flex';
        });

        window.addEventListener('appinstalled', () => {
            this.deferred = null;
            const btn = document.getElementById('installBtn');
            if (btn) btn.style.display = 'none';
            if (typeof app !== 'undefined' && app.showToast) app.showToast('Installed. Open it from your home screen.', 'success');
        });

        const params = new URLSearchParams(location.search);
        const tab = params.get('tab');
        const action = params.get('action');
        if (tab || action) {
            setTimeout(() => {
                if (!window.app || !app.currentUser) return;
                if (tab) app.switchTab(tab);
                if (action === 'new') app.openTaskModal();
            }, 400);
        }
    },

    async install() {
        if (!this.deferred) {
            app.showToast('Use your browser menu: Add to home screen', 'info');
            return;
        }
        this.deferred.prompt();
        const choice = await this.deferred.userChoice;
        this.deferred = null;
        if (choice.outcome !== 'accepted') app.showToast('Install cancelled', 'info');
    },

    reg: null,
    hadController: false,
    waitingWorker: null,
    reloading: false,
    version: null,

    async registerWorker() {
        try {
            const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
            this.reg = reg;

            if (reg.waiting && navigator.serviceWorker.controller) this.onUpdateReady(reg.waiting);

            reg.addEventListener('updatefound', () => {
                const sw = reg.installing;
                if (!sw) return;
                sw.addEventListener('statechange', () => {
                    if (sw.state === 'installed' && navigator.serviceWorker.controller) this.onUpdateReady(sw);
                });
            });

            // Look for a new deploy on a slow loop, when the app comes back to
            // the foreground, and when the connection returns.
            setInterval(() => this.silentUpdateCheck(), 30 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') this.silentUpdateCheck();
            });
            window.addEventListener('online', () => this.silentUpdateCheck());

            this.askVersion();
        } catch (err) {
            console.warn('Service worker registration failed', err);
            this.renderVersion();
        }
    },

    onUpdateReady(worker) {
        if (!worker || this.waitingWorker === worker) return;  // one prompt per build
        this.waitingWorker = worker;
        this.renderVersion();
        if (typeof app !== 'undefined' && app.showToast) {
            app.showToast('A new version is ready.', 'info', { label: 'Update now', onClick: () => this.applyUpdate() });
        }
    },

    applyUpdate() {
        const worker = this.waitingWorker || (this.reg && this.reg.waiting);
        if (!worker) { window.location.reload(); return; }
        if (typeof app !== 'undefined' && app.showToast) app.showToast('Updating…', 'info');
        worker.postMessage({ type: 'SKIP_WAITING' });
        // If the worker does not hand over within a few seconds, reload anyway.
        setTimeout(() => { if (!this.reloading) { this.reloading = true; window.location.reload(); } }, 4000);
    },

    silentUpdateCheck() {
        if (!this.reg || !navigator.onLine) return;
        this.reg.update().catch(() => {});
    },

    askVersion() {
        const sw = navigator.serviceWorker.controller;
        if (!sw || !window.MessageChannel) { this.renderVersion(); return; }
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
            const data = event.data || {};
            if (data.version) { this.version = data.version; this.renderVersion(); }
        };
        try { sw.postMessage({ type: 'GET_VERSION' }, [channel.port2]); } catch (e) { this.renderVersion(); }
    },

    renderVersion() {
        const el = document.getElementById('swVersion');
        if (!el) return;
        if (!('serviceWorker' in navigator)) { el.textContent = 'Offline cache needs a hosted copy over HTTPS.'; return; }
        const bits = [];
        bits.push(this.version ? 'Cache ' + this.version : 'Cache starting up');
        bits.push(navigator.serviceWorker.controller ? 'offline ready' : 'not cached yet');
        if (this.waitingWorker) bits.push('update waiting');
        el.textContent = bits.join(' · ') + '.';
    },

    async checkUpdate() {
        if (!('serviceWorker' in navigator)) { app.showToast('Updates need a hosted copy over HTTPS', 'warning'); return; }
        if (this.waitingWorker) { this.applyUpdate(); return; }

        const reg = this.reg || await navigator.serviceWorker.getRegistration();
        if (!reg) { app.showToast('Not installed yet', 'info'); return; }
        this.reg = reg;

        app.showToast('Checking for an update…', 'info');
        try {
            await reg.update();
            await new Promise(r => setTimeout(r, 1200));
            if (this.waitingWorker || reg.waiting) { this.onUpdateReady(this.waitingWorker || reg.waiting); return; }
            this.askVersion();
            app.showToast('You are on the latest version' + (this.version ? ' (' + this.version + ')' : ''), 'success');
        } catch (e) {
            app.showToast('Could not reach the server', 'error');
        }
    },

    // Last resort when a phone is stuck on an old build: wipe every cache and
    // re-fetch from the server. Tasks live in local storage and are untouched.
    clearCache() {
        if (!confirm('Clear the offline cache and reload?\n\nYour entries stay on this device.')) return;
        const done = () => window.location.reload(true);
        const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (sw && window.MessageChannel) {
            const channel = new MessageChannel();
            channel.port1.onmessage = done;
            try { sw.postMessage({ type: 'CLEAR_CACHES' }, [channel.port2]); } catch (e) { done(); }
            setTimeout(done, 3000);
        } else if (window.caches) {
            caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(done).catch(done);
        } else {
            done();
        }
    }
};
pwa.init();