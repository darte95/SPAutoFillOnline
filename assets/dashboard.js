// ============================================================
// Auto-Fill v3 — Dashboard / แผงควบคุมเครื่องลูก
// ส่งคำสั่งผ่าน Blynk ถึง Extension ของผู้ใช้คนนี้เท่านั้น: กรอกข้อความ, เปิด URL, หยุด/รับ, รีเฟรชแท็บ
// ใช้ได้ทั้งบนเว็บ (ต้องเข้าสู่ระบบ) และในตัว Extension (ใช้บัญชีของ Extension ไม่ต้องเข้าสู่ระบบซ้ำ)
// ============================================================
AF.ready.then(function () {
    'use strict';
    const C = window.AF_CONFIG;
    const P = C.PINS;
    const { $, h, store, toast } = AF;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const gate = $('#gate');

    function showGate(title, message, isError, actions = true) {
        gate.hidden = false;
        gate.classList.remove('hide');
        gate.classList.toggle('error', !!isError);
        $('#gateTitle').textContent = title;
        $('#gateMsg').textContent = message;
        $('#gateActions').hidden = !isError || !actions;
    }

    function hideGate() {
        if (gate.hidden) return;
        gate.classList.add('hide');
        setTimeout(() => { gate.hidden = true; }, 300);
    }

    // ============================================================
    // 0. บัญชี — บนเว็บต้องเข้าสู่ระบบ / ในตัว Extension ใช้บัญชีของ Extension
    // ============================================================
    if (AF.inExtension) {
        document.body.classList.add('in-extension');
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.account) location.reload();
        });
    }

    const session = AF.session.get();
    if (!session) {
        if (AF.inExtension) {
            showGate('ยังไม่ได้เข้าสู่ระบบ Extension', 'กดไอคอน ⚡ ที่แถบเครื่องมือ แล้วเข้าสู่ระบบ — หน้านี้จะเปิดให้ใช้เองทันที', true, false);
        } else if (C.REQUIRE_LOGIN) {
            location.replace('index.html');
        }
        return;
    }
    const token = session.token;
    $('#userLabel').textContent = `👤 ${session.name || session.user}`;

    async function logout(reason) {
        if (AF.inExtension) {
            if (!confirm('ออกจากระบบ Extension ในเบราว์เซอร์นี้? เครื่องนี้จะหยุดรับข้อความ')) return;
            await chrome.runtime.sendMessage({ target: 'background', type: 'logout' }).catch(() => {});
            AF.session.clear();
            location.reload();
            return;
        }
        AF.session.clear();
        location.replace('index.html?reason=' + reason);
    }
    document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', () => logout('logout')));

    // ============================================================
    // 1. สิทธิ์การใช้งาน — เปิดหน้าได้ทันทีถ้าเพิ่งตรวจผ่าน แล้วค่อยตรวจซ้ำเบื้องหลัง
    // ============================================================
    let licenseOK = false;
    let lastVerify = 0;
    let heartbeatTimer = 0;   // ใช้ในข้อ 3 (ประกาศไว้ก่อน เพราะ applyLicense อาจถูกเรียกทันที)

    function setLicenseBadge(text, cls, title) {
        const badge = $('#licenseBadge');
        badge.className = 'badge ' + (cls || '');
        badge.querySelector('b').textContent = text;
        badge.title = title || '';
    }

    function applyLicense(r, offline) {
        licenseOK = !!r.valid;
        if (!r.valid) {
            const [title, message] = AF.reason(r.reason);
            setLicenseBadge(title, 'bad');
            showGate(title, message, true);
            return;
        }
        const days = r.daysLeft;
        setLicenseBadge(offline ? 'ออฟไลน์' : days === 0 ? 'หมดวันนี้' : `เหลือ ${days} วัน`, offline || days <= 3 ? 'warn' : 'good', `ใช้ได้ถึง ${r.expiryText}`);
        hideGate();
        startHeartbeat();
    }

    async function verify() {
        lastVerify = Date.now();
        try {
            const r = await AFB.recheck(AF.blynk, AF.registry, session);
            if (r.reason === 'revoked') return logout('revoked');
            AF.sessionStore.set('af3_license', { valid: r.valid, reason: r.reason, expiryText: r.expiryText, daysLeft: r.daysLeft, at: Date.now() });
            applyLicense(r);
        } catch (err) {
            console.error(err);
            const cached = AF.sessionStore.get('af3_license', null);
            if (cached?.valid && Date.now() - cached.at < 30 * 60000) applyLicense(cached, true);
            else showGate('การเชื่อมต่อล้มเหลว', 'ไม่สามารถตรวจสอบสิทธิ์กับเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ต', true);
        }
    }

    const cachedLicense = AF.sessionStore.get('af3_license', null);
    if (cachedLicense?.valid && Date.now() - cachedLicense.at < 10 * 60000) applyLicense(cachedLicense);
    else showGate('กำลังตรวจสอบสิทธิ์', 'กรุณารอสักครู่ ระบบกำลังเชื่อมต่อเซิร์ฟเวอร์…', false);
    verify();
    setInterval(verify, C.LICENSE_RECHECK_MIN * 60000);
    $('#gateRetry').addEventListener('click', () => {
        showGate('กำลังตรวจสอบสิทธิ์', 'กรุณารอสักครู่…', false);
        verify();
    });

    // ============================================================
    // 2. ตัวเลือกการส่ง (จำค่าไว้ในเครื่อง)
    //    - ล้างข้อความเดิมก่อนกรอก: เปิดเป็นค่าเริ่มต้น กันข้อความค้างในช่องไปต่อท้าย
    //    - Enter = ส่ง: ปิดเป็นค่าเริ่มต้นบนมือถือ กันกด Enter เพื่อขึ้นบรรทัดแล้วส่งออกไปเลย
    // ============================================================
    const isTouch = matchMedia('(pointer: coarse)').matches;
    const OPT_IDS = { autoEnter: 'optEnter', clickSend: 'optClick', clearBefore: 'optClear', enterSend: 'optEnterSend' };
    const opts = { autoEnter: false, clickSend: false, clearBefore: true, enterSend: !isTouch, ...store.get('af3_opts', {}) };

    function renderEnterHint() {
        $('#enterHint').replaceChildren(...(opts.enterSend
            ? [h('kbd', { text: 'Enter' }), ' ส่ง • ', h('kbd', { text: 'Shift' }), '+', h('kbd', { text: 'Enter' }), ' ขึ้นบรรทัด']
            : [h('kbd', { text: 'Enter' }), ' ขึ้นบรรทัด • กดปุ่ม "ส่งข้อความ" เพื่อส่ง']));
    }

    for (const [key, id] of Object.entries(OPT_IDS)) {
        const el = document.getElementById(id);
        el.checked = !!opts[key];
        el.addEventListener('change', () => {
            opts[key] = el.checked;
            store.set('af3_opts', opts);
            renderEnterHint();
        });
    }

    // ============================================================
    // 3. สัญญาณ "Dashboard เปิดอยู่" (V6) → เครื่องลูกสลับเป็นโหมดรับเร็ว
    //    หยุดส่งเมื่อซ่อนหน้า เพื่อไม่ให้ Extension ถามถี่โดยไม่จำเป็น (ประหยัดโควตา Blynk)
    // ============================================================
    async function heartbeat() {
        clearTimeout(heartbeatTimer);
        if (document.hidden || !licenseOK) { heartbeatTimer = 0; return; }
        try { await AF.blynk.update(token, { [P.LIVE]: AF.uid() }); } catch (err) { console.warn('heartbeat', err); }
        heartbeatTimer = setTimeout(heartbeat, C.HEARTBEAT_MS);
    }

    function startHeartbeat() {
        if (heartbeatTimer) return;
        heartbeatTimer = -1;   // กันเรียกซ้อนระหว่างรอผล
        heartbeat();
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { clearTimeout(heartbeatTimer); heartbeatTimer = 0; return; }
        heartbeatTimer = 0;
        startHeartbeat();
        readDevices();
        if (Date.now() - lastVerify > 5 * 60000) verify();
    });

    // ============================================================
    // 4. เครื่องลูก (V7) — Extension ทุกเครื่อง/ทุกโปรไฟล์ Chrome ที่เข้าสู่ระบบบัญชีนี้
    // ============================================================
    let devices = [];
    let devError = '';
    let devTimer = 0;
    const openedAt = Date.now();
    const targets = { all: true, ids: [], ...store.get(`af3_targets:${session.user}`, {}) };
    const saveTargets = () => store.set(`af3_targets:${session.user}`, targets);

    const isOnline = d => Math.abs(Date.now() - d.seen) < C.ONLINE_WINDOW_MS && d.mode !== 'off';
    const onlineDevices = () => devices.filter(isOnline);
    const MODE_TEXT = {
        live: ['พร้อม — รับทันที', 'live'],
        standby: ['กำลังสลับเป็นโหมดเร็ว…', 'standby'],
        idle: ['ไม่มีแท็บที่ใช้งาน (รับคำสั่งเปิด URL ได้)', 'idle'],
        off: ['ปิดระบบอยู่', ''],
    };

    function targetIds() {
        if (targets.all) return null;
        const known = new Set(devices.map(d => d.id));
        return targets.ids.filter(id => known.has(id));
    }

    function renderTargetNote() {
        const ids = targetIds();
        const online = onlineDevices();
        let text = '';
        if (ids) {
            if (!ids.length) text = '⚠ ยังไม่ได้เลือกเครื่อง — ติ๊กเครื่องในรายการเครื่องลูก';
            else if (!online.some(d => ids.includes(d.id))) text = '⚠ เครื่องที่เลือกออฟไลน์ทั้งหมด';
            $('#targetSummary').textContent = `→ ${ids.length} เครื่องที่เลือก`;
        } else {
            $('#targetSummary').textContent = devices.length ? `→ ทุกเครื่อง (${online.length} ออนไลน์)` : '';
            if (!devError && devices.length && !online.length) text = '⚠ ไม่มีเครื่องลูกออนไลน์';
        }
        $('#targetNote').textContent = text;
        $('#targetNote').hidden = !text;
    }

    function renderDevices() {
        const ul = $('#devices');
        ul.classList.toggle('no-select', targets.all);
        const online = onlineDevices();
        const tabs = online.reduce((n, d) => n + d.tabs, 0);
        const ready = online.reduce((n, d) => n + (d.paused ? 0 : d.ready), 0);
        $('#devSummary').textContent = devError || `${online.length}/${devices.length} ออนไลน์ • ${ready}/${tabs} แท็บพร้อม`;
        ul.replaceChildren();
        if (!devices.length) {
            ul.append(h('li', { class: 'empty' }, devError
                ? 'อ่านสถานะไม่ได้ — ' + devError
                : 'ยังไม่พบเครื่องลูก — ติดตั้ง Extension v3 แล้วเข้าสู่ระบบด้วยบัญชีนี้ (หรือใช้ "รหัสเชื่อมเครื่อง" ในเมนู ⋯)'));
        }
        for (const d of devices.slice().sort((a, b) => isOnline(b) - isOnline(a) || a.name.localeCompare(b.name, 'th'))) {
            const on = isOnline(d);
            const box = h('input', { type: 'checkbox', 'aria-label': `เลือก ${d.name}` });
            box.checked = targets.ids.includes(d.id);
            box.addEventListener('change', () => {
                targets.ids = box.checked ? [...new Set([...targets.ids, d.id])] : targets.ids.filter(x => x !== d.id);
                saveTargets();
                renderTargetNote();
            });
            const [modeText, dot] = on ? (d.paused ? ['หยุดรับชั่วคราว', 'paused'] : MODE_TEXT[d.mode] || MODE_TEXT.off) : ['ออฟไลน์', ''];
            const meta = on ? `${modeText} • ${d.tabs} แท็บ • พร้อม ${d.ready} • ${AF.timeAgo(d.seen)}` : `ออฟไลน์ • ${AF.timeAgo(d.seen)}`;
            const last = d.acks[d.acks.length - 1];
            ul.append(h('li', { class: 'dev' + (on ? '' : ' offline') + (d.paused ? ' paused' : '') },
                box,
                h('i', { class: 'dot ' + (on ? (d.paused ? 'warn' : 'on') : 'off') }),
                h('div', { class: 'info' },
                    h('div', { class: 'name', text: `${d.name}${d.ver ? ' • v' + d.ver : ''}` }),
                    h('div', { class: 'meta', text: meta })),
                last ? h('span', { class: 'ack ' + (last.ok && !last.f ? 'ok' : 'warn'), title: 'ผลคำสั่งล่าสุด' }, last.ok ? `✓ ${last.ok}` : '—', last.f ? ` ⚠ ${last.f}` : '') : null,
                h('div', { class: 'dev-acts' },
                    h('button', {
                        class: 'icon-sm', title: d.paused ? 'ให้เครื่องนี้รับข้อความต่อ' : 'หยุดรับข้อความที่เครื่องนี้', text: d.paused ? '▶' : '⏸', disabled: !on,
                        onclick: () => sendCommand({ kind: d.paused ? 'resume' : 'pause', targets: [d.id], label: `${d.paused ? '▶ รับข้อความต่อ' : '⏸ หยุดรับ'} — ${d.name}` }),
                    }),
                    h('button', {
                        class: 'icon-sm', title: 'รีเฟรชแท็บที่ใช้งานของเครื่องนี้', text: '↻', disabled: !on,
                        onclick: () => sendCommand({ kind: 'reload', targets: [d.id], label: `↻ รีเฟรชแท็บ — ${d.name}` }),
                    }))));
        }
        renderTargetNote();
    }

    async function readDevices() {
        try {
            devices = AFB.listDevices((await AF.blynk.get(token, [P.STATE]))[P.STATE]);
            devError = '';
        } catch (err) {
            devError = AFB.isMissingPin(err) ? 'ยังไม่ได้สร้าง Datastream V7' : 'เชื่อมต่อ Blynk ไม่ได้';
        }
        renderDevices();
        checkAcks();
        return devices;
    }

    // อ่านถี่ขึ้นช่วงแรกที่เปิดหน้า เพื่อให้เห็นตอนเครื่องลูกสลับเป็นโหมดเร็ว
    async function devLoop() {
        clearTimeout(devTimer);
        if (!document.hidden) await readDevices();
        const warming = Date.now() - openedAt < 45000 && onlineDevices().some(d => d.mode === 'standby');
        devTimer = setTimeout(devLoop, warming ? 3000 : C.STATE_POLL_MS);
    }

    $('#devAll').checked = targets.all;
    $('#devAll').addEventListener('change', e => {
        targets.all = e.target.checked;
        saveTargets();
        renderDevices();
    });
    $('#devRefresh').addEventListener('click', readDevices);
    $('#allPause').addEventListener('click', () => sendCommand({ kind: 'pause', targets: targetIds(), label: '⏸ หยุดรับข้อความ — เครื่องที่เลือก' }));
    $('#allResume').addEventListener('click', () => sendCommand({ kind: 'resume', targets: targetIds(), label: '▶ รับข้อความต่อ — เครื่องที่เลือก' }));
    $('#devPrune').addEventListener('click', async () => {
        const stale = devices.filter(d => !isOnline(d));
        if (!stale.length) return toast('ไม่มีเครื่องที่ออฟไลน์', 'info');
        if (!confirm(`ลบเครื่องที่ออฟไลน์ ${stale.length} เครื่องออกจากรายการ?`)) return;
        try {
            const map = AFB.decodeDevices((await AF.blynk.get(token, [P.STATE]))[P.STATE]);
            stale.forEach(d => delete map[d.id]);
            await AF.blynk.update(token, { [P.STATE]: AFB.encodeDevices(map) });
            toast(`ลบแล้ว ${stale.length} เครื่อง`, 'ok');
            readDevices();
        } catch (err) {
            toast('ลบไม่สำเร็จ: ' + (err.message || err), 'error');
        }
    });
    setInterval(renderDevices, 5000);

    // ============================================================
    // 5. ประวัติการส่ง
    // ============================================================
    const HISTORY_MAX = 100;
    const HISTORY_KEY = `af3_history:${session.user}`;   // แยกประวัติตามผู้ใช้
    let history = store.get(HISTORY_KEY, []).map(item => item.res?.cls === 'sending' ? { ...item, res: { cls: 'warn', text: 'ไม่ทราบผล (ปิดหน้าก่อนส่งเสร็จ)' } } : item);
    let historySaveTimer = 0;

    function saveHistory() {
        clearTimeout(historySaveTimer);
        historySaveTimer = setTimeout(() => store.set(HISTORY_KEY, history.slice(0, HISTORY_MAX)), 300);
    }

    function renderHistory() {
        const ul = $('#history');
        ul.replaceChildren();
        if (!history.length) {
            ul.append(h('li', { class: 'empty', text: 'ยังไม่มีประวัติการส่ง' }));
            return;
        }
        for (const item of history) {
            const res = item.res || {};
            const isFill = !item.kind || item.kind === 'fill';
            ul.append(h('li', { class: `hist s-${res.cls || 'sending'}${isFill ? '' : ' cmd'}` },
                h('div', { class: 'body' },
                    h('div', { class: 'text', text: item.text }),
                    h('div', { class: 'meta', text: `${AF.clock(item.at)}${res.text ? ' • ' + res.text : ''}` })),
                h('div', { class: 'acts' },
                    isFill ? h('button', { title: 'ส่งซ้ำ', 'aria-label': 'ส่งซ้ำ', text: '↻', onclick: () => send(item.text) }) : null,
                    isFill ? h('button', { title: 'แก้ไขแล้วส่ง', 'aria-label': 'แก้ไข', text: '✎', onclick: () => setComposer(item.text) }) : null,
                    item.kind === 'nav' ? h('button', { title: 'เปิดลิงก์นี้อีกครั้ง', 'aria-label': 'เปิดอีกครั้ง', text: '↻', onclick: () => openUrl(item.url, item.mode) }) : null,
                    h('button', {
                        title: 'ลบ', 'aria-label': 'ลบ', text: '✕',
                        onclick: () => { history = history.filter(x => x !== item); saveHistory(); renderHistory(); },
                    }))));
        }
    }

    $('#histClear').addEventListener('click', () => {
        if (!history.length || !confirm('ล้างประวัติการส่งทั้งหมด?')) return;
        history = [];
        saveHistory();
        renderHistory();
    });

    // ============================================================
    // 6. ส่งคำสั่ง — V5 เก็บคำสั่งล่าสุดหลายรายการ (ไม่เกิน 5 รายการ / 20 วินาที)
    //    ส่งติดกันเร็ว ๆ เครื่องลูกก็ยังได้ครบทุกคำสั่งตามลำดับ
    // ============================================================
    const queue = [];
    const pending = new Set();   // ส่งแล้ว รอผลจากเครื่องลูก
    const RECENT_KEY = `af3_recent:${session.user}`;
    let recent = AF.sessionStore.get(RECENT_KEY, []);
    let pumping = false;
    let lastSendAt = 0;
    let lastRec = null;
    const SEND_GAP_MS = 250;     // เว้นระยะเล็กน้อยให้ลำดับการเขียนไม่สลับกัน

    function setDelivery(text, cls) {
        const el = $('#delivery');
        el.className = 'delivery ' + (cls === 'sending' ? '' : cls || '');
        el.replaceChildren(...(cls === 'sending' ? [h('span', { class: 'spinner sm' })] : []), text);
    }

    function renderQueue() {
        $('#queueInfo').textContent = queue.length ? `รอคิว ${queue.length}` : '';
    }

    function summarize(rec) {
        if (rec.error) return { cls: 'bad', text: `ส่งไม่สำเร็จ — ${rec.error}` };
        if (!rec.sent) return { cls: 'sending', text: queue.includes(rec) && queue[0] !== rec ? 'รอคิว…' : 'กำลังส่ง…' };
        let ok = 0, f = 0;
        for (const a of rec.acks.values()) { ok += a.ok; f += a.f; }
        const got = rec.acks.size;
        const of = Math.max(rec.expect.size, got);
        const ms = (rec.ms != null ? ` • ${rec.ms}ms` : '') + (rec.pausedCount ? ` • หยุดรับ ${rec.pausedCount} เครื่อง` : '');
        if (got) {
            const devs = of > 1 || rec.kind !== 'fill' ? ` • ${got}/${of} เครื่อง` : '';
            if (rec.kind === 'nav') return { cls: got >= of && !f ? 'ok' : 'warn', text: `✓ เปิดลิงก์แล้ว ${ok} แท็บ${devs}${ms}` };
            if (rec.kind === 'reload') return { cls: 'ok', text: `✓ รีเฟรชแล้ว ${ok} แท็บ${devs}` };
            if (rec.kind === 'pause' || rec.kind === 'resume') return { cls: 'ok', text: `✓ ${rec.kind === 'pause' ? 'หยุดรับ' : 'รับต่อ'}แล้ว${devs}` };
            if (!ok && !f) return { cls: 'warn', text: `⚠ ไม่มีแท็บที่พร้อมกรอก${devs}${ms}` };
            const parts = [ok ? `✓ กรอกแล้ว ${ok} แท็บ` : '⚠ กรอกไม่สำเร็จ'];
            if (f) parts.push(`⚠ หาช่องไม่เจอ ${f}`);
            return { cls: ok && !f && got >= of ? 'ok' : 'warn', text: parts.join(' • ') + devs + ms };
        }
        if (!rec.done) return { cls: 'sending', text: 'ส่งแล้ว • รอเครื่องลูก…' };
        if (!rec.expect.size) return { cls: 'warn', text: rec.pausedCount ? `ส่งแล้ว แต่เครื่องที่ออนไลน์หยุดรับอยู่ (${rec.pausedCount} เครื่อง)` : 'ส่งแล้ว แต่ไม่มีเครื่องลูกออนไลน์' };
        return { cls: 'warn', text: 'ส่งแล้ว — ไม่ได้รับผลยืนยัน' };
    }

    function updateRec(rec) {
        const res = summarize(rec);
        rec.item.res = res;
        if (rec === lastRec) setDelivery(res.text, res.cls);
        saveHistory();
        renderHistory();
        renderQueue();
    }

    // รวมผลจากทุกเครื่อง — จบเมื่อเครื่องที่ออนไลน์ตอนส่งตอบครบ (หรือหมดเวลา)
    function checkAcks() {
        for (const rec of pending) {
            let changed = false;
            for (const d of devices) {
                if (!rec.expect.has(d.id)) continue;
                const a = d.acks.find(x => x.i === rec.id);
                if (a && !rec.acks.has(d.id)) {
                    rec.acks.set(d.id, a);
                    rec.ms ??= Math.round(performance.now() - rec.t0);
                    changed = true;
                }
            }
            if (!changed) continue;
            if ([...rec.expect].every(id => rec.acks.has(id))) finish(rec);
            else updateRec(rec);
        }
    }

    function finish(rec) {
        pending.delete(rec);
        clearTimeout(rec.timer);
        rec.done = true;
        updateRec(rec);
    }

    // หลังส่ง: อ่าน V7 ถี่ ๆ จนเห็นผลยืนยัน (เครื่องที่อยู่โหมดพักจะถามทุก ~8 วิ จึงรอนานพอ)
    async function watchAck(rec) {
        rec.timer = setTimeout(() => finish(rec), 15000);
        for (const wait of [600, 600, 700, 800, 1000, 1500, 2000, 2500, 3000, 3000]) {
            await sleep(wait);
            if (!pending.has(rec)) return;
            await readDevices();
        }
    }

    async function deliver(rec) {
        recent.push(AFB.packMessage(rec.packed));
        const batch = AFB.encodeBatch(recent);
        recent = batch.list;
        AF.sessionStore.set(RECENT_KEY, recent);
        // เครื่องที่หยุดรับอยู่จะไม่กรอก/ไม่เปิดลิงก์ → ไม่นับเป็นเครื่องที่รอผล
        const reach = onlineDevices().filter(d => !rec.packed.targets || rec.packed.targets.includes(d.id));
        const skipsPaused = rec.kind === 'fill' || rec.kind === 'nav';
        rec.expect = new Set(reach.filter(d => !(skipsPaused && d.paused)).map(d => d.id));
        rec.pausedCount = skipsPaused ? reach.filter(d => d.paused).length : 0;
        rec.t0 = performance.now();
        updateRec(rec);
        try {
            await AF.blynk.update(token, { [P.MSG]: batch.json });
            rec.sent = true;
            pending.add(rec);
            updateRec(rec);
            watchAck(rec);
        } catch (err) {
            console.error(err);
            rec.error = err.status === 400 ? 'Blynk ปฏิเสธ (ตรวจสอบ Datastream V5)' : err.timeout ? 'หมดเวลา' : 'เครือข่ายขัดข้อง';
            updateRec(rec);
            toast('ส่งไม่สำเร็จ: ' + rec.error, 'error');
        }
    }

    async function pump() {
        if (pumping) return;
        pumping = true;
        while (queue.length) {
            const wait = SEND_GAP_MS - (Date.now() - lastSendAt);
            if (wait > 0) { renderQueue(); await sleep(wait); }
            const rec = queue.shift();
            renderQueue();
            await deliver(rec);
            lastSendAt = Date.now();
        }
        pumping = false;
    }

    // คำสั่งทุกชนิดผ่านทางนี้: fill / nav / pause / resume / reload
    function sendCommand({ kind = 'fill', text = '', url = '', mode = '', targets: to = targetIds(), label, chip }) {
        if (!licenseOK) { toast('ระบบยังไม่พร้อมใช้งาน (ตรวจสอบสิทธิ์ไม่ผ่าน)', 'error'); return false; }
        if (to && !to.length) { toast('ยังไม่ได้เลือกเครื่องลูก', 'warn'); return false; }
        const id = AF.uid();
        const packed = kind === 'fill'
            ? { id, kind, text, autoEnter: opts.autoEnter, clickSend: opts.clickSend, clearBefore: opts.clearBefore, targets: to }
            : { id, kind, url, mode, targets: to };
        if (AFB.byteLength(`{"m":[${AFB.encodeMessage(packed)}]}`) > AFB.MAX_BYTES) {
            toast('ข้อความยาวเกินไป (Blynk เก็บได้ไม่เกิน ~1000 ไบต์)', 'error');
            return false;
        }
        const item = { id, kind, text: label || text, url, mode, at: Date.now(), res: null };
        history.unshift(item);
        history = history.slice(0, HISTORY_MAX);
        const rec = { id, kind, item, packed, expect: new Set(), acks: new Map(), sent: false, done: false, error: '', ms: null, t0: 0 };
        lastRec = rec;
        queue.push(rec);
        updateRec(rec);
        if (chip) { chip.classList.remove('sent'); void chip.offsetWidth; chip.classList.add('sent'); }
        pump();
        return true;
    }

    const send = (raw, chip) => {
        const text = String(raw || '').trim();
        return text ? sendCommand({ kind: 'fill', text, chip }) : false;
    };

    // ============================================================
    // 7. ช่องพิมพ์ข้อความ
    // ============================================================
    const textEl = $('#text');

    function autoGrow() {
        textEl.style.height = 'auto';
        textEl.style.height = Math.min(textEl.scrollHeight + 2, 260) + 'px';
        const bytes = AFB.byteLength(textEl.value);
        const limit = AFB.MAX_BYTES - 100;   // เผื่อพื้นที่ให้ id/ตัวเลือก/รายชื่อเครื่อง
        const count = $('#count');
        count.textContent = bytes > limit * 0.7 ? `${bytes}/${limit} ไบต์` : String(textEl.value.length);
        count.className = bytes > limit ? 'over' : '';
    }

    function setComposer(text) {
        textEl.value = text;
        autoGrow();
        textEl.focus();
        textEl.setSelectionRange(text.length, text.length);
    }

    function sendComposer() {
        const text = textEl.value;
        if (!text.trim()) { textEl.focus(); return; }
        if (send(text)) setComposer('');
    }

    textEl.addEventListener('input', autoGrow);
    textEl.addEventListener('keydown', e => {
        if (e.isComposing || e.keyCode === 229) return;   // กำลังเลือกคำจากแป้นพิมพ์ (IME)
        if (e.key === 'Enter' && opts.enterSend && !e.shiftKey) {
            e.preventDefault();
            sendComposer();
        } else if (e.key === 'Escape') {
            setComposer('');
        }
    });
    $('#sendBtn').addEventListener('click', sendComposer);

    // ============================================================
    // 8. เปิดหน้าเว็บบนเครื่องลูก
    // ============================================================
    const URLS_KEY = `af3_urls:${session.user}`;
    let recentUrls = store.get(URLS_KEY, []);
    const NAV_LABEL = { tab: 'แท็บที่ใช้ล่าสุด', all: 'ทุกแท็บที่ใช้งาน', new: 'แท็บใหม่' };

    function normalizeUrl(raw) {
        let u = String(raw || '').trim();
        if (!u) return '';
        if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;   // พิมพ์แค่ facebook.com/… ก็ได้
        return AFB.isWebUrl(u) ? u : '';
    }

    function renderUrls() {
        const wrap = $('#urlRecent');
        wrap.replaceChildren(...recentUrls.map(u => {
            let label = u;
            try { const x = new URL(u); label = x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname : ''); } catch { }
            return h('button', { class: 'qr url-chip', type: 'button', title: u, onclick: () => { $('#urlInput').value = u; $('#urlInput').focus(); } },
                h('span', { class: 't', text: label.length > 42 ? label.slice(0, 40) + '…' : label }));
        }));
    }

    function openUrl(raw, mode = $('#urlMode').value) {
        const url = normalizeUrl(raw);
        if (!url) { toast('ลิงก์ไม่ถูกต้อง (รับเฉพาะ http/https)', 'warn'); return false; }
        const ok = sendCommand({ kind: 'nav', url, mode, label: `🔗 ${url} (${NAV_LABEL[mode] || mode})` });
        if (ok) {
            recentUrls = [url, ...recentUrls.filter(x => x !== url)].slice(0, 6);
            store.set(URLS_KEY, recentUrls);
            renderUrls();
        }
        return ok;
    }

    $('#urlForm').addEventListener('submit', e => {
        e.preventDefault();
        if (openUrl($('#urlInput').value)) $('#urlInput').value = '';
    });
    $('#urlMode').value = store.get('af3_url_mode', 'tab');
    $('#urlMode').addEventListener('change', () => store.set('af3_url_mode', $('#urlMode').value));

    // ============================================================
    // 9. ข้อความด่วน
    // ============================================================
    let quick = store.get('af3_quick', ['CF', 'สนใจ', 'ขอราคาหน่อย', 'ขอบคุณ']);
    let editing = false;

    function renderQuick() {
        const wrap = $('#quick');
        wrap.classList.toggle('editing', editing);
        wrap.replaceChildren();
        if (!quick.length) wrap.append(h('div', { class: 'empty', style: 'flex:1', text: 'ยังไม่มีข้อความด่วน — กด "แก้ไข" เพื่อเพิ่ม' }));
        quick.forEach((text, i) => {
            const chip = h('button', { class: 'qr', type: 'button', title: editing ? 'ลบ' : `ส่ง "${text}"${i < 9 ? ` (Alt+${i + 1})` : ''}` },
                i < 9 ? h('span', { class: 'n', text: i + 1 }) : null,
                h('span', { class: 't', text }),
                h('span', { class: 'del', text: '✕' }));
            chip.addEventListener('click', () => {
                if (editing) {
                    quick.splice(i, 1);
                    store.set('af3_quick', quick);
                    renderQuick();
                } else {
                    send(text, chip);
                }
            });
            wrap.append(chip);
        });
    }

    $('#qrEdit').addEventListener('click', () => {
        editing = !editing;
        $('#qrEdit').textContent = editing ? 'เสร็จสิ้น' : 'แก้ไข';
        $('#qrForm').hidden = !editing;
        if (editing) {
            $('#qrInput').value = textEl.value.trim();   // บันทึกข้อความที่พิมพ์อยู่เป็นข้อความด่วนได้ทันที
            $('#qrInput').focus();
        }
        renderQuick();
    });

    $('#qrForm').addEventListener('submit', e => {
        e.preventDefault();
        const text = $('#qrInput').value.trim();
        if (!text) return;
        if (quick.includes(text)) return toast('มีข้อความนี้อยู่แล้ว', 'warn');
        quick.push(text);
        store.set('af3_quick', quick);
        $('#qrInput').value = '';
        renderQuick();
    });

    // Alt+1…9 = ส่งข้อความด่วน
    document.addEventListener('keydown', e => {
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        const m = /^Digit([1-9])$/.exec(e.code);
        if (!m) return;
        const i = +m[1] - 1;
        if (quick[i] === undefined) return;
        e.preventDefault();
        send(quick[i], $('#quick').children[i]);
    });

    // ============================================================
    // 10. เมนู + รหัสเชื่อมเครื่อง
    // ============================================================
    const menuBtn = $('#menuBtn');
    const menuList = $('#menuList');
    $('#extLink').href = C.EXTENSION_URL;
    menuBtn.addEventListener('click', e => {
        e.stopPropagation();
        menuList.hidden = !menuList.hidden;
        menuBtn.setAttribute('aria-expanded', String(!menuList.hidden));
    });
    document.addEventListener('click', e => {
        if (!menuList.hidden && !menuList.contains(e.target)) { menuList.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
    });
    $('#keysBtn').addEventListener('click', () => {
        toast('Enter = ส่ง (ถ้าเปิด "Enter = ส่ง") • Shift+Enter = ขึ้นบรรทัด • Esc = ล้างช่อง • Alt+1…9 = ข้อความด่วน', 'info', 6000);
    });

    // รหัสเชื่อมเครื่อง = เข้าสู่ระบบโปรไฟล์ Chrome/เครื่องอื่นได้โดยไม่ต้องพิมพ์รหัสผ่าน
    $('#pairBtn').addEventListener('click', () => {
        menuList.hidden = true;
        $('#pairCodeOut').value = AFB.makePairCode(session);
        $('#pairDlg').showModal();
        $('#pairCodeOut').select();
    });
    $('#pairCopy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText($('#pairCodeOut').value); } catch { $('#pairCodeOut').select(); document.execCommand('copy'); }
        toast('คัดลอกรหัสเชื่อมเครื่องแล้ว', 'ok');
    });
    $('#pairClose').addEventListener('click', () => $('#pairDlg').close());

    // ============================================================
    // 11. เริ่มต้น
    // ============================================================
    renderEnterHint();
    renderDevices();
    renderHistory();
    renderQuick();
    renderUrls();
    autoGrow();
    devLoop();
});
