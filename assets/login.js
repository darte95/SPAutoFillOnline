// ============================================================
// Auto-Fill v3 — หน้าเข้าสู่ระบบ
// ============================================================
(function () {
    'use strict';
    const { $, session } = AF;
    const form = $('#loginForm');
    const btn = $('#loginBtn');
    const msg = $('#msg');

    const NOTICES = {
        revoked: 'บัญชีถูกเปลี่ยนโดยผู้ดูแล กรุณาเข้าสู่ระบบใหม่',
        logout: 'ออกจากระบบแล้ว',
        expired: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
    };

    // เข้าสู่ระบบค้างไว้แล้ว → ไปหน้า Dashboard ทันที
    const reason = new URLSearchParams(location.search).get('reason');
    if (!reason && session.get()) location.replace('dashboard.html');
    if (NOTICES[reason]) showMsg(NOTICES[reason], 'info');

    function showMsg(text, type = 'error') {
        msg.textContent = text;
        msg.className = 'msg' + (type === 'info' ? ' info' : '');
    }

    function fail(text) {
        showMsg(text);
        $('#card').classList.remove('shake');
        void $('#card').offsetWidth;
        $('#card').classList.add('shake');
        btn.disabled = false;
        btn.textContent = 'เข้าสู่ระบบ';
    }

    $('#peek').addEventListener('click', () => {
        const input = $('#password');
        input.type = input.type === 'password' ? 'text' : 'password';
        input.focus();
    });

    $('#password').addEventListener('keyup', e => {
        $('#caps').hidden = !e.getModifierState?.('CapsLock');
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const user = $('#username').value.trim();
        const pass = $('#password').value;
        if (!user || !pass) return fail('กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน');

        btn.disabled = true;
        btn.replaceChildren(AF.h('span', { class: 'spinner sm' }), ' กำลังตรวจสอบ…');
        showMsg('', 'info');

        try {
            const account = await AFB.login(AF.blynk, AF.registry, user, pass);
            if (!account.valid) {
                const [title, message] = AF.reason(account.reason);
                return fail(`${title}: ${message}`);
            }
            session.save(account, $('#remember').checked);
            AF.sessionStore.set('af3_license', { valid: true, reason: account.reason, expiryText: account.expiryText, daysLeft: account.daysLeft, at: Date.now() });
            btn.classList.replace('primary', 'success');
            btn.textContent = '✓ เข้าสู่ระบบสำเร็จ';
            location.replace('dashboard.html');
        } catch (err) {
            console.error(err);
            if (err.code === 'bad-credentials') return fail('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
            if (err.code === 'bad-token') return fail('ข้อมูลบัญชีเสียหาย กรุณาติดต่อผู้ดูแล');
            fail('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่');
        }
    });

    $('#username').focus();
})();
