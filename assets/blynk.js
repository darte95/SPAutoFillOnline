// ============================================================
// Auto-Fill v3 — ไลบรารี Blynk กลาง (ใช้ได้ทั้ง service worker, worker และหน้าเว็บ)
// ⚠ ไฟล์นี้มี 2 สำเนาที่ต้องเหมือนกัน: extension/lib/blynk.js และ web/assets/blynk.js
//
// ผังข้อมูลบน Blynk
//   Admin token (อุปกรณ์หลัก):  V0 วันหมดอายุ  V1 สถานะ  V3 ชื่อผู้ใช้  V4 รหัสผ่าน   ← ผู้ใช้หลัก (เดิม)
//                              V2 จำนวนช่องผู้ใช้ (แอดมินกำหนด)   V10… ช่องผู้ใช้ละ 1 พิน (JSON)
//   Token ของผู้ใช้แต่ละคน:      V5 ข้อความ  V6 สัญญาณ Dashboard เปิดอยู่  V7 สถานะ Extension
//   (ผู้ใช้หลักใช้ V5–V7 บน Admin token)
// ============================================================
(function (root) {
    'use strict';
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const PBKDF2_ITER = 150000;
    const MAX_BYTES = 1000;   // Blynk เก็บข้อความได้สูงสุด 1024 ไบต์

    // ============================================================
    // 1. อ่านค่าจาก Blynk (ตอบได้หลายรูปแบบ เช่น 1, "06-11-2569", ["06-11-2569"])
    // ============================================================
    function parse(v) {
        if (v == null) return '';
        if (Array.isArray(v)) return v.length && typeof v[0] === 'object' ? JSON.stringify(v) : parse(v[0]);
        if (typeof v === 'object') return JSON.stringify(v);   // ข้อมูล JSON ของระบบเอง ไม่ต้องแกะ
        if (typeof v !== 'string') return String(v);
        const t = v.trim();
        if (t.startsWith('[') || t.startsWith('"')) {
            try {
                const j = JSON.parse(t);
                return Array.isArray(j) && j.length && typeof j[0] === 'object' ? t : parse(j);
            } catch { return t.replace(/[\[\]"]/g, '').trim(); }
        }
        return t;
    }

    const isEmptyPin = err => err?.status === 400 && /have any value/i.test(err.message);
    const isMissingPin = err => err?.status === 400 && /doesn't exist|does not exist/i.test(err.message);

    function createClient({ server, timeoutMs = 8000, onRequest } = {}) {
        let multiGet = true;   // ปิดเองถ้าเซิร์ฟเวอร์ไม่รองรับอ่านหลายพินในคำขอเดียว

        async function request(op, token, query) {
            onRequest && onRequest();
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                const res = await fetch(`${server}/external/api/${op}?token=${encodeURIComponent(token)}${query ? '&' + query : ''}`, { cache: 'no-store', signal: ctrl.signal });
                const text = await res.text();
                if (!res.ok) {
                    const err = new Error(`Blynk ${res.status}: ${text.slice(0, 160)}`);
                    err.status = res.status;
                    throw err;
                }
                return text;
            } catch (err) {
                if (err.name === 'AbortError') throw Object.assign(new Error('Blynk timeout'), { timeout: true });
                throw err;
            } finally {
                clearTimeout(timer);
            }
        }

        // พินที่มีอยู่แต่ยังไม่เคยมีค่า Blynk ตอบ 400 "doesn't have any value yet" → ถือเป็นค่าว่าง
        async function getOne(token, pin) {
            try { return parse(await request('get', token, pin)); } catch (err) {
                if (isEmptyPin(err)) return '';
                throw err;
            }
        }

        async function getSingles(token, pins) {
            const values = await Promise.all(pins.map(p => getOne(token, p)));
            return Object.fromEntries(pins.map((p, i) => [p, values[i]]));
        }

        return {
            request,
            async get(token, pins) {
                if (pins.length === 1 || !multiGet) return getSingles(token, pins);
                const text = await request('get', token, pins.join('&'));
                let obj = null;
                try { obj = JSON.parse(text); } catch { /* รูปแบบไม่ตรง */ }
                if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                    const out = {};
                    for (const [k, v] of Object.entries(obj)) out[k.toUpperCase()] = parse(v);
                    // Blynk ตัดพินที่ยังไม่มีค่า หรือยังไม่ได้สร้าง ออกจากผลลัพธ์ (ตอบ 200) → ถือเป็นค่าว่าง
                    return Object.fromEntries(pins.map(p => [p, out[p] ?? '']));
                }
                multiGet = false;
                return getSingles(token, pins);
            },
            // อ่านหลายพินโดยยอมให้บางพินยังไม่ได้สร้าง (คืนค่าว่าง)
            async getLoose(token, pins) {
                try { return await this.get(token, pins); } catch (err) {
                    if (!err.status) throw err;   // เครือข่ายล่ม → ไม่ต้องลองทีละพิน
                }
                const settled = await Promise.allSettled(pins.map(p => getOne(token, p)));
                if (settled.every(s => s.status === 'rejected')) throw settled[0].reason;
                return Object.fromEntries(pins.map((p, i) => [p, settled[i].status === 'fulfilled' ? settled[i].value : '']));
            },
            // แยกให้ได้ว่าพินไหน "มีค่า / ว่าง / ยังไม่ได้สร้าง" (อ่านทีละพิน ทีละ 10 คำขอ) — ใช้ในหน้า Admin
            async probe(token, pins) {
                const out = {};
                for (let i = 0; i < pins.length; i += 10) {
                    const chunk = pins.slice(i, i + 10);
                    const settled = await Promise.allSettled(chunk.map(p => request('get', token, p)));
                    settled.forEach((s, k) => {
                        if (s.status === 'fulfilled') out[chunk[k]] = 'value';
                        else if (isEmptyPin(s.reason)) out[chunk[k]] = 'empty';
                        else if (isMissingPin(s.reason)) out[chunk[k]] = 'missing';
                        else throw s.reason;   // token ผิด / เครือข่ายล่ม
                    });
                }
                return out;
            },
            async update(token, values) {
                const pairs = Object.entries(values).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
                if (pairs.length === 1) return request('update', token, pairs[0]);
                try { return await request('batch/update', token, pairs.join('&')); } catch (err) {
                    if (!err.status || err.status === 401 || err.status === 403) throw err;
                }
                for (const p of pairs) await request('update', token, p);
            },
        };
    }

    // ============================================================
    // 2. วันที่ พ.ศ. + สิทธิ์การใช้งาน
    // ============================================================
    const thaiDate = {
        toISO(be) {
            const m = String(be || '').match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
            return m ? `${+m[3] - 543}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
        },
        fromISO(iso) {
            const [y, mo, d] = iso.split('-');
            return `${d}-${mo}-${+y + 543}`;
        },
        endOfDay(iso) {
            const [y, mo, d] = iso.split('-').map(Number);
            return new Date(y, mo - 1, d, 23, 59, 59).getTime();
        },
        daysLeft(iso) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return Math.floor((thaiDate.endOfDay(iso) - today.getTime()) / 86400000);
        },
    };

    const REASONS = {
        ok: ['ใช้งานได้', ''],
        suspended: ['ระงับการใช้งาน', 'บัญชีนี้ถูกปิดการใช้งานโดยผู้ดูแลระบบ'],
        expired: ['หมดอายุ', 'สิทธิ์การใช้งานของบัญชีนี้หมดอายุแล้ว'],
        invalid: ['ข้อมูลสิทธิ์ไม่ถูกต้อง', 'อ่านสถานะการใช้งานไม่ได้ กรุณาติดต่อผู้ดูแล'],
        baddate: ['ข้อมูลผิดพลาด', 'อ่านวันหมดอายุไม่ได้ กรุณาติดต่อผู้ดูแล'],
        revoked: ['บัญชีถูกเปลี่ยน', 'ชื่อผู้ใช้/รหัสผ่านถูกเปลี่ยนหรือลบโดยผู้ดูแล กรุณาเข้าสู่ระบบใหม่'],
    };

    function evaluate(statusRaw, expiryRaw) {
        const status = String(statusRaw ?? '').replace(/[^0-9]/g, '');
        if (status === '0') return { valid: false, reason: 'suspended' };
        if (status !== '1') return { valid: false, reason: 'invalid' };
        const iso = thaiDate.toISO(expiryRaw);
        if (!iso) return { valid: false, reason: 'baddate' };
        const expiry = thaiDate.endOfDay(iso);
        const info = { expiry, expiryText: thaiDate.fromISO(iso), daysLeft: thaiDate.daysLeft(iso) };
        return Date.now() > expiry ? { valid: false, reason: 'expired', ...info } : { valid: true, reason: 'ok', ...info };
    }

    // ============================================================
    // 3. เข้ารหัส: รหัสผ่านเก็บเป็น hash, token ของผู้ใช้เข้ารหัสด้วยรหัสผ่าน
    //    คนที่เปิดดูโค้ดหน้าเว็บจะไม่เห็นรหัสผ่านหรือ token ของผู้ใช้คนอื่น
    // ============================================================
    const b64 = {
        enc: bytes => btoa(String.fromCharCode(...bytes)),
        dec: str => Uint8Array.from(atob(str), c => c.charCodeAt(0)),
    };
    const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

    async function sha256hex(text) {
        return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
    }

    async function deriveKeys(password, saltB64) {
        const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
        const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: b64.dec(saltB64), iterations: PBKDF2_ITER, hash: 'SHA-256' }, material, 512));
        const key = await crypto.subtle.importKey('raw', bits.slice(32, 64), 'AES-GCM', false, ['encrypt', 'decrypt']);
        return { verifier: hex(bits.slice(0, 16)), key };
    }

    async function sealCredentials(password, token) {
        const salt = b64.enc(crypto.getRandomValues(new Uint8Array(16)));
        const { verifier, key } = await deriveKeys(password, salt);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token)));
        const sealed = new Uint8Array(iv.length + ct.length);
        sealed.set(iv);
        sealed.set(ct, iv.length);
        return { s: salt, h: verifier, k: b64.enc(sealed) };
    }

    async function openToken(sealedB64, key) {
        const all = b64.dec(sealedB64);
        return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12)));
    }

    // ============================================================
    // 4. ทะเบียนผู้ใช้ (เก็บบน Admin token)
    // ============================================================
    const slotPin = (cfg, i) => 'V' + (cfg.pins.SLOT_BASE + i - 1);

    function decodeSlot(raw) {
        if (!raw || raw === '-' || raw === '{}') return null;
        try { const o = JSON.parse(raw); return o && o.u ? o : null; } catch { return null; }
    }

    const fail = code => Object.assign(new Error(code), { code });

    // V2 = จำนวนช่องผู้ใช้ที่เปิดให้ใช้ (แอดมินกำหนด) — อ่านช่อง V10… ตามจำนวนนี้ (ไม่เกิน maxSlots)
    // ช่องที่ยังไม่ได้สร้าง Datastream หรือยังว่าง จะได้ค่าว่าง (ไม่ทำให้การเข้าสู่ระบบล้ม)
    async function readRegistry(client, cfg) {
        const P = cfg.pins;
        const head = await client.getLoose(cfg.adminToken, [P.EXPIRY, P.STATUS, P.SLOTS, P.USER, P.PASS]);
        const capacity = Math.max(0, parseInt(head[P.SLOTS], 10) || 0);
        const count = Math.min(cfg.maxSlots, capacity);
        const pins = Array.from({ length: count }, (_, k) => slotPin(cfg, k + 1));
        const raw = count ? await client.getLoose(cfg.adminToken, pins) : {};
        return {
            legacy: { user: head[P.USER], pass: head[P.PASS], status: head[P.STATUS], expiry: head[P.EXPIRY] },
            capacity,
            count,
            slots: pins.map((pin, k) => ({ index: k + 1, pin, data: decodeSlot(raw[pin]) })),
        };
    }

    // เข้าสู่ระบบ → คืนบัญชีพร้อม token ของผู้ใช้ (ผู้เรียกตัดสินเองว่าสิทธิ์หมดแล้วจะให้เข้าไหม)
    async function login(client, cfg, username, password) {
        const name = String(username || '').trim();
        if (!name || !password) throw fail('bad-credentials');
        const reg = await readRegistry(client, cfg);
        const L = reg.legacy;
        if (L.user && name === L.user && password === L.pass) {
            return { slot: 0, user: name, name, token: cfg.adminToken, verifier: await sha256hex(`${name}\n${password}`), ...evaluate(L.status, L.expiry) };
        }
        const slot = reg.slots.find(s => s.data && String(s.data.u).toLowerCase() === name.toLowerCase());
        if (!slot) throw fail('bad-credentials');
        const { verifier, key } = await deriveKeys(password, slot.data.s);
        if (verifier !== slot.data.h) throw fail('bad-credentials');
        let token;
        try { token = await openToken(slot.data.k, key); } catch { throw fail('bad-token'); }
        return { slot: slot.index, user: slot.data.u, name: slot.data.n || slot.data.u, token, verifier, ...evaluate(slot.data.on, slot.data.x) };
    }

    // ตรวจสิทธิ์ซ้ำโดยไม่ต้องใช้รหัสผ่าน (1 คำขอ)
    async function recheck(client, cfg, account) {
        const P = cfg.pins;
        if (account.slot === 0) {
            const v = await client.get(cfg.adminToken, [P.EXPIRY, P.STATUS, P.USER, P.PASS]);
            if (!v[P.USER] || v[P.USER] !== account.user || await sha256hex(`${v[P.USER]}\n${v[P.PASS]}`) !== account.verifier) {
                return { ...account, valid: false, reason: 'revoked' };
            }
            return { ...account, ...evaluate(v[P.STATUS], v[P.EXPIRY]) };
        }
        const pin = slotPin(cfg, account.slot);
        const s = decodeSlot((await client.get(cfg.adminToken, [pin]))[pin]);
        if (!s || s.u !== account.user || s.h !== account.verifier) return { ...account, valid: false, reason: 'revoked' };
        return { ...account, name: s.n || s.u, ...evaluate(s.on, s.x) };
    }

    // ============================================================
    // 5. รูปแบบข้อความ (V5) และสถานะ Extension (V7)
    //    V5 เก็บ "ข้อความล่าสุดไม่กี่รายการ" เป็น array — ส่งติดกันเร็วกว่ารอบที่ Extension ถาม
    //    ข้อความก่อนหน้าจะไม่หาย เพราะ Extension กรอกทุกรายการที่ยังไม่เคยเห็นตามลำดับ
    // ============================================================
    const FLAG = { ENTER: 1, CLICK: 2, CLEAR: 4 };
    const BATCH_MAX = 5;
    const BATCH_AGE_MS = 20000;
    const byteLength = s => enc.encode(String(s)).length;

    function packMessage({ id, text, autoEnter, clickSend, clearBefore, t }) {
        const o = (autoEnter ? FLAG.ENTER : 0) | (clickSend ? FLAG.CLICK : 0) | (clearBefore ? FLAG.CLEAR : 0);
        return { i: id, t: t || Date.now(), x: text, o };
    }

    const encodeMessage = msg => JSON.stringify(packMessage(msg));

    // รวมข้อความล่าสุด (เก่า→ใหม่) ให้พอดี 1000 ไบต์ — ตัดรายการเก่า/เกินอายุทิ้งก่อน
    // ห่อด้วย object {"m":[…]} เพื่อไม่ให้ถูกมองว่าเป็นค่าที่ Blynk ห่อด้วย [ ]
    function encodeBatch(packed) {
        let list = packed.filter(m => Date.now() - m.t < BATCH_AGE_MS).slice(-BATCH_MAX);
        if (!list.length && packed.length) list = packed.slice(-1);
        let json = JSON.stringify({ m: list });
        while (list.length > 1 && byteLength(json) > MAX_BYTES) {
            list = list.slice(1);
            json = JSON.stringify({ m: list });
        }
        return { json, list };
    }

    function unpack(m) {
        if (!m || !m.i || typeof m.x !== 'string') return null;
        return { id: String(m.i), text: m.x, sentAt: +m.t || 0, autoEnter: !!(m.o & FLAG.ENTER), clickSend: !!(m.o & FLAG.CLICK), clearBefore: !!(m.o & FLAG.CLEAR) };
    }

    // รับได้ทั้ง {"m":[…]}, array และรายการเดียว (object)
    function decodeMessages(raw) {
        try {
            const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const list = Array.isArray(v) ? v : Array.isArray(v?.m) ? v.m : [v];
            return list.map(unpack).filter(Boolean);
        } catch { return []; }
    }

    function decodeState(raw) {
        try { const s = JSON.parse(raw); return s && typeof s === 'object' ? s : null; } catch { return null; }
    }

    root.AFB = {
        MAX_BYTES, FLAG, REASONS, BATCH_MAX, BATCH_AGE_MS,
        parse, createClient, isEmptyPin, isMissingPin, thaiDate, evaluate,
        sha256hex, deriveKeys, sealCredentials, openToken,
        slotPin, decodeSlot, readRegistry, login, recheck,
        byteLength, packMessage, encodeMessage, encodeBatch, decodeMessages, decodeState,
    };
})(typeof self !== 'undefined' ? self : this);
