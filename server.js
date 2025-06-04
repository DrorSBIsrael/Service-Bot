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

// חיפוש לקוח מתקדם - תמיכה בטלפונים מרובים
function findCustomer(phone, message = '') {
    const cleanPhone = phone.replace(/[^\d]/g, '');
    
    // פונקציה עזר לבדיקת התאמת טלפון
    function isPhoneMatch(customerPhone, incomingPhone) {
        if (!customerPhone) return false;
        const cleanCustomerPhone = customerPhone.replace(/[^\d]/g, '');
        return cleanCustomerPhone === incomingPhone || 
               cleanCustomerPhone === incomingPhone.substring(3) || 
               ('972' + cleanCustomerPhone) === incomingPhone ||
               cleanCustomerPhone === ('0' + incomingPhone.substring(3)) ||
               ('0' + cleanCustomerPhone.substring(3)) === incomingPhone;
    }
    
    // חיפוש לפי כל הטלפונים האפשריים (טלפון, טלפון1, טלפון2, טלפון3, טלפון4)
    let customer = customers.find(c => {
        return isPhoneMatch(c.phone, cleanPhone) ||
               isPhoneMatch(c.phone1, cleanPhone) ||
               isPhoneMatch(c.phone2, cleanPhone) ||
               isPhoneMatch(c.phone3, cleanPhone) ||
               isPhoneMatch(c.phone4, cleanPhone);
    });
    
    if (customer) {
        // זיהוי איזה טלפון נמצא
        let phoneSource = 'טלפון ראשי';
        if (isPhoneMatch(customer.phone1, cleanPhone)) phoneSource = 'טלפון 1';
        else if (isPhoneMatch(customer.phone2, cleanPhone)) phoneSource = 'טלפון 2';
        else if (isPhoneMatch(customer.phone3, cleanPhone)) phoneSource = 'טלפון 3';
        else if (isPhoneMatch(customer.phone4, cleanPhone)) phoneSource = 'טלפון 4';
        
        console.log(`✅ זוהה לפי ${phoneSource}: ${customer.name} מ${customer.site}`);
        return customer;
    }
    
    // אם לא נמצא לפי טלפון, חפש לפי שם החניון בהודעה
    if (message && message.length > 2) {
        const messageWords = message.toLowerCase().split(/\s+/);
        
        customer = customers.find(c => {
            const siteName = c.site.toLowerCase();
            const siteWords = siteName.split(/\s+/);
            
            // בדיקה אם יש התאמה של מילות מפתח
            return siteWords.some(siteWord => {
                if (siteWord.length < 3) return false; // מילים קצרות מדי
                return messageWords.some(msgWord => {
                    // התאמה מלאה או חלקית
                    return msgWord.includes(siteWord) || siteWord.includes(msgWord);
                });
            });
        });
        
        if (customer) {
            console.log(`✅ זוהה לפי שם חניון (טלפון לא רשום): ${customer.name} מ${customer.site}`);
            return customer;
        }
        
        // חיפוש נוסף לפי מילים ספציפיות בשם החניון
        const siteMappings = {
            'אינפיניטי': 'אינפיניטי',
            'אלון': 'אלון אחזקה',
            'אחזקה': 'אלון אחזקה',
            'רימון': 'חניון רימון',
            'גן': 'גן',
            'מול': 'מול',
            'אפעל': 'אפעל',
            'רמת': 'רמת',
            'תל אביב': 'תל אביב',
            'ירושלים': 'ירושלים',
            'חיפה': 'חיפה',
            'רעננה': 'רעננה'
        };
        
        for (const [keyword, siteHint] of Object.entries(siteMappings)) {
            if (message.toLowerCase().includes(keyword)) {
                customer = customers.find(c => 
                    c.site.toLowerCase().includes(siteHint.toLowerCase())
                );
                if (customer) {
                    console.log(`✅ זוהה לפי מילת מפתח "${keyword}" (טלפון חדש): ${customer.name} מ${customer.site}`);
                    return customer;
                }
            }
        }
    }
    
    console.log(`⚠️ לקוח לא מזוהה: ${phone} ${message ? `(הודעה: "${message.substring(0, 30)}...")` : ''}`);
    return null;
}

