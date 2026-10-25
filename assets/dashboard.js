// ============================================================
// Auto-Fill v3 — Dashboard (ส่งข้อความผ่าน Blynk ถึง Extension ของผู้ใช้คนนี้เท่านั้น)
// ============================================================
(function () {
    'use strict';
    const C = window.AF_CONFIG;
    const P = C.PINS;
    const { $, h, store, toast } = AF;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ============================================================
    // 0. ต้องเข้าสู่ระบบก่อน
    // ============================================================
    const session = AF.session.get();
    if (C.REQUIRE_LOGIN && !session) {
        location.replace('index.html');
        return;
    }
    const token = session.token;
    $('#userLabel').textContent = `👤 ${session.name || session.user}`;

    function logout(reason) {
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
    const gate = $('#gate');

    function showGate(title, message, isError) {
        gate.hidden = false;
        gate.classList.remove('hide');
        gate.classList.toggle('error', !!isError);
        $('#gateTitle').textContent = title;
        $('#gateMsg').textContent = message;
        $('#gateActions').hidden = !isError;
    }

    function hideGate() {
        if (gate.hidden) return;
        gate.classList.add('hide');
        setTimeout(() => { gate.hidden = true; }, 300);
    }

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
    // 3. สัญญาณ "Dashboard เปิดอยู่" (V6) → Extension สลับเป็นโหมดรับเร็ว
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
        readState();
        if (Date.now() - lastVerify > 5 * 60000) verify();
    });

    // ============================================================
    // 4. สถานะ Extension (V7)
    // ============================================================
    let ext = null;          // สถานะล่าสุดที่อ่านได้
    let extError = '';
    let stateTimer = 0;
    const openedAt = Date.now();

    const extOnline = st => !!st && Math.abs(Date.now() - (st.s || 0)) < C.ONLINE_WINDOW_MS;
    const EXT_MODE = {
        live: ['พร้อม — รับข้อความทันที', 'live'],
        standby: [`กำลังสลับเป็นโหมดเร็ว… (ไม่เกิน ~8 วินาที)`, 'standby'],
        idle: ['ยังไม่มีแท็บที่ใช้งาน — เปิด Facebook แล้วเลือกช่อง', 'idle'],
        off: ['ปิดระบบอยู่ (เปิดได้ที่ไอคอน Extension)', ''],
    };

    function renderExt() {
        const online = extOnline(ext);
        const [modeText, dot] = online ? (EXT_MODE[ext.m] || EXT_MODE.off) : ['ออฟไลน์', ''];
        $('#extDot').className = 'big-dot ' + dot;
        if (!ext) {
            $('#extName').textContent = extError ? 'อ่านสถานะไม่ได้' : 'ยังไม่พบ Extension';
            $('#extMeta').textContent = extError || 'ติดตั้ง Extension v3 แล้วเข้าสู่ระบบด้วยบัญชีนี้ที่ไอคอน Extension';
        } else {
            $('#extName').textContent = `${ext.n || 'Extension'}${ext.v ? ' • v' + ext.v : ''}`;
            $('#extMeta').textContent = online ? `${modeText} • อัปเดต ${AF.timeAgo(ext.s)}` : `ออฟไลน์ • ติดต่อล่าสุด ${AF.timeAgo(ext.s)}`;
        }
        $('#extTabs').textContent = online ? ext.tb ?? 0 : '–';
        $('#extReady').textContent = online ? ext.rd ?? 0 : '–';
        $('#extSpeed').textContent = online && ext.m === 'live' ? `${(ext.pi || 700) / 1000} วิ` : online && ext.m === 'standby' ? '8 วิ' : '–';
        $('#extHint').textContent = online && ext.rd === 0 && ext.tb > 0 ? '⚠ ยังไม่ได้เลือกช่องกรอก — คลิกที่ช่องคอมเมนต์ หรือ Alt+คลิก เพื่อล็อก' : '';
    }

    async function readState() {
        try {
            const v = await AF.blynk.get(token, [P.STATE]);
            ext = AFB.decodeState(v[P.STATE]);
            extError = '';
        } catch (err) {
            extError = err.status === 400 ? 'ตรวจสอบว่าสร้าง Datastream V5–V7 ใน Blynk แล้ว' : 'เชื่อมต่อ Blynk ไม่ได้';
        }
        renderExt();
        checkAcks();
        return ext;
    }

    // อ่านถี่ขึ้นช่วงแรกที่เปิดหน้า เพื่อให้เห็นตอน Extension สลับเป็นโหมดเร็ว
    async function stateLoop() {
        clearTimeout(stateTimer);
        if (!document.hidden) await readState();
        const warming = Date.now() - openedAt < 45000 && !(extOnline(ext) && ext.m === 'live');
        stateTimer = setTimeout(stateLoop, warming ? 3000 : C.STATE_POLL_MS);
    }

    $('#extRefresh').addEventListener('click', readState);
    setInterval(renderExt, 5000);

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
            ul.append(h('li', { class: `hist s-${res.cls || 'sending'}` },
                h('div', { class: 'body' },
                    h('div', { class: 'text', text: item.text }),
                    h('div', { class: 'meta', text: `${AF.clock(item.at)}${res.text ? ' • ' + res.text : ''}` })),
                h('div', { class: 'acts' },
                    h('button', { title: 'ส่งซ้ำ', 'aria-label': 'ส่งซ้ำ', text: '↻', onclick: () => send(item.text) }),
                    h('button', { title: 'แก้ไขแล้วส่ง', 'aria-label': 'แก้ไข', text: '✎', onclick: () => setComposer(item.text) }),
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
    // 6. ส่งข้อความ
    //    V5 เก็บข้อความล่าสุดหลายรายการ (ไม่เกิน 5 รายการ / 20 วินาที) — ส่งติดกันเร็ว ๆ
    //    Extension ก็ยังได้ครบทุกข้อความตามลำดับ ไม่ถูกทับหาย
    // ============================================================
    const queue = [];
    const pending = new Set();   // ส่งแล้ว รอผลจาก Extension
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
        const a = rec.ack;
        if (a) {
            const ms = rec.ms != null ? ` • ${rec.ms}ms` : '';
            if (!a.ok && !a.f) return { cls: 'warn', text: '⚠ ไม่มีแท็บที่พร้อมกรอก' + ms };
            const parts = [a.ok ? `✓ กรอกแล้ว ${a.ok} แท็บ` : '⚠ กรอกไม่สำเร็จ'];
            if (a.f) parts.push(`⚠ หาช่องไม่เจอ ${a.f}`);
            return { cls: a.ok && !a.f ? 'ok' : 'warn', text: parts.join(' • ') + ms };
        }
        if (!rec.done) return { cls: 'sending', text: 'ส่งแล้ว • รอ Extension…' };
        if (!extOnline(ext)) return { cls: 'warn', text: 'ส่งแล้ว แต่ Extension ไม่ได้ออนไลน์' };
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

    function checkAcks() {
        const acks = [].concat(ext?.a || []);
        if (!acks.length) return;
        for (const rec of pending) {
            const a = acks.find(x => x.i === rec.id);
            if (a) {
                rec.ack = a;
                rec.ms = Math.round(performance.now() - rec.t0);
                finish(rec);
            }
        }
    }

    function finish(rec) {
        pending.delete(rec);
        clearTimeout(rec.timer);
        rec.done = true;
        updateRec(rec);
    }

    // หลังส่ง: อ่าน V7 ถี่ ๆ จนเห็นผลยืนยัน (Extension โหมดพักจะถามทุก ~8 วิ จึงรอนานพอ)
    async function watchAck(rec) {
        rec.timer = setTimeout(() => finish(rec), 15000);
        for (const wait of [600, 600, 700, 800, 1000, 1500, 2000, 2500, 3000, 3000]) {
            await sleep(wait);
            if (!pending.has(rec)) return;
            await readState();
        }
    }

    async function deliver(rec) {
        recent.push(AFB.packMessage({ id: rec.id, text: rec.item.text, ...rec.opts }));
        const batch = AFB.encodeBatch(recent);
        recent = batch.list;
        AF.sessionStore.set(RECENT_KEY, recent);
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

    function send(raw, chip) {
        const text = String(raw || '').trim();
        if (!text) return false;
        if (!licenseOK) { toast('ระบบยังไม่พร้อมใช้งาน (ตรวจสอบสิทธิ์ไม่ผ่าน)', 'error'); return false; }
        const id = AF.uid();
        const sendOpts = { autoEnter: opts.autoEnter, clickSend: opts.clickSend, clearBefore: opts.clearBefore };
        if (AFB.byteLength(`[${AFB.encodeMessage({ id, text, ...sendOpts })}]`) > AFB.MAX_BYTES) {
            toast('ข้อความยาวเกินไป (Blynk เก็บได้ไม่เกิน ~1000 ไบต์)', 'error');
            return false;
        }
        const item = { id, text, at: Date.now(), res: null };
        history.unshift(item);
        history = history.slice(0, HISTORY_MAX);
        const rec = { id, item, opts: sendOpts, sent: false, done: false, error: '', ack: null, ms: null, t0: 0 };
        lastRec = rec;
        queue.push(rec);
        updateRec(rec);
        if (chip) { chip.classList.remove('sent'); void chip.offsetWidth; chip.classList.add('sent'); }
        pump();
        return true;
    }

    // ============================================================
    // 7. ช่องพิมพ์ข้อความ
    // ============================================================
    const textEl = $('#text');

    function autoGrow() {
        textEl.style.height = 'auto';
        textEl.style.height = Math.min(textEl.scrollHeight + 2, 260) + 'px';
        const bytes = AFB.byteLength(textEl.value);
        const limit = AFB.MAX_BYTES - 60;   // เผื่อพื้นที่ให้ id/ตัวเลือก
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
    // 8. ข้อความด่วน
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
    // 9. เมนู
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

    // ============================================================
    // 10. เริ่มต้น
    // ============================================================
    renderEnterHint();
    renderExt();
    renderHistory();
    renderQuick();
    autoGrow();
    stateLoop();
})();
