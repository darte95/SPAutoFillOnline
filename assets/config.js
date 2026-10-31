// ============================================================
// ค่าตั้งค่ากลางของหน้าเว็บ (Login / Dashboard / Admin)
// ============================================================
window.AF_CONFIG = Object.freeze({
    VERSION: '3.1.0',

    // Blynk — Admin token เก็บทะเบียนผู้ใช้ (ต้องตรงกับ extension/config.js)
    BLYNK_SERVER: 'https://sgp1.blynk.cloud',
    ADMIN_TOKEN: 'mv0IHbbPrtMdJHzR2vnlAdijTjZHnWms',
    PINS: Object.freeze({
        EXPIRY: 'V0', STATUS: 'V1', SLOTS: 'V2', USER: 'V3', PASS: 'V4',
        MSG: 'V5', LIVE: 'V6', STATE: 'V7',
        SLOT_BASE: 10,
    }),
    MAX_SLOTS: 40,                // จำนวนช่องผู้ใช้สูงสุดที่ระบบรองรับ (ช่องที่ 1–40 = V10…V49)

    REQUIRE_LOGIN: true,
    SESSION_DAYS: 7,              // "จดจำการเข้าสู่ระบบ"
    LICENSE_RECHECK_MIN: 5,       // ตรวจสิทธิ์ซ้ำระหว่างเปิด Dashboard
    HEARTBEAT_MS: 15000,          // Dashboard แจ้ง Extension ว่าเปิดอยู่ (V6) → Extension ถามถี่ขึ้น
    STATE_POLL_MS: 10000,         // อ่านสถานะ Extension (V7)
    ONLINE_WINDOW_MS: 150000,

    EXTENSION_URL: 'https://drive.google.com/file/d/181uiQCQimdAcIIQ9K9DW1H9gwb4JFlzZ/view?usp=sharing',
});