// פונקציה לזיהוי לקוח אינטראקטיבי
function identifyCustomerInteractively(message) {
    const msg = message.toLowerCase();
    
    // חיפוש לפי שם לקוח
    const nameMatch = customers.find(c => 
        c.name && msg.includes(c.name.toLowerCase())
    );
    if (nameMatch) {
        return { 
            customer: nameMatch, 
            confidence: 'high',
            method: `זוהה לפי שם הלקוח: ${nameMatch.name}`
        };
    }
    
    // חיפוש לפי שם חניון
    const siteMatch = customers.find(c => {
        const siteName = c.site.toLowerCase();
        const siteWords = siteName.split(/\s+/);
        return siteWords.some(word => 
            word.length > 2 && msg.includes(word)
        );
    });
    if (siteMatch) {
        return { 
            customer: siteMatch, 
            confidence: 'medium',
            method: `זוהה לפי שם החניון: ${siteMatch.site}`
        };
    }
    
    // חיפוש לפי מספר לקוח
    const idMatch = msg.match(/\d{2,4}/);
    if (idMatch) {
        const customerId = parseInt(idMatch[0]);
        const customerById = customers.find(c => c.id === customerId);
        if (customerById) {
            return { 
                customer: customerById, 
                confidence: 'high',
                method: `זוהה לפי מספר לקוח: ${customerId}`
            };
        }
    }
    
    return null;
}

