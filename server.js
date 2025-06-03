require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const fs = require('fs');
const app = express();

// טעינת לקוחות
let customers = [];
let serviceCallCounter = 10001;

try {
    const customersData = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
    customers = customersData.map(client => ({
        id: client["מספר לקוח"],
        name: client["שם לקוח"],
        site: client["שם החניון"],
        phone: client["טלפון"],
        address: client["כתובת הלקוח"],
        email: client["מייל"]
    }));
    console.log(`📊 נטענו ${customers.length} לקוחות`);
} catch (error) {
    console.error('❌ שגיאה בטעינת לקוחות:', error.message);
    customers = [{ id: 555, name: "דרור פרינץ", site: "חניון רימון", phone: "0545-484210", address: "רימון 8 רמת אפעל", email: "Dror@sbparking.co.il" }];
}

// מערכת זיכרון פשוטה
class SimpleMemory {
    constructor() {
        this.conversations = new Map();
        this.maxAge = 4 * 60 * 60 * 1000; // 4 שעות
        setInterval(() => this.cleanup(), 60 * 60 * 1000); // ניקוי כל שעה
    }
    
    add(phone, message, sender, customer = null) {
        const key = customer ? `${customer.id}_${phone}` : phone;
        if (!this.conversations.has(key)) {
            this.conversations.set(key, {
                customer, messages: [], startTime: new Date(), 
                lastActivity: new Date(), stage: 'greeting'
            });
        }
        const conv = this.conversations.get(key);
        conv.messages.push({ timestamp: new Date(), sender, message });
        conv.lastActivity = new Date();
        return conv;
    }
    
    get(phone, customer = null) {
        const key = customer ? `${customer.id}_${phone}` : phone;
        return this.conversations.get(key) || null;
    }
    
    updateStage(phone, stage, customer = null) {
        const key = customer ? `${customer.id}_${phone}` : phone;
        const conv = this.conversations.get(key);
        if (conv) conv.stage = stage;
    }
    
    cleanup() {
        const now = new Date();
        for (const [key, conv] of this.conversations.entries()) {
            if (now - conv.lastActivity > this.maxAge) {
                this.conversations.delete(key);
            }
        }
    }
}

const memory = new SimpleMemory();

// הגדרות
app.use(express.json());
app.use(express.static('public'));

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.012.net.il',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER || 'Report@sbparking.co.il',
        pass: process.env.EMAIL_PASS || 'o51W38D5'
    }
});

// חיפוש לקוח
function findCustomer(phone) {
    const cleanPhone = phone.replace(/[^\d]/g, '');
    return customers.find(c => {
        if (!c.phone) return false;
        const customerPhone = c.phone.replace(/[^\d]/g, '');
        return customerPhone === cleanPhone || 
               customerPhone === cleanPhone.substring(3) || 
               ('972' + customerPhone) === cleanPhone;
    });
}

