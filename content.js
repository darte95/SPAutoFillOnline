const DATABASE_URL = "https://myiot-92b38-default-rtdb.asia-southeast1.firebasedatabase.app";
const AUTOFILL_URL = `${DATABASE_URL}/autofill.json`;

const evtSource = new EventSource(AUTOFILL_URL);

let activeChatBox = null; // ตัวแปรเก็บช่องแชทที่กำลังถูกเลือก

// ============================================================
// 1. ระบบตรวจจับและสร้าง "กรอบสีเหลือง" ให้กล่องข้อความที่ถูกคลิก
// ============================================================
document.addEventListener('focusin', function(e) {
    let target = e.target;
    
    // ค้นหา Element ที่เป็นกล่องข้อความของ Facebook (contenteditable)
    while (target && target !== document.body) {
        if (target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox') {
            
            // เอาสีเหลืองออกจากกล่องเก่าที่เคยคลิก (ถ้ามี)
            if (activeChatBox && activeChatBox !== target) {
                activeChatBox.style.outline = "none";
            }
            
            // ใส่กรอบสีเหลืองให้กล่องใหม่ที่เพิ่งคลิก
            activeChatBox = target;
            activeChatBox.style.outline = "3px solid #FFD700"; // สีเหลืองทอง
            activeChatBox.style.outlineOffset = "2px";
            activeChatBox.style.borderRadius = "8px"; // ลบขอบเหลี่ยมให้ดูมนเข้ากับ Facebook
            
            break;
        }
        target = target.parentElement;
    }
});

// ============================================================
// 2. ระบบรับข้อมูลและกรอก
// ============================================================
evtSource.addEventListener("put", function(e) {
    const payload = JSON.parse(e.data);
    const data = payload.data;
    
    if (data && typeof data === 'object' && payload.path === "/") {
        fillFacebookBox(data);
    }
});

function fillFacebookBox(data) {
    if (!data.fb_text || data.fb_text === "") return;

    // เลือกเป้าหมาย: พยายามใช้กล่องที่เพิ่งคลิก (มีกรอบสีเหลือง) ก่อน ถ้าไม่มีค่อยใช้ XPath เดิม
    let targetElement = null;
    
    if (activeChatBox) {
        targetElement = activeChatBox;
    } else {
        const inputXpath = "/html/body/div[1]/div/div[1]/div/div[5]/div[1]/div[1]/div[1]/div/div/div/div/div/div/div/div[2]/div[2]/div/div/div[2]/div/div[2]/div/div[1]/div[1]/p";
        targetElement = document.evaluate(inputXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    }

    if (targetElement) {
        // นำ Cursor ไปโฟกัส
        targetElement.focus();
        
        // พิมพ์ข้อความ
        document.execCommand('insertText', false, data.fb_text);
        
        // ทำให้สีเหลืองกระพริบ เพื่อให้รู้ว่าข้อความถูกส่งเข้ามาแล้ว
        const originalOutline = targetElement.style.outline;
        targetElement.style.outline = "4px solid #FF4500"; // เปลี่ยนเป็นสีส้มแดงแป๊บเดียว
        setTimeout(() => {
            targetElement.style.outline = originalOutline;
        }, 300);
        
        // สั่งกด Enter
        if (data.auto_enter) {
            setTimeout(() => {
                const enterEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", keyCode: 13 });
                targetElement.dispatchEvent(enterEvent);
            }, 300);
        }

        // สั่งคลิกปุ่ม SVG (ค่าถูกซ่อนไว้ใน Dashboard แต่ยังส่งมาเป็น true ได้)
        if (data.click_svg) {
            setTimeout(() => {
                const svgXpath = "//*[starts-with(@id, 'mount_0_0_')]/div/div[1]/div/div[5]/div[1]/div[1]/div[1]/div[1]/div/div/div/div/div/div/div[2]/div[2]/div/div/span/div/svg/path";
                const svgPathElement = document.evaluate(svgXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                
                if (svgPathElement) {
                    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                    svgPathElement.dispatchEvent(clickEvent);
                }
            }, 500);
        }

    } else {
        console.warn("ไม่พบกล่องข้อความ กรุณาคลิกเลือกช่องแชทบนหน้า Facebook เพื่อให้กรอบสีเหลืองขึ้นก่อนส่งข้อความ");
    }
}