// ============================================================
// Auto-Fill v3 — Admin: จัดการผู้ใช้งาน (ช่องผู้ใช้บน Admin token) + ผู้ใช้หลัก
// ============================================================
(function () {
    'use strict';
    const C = window.AF_CONFIG;
    const P = C.PINS;
    const ADMIN = C.ADMIN_TOKEN;
    const { $, h, toast } = AF;
    const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

    let reg = null;   // ทะเบียนผู้ใช้ล่าสุดที่อ่านได้

    // ============================================================
    // 0. ตัวช่วย
    // ============================================================
    function showMsg(id, text, ok) {
        const el = $('#' + id);
        el.textContent = text;
        el.className = 'status-msg ' + (ok ? 'ok' : 'err');
        if (ok) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
    }

    async function busy(btn, label, fn) {
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.replaceChildren(h('span', { class: 'spinner sm' }), ' ' + label);
        try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = original; }
    }

    const pad = n => String(n).padStart(2, '0');
    const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // ต่ออายุนับจากวันหมดอายุเดิม หรือจากวันนี้ถ้าหมดอายุไปแล้ว
    function addDays(iso, days) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        let base = iso ? new Date(iso + 'T00:00:00') : today;
        if (base < today) base = today;
        base.setDate(base.getDate() + days);
        return toISO(base);
    }

    function setSeg(seg, value) {
        seg.dataset.value = value;
        seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.value === value));
    }

    document.querySelectorAll('.seg').forEach(seg => seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        setSeg(seg, b.dataset.value);
        seg.dispatchEvent(new Event('change'));
    })));

    document.querySelectorAll('.quick[data-for]').forEach(group => group.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
        const input = document.getElementById(group.dataset.for);
        input.value = addDays(input.value, Number(btn.dataset.add));
        input.dispatchEvent(new Event('input'));
    })));

    document.querySelectorAll('[data-peek]').forEach(btn => btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.peek);
        input.type = input.type === 'password' ? 'text' : 'password';
    }));

    function randomPassword() {
        const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
        return [...crypto.getRandomValues(new Uint8Array(10))].map(b => chars[b % chars.length]).join('');
    }

    function licenseLabel(on, expiry) {
        const r = AFB.evaluate(on, expiry);
        if (r.valid) return { text: `ถึง ${r.expiryText} • เหลือ ${r.daysLeft} วัน`, cls: r.daysLeft <= 3 ? 'warn' : 'good' };
        return { text: AF.reason(r.reason)[0] + (r.expiryText ? ` (${r.expiryText})` : ''), cls: 'bad' };
    }

    // เขียนแล้วอ่านกลับมายืนยัน (Blynk บางครั้งไม่บันทึกถ้าชนิด Datastream ไม่ตรง)
    async function writeVerified(values) {
        await AF.blynk.update(ADMIN, values);
        const saved = await AF.blynk.get(ADMIN, Object.keys(values));
        const wrong = Object.keys(values).filter(k => saved[k] !== String(values[k]));
        if (wrong.length) throw new Error(`${wrong.join(', ')} ไม่ถูกบันทึก — ตรวจสอบว่าสร้าง Datastream นี้ใน Blynk แล้ว และชนิดถูกต้อง`);
    }

    function explain(err) {
        if (AFB.isMissingPin(err)) return 'ยังไม่ได้สร้าง Datastream นี้ใน Blynk';
        if (err.status === 400) return /token/i.test(err.message) ? 'Token ไม่ถูกต้อง' : `Blynk ปฏิเสธ: ${err.message.replace(/^Blynk 400: /, '')}`;
        if (err.timeout) return 'Blynk ไม่ตอบสนอง (หมดเวลา)';
        return err.message || 'เชื่อมต่อ Blynk ไม่ได้';
    }

    // ============================================================
    // 1. รายการผู้ใช้
    // ============================================================
    function renderUsers() {
        const ul = $('#users');
        ul.replaceChildren();
        const used = reg.slots.filter(s => s.data);
        const enabled = used.filter(s => String(s.data.on) === '1').length;
        const usable = reg.slots.filter(s => !s.missing);
        $('#slotStats').textContent = `${used.length} คน • เปิดใช้ ${enabled} • ช่องพร้อมใช้ ${usable.length}/${reg.count}`;
        $('#addUser').disabled = !usable.some(s => !s.data);
        $('#capacity').value = reg.capacity;
        $('#capacityNote').textContent = reg.capacity > C.MAX_SLOTS ? `ระบบรองรับสูงสุด ${C.MAX_SLOTS} ช่อง` : `สูงสุด ${C.MAX_SLOTS}`;

        if (!reg.count) {
            ul.append(h('li', { class: 'user empty' },
                h('div', { class: 'slot', text: '—' }),
                h('div', { class: 'who' }, h('b', { text: 'ยังไม่ได้เปิดช่องผู้ใช้' }), h('span', { text: 'ตั้ง "จำนวนช่องผู้ใช้" ด้านบน แล้วสร้าง Datastream ของช่องใน Blynk' })),
                h('span')));
            return;
        }
        // ช่องที่ยังไม่ได้สร้าง Datastream → รวมเป็นช่วงเดียว แจ้งให้ไปสร้างใน Blynk
        const missingRanges = [];
        for (const s of reg.slots) {
            if (!s.missing) continue;
            const last = missingRanges[missingRanges.length - 1];
            if (last && last.to.index === s.index - 1) last.to = s; else missingRanges.push({ from: s, to: s });
        }
        for (const r of missingRanges) {
            const pins = r.from === r.to ? r.from.pin : `${r.from.pin}–${r.to.pin}`;
            const slots = r.from === r.to ? `#${r.from.index}` : `#${r.from.index}–#${r.to.index}`;
            ul.append(h('li', { class: 'user empty missing' },
                h('div', { class: 'slot' }, h('b', { text: '⚠' })),
                h('div', { class: 'who' },
                    h('b', { text: `ช่อง ${slots} ยังไม่ได้สร้าง Datastream` }),
                    h('span', { text: `สร้าง ${pins} (ชนิด String) ใน Template ของ Admin token แล้วกด "โหลดใหม่"` })),
                h('span')));
        }
        for (const s of reg.slots) {
            if (s.missing) continue;
            const slotBox = h('div', { class: 'slot' }, h('b', { text: `#${s.index}` }), s.pin);
            if (!s.data) {
                ul.append(h('li', { class: 'user empty' }, slotBox,
                    h('div', { class: 'who' }, h('b', { class: 'muted', text: 'ช่องว่าง' })),
                    h('button', { class: 'btn sm', text: '＋ ใช้ช่องนี้', onclick: () => openEditor(s.index) })));
                continue;
            }
            const d = s.data;
            const on = String(d.on) === '1';
            const lic = licenseLabel(d.on, d.x);
            const sw = h('input', { type: 'checkbox', 'aria-label': `เปิด/ปิด ${d.u}` });
            sw.checked = on;
            sw.addEventListener('change', () => setUserOn(s, sw.checked, sw));
            ul.append(h('li', { class: 'user' + (on ? '' : ' off') },
                slotBox,
                h('div', { class: 'who' },
                    h('b', { text: d.n && d.n !== d.u ? `${d.n} (${d.u})` : d.u }),
                    h('span', { class: lic.cls === 'bad' ? 'bad' : '' }, h('span', { class: 'badge ' + lic.cls, text: lic.text }), '  🔒 Token เข้ารหัสแล้ว')),
                h('label', { class: 'switch', title: on ? 'เปิดใช้งาน' : 'ระงับ' }, sw, h('span')),
                h('div', { class: 'acts' },
                    h('button', { class: 'btn sm', text: 'แก้ไข', onclick: () => openEditor(s.index) }),
                    h('button', { class: 'btn sm danger', text: 'ลบ', onclick: () => deleteUser(s) }))));
        }
    }

    async function setUserOn(s, on, sw) {
        sw.disabled = true;
        try {
            const fresh = AFB.decodeSlot((await AF.blynk.get(ADMIN, [s.pin]))[s.pin]);   // อ่านใหม่ กันทับการแก้ไขจากที่อื่น
            if (!fresh) throw new Error('ช่องนี้ถูกลบไปแล้ว');
            const next = { ...fresh, on: on ? 1 : 0 };
            await writeVerified({ [s.pin]: JSON.stringify(next) });
            s.data = next;
            toast(`${on ? 'เปิดใช้งาน' : 'ระงับ'} ${next.u} แล้ว`, on ? 'ok' : 'warn');
        } catch (err) {
            sw.checked = !on;
            toast('บันทึกไม่สำเร็จ: ' + explain(err), 'error');
        }
        sw.disabled = false;
        renderUsers();
    }

    async function deleteUser(s) {
        if (!confirm(`ลบผู้ใช้ "${s.data.u}" ออกจากช่อง #${s.index}?\nExtension และ Dashboard ของผู้ใช้นี้จะใช้งานไม่ได้ทันที`)) return;
        try {
            await writeVerified({ [s.pin]: '-' });
            toast(`ลบ ${s.data.u} แล้ว`, 'ok');
            await load();
        } catch (err) {
            toast('ลบไม่สำเร็จ: ' + explain(err), 'error');
        }
    }

    // ============================================================
    // 2. หน้าต่างเพิ่ม/แก้ไขผู้ใช้
    // ============================================================
    const dlg = $('#editor');
    let editing = null;   // { index, pin, data }

    function renderEdDays() {
        const iso = $('#edExpire').value;
        if (!iso) { $('#edDays').textContent = ''; return; }
        const days = AFB.thaiDate.daysLeft(iso);
        $('#edDays').textContent = days < 0 ? `(หมดอายุแล้ว ${-days} วัน)` : `(ใช้ได้อีก ${days} วัน)`;
    }

    function openEditor(index) {
        if (!index) {
            const empty = reg.slots.find(s => !s.data && !s.missing);
            if (!empty) return toast('ไม่มีช่องว่าง — สร้าง Datastream ของช่องเพิ่ม หรือเพิ่ม "จำนวนช่องผู้ใช้"', 'warn', 4500);
            index = empty.index;
        }
        const existing = reg.slots.find(s => s.index === index)?.data || null;
        editing = { index, pin: AFB.slotPin(AF.registry, index), data: existing };

        $('#edTitle').textContent = existing ? `แก้ไขผู้ใช้ — ช่อง #${index} (${editing.pin})` : `เพิ่มผู้ใช้ — ช่อง #${index} (${editing.pin})`;
        $('#edUser').value = existing?.u || '';
        $('#edName').value = existing?.n || '';
        setSeg($('#edStatus'), existing ? String(existing.on) === '1' ? '1' : '0' : '1');
        $('#edExpire').value = existing ? AFB.thaiDate.toISO(existing.x) : addDays('', 30);
        $('#edPass').value = '';
        $('#edPass').type = 'password';
        $('#edToken').value = '';
        $('#edTokenMsg').textContent = '';
        $('#edMsg').textContent = '';
        $('#edSecretHint').textContent = existing
            ? 'เว้นว่างทั้งสองช่อง = ใช้รหัสผ่านและ Token เดิม • ถ้าเปลี่ยนรหัสผ่าน ต้องใส่ Token ด้วย (Token เดิมถูกเข้ารหัสไว้ ระบบอ่านไม่ได้)'
            : 'ตั้งรหัสผ่านและใส่ Token ของ Device ผู้ใช้ (Token จะถูกเข้ารหัสด้วยรหัสผ่านก่อนบันทึก)';
        renderEdDays();
        dlg.showModal();
        (existing ? $('#edExpire') : $('#edUser')).focus();
    }

    $('#edExpire').addEventListener('input', renderEdDays);
    $('#edToken').addEventListener('input', () => { $('#edTokenMsg').textContent = ''; });
    $('#edGen').addEventListener('click', () => { $('#edPass').value = randomPassword(); $('#edPass').type = 'text'; });
    $('#edCancel').addEventListener('click', () => dlg.close());
    $('#addUser').addEventListener('click', () => openEditor());

    async function testToken(token) {
        const msg = $('#edTokenMsg');
        try {
            // อ่านทีละพิน เพราะการอ่านหลายพินของ Blynk จะตัดพินที่ไม่มีทิ้งเงียบ ๆ
            const result = await AF.blynk.probe(token, [P.MSG, P.LIVE, P.STATE]);
            const missing = Object.keys(result).filter(p => result[p] === 'missing');
            if (missing.length) {
                msg.textContent = `⚠ Token ใช้ได้ แต่ยังไม่มี Datastream ${missing.join(', ')} — สร้างเป็นชนิด String ใน Template ของ Device นี้`;
                msg.className = 'token-check err';
                return false;
            }
            msg.textContent = '✓ Token ใช้ได้ และมี Datastream V5–V7 ครบ';
            msg.className = 'token-check ok';
            return true;
        } catch (err) {
            msg.textContent = '✗ ' + explain(err);
            msg.className = 'token-check err';
            return false;
        }
    }

    $('#edTest').addEventListener('click', e => {
        const token = $('#edToken').value.trim();
        if (!TOKEN_RE.test(token)) { $('#edTokenMsg').textContent = '✗ รูปแบบ Token ไม่ถูกต้อง'; $('#edTokenMsg').className = 'token-check err'; return; }
        busy(e.currentTarget, 'กำลังตรวจ…', () => testToken(token));
    });

    $('#editorForm').addEventListener('submit', e => {
        e.preventDefault();
        busy($('#edSave'), 'กำลังบันทึก…', saveEditor);
    });

    async function saveEditor() {
        const user = $('#edUser').value.trim();
        const name = $('#edName').value.trim();
        const iso = $('#edExpire').value;
        const pass = $('#edPass').value;
        const token = $('#edToken').value.trim();
        const fail = text => showMsg('edMsg', text, false);

        if (!/^[^\s]{3,32}$/.test(user)) return fail('ชื่อผู้ใช้ต้องมี 3–32 ตัวอักษร และไม่มีช่องว่าง');
        const taken = (reg.legacy.user && reg.legacy.user.toLowerCase() === user.toLowerCase())
            || reg.slots.some(s => s.data && s.index !== editing.index && String(s.data.u).toLowerCase() === user.toLowerCase());
        if (taken) return fail('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
        if (!iso) return fail('กรุณาเลือกวันหมดอายุ');

        const changingSecret = !!(pass || token) || !editing.data;
        let secret = editing.data ? { s: editing.data.s, h: editing.data.h, k: editing.data.k } : null;
        if (changingSecret) {
            if (pass.length < 4) return fail('รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');
            if (!TOKEN_RE.test(token)) return fail('กรุณาใส่ Blynk Auth Token ของผู้ใช้ให้ถูกต้อง');
            if (token === ADMIN) return fail('ห้ามใช้ Admin token — สร้าง Device ใหม่ให้ผู้ใช้คนนี้');
            if (!(await testToken(token)) && !confirm('ตรวจ Token ไม่ผ่าน ยังต้องการบันทึกต่อหรือไม่?')) return;
            secret = await AFB.sealCredentials(pass, token);
        }

        const slot = { u: user, n: name || undefined, on: $('#edStatus').dataset.value === '1' ? 1 : 0, x: AFB.thaiDate.fromISO(iso), ...secret };
        const json = JSON.stringify(slot);
        if (AFB.byteLength(json) > AFB.MAX_BYTES) return fail('ข้อมูลยาวเกินไป — ลดความยาวชื่อที่แสดง');

        try {
            await writeVerified({ [editing.pin]: json });
        } catch (err) {
            return fail(explain(err));
        }
        dlg.close();
        toast(changingSecret ? `บันทึก ${user} แล้ว — แจ้งรหัสผ่านให้ผู้ใช้` : `บันทึก ${user} แล้ว`, 'ok', 4000);
        await load();
    }

    // ============================================================
    // 3. ผู้ใช้หลัก (V0, V1, V3, V4 บน Admin token)
    // ============================================================
    function renderLegacySummary() {
        const iso = $('#expireDate').value;
        const el = $('#licSummary');
        if ($('#statusSeg').dataset.value === '0') { el.textContent = '🔴 ระงับการใช้งาน'; return; }
        if (!iso) { el.textContent = 'ยังไม่ได้เลือกวันหมดอายุ'; return; }
        const days = AFB.thaiDate.daysLeft(iso);
        el.textContent = days < 0 ? `หมดอายุแล้ว ${-days} วัน` : days === 0 ? 'หมดอายุสิ้นวันนี้' : `ใช้ได้อีก ${days} วัน`;
    }

    function renderLegacyBadge(status, expiry) {
        const lic = licenseLabel(status, expiry);
        $('#licBadge').textContent = lic.text;
        $('#licBadge').className = 'badge ' + lic.cls;
        $('#licSaved').textContent = expiry ? `ในระบบ: ${expiry}` : '';
    }

    $('#statusSeg').addEventListener('change', renderLegacySummary);
    $('#expireDate').addEventListener('input', renderLegacySummary);

    $('#saveLegacy').addEventListener('click', e => busy(e.currentTarget, 'กำลังบันทึก…', async () => {
        const iso = $('#expireDate').value;
        const user = $('#username').value.trim();
        const pass = $('#password').value.trim();
        if (!iso) return showMsg('msgLegacy', 'กรุณาเลือกวันหมดอายุ', false);
        if (!user || !pass) return showMsg('msgLegacy', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน (ปิดผู้ใช้หลักได้ด้วยการเลือก "ระงับ")', false);
        if (reg.slots.some(s => s.data && String(s.data.u).toLowerCase() === user.toLowerCase())) return showMsg('msgLegacy', 'ชื่อผู้ใช้นี้ซ้ำกับผู้ใช้ในช่องอื่น', false);
        const status = $('#statusSeg').dataset.value;
        const date = AFB.thaiDate.fromISO(iso);
        try {
            await writeVerified({ [P.EXPIRY]: date, [P.STATUS]: status, [P.USER]: user, [P.PASS]: pass });
            Object.assign(reg.legacy, { user, pass, status, expiry: date });
            renderLegacyBadge(status, date);
            showMsg('msgLegacy', `บันทึกและยืนยันแล้ว: ${status === '1' ? 'เปิดใช้งาน' : 'ระงับ'} • หมดอายุ ${date}`, true);
        } catch (err) {
            showMsg('msgLegacy', explain(err), false);
        }
    }));

    function fillLegacy() {
        const L = reg.legacy;
        setSeg($('#statusSeg'), String(L.status).replace(/[^0-9]/g, '') === '0' ? '0' : '1');
        $('#expireDate').value = AFB.thaiDate.toISO(L.expiry);
        $('#username').value = L.user;
        $('#password').value = L.pass;
        renderLegacySummary();
        renderLegacyBadge(L.status, L.expiry);
    }

    // ============================================================
    // 4. โหลดข้อมูล + ข้อมูลระบบ
    // ============================================================
    async function load() {
        $('#slotStats').textContent = 'กำลังโหลด…';
        try {
            const t0 = performance.now();
            reg = await AFB.readRegistry(AF.blynk, AF.registry);
            $('#infoBlynk').textContent = `ออนไลน์ • ${Math.round(performance.now() - t0)}ms`;
            const unknown = reg.slots.filter(s => !s.data).map(s => s.pin);
            if (unknown.length) {
                const kinds = await AF.blynk.probe(ADMIN, unknown);
                for (const s of reg.slots) s.missing = kinds[s.pin] === 'missing';
            }
            renderUsers();
            fillLegacy();
        } catch (err) {
            console.error(err);
            $('#slotStats').textContent = 'โหลดไม่สำเร็จ';
            $('#infoBlynk').textContent = 'เชื่อมต่อไม่ได้';
            toast('โหลดข้อมูลจาก Blynk ไม่สำเร็จ: ' + explain(err), 'error', 5000);
        }
    }

    $('#reloadBtn').addEventListener('click', load);

    $('#capacityForm').addEventListener('submit', e => {
        e.preventDefault();
        const n = Math.round(Number($('#capacity').value));
        if (!(n >= 0 && n <= C.MAX_SLOTS)) return toast(`จำนวนช่องต้องอยู่ระหว่าง 0–${C.MAX_SLOTS}`, 'warn');
        const lost = reg.slots.filter(s => s.data && s.index > n);
        if (lost.length && !confirm(`ผู้ใช้ในช่องที่เกิน ${n} (${lost.map(s => s.data.u).join(', ')}) จะเข้าสู่ระบบไม่ได้จนกว่าจะเพิ่มจำนวนช่องกลับ ต้องการทำต่อหรือไม่?`)) return;
        busy($('#capacitySave'), 'กำลังบันทึก…', async () => {
            try {
                await writeVerified({ [P.SLOTS]: n });
                toast(`ตั้งจำนวนช่องผู้ใช้เป็น ${n} แล้ว`, 'ok');
                await load();
            } catch (err) {
                toast('บันทึกไม่สำเร็จ: ' + explain(err), 'error');
            }
        });
    });

    $('#pingBtn').addEventListener('click', e => busy(e.currentTarget, 'กำลังทดสอบ…', async () => {
        try {
            const t0 = performance.now();
            await AF.blynk.request('get', ADMIN, P.STATUS);
            $('#infoBlynk').textContent = `ออนไลน์ • ${Math.round(performance.now() - t0)}ms`;
        } catch (err) { $('#infoBlynk').textContent = explain(err); }
    }));

    $('#infoMax').textContent = `${C.MAX_SLOTS} คน (${AFB.slotPin(AF.registry, 1)}–${AFB.slotPin(AF.registry, C.MAX_SLOTS)})`;
    $('#slotRange').textContent = `${AFB.slotPin(AF.registry, 1)}–${AFB.slotPin(AF.registry, C.MAX_SLOTS)}`;
    setSeg($('#statusSeg'), '1');
    load();
})();
