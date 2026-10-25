// ============================================================
// Auto-Fill v3 — โค้ดกลางของหน้าเว็บ (ต้องโหลด config.js และ blynk.js ก่อน)
// ใช้สคริปต์ธรรมดา (ไม่ใช่ module) เพื่อให้เปิดจากไฟล์ในเครื่อง (file://) ได้ด้วย
// ============================================================
(function () {
    'use strict';
    const C = window.AF_CONFIG;
    const AF = (window.AF = {});

    // ============================================================
    // 1. DOM / utils
    // ============================================================
    AF.$ = (sel, root = document) => root.querySelector(sel);

    AF.h = function h(tag, props, ...kids) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(props || {})) {
            if (v == null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? '' : v);
        }
        for (const c of kids.flat()) if (c != null && c !== false) el.append(c);
        return el;
    };

    AF.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    AF.timeAgo = ts => {
        const s = Math.round((Date.now() - ts) / 1000);
        if (s < 5) return 'เมื่อสักครู่';
        if (s < 60) return `${s} วิ.ที่แล้ว`;
        if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
        if (s < 86400) return `${Math.floor(s / 3600)} ชม.ที่แล้ว`;
        return new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
    };

    AF.clock = ts => new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    function makeStore(area) {
        return {
            get(key, fallback) {
                try { const v = area.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
            },
            set(key, value) { try { area.setItem(key, JSON.stringify(value)); } catch { } },
            del(key) { try { area.removeItem(key); } catch { } },
        };
    }
    AF.store = makeStore(window.localStorage);
    AF.sessionStore = makeStore(window.sessionStorage);

    // ============================================================
    // 2. Toast
    // ============================================================
    AF.toast = function (text, type = 'info', ms = 2800) {
        let wrap = document.getElementById('toasts');
        if (!wrap) document.body.append(wrap = AF.h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }));
        const el = AF.h('div', { class: `toast ${type}`, text });
        wrap.append(el);
        setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, ms);
    };

    // ============================================================
    // 3. Blynk
    // ============================================================
    AF.blynk = AFB.createClient({ server: C.BLYNK_SERVER });
    AF.registry = { adminToken: C.ADMIN_TOKEN, pins: C.PINS, maxSlots: C.MAX_SLOTS };
    AF.reason = reason => AFB.REASONS[reason] || AFB.REASONS.invalid;

    // ============================================================
    // 4. Session — เก็บ token ของผู้ใช้ (ไว้ส่งข้อความ) แต่ไม่เก็บรหัสผ่าน
    // ============================================================
    const SESSION_KEY = 'af3_session';

    AF.session = {
        save(account, remember) {
            const s = {
                slot: account.slot, user: account.user, name: account.name,
                token: account.token, verifier: account.verifier,
                exp: Date.now() + (remember ? C.SESSION_DAYS * 86400000 : 12 * 3600000),
            };
            AF.session.clear();
            (remember ? AF.store : AF.sessionStore).set(SESSION_KEY, s);
            return s;
        },
        get() {
            for (const st of [AF.sessionStore, AF.store]) {
                const s = st.get(SESSION_KEY, null);
                if (s && s.token && s.exp > Date.now()) return s;
            }
            return null;
        },
        clear() {
            AF.store.del(SESSION_KEY);
            AF.sessionStore.del(SESSION_KEY);
            AF.sessionStore.del('af3_license');
        },
    };

    // ============================================================
    // 5. เปิดเป็นแผงควบคุมในตัว Extension → ใช้บัญชีที่ Extension เข้าสู่ระบบไว้ ไม่ต้องเข้าสู่ระบบซ้ำ
    // ============================================================
    AF.inExtension = location.protocol === 'chrome-extension:' && !!window.chrome?.storage?.local;
    AF.ready = (async () => {
        if (!AF.inExtension) return;
        const { account } = await chrome.storage.local.get('account');
        if (account?.token) AF.session.save(account, false);
        else AF.session.clear();
    })().catch(err => console.warn('[AF3]', err));
})();