// תגובה חכמה
function generateResponse(message, customer, context) {
    const msg = message.toLowerCase();
    
    // תפריט ראשי
    if (msg === '1' || msg.includes('תקלה')) {
        return { response: `שלום ${customer.name} 👋\n\nבאיזו יחידה יש תקלה?\n(מספר יחידה: 101, 204, 603)\n\n📞 039792365`, stage: 'unit_number' };
    }
    
    if (msg === '2' || msg.includes('נזק')) {
        return { response: `שלום ${customer.name} 👋\n\nאנא צלם את הנזק ושלח תמונה + מספר היחידה\n(לדוגמה: תמונה + "יחידה 101")\n\n📞 039792365`, stage: 'damage_photo' };
    }
    
    if (msg === '3' || msg.includes('מחיר')) {
        return { response: `שלום ${customer.name} 👋\n\nמה אתה צריך?\n1️⃣ כרטיסים\n2️⃣ גלילים\n3️⃣ זרועות\n4️⃣ אחר\n\n📞 039792365`, stage: 'equipment' };
    }
    
    // זיהוי יחידה
    const unitMatch = msg.match(/(\d{3})|יחידה\s*(\d{1,3})/);
    if (unitMatch && context?.stage === 'unit_number') {
        const unit = unitMatch[1] || unitMatch[2];
        return { response: `יחידה ${unit} - מה בדיוק התקלה?\n• האם היחידה דולקת?\n• מה קורה כשמנסים להשתמש?\n\n📞 039792365`, stage: 'problem_description' };
    }
    
    // פתרון תקלה
    if (context?.stage === 'problem_description') {
        let solution = '🔧 **פתרון מיידי:**\n\n';
        if (msg.includes('לא דולק')) {
            solution += '1️⃣ בדוק מתג הפעלה\n2️⃣ בדוק נתיכים\n3️⃣ בדוק חיבור חשמל\n\n';
        } else if (msg.includes('כרטיס')) {
            solution += '1️⃣ נקה קורא כרטיסים\n2️⃣ נסה כרטיס חדש\n3️⃣ בדוק חריץ נקי\n\n';
        } else {
            solution += '1️⃣ אתחל המכונה\n2️⃣ בדוק חיבורים\n3️⃣ נקה בעדינות\n\n';
        }
        solution += `📞 אם לא עזר: 039792365\n\n❓ **האם הפתרון עזר?** (כן/לא)`;
        return { response: solution, stage: 'waiting_feedback' };
    }
    
    // משוב על פתרון
    if (context?.stage === 'waiting_feedback') {
        if (msg.includes('כן') || msg.includes('עזר')) {
            return { response: `🎉 מעולה! שמח שהבעיה נפתרה!\n\nיום טוב! 😊\n\n📞 039792365`, stage: 'resolved', sendSummary: true };
        } else if (msg.includes('לא')) {
            return { response: `🔧 אני מבינה שהפתרון לא עזר.\n\n🚨 **שולחת טכנאי אליך!**\n\n⏰ טכנאי יגיע תוך 2-4 שעות\n📞 039792365\n\n🆔 מספר קריאה: HSC-${serviceCallCounter}`, stage: 'technician', sendTechnician: true };
        }
    }
    
    // ברירת מחדל
    return { response: `שלום ${customer.name} מ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, stage: 'greeting' };
}

// שליחת WhatsApp
async function sendWhatsApp(phone, message) {
    const instanceId = '7105253183';
    const token = '2fec0da532cc4f1c9cb5b1cdc561d2e36baff9a76bce407889';
    const url = `https://7105.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`;
    
    try {
        const response = await axios.post(url, {
            chatId: `${phone}@c.us`,
            message: message
        });
        console.log('✅ WhatsApp נשלח:', response.data);
        return response.data;
    } catch (error) {
        console.error('❌ שגיאת WhatsApp:', error.message);
        throw error;
    }
}

// שליחת מייל
async function sendEmail(customer, type, details) {
    try {
        serviceCallCounter++;
        const serviceNumber = `HSC-${serviceCallCounter}`;
        
        const subject = type === 'technician' ? 
            `🚨 קריאת טכנאי ${serviceNumber} - ${customer.name}` :
            `📋 סיכום שיחה - ${customer.name}`;
        
        const html = `
            <div dir="rtl" style="font-family: Arial, sans-serif;">
                <h2>${type === 'technician' ? '🚨 דרוש טכנאי מיידי!' : '📋 סיכום שיחה'}</h2>
                <p><strong>לקוח:</strong> ${customer.name}</p>
                <p><strong>אתר:</strong> ${customer.site}</p>
                <p><strong>טלפון:</strong> ${customer.phone}</p>
                <p><strong>כתובת:</strong> ${customer.address}</p>
                <p><strong>מספר קריאה:</strong> ${serviceNumber}</p>
                <p><strong>זמן:</strong> ${new Date().toLocaleString('he-IL')}</p>
                <p><strong>פרטים:</strong> ${details}</p>
            </div>
        `;
        
        await transporter.sendMail({
            from: 'Report@sbparking.co.il',
            to: 'Dror@sbparking.co.il',
            subject: subject,
            html: html
        });
        
        console.log(`📧 מייל נשלח: ${type}`);
    } catch (error) {
        console.error('❌ שגיאת מייל:', error);
    }
}

// עמוד בית
app.get('/', (req, res) => {
    res.send(`
        <div dir="rtl" style="font-family: Arial; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <div style="max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 15px;">
                <h1 style="color: #2c3e50; text-align: center;">🚗 שיידט את בכמן</h1>
                <div style="background: #e8f5e8; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>👩‍💼 הדר - נציגת שירות לקוחות</h3>
                    <ul>
                        <li>🔧 תקלות ופתרונות</li>
                        <li>📋 דיווח נזקים</li>
                        <li>💰 הצעות מחיר</li>
                        <li>🧠 זיכרון שיחות (4 שעות)</li>
                    </ul>
                    <p><strong>📞 039792365 | 📧 Service@sbcloud.co.il</strong></p>
                </div>
                <div style="text-align: center; background: #f8f9fa; padding: 20px; border-radius: 10px;">
                    <p><strong>📲 WhatsApp:</strong> 972546284210</p>
                    <p><strong>👥 לקוחות:</strong> ${customers.length}</p>
                    <p><strong>🧠 שיחות פעילות:</strong> ${memory.conversations.size}</p>
                    <p><strong>✅ מערכת פעילה!</strong></p>
                </div>
            </div>
        </div>
    `);
});

// WhatsApp Webhook
app.post('/webhook/whatsapp', async (req, res) => {
    try {
        if (req.body.typeWebhook === 'incomingMessageReceived') {
            const messageData = req.body.messageData;
            const senderData = req.body.senderData;
            
            const phone = senderData.sender.replace('@c.us', '');
            const customerName = senderData.senderName || 'לקוח';
            let messageText = '';
            let hasFile = false;
            
            // עיבוד הודעה
            if (messageData.textMessageData) {
                messageText = messageData.textMessageData.textMessage;
            } else if (messageData.fileMessageData) {
                hasFile = true;
                messageText = messageData.fileMessageData.caption || 'שלח קובץ';
                console.log(`📁 קובץ: ${messageData.fileMessageData.fileName}`);
            }
            
            console.log(`📞 הודעה מ-${phone}: ${messageText}`);
            
            // מציאת לקוח
            const customer = findCustomer(phone);
            if (!customer) {
                await sendWhatsApp(phone, `שלום ${customerName} 👋\n\nכדי לטפל בפנייתך, אני צריכה פרטי זיהוי:\n• שם מלא\n• שם החניון\n• מספר לקוח\n\n📞 039792365`);
                return res.status(200).json({ status: 'OK' });
            }
            
            console.log(`✅ לקוח מזוהה: ${customer.name}`);
            
            // זיכרון
            const context = memory.get(phone, customer);
            memory.add(phone, messageText, 'customer', customer);
            
            // בדיקה מיוחדת לקבצים עם יחידה
            if (hasFile && context?.stage === 'damage_photo') {
                const unitMatch = messageText.match(/(\d{3})|יחידה\s*(\d{1,3})/);
                if (unitMatch) {
                    const unit = unitMatch[1] || unitMatch[2];
                    const response = `שלום ${customer.name} 👋\n\nיחידה ${unit} - קיבלתי את התמונה!\n\n🔍 מעביר לטכנאי מיידי\n⏰ טכנאי יגיע תוך 2-4 שעות\n\n🆔 מספר קריאה: HSC-${serviceCallCounter}\n\n📞 039792365`;
                    
                    await sendWhatsApp(phone, response);
                    await sendEmail(customer, 'technician', `נזק ביחידה ${unit} - תמונה צורפה`);
                    memory.updateStage(phone, 'resolved', customer);
                    
                    return res.status(200).json({ status: 'OK' });
                }
            }
            
            // תגובה רגילה
            const result = generateResponse(messageText, customer, context);
            
            // שליחת תגובה
            await sendWhatsApp(phone, result.response);
            memory.add(phone, result.response, 'hadar', customer);
            memory.updateStage(phone, result.stage, customer);
            
            // שליחת מיילים
            if (result.sendTechnician) {
                await sendEmail(customer, 'technician', messageText);
            } else if (result.sendSummary) {
                await sendEmail(customer, 'summary', 'בעיה נפתרה בהצלחה');
            }
        }
        
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('❌ שגיאה:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// הפעלת שרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 השרת פועל על פורט:', PORT);
    console.log('📲 WhatsApp: 972546284210');
    console.log('👥 לקוחות:', customers.length);
    console.log('🧠 זיכרון: 4 שעות');
    console.log('✅ מערכת מוכנה!');
});

module.exports = app;