// תגובה חכמה עם זיהוי לקוח משופר
function generateResponse(message, customer, context, phone) {
    const msg = message.toLowerCase();
    
    // אם אין לקוח מזוהה, נסה זיהוי אינטראקטיבי
    if (!customer) {
        const identification = identifyCustomerInteractively(message);
        if (identification) {
            console.log(`🔍 ${identification.method} (רמת ביטחון: ${identification.confidence})`);
            
            if (identification.confidence === 'high') {
                // זיהוי חד משמעי - המשך עם הלקוח
                return { 
                    response: `שלום ${identification.customer.name} מ${identification.customer.site} 👋\n\nזיהיתי אותך!\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, 
                    stage: 'greeting',
                    customer: identification.customer
                };
            } else {
                // זיהוי לא בטוח - בקש אישור
                return { 
                    response: `שלום! 👋\n\nהאם אתה ${identification.customer.name} מ${identification.customer.site}?\n\n✅ כתוב "כן" לאישור\n❌ או שתף את פרטיך:\n• שם מלא\n• שם החניון\n• מספר לקוח\n\n📞 039792365`,
                    stage: 'confirming_identity',
                    tentativeCustomer: identification.customer
                };
            }
        }
        
        // לא נמצא זיהוי - בקש פרטים
        return { 
            response: `שלום! 👋\n\nכדי לטפל בפנייתך, אני צריכה פרטי זיהוי:\n\n• שם מלא\n• שם החניון (לדוגמה: "אינפיניטי", "אלון אחזקה")\n• מספר לקוח\n\nאו פשוט כתוב את שם החניון שלך\n\n📞 039792365`, 
            stage: 'identifying' 
        };
    }
    
    // אישור זהות
    if (context?.stage === 'confirming_identity') {
        if (msg.includes('כן') || msg.includes('נכון') || msg.includes('תקין')) {
            return { 
                response: `מעולה! שלום ${context.tentativeCustomer.name} מ${context.tentativeCustomer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, 
                stage: 'greeting',
                customer: context.tentativeCustomer
            };
        } else {
            return { 
                response: `בסדר, בואו ננסה שוב.\n\nאנא שתף את הפרטים המדויקים:\n• שם מלא\n• שם החניון\n• מספר לקוח\n\n📞 039792365`, 
                stage: 'identifying' 
            };
        }
    }
    
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

// שליחת מייל עם תמיכה בטלפונים מרובים
async function sendEmail(customer, type, details) {
    try {
        serviceCallCounter++;
        const serviceNumber = `HSC-${serviceCallCounter}`;
        
        // רשימת טלפונים של הלקוח
        const phoneList = [customer.phone, customer.phone1, customer.phone2, customer.phone3, customer.phone4]
            .filter(phone => phone && phone.trim() !== '')
            .map((phone, index) => {
                const label = index === 0 ? 'טלפון ראשי' : `טלפון ${index}`;
                return `<p><strong>${label}:</strong> ${phone}</p>`;
            })
            .join('');
        
        const subject = type === 'technician' ? 
            `🚨 קריאת טכנאי ${serviceNumber} - ${customer.name}` :
            `📋 סיכום שיחה - ${customer.name}`;
        
        const html = `
            <div dir="rtl" style="font-family: Arial, sans-serif;">
                <h2>${type === 'technician' ? '🚨 דרוש טכנאי מיידי!' : '📋 סיכום שיחה'}</h2>
                <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>👤 פרטי לקוח:</h3>
                    <p><strong>שם לקוח:</strong> ${customer.name}</p>
                    <p><strong>אתר/חניון:</strong> ${customer.site}</p>
                    <p><strong>מספר לקוח:</strong> #${customer.id}</p>
                    <p><strong>כתובת:</strong> ${customer.address}</p>
                    <p><strong>אימייל:</strong> ${customer.email || 'לא רשום'}</p>
                </div>
                <div style="background: #e3f2fd; padding: 15px; border-radius: 10px; margin: 20px 0;">
                    <h3>📞 טלפונים:</h3>
                    ${phoneList}
                </div>
                <div style="background: #fff3cd; padding: 15px; border-radius: 10px; margin: 20px 0;">
                    <h3>📋 פרטי הקריאה:</h3>
                    <p><strong>מספר קריאה:</strong> ${serviceNumber}</p>
                    <p><strong>זמן:</strong> ${new Date().toLocaleString('he-IL')}</p>
                    <p><strong>פרטי הבעיה:</strong> ${details}</p>
                </div>
                ${type === 'technician' ? `
                <div style="background: #f8d7da; padding: 15px; border-radius: 10px; border-right: 4px solid #dc3545;">
                    <h3>🚨 פעולות נדרשות:</h3>
                    <p><strong>1. צור קשר עם הלקוח תוך 15 דקות</strong></p>
                    <p><strong>2. תאם הגעת טכנאי תוך 2-4 שעות</strong></p>
                    <p><strong>3. עדכן את הלקוח על זמן הגעה</strong></p>
                </div>
                ` : ''}
            </div>
        `;
        
        await transporter.sendMail({
            from: 'Report@sbparking.co.il',
            to: 'Dror@sbparking.co.il',
            subject: subject,
            html: html
        });
        
        console.log(`📧 מייל נשלח: ${type} - ${customer.name}`);
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
            
            // מציאת לקוח - מתקדם
            let customer = findCustomer(phone, messageText);
            const context = customer ? memory.get(phone, customer) : memory.get(phone);
            
            // עיבוד תגובה עם זיהוי לקוח משופר
            let result = generateResponse(messageText, customer, context, phone);
            
            // אם זוהה לקוח חדש, עדכן את המערכת
            if (result.customer && !customer) {
                customer = result.customer;
                console.log(`🆕 לקוח חדש מזוהה: ${customer.name} מ${customer.site}`);
            }
            
            // זיכרון
            memory.add(phone, messageText, 'customer', customer);
            
            // בדיקה מיוחדת לקבצים עם יחידה (רק לאחר זיהוי לקוח)
            if (hasFile && customer && context?.stage === 'damage_photo') {
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
            
            // אם אין לקוח, נסה לזהות או בקש פרטים
            if (!customer && !result.customer) {
                await sendWhatsApp(phone, result.response);
                memory.add(phone, result.response, 'hadar');
                if (result.stage) {
                    memory.updateStage(phone, result.stage);
                }
                return res.status(200).json({ status: 'OK' });
            }
            
            // תגובה רגילה עם לקוח מזוהה
            const finalResult = customer ? generateResponse(messageText, customer, context, phone) : result;
            
            // שליחת תגובה
            await sendWhatsApp(phone, finalResult.response);
            memory.add(phone, finalResult.response, 'hadar', customer);
            memory.updateStage(phone, finalResult.stage, customer);
            
            // שליחת מיילים
            if (finalResult.sendTechnician) {
                await sendEmail(customer, 'technician', messageText);
            } else if (finalResult.sendSummary) {
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
