# Meditation Webapp Demo Patch (2026-03-10)

ไฟล์ชุดนี้เป็น patch สำหรับแนวทางใหม่ดังนี้

- โหลดสถานะของวันนั้นทันทีเมื่อเลือกรายชื่อ/วันที่
- แสดง 3 รอบแบบชัดเจนว่าอันไหนทำแล้ว / ยังไม่ทำ
- รอบที่ทำแล้วถูก disable ไม่ให้เลือกซ้ำ
- หลังกดบันทึกยังมี popup สำเร็จเหมือนเดิม
- ลดภาระการอ่านชีตซ้ำ ๆ โดยใช้ cache รายวันใน Google Apps Script

## ไฟล์ที่ให้มา

- `index.html`
- `index-demo.html`
- `functions/api/_util.js`
- `functions/api/names.js`
- `functions/api/checkStatus.js`
- `functions/api/submit.js`
- `Code.gs`

## วิธีวางไฟล์

### ฝั่ง GitHub / Cloudflare
แทนที่ไฟล์เดิมใน repo ด้วยไฟล์ชุดนี้

- `index.html`
- `index-demo.html`
- `functions/api/_util.js`
- `functions/api/names.js`
- `functions/api/checkStatus.js`
- `functions/api/submit.js`

จากนั้น push ขึ้น GitHub แล้วให้ Cloudflare deploy ใหม่

### ฝั่ง Google Apps Script
แทนที่ `Code.gs` เดิมด้วย `Code.gs` ในชุดนี้ แล้ว Deploy Web App ใหม่

## สิ่งที่ต้องมีเหมือนเดิม

- Sheet `Responses`
- Sheet `People`
- headers ใน `Responses` ต้องเป็น:
  - `Timestamp`
  - `Name`
  - `Weekday`
  - `Session`
  - `Duration`
  - `LogDate`
  - `ClientNow`
  - `TzOffsetMin`

## หมายเหตุ

- Dashboard ยังใช้ schema เดิมได้
- checkStatus และ submit จะเร็วขึ้นก็ต่อเมื่อมีการใช้งานสถานะของวันนั้นซ้ำ เพราะมี cache รายวันช่วย
- ถ้าอยากให้ dropdown สีในตัวเลือก native select จริง ๆ จะทำได้จำกัด จึงเปลี่ยนเป็นการ์ดเลือก session แทน
