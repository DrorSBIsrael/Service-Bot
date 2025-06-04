require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const fs = require('fs');
const app = express();

// מספר תקלה גלובלי עם נומרטור מתקדם
let globalServiceCounter = 10001;

function getNextServiceNumber() {
    return `HSC-${++globalServiceCounter}`;
}

// טעינת לקוחות
let customers = [];

try {
    const customersData = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
    customers = customersData.map(client => ({
        id: client["מספר לקוח"],
        name: client["שם לקוח"],
        site: client["שם החניון"],
        phone: client["טלפון"],
        phone1: client["טלפון1"],
        phone2: client["טלפון2"],
        phone3: client["טלפון3"],
        phone4: client["טלפון4"],
        address: client["כתובת הלקוח"],
        email: client["מייל"]
    }));
    console.log(`📊 נטענו ${customers.length} לקוחות`);
} catch (error) {
    console.error('❌ שגיאה בטעינת לקוחות:', error.message);
    customers = [{ id: 555, name: "דרור פרינץ", site: "חניון רימון", phone: "0545-484210", address: "רימון 8 רמת אפעל", email: "Dror@sbparking.co.il" }];
}

// פונקציה לשעון ישראל
function getIsraeliTime() {
    return new Date().toLocaleString('he-IL', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
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

const troubleshootingDB = {
    "חשמל": "בדוק נתיכים ומתג הפעלה",
    "כרטיס": "נקה קורא כרטיסים עם אלכוהול",
    "מחסום": "בדוק לחץ אוויר 6-8 בר",
    "מצלמה": "בדוק חיבור רשת ואתחל"
};

// שיפור זיהוי לקוח - תמיכה מלאה בטלפונים מרובים
function findCustomer(phone, message = '') {
    const cleanPhone = phone.replace(/[^\d]/g, '');
    
    // פונקציה לבדיקת התאמת טלפון מתקדמת
    function isPhoneMatch(customerPhone, incomingPhone) {
        if (!customerPhone) return false;
        const cleanCustomerPhone = customerPhone.replace(/[^\d]/g, '');
        
        // בדיקות מרובות לתאמת טלפונים
        return cleanCustomerPhone === incomingPhone || 
               cleanCustomerPhone === incomingPhone.substring(3) || 
               ('972' + cleanCustomerPhone) === incomingPhone ||
               cleanCustomerPhone === ('0' + incomingPhone.substring(3)) ||
               ('0' + cleanCustomerPhone.substring(3)) === incomingPhone ||
               cleanCustomerPhone.substring(1) === incomingPhone.substring(3) ||
               ('972' + cleanCustomerPhone.substring(1)) === incomingPhone;
    }
    
    // חיפוש לפי כל שדות הטלפון
    let customer = customers.find(c => {
        return isPhoneMatch(c.phone, cleanPhone) ||
               isPhoneMatch(c.phone1, cleanPhone) ||
               isPhoneMatch(c.phone2, cleanPhone) ||
               isPhoneMatch(c.phone3, cleanPhone) ||
               isPhoneMatch(c.phone4, cleanPhone);
    });
    
    if (customer) {
        console.log(`✅ לקוח מזוהה: ${customer.name} מ${customer.site}`);
        return customer;
    }
    
    // חיפוש לפי מילת "חניון" בהודעה
    if (message && message.includes('חניון')) {
        const words = message.split(/\s+/);
        const chanionIndex = words.findIndex(word => word.includes('חניון'));
        
        if (chanionIndex !== -1 && chanionIndex < words.length - 1) {
            const chanionName = words[chanionIndex + 1];
            customer = customers.find(c => 
                c.site.toLowerCase().includes(chanionName.toLowerCase())
            );
            
            if (customer) {
                console.log(`✅ זוהה לפי "חניון ${chanionName}": ${customer.name}`);
                return customer;
            }
        }
    }
    
    // אם לא נמצא לפי טלפון - חיפוש לפי תוכן ההודעה
    if (message && message.length > 3) {
        const msg = message.toLowerCase();
        
        // חיפוש לפי שם לקוח
        customer = customers.find(c => {
            const customerName = c.name.toLowerCase();
            return msg.includes(customerName) || customerName.includes(msg.split(' ')[0]);
        });
        
        if (customer) {
            console.log(`✅ זוהה לפי שם לקוח: ${customer.name}`);
            return customer;
        }
    }
    
    console.log(`⚠️ לקוח לא מזוהה: ${phone}`);
    return null;
}

// תגובה חכמה עם זיהוי לקוח משופר
function generateResponse(message, customer, context, phone) {
    const msg = message.toLowerCase();
    
    // אם יש לקוח מזוהה - תן תגובה ישירה
    if (customer) {
        // תפריט ראשי ללקוח מזוהה
        if (!context || context.stage === 'greeting') {
            return { 
                response: `שלום ${customer.name} מחניון ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, 
                stage: 'menu' 
            };
        }
    }
    
    // אם אין לקוח מזוהה, נסה זיהוי אינטראקטיבי
    if (!customer) {
        const identification = identifyCustomerInteractively(message);
        if (identification) {
            console.log(`🔍 ${identification.method} (רמת ביטחון: ${identification.confidence})`);
            
            if (identification.confidence === 'high') {
                // זיהוי חד משמעי - המשך עם הלקוח
                return { 
                    response: `שלום ${identification.customer.name} מחניון ${identification.customer.site} 👋\n\nזיהיתי אותך!\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, 
                    stage: 'menu',
                    customer: identification.customer
                };
            } else {
                // זיהוי לא בטוח - בקש אישור
                return { 
                    response: `שלום! 👋\n\nהאם אתה ${identification.customer.name} מחניון ${identification.customer.site}?\n\n✅ כתוב "כן" לאישור\n❌ או כתוב שם החניון הנכון\n\n📞 039792365`,
                    stage: 'confirming_identity',
                    tentativeCustomer: identification.customer
                };
            }
        }
        
        // לא נמצא זיהוי - בקש רק שם חניון
        return { 
            response: `שלום! 👋\n\nכדי לטפל בפנייתך אני צריכה:\n\n🏢 **שם החניון שלך**\n\nלדוגמה: "חניון אינפיניטי" או "חניון מרכז עזריאלי"\n\n📞 039792365`, 
            stage: 'identifying' 
        };
    }
    
    // אישור זהות
    if (context?.stage === 'confirming_identity') {
        if (msg.includes('כן') || msg.includes('נכון') || msg.includes('תקין')) {
            return { 
                response: `מעולה! שלום ${context.tentativeCustomer.name} מחניון ${context.tentativeCustomer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, 
                stage: 'menu',
                customer: context.tentativeCustomer
            };
        } else {
            return { 
                response: `בסדר, אנא כתוב את שם החניון הנכון:\n\n📞 039792365`, 
                stage: 'identifying' 
            };
        }
    }
    
    // תפריט ראשי
    if (msg === '1' || msg.includes('תקלה')) {
        return { 
            response: `שלום ${customer.name} 👋\n\n🔧 **תיאור התקלה:**\n\nאנא כתוב תיאור קצר של התקלה כולל סוג היחידה ומספר\n\n📞 039792365`, 
            stage: 'problem_description' 
        };
    }
    
    if (msg === '2' || msg.includes('נזק')) {
        return { response: `שלום ${customer.name} 👋\n\nאנא צלם את הנזק ושלח תמונה + מספר היחידה\n(לדוגמה: תמונה + "יחידה 101")\n\n📞 039792365`, stage: 'damage_photo' };
    }
    
    if (msg === '3' || msg.includes('מחיר')) {
        return { response: `שלום ${customer.name} 👋\n\n💰 **הצעת מחיר / הזמנה**\n\nמה אתה מבקש להזמין?\n\nכמות? (לדוגמה: 20,000 כרטיסים, גלילים, זרועות...)\n\n📞 039792365`, stage: 'order_request' };
    }
    
    // עיבוד הזמנה
    if (context?.stage === 'order_request') {
        return { 
            response: `📋 קיבלתי את בקשת ההזמנה!\n\n"${message}"\n\n📧 אשלח הצעת מחיר מפורטת למייל\n⏰ תוך 24 שעות\n\n📞 039792365`, 
            stage: 'order_completed',
            sendOrderEmail: true,
            orderDetails: message
        };
    }
    
    // עיבוד תיאור הבעיה עם OpenAI
    if (context?.stage === 'problem_description') {
        const currentServiceNumber = getNextServiceNumber();
        
        return { 
            response: `📋 **קיבלתי את התיאור**\n\n🔍 אני מעבדת את הבעיה עם המערכת החכמה...\n\n⏳ תוך רגע אחזור עם פתרון מיידי\n\n🆔 מספר קריאה: ${currentServiceNumber}\n\n📞 039792365`, 
            stage: 'processing_with_ai',
            serviceNumber: currentServiceNumber,
            problemDescription: message
        };
    }
    
    // עיבוד עם AI ומתן פתרון
    if (context?.stage === 'processing_with_ai') {
        return { 
            response: `⏳ אני עדיין מעבדת את הבעיה...\n\nאנא המתן רגע\n\n📞 039792365`, 
            stage: 'processing_with_ai' 
        };
    }
    
    // משוב על פתרון - תיקון הלוגיקה
    if (context?.stage === 'waiting_feedback') {
        if (msg.includes('כן') || msg.includes('עזר') || msg.includes('נפתר') || msg.includes('תודה')) {
            return { 
                response: `🎉 מעולה! שמח לשמוע שהבעיה נפתרה!\n\nיום טוב! 😊\n\n📞 039792365`, 
                stage: 'resolved', 
                sendSummary: true,
                serviceNumber: context.serviceNumber,
                problemDescription: context.problemDescription,
                solution: context.aiSolution,
                resolved: true
            };
        } else if (msg.includes('לא') || msg.includes('לא עזר') || msg.includes('לא עובד')) {
            return { 
                response: `🔧 אני מבינה שהפתרון לא עזר.\n\n📋 **מעבירה את הפניה לטכנאי**\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n📞 039792365\n\n🆔 מספר קריאה: ${context.serviceNumber}`, 
                stage: 'technician_dispatched', 
                sendTechnician: true,
                serviceNumber: context.serviceNumber,
                problemDescription: context.problemDescription,
                solution: context.aiSolution,
                resolved: false
            };
        } else {
            return {
                response: `❓ אני צריכה לדעת האם הפתרון עזר:\n\n✅ כתוב "כן" אם הבעיה נפתרה\n❌ כתוב "לא" אם עדיין יש בעיה\n\n📞 039792365`,
                stage: 'waiting_feedback'
            };
        }
    }
    
    // ברירת מחדל
    return { response: `שלום ${customer.name} מחניון ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, stage: 'menu' };
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

// OpenAI לפתרון תקלות מתקדם
async function getAISolution(problemDescription, customer, troubleshootingDB) {
    try {
        const systemPrompt = `אני הדר, מומחית תקלות במערכות בקרת חניה של שיידט את בכמן.

אני מקבלת תיאור תקלה ונותנת פתרון מיידי ומקצועי.

מידע על החברה:
- שיידט את בכמן ישראל
- מערכות בקרת חניה אוטומטיות
- יחידות: יציאה (100-199), מחסום (200-299), אשראי (300-399), מצלמה (400-499)
- טלפון: 039792365

מסד נתוני תקלות זמין: ${JSON.stringify(troubleshootingDB)}

הנחיות:
1. זהה את סוג היחידה והמספר
2. תן פתרון מיידי ומפורט עם צעדים ברורים
3. השתמש באמוג'י להדגשה
4. כלול המלצה לטכנאי אם נדרש
5. סיים עם שאלה "האם הפתרון עזר?"

תמיד התחל עם: "🔧 **פתרון מיידי לתקלה:**"`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `לקוח: ${customer.name} מ${customer.site}\nתקלה: ${problemDescription}` }
            ],
            max_tokens: 500,
            temperature: 0.3
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        console.log('✅ OpenAI פתרון התקבל');
        return response.data.choices[0].message.content.trim();
        
    } catch (error) {
        console.error('❌ שגיאה ב-OpenAI:', error.message);
        
        // פתרון fallback מתקדם מהמסד נתונים
        const problem = problemDescription.toLowerCase();
        let solution = '🔧 **פתרון מיידי לתקלה:**\n\n';
        
        if (problem.includes('לא דולק') || problem.includes('אין חשמל')) {
            solution += '1️⃣ **בדוק מתג הפעלה ראשי**\n2️⃣ **בדוק נתיכים בלוח החשמל**\n3️⃣ **וודא חיבור כבל חשמל תקין**\n4️⃣ **בדוק מתח 220V בשקע**\n\n';
        } else if (problem.includes('כרטיס') || problem.includes('לא קורא')) {
            solution += '1️⃣ **נקה קורא כרטיסים בעדינות עם אלכוהול**\n2️⃣ **נסה כרטיס חדש וידוע כתקין**\n3️⃣ **בדוק שאין לכלוך או חסימה בחריץ**\n4️⃣ **אתחל את המערכת (כיבוי-הדלקה)**\n\n';
        } else if (problem.includes('מחסום') || problem.includes('זרוע') || problem.includes('לא עול')) {
            solution += '1️⃣ **בדוק לחץ אוויר במדחס (6-8 בר)**\n2️⃣ **וודא שאין מכשולים בנתיב הזרוע**\n3️⃣ **בדוק רמת שמן הידראולי**\n4️⃣ **נסה הפעלה ידנית עדינה**\n\n';
        } else if (problem.includes('מצלמה')) {
            solution += '1️⃣ **בדוק חיבור כבל רשת (LAN)**\n2️⃣ **וודא שיש אור ירוק ברשת**\n3️⃣ **אתחל מצלמה (נתק-חבר חשמל)**\n4️⃣ **בדוק הגדרות IP במערכת**\n\n';
        } else {
            solution += '1️⃣ **אתחל את המכונה (כיבוי למשך דקה)**\n2️⃣ **בדוק כל החיבורים (חשמל/רשת)**\n3️⃣ **נקה בעדינות את החלקים הנגישים**\n4️⃣ **וודא שאין חסימות פיזיות**\n\n';
        }
        
        solution += '📞 **אם הפתרון לא עזר:** התקשר מיד 039792365\n\n❓ **האם הפתרון עזר?** (כן/לא)';
        
        return solution;
    }
}

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

// שליחת מייל עם סיכום שיחה מלא
async function sendEmail(customer, type, details, extraData = {}) {
    try {
        const serviceNumber = extraData.serviceNumber || getNextServiceNumber();
        
        // רשימת טלפונים של הלקוח
        const phoneList = [customer.phone, customer.phone1, customer.phone2, customer.phone3, customer.phone4]
            .filter(phone => phone && phone.trim() !== '')
            .map((phone, index) => {
                const label = index === 0 ? 'טלפון ראשי' : `טלפון ${index}`;
                return `<p><strong>${label}:</strong> ${phone}</p>`;
            })
            .join('');
        
        let subject, emailType;
        if (type === 'technician') {
            subject = `🚨 קריאת טכנאי ${serviceNumber} - ${customer.name} (${customer.site})`;
            emailType = '🚨 קריאת טכנאי דחופה';
        } else if (type === 'order') {
            subject = `💰 בקשת הצעת מחיר ${serviceNumber} - ${customer.name}`;
            emailType = '💰 בקשת הצעת מחיר';
        } else {
            subject = `📋 סיכום קריאת שירות ${serviceNumber} - ${customer.name}`;
            emailType = '📋 סיכום קריאת שירות';
        }
        
        // בניית סיכום השיחה
        let conversationSummary = '';
        if (extraData.problemDescription) {
            conversationSummary += `<p><strong>תיאור הבעיה:</strong> ${extraData.problemDescription}</p>`;
        }
        if (extraData.solution) {
            conversationSummary += `<p><strong>הפתרון שניתן:</strong></p><div style="background: #f8f9fa; padding: 10px; border-radius: 5px;">${extraData.solution.replace(/\n/g, '<br>')}</div>`;
        }
        if (extraData.orderDetails) {
            conversationSummary += `<p><strong>פרטי ההזמנה:</strong> ${extraData.orderDetails}</p>`;
        }
        if (extraData.resolved !== undefined) {
            const status = extraData.resolved ? '✅ נפתר בהצלחה' : '❌ לא נפתר - נשלח טכנאי';
            conversationSummary += `<p><strong>סטטוס:</strong> <span style="color: ${extraData.resolved ? 'green' : 'red'};">${status}</span></p>`;
        }
        
        const html = `
            <div dir="rtl" style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
                <div style="max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                    
                    <div style="background: linear-gradient(45deg, ${type === 'technician' ? '#dc3545, #c82333' : type === 'order' ? '#ffc107, #e0a800' : '#28a745, #20c997'}); color: white; padding: 20px; border-radius: 10px; margin-bottom: 30px; text-align: center;">
                        <h1 style="margin: 0; font-size: 24px;">${emailType}</h1>
                        <p style="margin: 5px 0 0 0; font-size: 16px;">שיידט את בכמן - מערכת בקרת חניה</p>
                    </div>
                    
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-right: 4px solid #007bff;">
                        <h2 style="color: #2c3e50; margin-top: 0;">👤 פרטי לקוח</h2>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            <p><strong>שם לקוח:</strong> ${customer.name}</p>
                            <p><strong>מספר לקוח:</strong> #${customer.id}</p>
                            <p><strong>אתר/חניון:</strong> ${customer.site}</p>
                            <p><strong>אימייל:</strong> ${customer.email || 'לא רשום'}</p>
                        </div>
                        <p><strong>כתובת:</strong> ${customer.address}</p>
                    </div>
                    
                    <div style="background: #e3f2fd; padding: 15px; border-radius: 10px; margin-bottom: 20px; border-right: 4px solid #2196f3;">
                        <h3 style="margin-top: 0; color: #1976d2;">📞 פרטי קשר</h3>
                        ${phoneList}
                    </div>
                    
                    <div style="background: #fff3cd; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-right: 4px solid #ffc107;">
                        <h2 style="color: #856404; margin-top: 0;">📋 פרטי הקריאה</h2>
                        <p><strong>מספר קריאה:</strong> <span style="background: #dc3545; color: white; padding: 5px 10px; border-radius: 5px; font-weight: bold;">${serviceNumber}</span></p>
                        <p><strong>תאריך ושעה:</strong> ${getIsraeliTime()}</p>
                        <p><strong>סוג טיפול:</strong> ${type === 'technician' ? 'קריאת טכנאי' : type === 'order' ? 'בקשת הצעת מחיר' : 'פתרון טלפוני'}</p>
                    </div>
                    
                    ${conversationSummary ? `
                    <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 2px solid #e9ecef;">
                        <h2 style="color: #2c3e50; margin-top: 0;">💬 סיכום השיחה</h2>
                        ${conversationSummary}
                    </div>
                    ` : ''}
                    
                    ${type === 'technician' ? `
                    <div style="background: #f8d7da; padding: 20px; border-radius: 10px; border-right: 4px solid #dc3545; margin-bottom: 20px;">
                        <h2 style="color: #721c24; margin-top: 0;">🚨 פעולות נדרשות לטכנאי</h2>
                        <div style="background: white; padding: 15px; border-radius: 8px; margin: 10px 0;">
                            <p style="margin: 0;"><strong>⏰ 1. צור קשר עם הלקוח תוך 15 דקות</strong></p>
                        </div>
                        <div style="background: white; padding: 15px; border-radius: 8px; margin: 10px 0;">
                            <p style="margin: 0;"><strong>🚗 2. תאם הגעה לאתר תוך 2-4 שעות</strong></p>
                        </div>
                        <div style="background: white; padding: 15px; border-radius: 8px; margin: 10px 0;">
                            <p style="margin: 0;"><strong>📱 3. עדכן לקוח על זמן הגעה משוער</strong></p>
                        </div>
                        <div style="background: white; padding: 15px; border-radius: 8px; margin: 10px 0;">
                            <p style="margin: 0;"><strong>🛠️ 4. קח כלים מתאימים לסוג התקלה</strong></p>
                        </div>
                    </div>
                    ` : type === 'order' ? `
                    <div style="background: #fff3cd; padding: 20px; border-radius: 10px; border-right: 4px solid #ffc107;">
                        <h2 style="color: #856404; margin-top: 0;">💰 פעולות נדרשות - הצעת מחיר</h2>
                        <div style="background: white; padding: 15px; border-radius: 8px; margin: 10px 0;">
                            <p style="margin: 0;"><strong>📊 1. הכן הצעת מחיר מפורטת</strong></p>
                        </div>
                        <div style="background: white; padding: 15px; border-radius: 8px; margin: 10px 0;">
                            <p style="margin: 0;"><strong>📧 2. שלח הצעה למייל הלקוח תוך 24 שעות</strong></p>
                        </div>
                        <div style="background: white; padding: 15px; border-radius: 8px; margin: 10px 0;">
                            <p style="margin: 0;"><strong>📞 3. צור קשר טלפוני לאישור ההזמנה</strong></p>
                        </div>
                    </div>
                    ` : `
                    <div style="background: #d4edda; padding: 20px; border-radius: 10px; border-right: 4px solid #28a745;">
                        <h2 style="color: #155724; margin-top: 0;">✅ הבעיה נפתרה בהצלחה</h2>
                        <p>הלקוח אישר שהפתרון עזר והבעיה נפתרה.</p>
                    </div>
                    `}
                    
                    <div style="background: #17a2b8; color: white; padding: 15px; border-radius: 10px; text-align: center;">
                        <p style="margin: 0;"><strong>📞 039792365 | 📧 Service@sbcloud.co.il</strong></p>
                    </div>
                </div>
            </div>
        `;
        
        await transporter.sendMail({
            from: 'Report@sbparking.co.il',
            to: 'Dror@sbparking.co.il',
            subject: subject,
            html: html
        });
        
        console.log(`📧 מייל נשלח: ${type} - ${customer.name} - ${serviceNumber}`);
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
            
            console.log(`📞 הודעה מ-${phone} (${customerName}) בשעה ${getIsraeliTime()}: ${messageText}`);
            
            // מציאת לקוח - מתקדם
            let customer = findCustomer(phone, messageText);
            const context = customer ? memory.get(phone, customer) : memory.get(phone);
            
            console.log(`🔍 לקוח: ${customer ? customer.name + ' מ' + customer.site : 'לא מזוהה'}`);
            console.log(`📊 Context stage: ${context?.stage || 'אין'}`);
            
            // עיבוד תגובה עם זיהוי לקוח משופר
            let result = generateResponse(messageText, customer, context, phone);
            
            // אם זוהה לקוח חדש, עדכן את המערכת
            if (result.customer && !customer) {
                customer = result.customer;
                console.log(`🆕 לקוח חדש מזוהה: ${customer.name} מ${customer.site}`);
            }
            
            console.log(`📊 Stage: ${result.stage || 'לא הוגדר'}, Customer: ${customer ? customer.name : 'לא מזוהה'}`);
            
            // זיכרון
            memory.add(phone, messageText, 'customer', customer);
            
            // עיבוד מיוחד עם OpenAI לתקלות
            if (result.stage === 'processing_with_ai' && result.problemDescription) {
                console.log('🤖 מעבד תקלה עם OpenAI...');
                
                try {
                    const aiSolution = await getAISolution(result.problemDescription, customer, troubleshootingDB);
                    
                    const finalResponse = `${aiSolution}\n\n🆔 מספר קריאה: ${result.serviceNumber}\n📞 039792365`;
                    
                    await sendWhatsApp(phone, finalResponse);
                    memory.add(phone, finalResponse, 'hadar', customer);
                    memory.updateStage(phone, 'waiting_feedback', customer);
                    
                    // שמור את המידע לזיכרון
                    const context = memory.get(phone, customer);
                    if (context) {
                        context.serviceNumber = result.serviceNumber;
                        context.problemDescription = result.problemDescription;
                        context.aiSolution = aiSolution;
                    }
                    
                    console.log(`✅ פתרון AI נשלח ללקוח ${customer.name} - ${result.serviceNumber}`);
                    return res.status(200).json({ status: 'OK' });
                } catch (aiError) {
                    console.error('❌ שגיאה בעיבוד AI:', aiError);
                    await sendWhatsApp(phone, `⚠️ יש בעיה זמנית במערכת החכמה\n\nאנא התקשר ישירות: 📞 039792365\n\n🆔 מספר קריאה: ${result.serviceNumber}`);
                    return res.status(200).json({ status: 'OK' });
                }
            }
            
            // בדיקה מיוחדת לקבצים עם יחידה - תיקון הלוגיקה
            if (hasFile && customer && context?.stage === 'damage_photo') {
                const unitMatch = messageText.match(/(\d{3})|יחידה\s*(\d{1,3})/);
                if (unitMatch) {
                    const unit = unitMatch[1] || unitMatch[2];
                    const currentServiceNumber = getNextServiceNumber();
                    
                    console.log(`📁 נזק ביחידה ${unit} - תמונה התקבלה מ${customer.name}`);
                    
                    const response = `שלום ${customer.name} 👋\n\nיחידה ${unit} - קיבלתי את התמונה!\n\n🔍 מעביר לטכנאי\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n🆔 מספר קריאה: ${currentServiceNumber}\n\n📞 039792365`;
                    
                    await sendWhatsApp(phone, response);
                    await sendEmail(customer, 'technician', `נזק ביחידה ${unit} - תמונה צורפה`, {
                        serviceNumber: currentServiceNumber,
                        problemDescription: `נזק ביחידה ${unit} - ${messageText}`,
                        solution: 'נשלח טכנאי לטיפול באתר',
                        resolved: false
                    });
                    memory.updateStage(phone, 'damage_completed', customer); // תיקון - לא לחזור לתחילה
                    
                    console.log(`✅ נזק יחידה ${unit} - מייל נשלח - ${currentServiceNumber}`);
                    return res.status(200).json({ status: 'OK' });
                } else {
                    // אם לא כתב מספר יחידה
                    await sendWhatsApp(phone, `אנא כתוב מספר היחידה עם התמונה\n\nלדוגמה: "יחידה 101"\n\n📞 039792365`);
                    console.log(`⚠️ תמונה ללא מספר יחידה מ${customer.name}`);
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
                console.log(`📤 תגובה ללא זיהוי לקוח: ${result.stage}`);
                return res.status(200).json({ status: 'OK' });
            }
            
            // תגובה רגילה עם לקוח מזוהה
            const finalResult = customer ? generateResponse(messageText, customer, context, phone) : result;
            
            // שליחת תגובה
            await sendWhatsApp(phone, finalResult.response);
            memory.add(phone, finalResult.response, 'hadar', customer);
            memory.updateStage(phone, finalResult.stage, customer);
            
            console.log(`📤 תגובה נשלחה ללקוח ${customer ? customer.name : 'לא מזוהה'}: ${finalResult.stage}`);
            
            // שליחת מיילים עם סיכום מלא
            if (finalResult.sendTechnician) {
                console.log(`📧 שולח מייל טכנאי ללקוח ${customer.name}`);
                await sendEmail(customer, 'technician', messageText, {
                    serviceNumber: finalResult.serviceNumber,
                    problemDescription: finalResult.problemDescription,
                    solution: finalResult.solution,
                    resolved: finalResult.resolved
                });
            } else if (finalResult.sendSummary) {
                console.log(`📧 שולח מייל סיכום ללקוח ${customer.name}`);
                await sendEmail(customer, 'summary', 'בעיה נפתרה בהצלחה', {
                    serviceNumber: finalResult.serviceNumber,
                    problemDescription: finalResult.problemDescription,
                    solution: finalResult.solution,
                    resolved: finalResult.resolved
                });
            } else if (finalResult.sendOrderEmail) {
                console.log(`📧 שולח מייל הזמנה ללקוח ${customer.name}`);
                await sendEmail(customer, 'order', finalResult.orderDetails, {
                    serviceNumber: getNextServiceNumber(),
                    orderDetails: finalResult.orderDetails
                });
            }
        }
        
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('❌ שגיאה כללית:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// הפעלת שרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 השרת פועל על פורט:', PORT);
    console.log('🕐 שעה נוכחית (ישראל):', getIsraeliTime());
    console.log('📲 WhatsApp: 972546284210');
    console.log('👥 לקוחות:', customers.length);
    console.log('🧠 זיכרון: 4 שעות');
    console.log('🤖 OpenAI: מחובר לפתרון תקלות');
    console.log('📋 מסד תקלות: זמין');
    console.log('🔢 מספרי קריאה: HSC-' + (globalServiceCounter + 1) + '+');
    console.log('📧 מיילים: סיכום מלא בכל קריאה');
    console.log('✅ מערכת מושלמת מוכנה!');
});

module.exports = app;
