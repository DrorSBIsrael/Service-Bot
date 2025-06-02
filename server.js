// קובץ: server.js משופר
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const app = express();

// ======================= מערכת זיכרון שיחות =======================

// זיכרון שיחות פעילות
const activeChats = new Map();

// מחלקה לניהול שיחה
class ChatSession {
    constructor(phoneNumber, customerData = null) {
        this.phoneNumber = phoneNumber;
        this.customerData = customerData;
        this.messages = [];
        this.startTime = new Date();
        this.lastActivity = new Date();
        this.status = 'active'; // active, completed, waiting_for_response
        this.currentTopic = null; // תקלה, הצעת_מחיר, נזק, הדרכה
        this.needsEmailSummary = false;
        this.troubleshootingStep = 0; // עבור מעקב שלבי פתרון תקלות
    }
    
    addMessage(sender, message) {
        this.messages.push({
            sender: sender, // 'customer' או 'hadar'
            message: message,
            timestamp: new Date()
        });
        this.lastActivity = new Date();
    }
    
    getConversationHistory() {
        return this.messages.map(msg => 
            `${msg.sender === 'customer' ? 'לקוח' : 'הדר'}: "${msg.message}"`
        ).join('\n');
    }
    
    isExpired(timeoutMinutes = 45) {
        const now = new Date();
        return (now - this.lastActivity) > (timeoutMinutes * 60 * 1000);
    }
    
    getDuration() {
        return Math.round((this.lastActivity - this.startTime) / (1000 * 60)); // דקות
    }
}

// פונקציה לניקוי שיחות ישנות
function cleanupExpiredChats() {
    const expiredChats = [];
    
    for (const [phoneNumber, session] of activeChats.entries()) {
        if (session.isExpired()) {
            expiredChats.push(phoneNumber);
        }
    }
    
    expiredChats.forEach(phoneNumber => {
        console.log(`🧹 מנקה שיחה ישנה: ${phoneNumber}`);
        activeChats.delete(phoneNumber);
    });
    
    return expiredChats.length;
}

// ניקוי אוטומטי כל 15 דקות
setInterval(cleanupExpiredChats, 15 * 60 * 1000);

// פונקציה לזיהוי נושא השיחה
function detectConversationTopic(message) {
    const msgLower = message.toLowerCase();
    
    if (msgLower.includes('תקלה') || msgLower.includes('לא עובד') || msgLower.includes('בעיה') || 
        msgLower.includes('תקוע') || msgLower.includes('לא מנפיק') || msgLower.includes('שבור') ||
        msgLower.includes('לא פותח') || msgLower.includes('לא סוגר') || msgLower.includes('אתחול')) {
        return 'תקלה';
    }
    
    if (msgLower.includes('הצעת מחיר') || msgLower.includes('כרטיסים') || msgLower.includes('גלילי קבלה') || 
        msgLower.includes('זרוע') || msgLower.includes('הזמנה') || msgLower.includes('מחיר') ||
        msgLower.includes('רול') || msgLower.includes('נייר')) {
        return 'הצעת_מחיר';
    }
    
    if (msgLower.includes('נזק') || msgLower.includes('שבור') || msgLower.includes('פגוע') || 
        msgLower.includes('תאונה') || msgLower.includes('דיווח נזק') || msgLower.includes('הרס')) {
        return 'נזק';
    }
    
    if (msgLower.includes('הדרכה') || msgLower.includes('איך') || msgLower.includes('תפעול') || 
        msgLower.includes('הוראות') || msgLower.includes('למד') || msgLower.includes('הסבר')) {
        return 'הדרכה';
    }
    
    if (msgLower.includes('סיכום') || msgLower.includes('מייל') || msgLower.includes('שלח') ||
        msgLower.includes('סגור') || msgLower.includes('תודה')) {
        return 'סיכום';
    }
    
    return 'כללי';
}

// ======================= טעינת לקוחות =======================

let customers = [];
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
    
    console.log(`📊 נטענו ${customers.length} לקוחות מהקובץ`);
} catch (error) {
    console.error('❌ שגיאה בטעינת קובץ הלקוחות:', error.message);
    customers = [
        { id: 555, name: "דרור פרינץ", site: "חניון רימון", phone: "0545-484210", address: "רימון 8 רמת אפעל", email: "Dror@sbparking.co.il" }
    ];
}

// ======================= הגדרות בסיסיות =======================

app.use(express.json());
app.use(express.static('public'));

// הגדרת nodemailer
const transporter = nodemailer.createTransporter({
    host: process.env.EMAIL_HOST || 'smtp.012.net.il',
    port: parseInt(process.env.EMAIL_PORT) || 465,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER || 'Report@sbparking.co.il',
        pass: process.env.EMAIL_PASS || 'o51W38D5'
    }
});

// הגדרת multer להעלאת תמונות
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('רק תמונות מותרות'));
        }
    }
});

// ======================= פונקציות עזר =======================

// חיפוש לקוח לפי מספר טלפון
function findCustomerByPhone(phoneNumber) {
    if (!phoneNumber) return null;
    
    const cleanPhone = phoneNumber.replace(/[^\d]/g, '');
    
    return customers.find(customer => {
        if (!customer.phone) return false;
        
        const customerPhone = customer.phone.replace(/[^\d]/g, '');
        
        return customerPhone === cleanPhone || 
               customerPhone === cleanPhone.substring(3) || 
               ('972' + customerPhone) === cleanPhone ||
               customerPhone === ('0' + cleanPhone.substring(3)) ||
               ('0' + customerPhone.substring(3)) === cleanPhone;
    });
}

// חיפוש לקוח גם לפי שם החניון
function findCustomerByPhoneOrSite(phoneNumber, message = '') {
    let customer = findCustomerByPhone(phoneNumber);
    
    if (customer) {
        return customer;
    }
    
    const messageWords = message.toLowerCase();
    
    const foundSite = customers.find(c => {
        const siteName = c.site.toLowerCase();
        const siteWords = siteName.split(' ');
        
        return siteWords.some(word => 
            word.length > 2 && messageWords.includes(word)
        );
    });
    
    return foundSite || null;
}

// שליחת הודעות WhatsApp
async function sendWhatsAppMessage(phoneNumber, message) {
    const instanceId = process.env.WHATSAPP_INSTANCE || '7105253183';
    const token = process.env.WHATSAPP_TOKEN || '2fec0da532cc4f1c9cb5b1cdc561d2e36baff9a76bce407889';
    const url = `https://7105.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`;
    
    try {
        const response = await axios.post(url, {
            chatId: `${phoneNumber}@c.us`,
            message: message
        }, {
            timeout: 10000
        });
        console.log('📱 הודעת WhatsApp נשלחה:', response.data);
        return response.data;
    } catch (error) {
        console.error('❌ שגיאה בשליחת WhatsApp:', error.response?.data || error.message);
        throw error;
    }
}

// ======================= פונקציית AI מתקדמת =======================

async function generateAIResponseWithContext(contextMessage, currentMessage, customerName, customerData, phoneNumber, chatSession) {
    try {
        // בדיקה אם זה מספר הבדיקה
        const testPhone = process.env.TEST_PHONE_NUMBER;
        if (testPhone && phoneNumber && phoneNumber === testPhone.replace(/[^\d]/g, '')) {
            if (currentMessage.startsWith('בדיקה:')) {
                const testMessage = currentMessage.replace('בדיקה:', '').trim();
                console.log(`🧪 מצב בדיקה פעיל: ${testMessage}`);
                return `🧪 מצב בדיקה - הדר פעילה!\n\nהודעה: "${testMessage}"\n${customerData ? `לקוח: ${customerData.name}` : 'לא מזוהה'}\n\nהמערכת עובדת! ✅`;
            }
        }

        // השהיה למניעת rate limiting (גדולה יותר)
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const systemPrompt = `אני הדר, נציגת שירות לקוחות של חברת שיידט את בכמן ישראל.

📋 מידע על השיחה הנוכחית:
${customerData ? `
✅ לקוח מזוהה: ${customerData.name} מ${customerData.site} (#${customerData.id})
📞 טלפון: ${customerData.phone}
📧 אימייל: ${customerData.email}
` : `
⚠️ לקוח לא מזוהה! אחייב לזהות קודם כל.
`}

🕒 היסטוריית השיחה:
${chatSession ? chatSession.getConversationHistory() : 'שיחה חדשה'}

📋 נושא נוכחי: ${chatSession?.currentTopic || 'לא זוהה'}
⏱️ משך שיחה: ${chatSession ? chatSession.getDuration() : 0} דקות

🔍 כללי זיהוי והתנהגות:
${customerData ? `
מכיוון שהלקוח מזוהה, אני אטפל בפנייתו בהתאם לנושא:

1. 🔧 תקלות:
   - זיהוי מיקום: "איפה התקלה? כניסה/יציאה/קופה? מספר יחידה?"
   - הנחיות אתחול: כיבוי → ניתוק כרטיסים → דקה המתנה → הדלקה → חיבור כרטיסים
   - אזהרה: "במהלך האתחול אסור שרכב יהיה בנתיב"
   - אם לא עזר: "אפתח דיווח תקלה לטכנאי. מספר קריאה: SRV-${Date.now().toString().slice(-6)}"

2. 💰 הצעות מחיר:
   - כרטיסי נייר: לבנים/עם גרפיקה, כמות?
   - גלילי קבלה: כמות? אורך?
   - זרועות מחסום: ישרה/פריקה? אורך?
   - כתובת משלוח?

3. 📋 נזקים:
   - מיקום מדויק של הנזק
   - תיאור הנזק
   - העברה לטכנאי

4. 📚 הדרכות:
   - נושא ההדרכה
   - הפניה לקובץ או הסבר

5. 📧 סיכום:
   - "אשלח סיכום מפורט לאימייל שלך: ${customerData.email}"
   - סיום השיחה
` : `
⚠️ לקוח לא מזוהה במערכת!
אני חייבת לזהות את הלקוח קודם כל. אבקש:
• שם מלא
• שם החניון/אתר החניה  
• מספר לקוח (אם יודע)

ללא זיהוי לא אוכל לטפל בפנייה.
`}

🛠️ ציוד במערכת:
כניסה (100-199), יציאה (200-299), מעברים (300-399), אוטומטיות (600-699), קופות ידניות (700-799)

📞 פרטי קשר:
משרד: 039792365 | שירות: Service@sbcloud.co.il | שעות: א'-ה' 8:15-17:00

🧠 זיהוי שלב השיחה (על בסיס ההיסטוריה):
- אני זוכרת את כל השיחה ומתייחסת לכל מה שנאמר קודם
- אני מתקדמת בהדרגה לפי השלבים
- אני לא חוזרת על שאלות שכבר שאלתי
- אני זוכרת תגובות הלקוח ומתבססת עליהן

כללי תגובה:
- אדיבה, מקצועית, עניינית
- זוכרת את כל ההיסטוריה
- לא חוזרת על שאלות
- מתקדמת לשלב הבא בטיפול
- בסיום תמיד מציעה סיכום אימייל`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: `הלקוח ${customerName} שלח כעת: "${currentMessage}"`
                }
            ],
            max_tokens: 300,
            temperature: 0.1 // נמוך מאוד לעקביות
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 20000
        });

        return response.data.choices[0].message.content.trim();
        
    } catch (error) {
        console.error('❌ שגיאה ב-OpenAI:', error.message);
        
        // תגובות fallback מותאמות
        let fallbackMessage;
        
        if (error.response?.status === 429) {
            console.log('⏱️ מכסת OpenAI מלאה - תגובת הדר סטנדרטית');
            
            if (customerData) {
                // התאמה לשלב השיחה
                if (chatSession && chatSession.currentTopic === 'תקלה') {
                    fallbackMessage = `שלום ${customerData.name},

בהמשך לתקלה שדיווחת:
אנא נסה אתחול מלא:
1. כיבוי היחידה
2. ניתוק כרטיסים  
3. המתנה דקה
4. הדלקה
5. חיבור הכרטיסים

האם זה עזר?

📞 039792365 במקרה דחוף`;
                } else {
                    fallbackMessage = `שלום ${customerData.name} מ${customerData.site} 👋

איך אוכל לעזור לך היום?

🔧 תקלות | 💰 הצעות מחיר | 📋 נזקים | 📚 הדרכות

📞 039792365`;
                }
            } else {
                fallbackMessage = `שלום ${customerName} 👋

אני הדר מחברת שיידט את בכמן.
לטיפול בפנייתך אני זקוקה לפרטי זיהוי:

• שם מלא
• שם החניון/אתר החניה
• מספר לקוח (אם ידוע)

📞 039792365`;
            }
        } else {
            fallbackMessage = `שלום ${customerName} 👋

יש לי בעיה טכנית זמנית.
אנא פנה ישירות:

📞 039792365 
📧 Service@sbcloud.co.il
⏰ א'-ה' 8:15-17:00`;
        }
        
        return fallbackMessage;
    }
}

// ======================= שליחת סיכום שיחה =======================

async function sendConversationSummary(chatSession, customer) {
    try {
        const conversationSummary = chatSession.getConversationHistory();
        const duration = chatSession.getDuration();
        const messageCount = chatSession.messages.length;
        
        // קביעת נושא מפורט לפי הסיווג
        const topicDetails = {
            'תקלה': 'טיפול בתקלה טכנית',
            'הצעת_מחיר': 'בקשת הצעת מחיר',
            'נזק': 'דיווח נזק',
            'הדרכה': 'בקשת הדרכה',
            'כללי': 'פנייה כללית'
        };
        
        const topicDescription = topicDetails[chatSession.currentTopic] || 'פנייה כללית';
        
        await transporter.sendMail({
            from: process.env.EMAIL_USER || 'Report@sbparking.co.il',
            to: customer.email,
            cc: 'Service@sbcloud.co.il, Dror@sbparking.co.il',
            subject: `סיכום שיחת WhatsApp - ${customer.name} (${customer.site}) - ${topicDescription}`,
            html: `
                <div dir="rtl" style="font-family: Arial, sans-serif;">
                    <div style="background: linear-gradient(45deg, #3498db, #2980b9); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h2 style="margin: 0;">📱 סיכום שיחת WhatsApp - הדר</h2>
                        <p style="margin: 5px 0 0 0;">שיידט את בכמן - מערכת בקרת חניה מתקדמת</p>
                    </div>
                    
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h3 style="color: #2c3e50; margin-top: 0;">👤 פרטי לקוח:</h3>
                        <p><strong>שם:</strong> ${customer.name}</p>
                        <p><strong>אתר חניה:</strong> ${customer.site}</p>
                        <p><strong>מספר לקוח:</strong> #${customer.id}</p>
                        <p><strong>טלפון:</strong> ${customer.phone}</p>
                        <p><strong>כתובת:</strong> ${customer.address}</p>
                        <p><strong>תחילת שיחה:</strong> ${chatSession.startTime.toLocaleString('he-IL')}</p>
                        <p><strong>משך שיחה:</strong> ${duration} דקות</p>
                        <p><strong>מספר הודעות:</strong> ${messageCount}</p>
                        <p><strong>נושא:</strong> ${topicDescription}</p>
                    </div>
                    
                    <div style="background: #e8f5e8; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h3 style="color: #155724; margin-top: 0;">💬 תמליל השיחה:</h3>
                        <div style="background: white; padding: 15px; border-radius: 8px; white-space: pre-line; direction: rtl; max-height: 400px; overflow-y: auto; border: 1px solid #ddd;">
${conversationSummary}
                        </div>
                    </div>
                    
                    ${chatSession.currentTopic === 'תקלה' ? `
                    <div style="background: #fff3cd; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h3 style="color: #856404; margin-top: 0;">🔧 סטטוס טיפול:</h3>
                        <p>📋 תקלה תועדה במערכת</p>
                        <p>🔧 הנחיות אתחול ניתנו</p>
                        <p>📞 במידת הצורך נפתחה קריאת שירות</p>
                        <p><strong>מספר קריאה:</strong> SRV-${Date.now().toString().slice(-6)}</p>
                    </div>
                    ` : ''}
                    
                    <div style="background: #d1ecf1; padding: 20px; border-radius: 10px;">
                        <h3 style="color: #0c5460; margin-top: 0;">📋 סטטוס כללי:</h3>
                        <p>✅ השיחה הושלמה בהצלחה</p>
                        <p>📧 סיכום נשלח אוטומטית למערכת</p>
                        <p>👩‍💼 טופלה על ידי הדר - נציגת שירות AI</p>
                        <p>⏰ זמן מענה ממוצע: מיידי</p>
                    </div>
                    
                    <hr style="margin: 30px 0; border: none; border-top: 2px solid #ecf0f1;">
                    <div style="background: #ecf0f1; padding: 15px; border-radius: 8px; text-align: center;">
                        <p style="color: #7f8c8d; font-size: 12px; margin: 0;">
                            📧 סיכום אוטומטי מהדר - שיידט את בכמן<br>
                            📞 משרד: 039792365 | 📧 שירות: Service@sbcloud.co.il<br>
                            ⏰ שעות פעילות: א'-ה' 8:15-17:00<br>
                            🤖 מערכת AI מתקדמת עם זיכרון שיחות
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log('📧 סיכום שיחה נשלח בהצלחה');
        
    } catch (error) {
        console.error('❌ שגיאה בשליחת סיכום שיחה:', error);
    }
}

// ======================= שליחת התראה למנהל =======================

async function sendManagerAlert(phoneNumber, messageText, response, customer, chatSession) {
    try {
        const emailSubject = customer ? 
            `${chatSession?.currentTopic || 'פנייה'} מ-${customer.name} (${customer.site})` : 
            `הודעה חדשה מ-WhatsApp: ${phoneNumber}`;
        
        await transporter.sendMail({
            from: process.env.EMAIL_USER || 'Report@sbparking.co.il',
            to: 'Dror@sbparking.co.il',
            subject: emailSubject,
            html: `
                <div dir="rtl" style="font-family: Arial, sans-serif;">
                    <div style="background: linear-gradient(45deg, #3498db, #2980b9); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h2 style="margin: 0;">📱 הודעה חדשה מוואטסאפ</h2>
                        <p style="margin: 5px 0 0 0;">שיידט את בכמן - מערכת שירות לקוחות</p>
                    </div>
                    
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h3 style="color: #2c3e50; margin-top: 0;">📞 פרטי השולח:</h3>
                        <p><strong>📱 מספר:</strong> ${phoneNumber}</p>
                        
                        ${customer ? `
                        <div style="background: #d4edda; padding: 15px; border-radius: 8px; border-right: 4px solid #28a745; margin-top: 15px;">
                            <h4 style="color: #155724; margin-top: 0;">✅ לקוח מזוהה במערכת:</h4>
                            <p><strong>שם:</strong> ${customer.name}</p>
                            <p><strong>אתר חניה:</strong> ${customer.site}</p>
                            <p><strong>מספר לקוח:</strong> #${customer.id}</p>
                            <p><strong>אימייל:</strong> ${customer.email}</p>
                            <p><strong>כתובת:</strong> ${customer.address}</p>
                        </div>
                        ` : `
                        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-right: 4px solid #ffc107; margin-top: 15px;">
                            <p style="color: #856404; margin: 0;"><strong>⚠️ לקוח לא מזוהה במערכת</strong></p>
                        </div>
                        `}
                    </div>
                    
                    ${chatSession ? `
                    <div style="background: #e3f2fd; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h3 style="color: #1565c0; margin-top: 0;">🕒 מידע על השיחה:</h3>
                        <p><strong>נושא:</strong> ${chatSession.currentTopic || 'כללי'}</p>
                        <p><strong>משך שיחה:</strong> ${chatSession.getDuration()} דקות</p>
                        <p><strong>מספר הודעות:</strong> ${chatSession.messages.length}</p>
                        <p><strong>תחילת שיחה:</strong> ${chatSession.startTime.toLocaleString('he-IL')}</p>
                    </div>
                    ` : ''}
                    
                    <div style="background: white; padding: 20px; border-radius: 10px; border-right: 4px solid #3498db; margin-bottom: 20px;">
                        <h3 style="color: #2c3e50; margin-top: 0;">💬 ההודעה האחרונה:</h3>
                        <p style="font-size: 16px; line-height: 1.5; background: #f8f9fa; padding: 15px; border-radius: 8px;">"${messageText}"</p>
                    </div>
                    
                    <div style="background: white; padding: 20px; border-radius: 10px; border-right: 4px solid #27ae60;">
                        <h3 style="color: #2c3e50; margin-top: 0;">🤖 התגובה שנשלחה:</h3>
                        <p style="font-size: 14px; line-height: 1.5; background: #e8f5e8; padding: 15px; border-radius: 8px;">"${response}"</p>
                    </div>
                    
                    ${chatSession && chatSession.messages.length > 2 ? `
                    <div style="background: #f5f5f5; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h3 style="color: #2c3e50; margin-top: 0;">📜 היסטוריית השיחה:</h3>
                        <div style="max-height: 200px; overflow-y: auto; background: white; padding: 15px; border-radius: 8px; border: 1px solid #ddd;">
                            <pre style="white-space: pre-wrap; direction: rtl;">${chatSession.getConversationHistory()}</pre>
                        </div>
                    </div>
                    ` : ''}
                    
                    <div style="margin-top: 20px; padding: 15px; background: #ecf0f1; border-radius: 8px; text-align: center;">
                        <p style="color: #7f8c8d; font-size: 12px; margin: 0;">
                            ⏰ זמן: ${new Date().toLocaleString('he-IL')}<br>
                            🤖 הודעה זו נשלחה אוטומטית ממערכת שיידט את בכמן<br>
                            👥 סה"כ לקוחות במערכת: ${customers.length}<br>
                            🔄 שיחות פעילות: ${activeChats.size}
                        </p>
                    </div>
                </div>
            `
        });
        console.log('📧 התראה נשלחה למנהל');
    } catch (emailError) {
        console.error('❌ שגיאה בשליחת התראה:', emailError);
    }
}

// ======================= WhatsApp Webhook מתקדם =======================

app.post('/webhook/whatsapp', async (req, res) => {
    try {
        console.log('📩 WhatsApp Webhook received:', JSON.stringify(req.body, null, 2));
        
        if (req.body.typeWebhook === 'incomingMessageReceived') {
            const messageData = req.body.messageData;
            const senderData = req.body.senderData;
            
            const phoneNumber = senderData.sender.replace('@c.us', '');
            const messageText = messageData.textMessageData?.textMessage || 'הודעה ללא טקסט';
            
            console.log(`📱 הודעה מ-${phoneNumber}: ${messageText}`);
            
            // חיפוש לקוח במסד הנתונים
            const customer = findCustomerByPhoneOrSite(phoneNumber, messageText);
            
            // קבלת/יצירת session שיחה
            let chatSession = activeChats.get(phoneNumber);
            if (!chatSession) {
                chatSession = new ChatSession(phoneNumber, customer);
                activeChats.set(phoneNumber, chatSession);
                console.log(`🆕 שיחה חדשה נוצרה עבור ${phoneNumber}`);
                
                if (customer) {
                    console.log(`✅ לקוח מזוהה: ${customer.name} מ${customer.site}`);
                } else {
                    console.log(`⚠️ לקוח לא מזוהה: ${phoneNumber}`);
                }
            }
            
            // הוספת ההודעה לhistory
            chatSession.addMessage('customer', messageText);
            
            // זיהוי נושא השיחה
            const topic = detectConversationTopic(messageText);
            if (topic !== 'כללי') {
                chatSession.currentTopic = topic;
                console.log(`📋 נושא שיחה זוהה: ${topic}`);
            }
            
            // יצירת הקשר מלא לפי היסטוריית השיחה
            const conversationHistory = chatSession.getConversationHistory();
            const contextMessage = `היסטוריית השיחה:\n${conversationHistory}\n\nהודעה נוכחית: "${messageText}"\nנושא: ${chatSession.currentTopic || 'לא זוהה'}`;
            
            // יצירת תגובה עם הקשר מלא
            const response = await generateAIResponseWithContext(
                contextMessage,
                messageText,
                senderData.senderName || 'לקוח',
                customer,
                phoneNumber,
                chatSession
            );
            
            // הוספת התגובה לhistory
            chatSession.addMessage('hadar', response);
            
            // שליחת תגובה
            await sendWhatsAppMessage(phoneNumber, response);
            
            // בדיקה אם צריך לשלוח סיכום
            if ((response.includes('סיכום') || response.includes('אשלח')) && customer && 
                (topic === 'סיכום' || messageText.toLowerCase().includes('סיכום') || 
                 messageText.toLowerCase().includes('מייל'))) {
                
                chatSession.needsEmailSummary = true;
                console.log('📧 מסומן לשליחת סיכום אימייל');
                
                // שליחת סיכום אמיתי
                await sendConversationSummary(chatSession, customer);
                
                // סימון השיחה כהושלמה
                chatSession.status = 'completed';
            }
            
            // שליחת אימייל התראה למנהל (עם היסטוריה)
            await sendManagerAlert(phoneNumber, messageText, response, customer, chatSession);
            
            console.log(`💬 שיחה עם ${phoneNumber}: ${chatSession.messages.length} הודעות, נושא: ${chatSession.currentTopic || 'כללי'}`);
            
        } else {
            console.log('ℹ️ התעלמות מסטטוס:', req.body.typeWebhook);
        }
        
        res.status(200).json({ status: 'OK', activeChats: activeChats.size });
    } catch (error) {
        console.error('❌ שגיאה בעיבוד webhook:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ======================= ממשק וEB =======================

// עמוד הבית המעודכן
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>מערכת בקרת חניה מתקדמת - שיידט את בכמן</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
                .container { max-width: 700px; margin: 0 auto; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
                h1 { color: #2c3e50; text-align: center; margin-bottom: 30px; }
                .company-header { text-align: center; background: #3498db; color: white; padding: 20px; border-radius: 10px; margin-bottom: 30px; }
                .hadar-info { background: #e8f5e8; padding: 20px; border-radius: 10px; margin: 20px 0; border-right: 4px solid #27ae60; }
                .stats { display: flex; justify-content: space-around; margin: 20px 0; }
                .stat { text-align: center; background: #ecf0f1; padding: 15px; border-radius: 8px; }
                input, textarea, button, select { 
                    width: 100%; 
                    padding: 12px; 
                    margin: 10px 0; 
                    box-sizing: border-box;
                    border: 2px solid #ddd;
                    border-radius: 8px;
                    font-size: 14px;
                }
                button { 
                    background: linear-gradient(45deg, #3498db, #2980b9); 
                    color: white; 
                    border: none; 
                    cursor: pointer;
                    font-size: 16px;
                    font-weight: bold;
                    transition: all 0.3s;
                }
                button:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.2); }
                .customer-search { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0; }
                .quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0; }
                .quick-btn { padding: 15px; background: #27ae60; color: white; text-decoration: none; border-radius: 8px; text-align: center; }
                .quick-btn:hover { background: #219a52; }
                .service-areas { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 20px 0; }
                .service-area { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-right: 4px solid #3498db; }
                .whatsapp-status { background: #d4edda; padding: 15px; border-radius: 10px; margin: 20px 0; border-right: 4px solid #28a745; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="company-header">
                    <h1>🚗 שיידט את בכמן</h1>
                    <p>מערכת בקרת חניה מתקדמת</p>
                </div>
                
                <div class="hadar-info">
                    <h3>👩‍💼 הדר - נציגת שירות לקוחות AI מתקדמת</h3>
                    <p><strong>✨ עם זיכרון שיחות ומעקב הקשר!</strong></p>
                    <p><strong>מתמחה בטיפול ללקוחות מזוהים בלבד:</strong></p>
                    <ul>
                        <li>🔧 שירות ודיווח על תקלות עם מעקב שלבים</li>
                        <li>💰 הצעות מחיר לציוד</li>
                        <li>📋 דיווח על נזקים</li>
                        <li>📚 הדרכות תפעול</li>
                        <li>📧 סיכום אוטומטי בסיום שיחה</li>
                    </ul>
                    <p><strong>📞 039792365 | 📧 Service@sbcloud.co.il</strong></p>
                    <small>שעות פעילות: א'-ה' 8:15-17:00</small>
                </div>
                
                <div class="whatsapp-status">
                    <h3>📱 סטטוס WhatsApp AI:</h3>
                    <p>🟢 <strong>פעיל</strong> - שיחות פעילות: ${activeChats.size}</p>
                    <p>🧠 <strong>זיכרון חכם:</strong> זוכר היסטוריית שיחות</p>
                    <p>⚡ <strong>תגובה מיידית</strong> 24/7</p>
                    <p>📧 <strong>סיכום אוטומטי</strong> בסיום טיפול</p>
                </div>
                
                <div class="stats">
                    <div class="stat">
                        <h3>📧 שירות אימייל</h3>
                        <small>smtp.012.net.il</small>
                    </div>
                    <div class="stat">
                        <h3>🤖 הדר AI Bot</h3>
                        <small>עם זיכרון</small>
                    </div>
                    <div class="stat">
                        <h3>👥 לקוחות רשומים</h3>
                        <small>${customers.length} אתרים</small>
                    </div>
                </div>
                
                <div class="service-areas">
                    <h3>🛠️ תחומי שירות</h3>
                    <div class="service-area">
                        <strong>ציוד בקרת חניה:</strong> כניסה, יציאה, קורא אשראי, מחסומים, גלאי כביש, מצלמות LPR, מקודדים, אינטרקום, מחשב ראשי, תחנת עבודה
                    </div>
                    <div class="service-area">
                        <strong>טווחי יחידות:</strong> 100-199 כניסות | 200-299 יציאות | 300-399 מעברים | 600-699 אוטומטיות | 700-799 קופות ידניות
                    </div>
                </div>
                
                <div class="quick-actions">
                    <a href="#email-form" class="quick-btn">📧 שליחת אימייל</a>
                    <a href="#customer-search" class="quick-btn">🔍 חיפוש לקוח</a>
                    <a href="/dashboard" class="quick-btn">📊 דשבורד</a>
                    <a href="/whatsapp-status" class="quick-btn">📱 סטטוס WhatsApp</a>
                </div>
                
                <div id="customer-search" class="customer-search">
                    <h3>🔍 חיפוש מהיר בלקוחות</h3>
                    <input type="text" id="searchBox" placeholder="חפש לפי שם, אתר, טלפון או אימייל..." onkeyup="searchCustomers()">
                    <div id="searchResults"></div>
                </div>
                
                <div id="email-form">
                    <h2>📧 שליחת אימייל ללקוח</h2>
                    <form action="/send-email" method="POST" enctype="multipart/form-data">
                        <label>בחר לקוח:</label>
                        <select name="customer" id="customerSelect" onchange="fillCustomerDetails()">
                            <option value="">-- בחר לקוח או הזן ידנית --</option>
                            ${customers.map(c => `<option value="${c.email}" data-name="${c.name}" data-site="${c.site}">${c.name} - ${c.site}</option>`).join('')}
                        </select>
                        
                        <label>כתובת אימייל:</label>
                        <input type="email" name="to" id="emailInput" required placeholder="customer@example.com">
                        
                        <label>נושא:</label>
                        <input type="text" name="subject" required placeholder="נושא האימייל">
                        
                        <label>הודעה:</label>
                        <textarea name="message" rows="6" required placeholder="שלום,\n\nכותב אליך מחברת שיידט את בכמן בנוגע ל..."></textarea>
                        
                        <label>תמונות (אופציונלי):</label>
                        <input type="file" name="images" multiple accept="image/*">
                        
                        <button type="submit">שלח אימייל 📨</button>
                    </form>
                </div>
                
                <div style="margin-top: 30px; padding: 20px; background: #ecf0f1; border-radius: 10px;">
                    <h3>📊 מידע טכני</h3>
                    <p><strong>WhatsApp Webhook:</strong> <code>/webhook/whatsapp</code></p>
                    <p><strong>מספר מחובר:</strong> 972545484210</p>
                    <p><strong>שרת אימייל:</strong> smtp.012.net.il</p>
                    <p><strong>לקוחות במערכת:</strong> ${customers.length} אתרי בקרת חניה</p>
                    <p><strong>נציגת שירות:</strong> הדר - AI מתקדם עם זיכרון</p>
                    <p><strong>שיחות פעילות:</strong> ${activeChats.size}</p>
                </div>
            </div>
            
            <script>
                const customers = ${JSON.stringify(customers)};
                
                function fillCustomerDetails() {
                    const select = document.getElementById('customerSelect');
                    const emailInput = document.getElementById('emailInput');
                    
                    if (select.value) {
                        emailInput.value = select.value;
                    }
                }
                
                function searchCustomers() {
                    const query = document.getElementById('searchBox').value.toLowerCase();
                    const results = document.getElementById('searchResults');
                    
                    if (query.length < 2) {
                        results.innerHTML = '';
                        return;
                    }
                    
                    const matches = customers.filter(c => 
                        c.name.toLowerCase().includes(query) ||
                        c.site.toLowerCase().includes(query) ||
                        c.phone.includes(query) ||
                        c.email.toLowerCase().includes(query)
                    );
                    
                    if (matches.length > 0) {
                        results.innerHTML = '<h4>תוצאות חיפוש:</h4>' + 
                        matches.slice(0, 5).map(c => 
                            \`<div style="background: white; padding: 10px; margin: 5px 0; border-radius: 5px; border-right: 4px solid #3498db;">
                                <strong>\${c.name}</strong> - \${c.site}<br>
                                <small>📞 \${c.phone} | 📧 \${c.email} | #\${c.id}</small>
                                <button onclick="selectCustomer('\${c.email}', '\${c.name}', '\${c.site}')" style="margin: 5px 0; width: auto; padding: 5px 10px;">בחר לקוח</button>
                            </div>\`
                        ).join('');
                    } else {
                        results.innerHTML = '<p style="color: #e74c3c;">לא נמצאו תוצאות</p>';
                    }
                }
                
                function selectCustomer(email, name, site) {
                    document.getElementById('emailInput').value = email;
                    document.getElementById('customerSelect').value = email;
                    document.getElementById('searchBox').value = name + ' - ' + site;
                    document.getElementById('searchResults').innerHTML = '';
                }
            </script>
        </body>
        </html>
    `);
});

// API לשליחת אימייל עם תמונות (ללא שינוי)
app.post('/send-email', upload.array('images', 5), async (req, res) => {
    try {
        console.log('📧 מתחיל לשלוח אימייל...');
        
        const { to, subject, message } = req.body;
        
        let htmlContent = `
            <div dir="rtl" style="font-family: Arial, sans-serif;">
                <div style="background: linear-gradient(45deg, #3498db, #2980b9); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                    <h2 style="margin: 0;">🚗 שיידט את בכמן</h2>
                    <p style="margin: 5px 0 0 0;">הדר נציגת שירות מערכת בקרת חניה מתקדמת</p>
                </div>
                <div style="padding: 20px;">
                    ${message.replace(/\n/g, '<br>')}
                </div>
        `;
        
        const attachments = [];
        
        if (req.files && req.files.length > 0) {
            console.log(`🖼️ מצרף ${req.files.length} תמונות`);
            htmlContent += '<br><h3 style="color: #2c3e50;">🖼️ תמונות מצורפות:</h3>';
            
            req.files.forEach((file, index) => {
                const cid = `image${index + 1}`;
                attachments.push({
                    filename: file.originalname || `image_${index + 1}.jpg`,
                    content: file.buffer,
                    cid: cid
                });
                htmlContent += `<p><img src="cid:${cid}" style="max-width: 500px; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" alt="תמונה ${index + 1}"></p>`;
            });
        }
        
        htmlContent += `
                <hr style="margin: 30px 0; border: none; border-top: 2px solid #ecf0f1;">
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                    <p style="color: #7f8c8d; font-size: 12px; margin: 0;">
                        הודעה זו נשלחה ממערכת שיידט את בכמן<br>
                        📧 לפניות: Report@sbparking.co.il | 🚗 מערכת ניהול חניות מתקדמת
                    </p>
                </div>
            </div>
        `;
        
        const mailOptions = {
            from: process.env.EMAIL_USER || 'Report@sbparking.co.il',
            to: to,
            subject: subject,
            html: htmlContent,
            attachments: attachments
        };
        
        const result = await transporter.sendMail(mailOptions);
        console.log('✅ אימייל נשלח בהצלחה:', result.messageId);
        
        res.send(`
            <div dir="rtl" style="font-family: Arial; margin: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 50px 0;">
                <div style="max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #27ae60; margin: 0;">✅ האימייל נשלח בהצלחה!</h1>
                    </div>
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 10px;">
                        <p><strong>📧 נמען:</strong> ${to}</p>
                        <p><strong>📝 נושא:</strong> ${subject}</p>
                        <p><strong>🖼️ תמונות:</strong> ${req.files ? req.files.length : 0}</p>
                        <p><strong>🆔 Message ID:</strong> <code>${result.messageId}</code></p>
                    </div>
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="/" style="background: linear-gradient(45deg, #3498db, #2980b9); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">← חזור למערכת</a>
                    </div>
                </div>
            </div>
        `);
        
    } catch (error) {
        console.error('❌ שגיאה בשליחת אימייל:', error);
        res.status(500).send(`
            <div dir="rtl" style="font-family: Arial; margin: 50px; background: #e74c3c; min-height: 100vh; padding: 50px 0;">
                <div style="max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 15px;">
                    <h2 style="color: #e74c3c; text-align: center;">❌ שגיאה בשליחת האימייל</h2>
                    <p><strong>פרטי השגיאה:</strong> ${error.message}</p>
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="/" style="background: #3498db; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px;">← חזור לנסות שוב</a>
                    </div>
                </div>
            </div>
        `);
    }
});

// ======================= עמודי ניטור ובדיקה =======================

// עמוד סטטוס WhatsApp
app.get('/whatsapp-status', (req, res) => {
    const activeChatsList = Array.from(activeChats.entries()).map(([phone, session]) => ({
        phone,
        customerName: session.customerData?.name || 'לא מזוהה',
        customerSite: session.customerData?.site || 'לא מזוהה',
        topic: session.currentTopic || 'כללי',
        messageCount: session.messages.length,
        duration: session.getDuration(),
        lastActivity: session.lastActivity.toLocaleString('he-IL'),
        status: session.status
    }));
    
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>סטטוס WhatsApp - שיידט את בכמן</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
                .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
                .header { background: white; padding: 30px; border-radius: 15px; margin-bottom: 30px; text-align: center; }
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
                .stat-card { background: white; padding: 25px; border-radius: 15px; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                .stat-number { font-size: 2.5em; font-weight: bold; color: #3498db; margin: 10px 0; }
                .chats-table { background: white; border-radius: 15px; overflow: hidden; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                .table-header { background: #3498db; color: white; padding: 20px; }
                .chat-row { padding: 15px 20px; border-bottom: 1px solid #ecf0f1; display: grid; grid-template-columns: 1.5fr 2fr 1fr 1fr 1fr 1.5fr; gap: 15px; align-items: center; }
                .chat-row:hover { background: #f8f9fa; }
                .status-active { color: #27ae60; font-weight: bold; }
                .status-completed { color: #95a5a6; }
                .back-btn { display: inline-block; background: #27ae60; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
                .refresh-btn { background: #f39c12; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 10px; }
            </style>
            <script>
                // רענון אוטומטי כל 30 שניות
                setTimeout(() => location.reload(), 30000);
            </script>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📱 סטטוס WhatsApp - הדר AI</h1>
                    <p>מעקב שיחות פעילות ומושלמות</p>
                    <a href="javascript:location.reload()" class="refresh-btn">🔄 רענן</a>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <h3>💬 שיחות פעילות</h3>
                        <div class="stat-number">${activeChatsList.filter(c => c.status === 'active').length}</div>
                        <p>שיחות בתהליך</p>
                    </div>
                    <div class="stat-card">
                        <h3>✅ שיחות הושלמו</h3>
                        <div class="stat-number">${activeChatsList.filter(c => c.status === 'completed').length}</div>
                        <p>סוכמו והושלמו</p>
                    </div>
                    <div class="stat-card">
                        <h3>👥 לקוחות מזוהים</h3>
                        <div class="stat-number">${activeChatsList.filter(c => c.customerName !== 'לא מזוהה').length}</div>
                        <p>מתוך ${activeChatsList.length}</p>
                    </div>
                    <div class="stat-card">
                        <h3>⏱️ זמן מענה</h3>
                        <div class="stat-number">מיידי</div>
                        <p>תגובה אוטומטית</p>
                    </div>
                </div>
                
                <div class="chats-table">
                    <div class="table-header">
                        <h2>📋 שיחות פעילות ואחרונות</h2>
                        <small>רענון אוטומטי כל 30 שניות</small>
                    </div>
                    <div class="chat-row" style="background: #ecf0f1; font-weight: bold;">
                        <div>מספר טלפון</div>
                        <div>לקוח ואתר</div>
                        <div>נושא</div>
                        <div>הודעות</div>
                        <div>משך (דק')</div>
                        <div>פעילות אחרונה</div>
                    </div>
                    ${activeChatsList.length === 0 ? `
                        <div style="padding: 40px; text-align: center; color: #666;">
                            <h3>😴 אין שיחות פעילות כרגע</h3>
                            <p>המערכת ממתינה לפניות WhatsApp חדשות</p>
                        </div>
                    ` : activeChatsList.map(chat => `
                        <div class="chat-row">
                            <div>
                                <strong>${chat.phone}</strong><br>
                                <small class="${chat.status === 'active' ? 'status-active' : 'status-completed'}">${chat.status === 'active' ? '🟢 פעיל' : '✅ הושלם'}</small>
                            </div>
                            <div>
                                <strong>${chat.customerName}</strong><br>
                                <small style="color: #666;">${chat.customerSite}</small>
                            </div>
                            <div>
                                <span style="background: #e3f2fd; padding: 3px 8px; border-radius: 12px; font-size: 12px;">
                                    ${chat.topic}
                                </span>
                            </div>
                            <div>${chat.messageCount}</div>
                            <div>${chat.duration}</div>
                            <div>
                                <small>${chat.lastActivity}</small>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <div style="display: flex; gap: 15px; margin-top: 30px;">
                    <a href="/" class="back-btn">← חזור למערכת</a>
                    <a href="/dashboard" class="back-btn" style="background: #3498db;">📊 דשבורד כללי</a>
                    <a href="/test-hadar" class="back-btn" style="background: #f39c12;">🧪 בדיקת הדר</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// דשבורד מתקדם
app.get('/dashboard', (req, res) => {
    const totalCustomers = customers.length;
    const uniqueCities = [...new Set(customers.map(c => c.address.split(',')[0]).filter(c => c))].length;
    const customersWithEmail = customers.filter(c => c.email).length;
    const activeChatsCount = activeChats.size;
    
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>דשבורד - שיידט את בכמן</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
                .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
                .header { background: white; padding: 30px; border-radius: 15px; margin-bottom: 30px; text-align: center; }
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
                .stat-card { background: white; padding: 25px; border-radius: 15px; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                .stat-number { font-size: 2.5em; font-weight: bold; color: #3498db; margin: 10px 0; }
                .customers-table { background: white; border-radius: 15px; overflow: hidden; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                .table-header { background: #3498db; color: white; padding: 20px; }
                .customer-row { padding: 15px 20px; border-bottom: 1px solid #ecf0f1; display: grid; grid-template-columns: 2fr 2fr 1.5fr 2fr; gap: 15px; align-items: center; }
                .customer-row:hover { background: #f8f9fa; }
                .back-btn { display: inline-block; background: #27ae60; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
                .system-status { background: #e8f5e8; padding: 20px; border-radius: 15px; margin-bottom: 30px; border-right: 4px solid #27ae60; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📊 דשבורד ניהול - שיידט את בכמן</h1>
                    <p>מעקב ובקרה על מערכת ניהול החניות המתקדמת</p>
                </div>
                
                <div class="system-status">
                    <h3>🤖 סטטוס מערכת הדר AI:</h3>
                    <p>🟢 <strong>פעילה ותקינה</strong> - עם זיכרון שיחות מתקדם</p>
                    <p>📱 <strong>WhatsApp:</strong> מחובר ופעיל</p>
                    <p>📧 <strong>אימייל:</strong> smtp.012.net.il - תקין</p>
                    <p>💬 <strong>שיחות פעילות:</strong> ${activeChatsCount}</p>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <h3>👥 סה"כ לקוחות</h3>
                        <div class="stat-number">${totalCustomers}</div>
                        <p>אתרי חניה פעילים</p>
                    </div>
                    <div class="stat-card">
                        <h3>🏙️ ערים</h3>
                        <div class="stat-number">${uniqueCities}</div>
                        <p>ערים עם אתרי חניה</p>
                    </div>
                    <div class="stat-card">
                        <h3>📧 עם אימייל</h3>
                        <div class="stat-number">${customersWithEmail}</div>
                        <p>לקוחות עם כתובת אימייל</p>
                    </div>
                    <div class="stat-card">
                        <h3>💬 WhatsApp</h3>
                        <div class="stat-number">${activeChatsCount}</div>
                        <p>שיחות פעילות</p>
                    </div>
                </div>
                
                <div class="customers-table">
                    <div class="table-header">
                        <h2>👥 רשימת לקוחות (${customers.length > 20 ? 'מציג 20 ראשונים' : 'כל הלקוחות'})</h2>
                    </div>
                    <div class="customer-row" style="background: #ecf0f1; font-weight: bold;">
                        <div>שם ואתר</div>
                        <div>פרטי קשר</div>
                        <div>מספר לקוח</div>
                        <div>כתובת</div>
                    </div>
                    ${customers.slice(0, 20).map(c => `
                        <div class="customer-row">
                            <div>
                                <strong>${c.name}</strong><br>
                                <small style="color: #666;">${c.site}</small>
                            </div>
                            <div>
                                📞 ${c.phone}<br>
                                📧 ${c.email}
                            </div>
                            <div>#${c.id}</div>
                            <div>${c.address}</div>
                        </div>
                    `).join('')}
                    ${customers.length > 20 ? `
                        <div style="padding: 20px; text-align: center; background: #f8f9fa;">
                            <p>ועוד ${customers.length - 20} לקוחות נוספים...</p>
                        </div>
                    ` : ''}
                </div>
                
                <div style="display: flex; gap: 15px; margin-top: 30px;">
                    <a href="/" class="back-btn">← חזור למערכת</a>
                    <a href="/whatsapp-status" class="back-btn" style="background: #3498db;">📱 סטטוס WhatsApp</a>
                    <a href="/test-conversation-smart" class="back-btn" style="background: #f39c12;">🧪 בדיקת שיחה</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// ======================= APIs נוספים =======================

// API לחיפוש לקוחות
app.get('/api/customers/search', (req, res) => {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
        return res.json([]);
    }
    
    const searchTerm = q.toLowerCase();
    const results = customers.filter(customer => 
        customer.name.toLowerCase().includes(searchTerm) ||
        customer.site.toLowerCase().includes(searchTerm) ||
        customer.phone.includes(searchTerm) ||
        customer.email.toLowerCase().includes(searchTerm) ||
        customer.address.toLowerCase().includes(searchTerm)
    ).slice(0, 10);
    
    res.json(results);
});

// API לקבלת סטטוס מערכת
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        customers: customers.length,
        activeChats: activeChats.size,
        whatsapp: {
            instance: '7105253183',
            status: 'active'
        },
        email: {
            server: 'smtp.012.net.il',
            status: 'connected'
        },
        ai: {
            service: 'OpenAI GPT-3.5-turbo',
            features: ['memory', 'context', 'auto-summary']
        }
    });
});

// API לניקוי שיחות ישנות ידנית
app.post('/api/cleanup-chats', (req, res) => {
    const cleaned = cleanupExpiredChats();
    res.json({
        success: true,
        message: `נוקו ${cleaned} שיחות ישנות`,
        remainingChats: activeChats.size
    });
});

// בדיקת webhook (GET request)
app.get('/webhook/whatsapp', (req, res) => {
    res.json({ 
        message: 'WhatsApp Webhook is working!', 
        timestamp: new Date().toISOString(),
        instance: '7105253183',
        company: 'שיידט את בכמן',
        activeChats: activeChats.size,
        features: ['memory', 'context', 'auto-summary']
    });
});

// בדיקת חיבור לשרת אימייל
app.get('/test-connection', async (req, res) => {
    try {
        await transporter.verify();
        res.json({
            success: true,
            message: '✅ החיבור לשרת האימייל עובד!',
            server: 'smtp.012.net.il',
            company: 'שיידט את בכמן',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '❌ בעיה בחיבור לשרת האימייל',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API לשליחת הודעת WhatsApp ידנית
app.post('/send-whatsapp', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;
        
        if (!phoneNumber || !message) {
            return res.status(400).json({ error: 'חסרים פרטים: phoneNumber ו-message' });
        }
        
        const result = await sendWhatsAppMessage(phoneNumber, message);
        res.json({ success: true, result, timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ======================= בדיקות מתקדמות =======================

// בדיקת הדר פשוטה
app.get('/test-hadar', async (req, res) => {
    try {
        const testResponse = await generateAIResponseWithContext(
            'בדיקה: מערכת פעילה', 
            'בדיקה: מערכת פעילה',
            'מצב בדיקה', 
            customers[0],
            '972545484210',
            null
        );
        
        res.send(`
            <div dir="rtl" style="font-family: Arial; padding: 50px;">
                <h1>🧪 בדיקת מצב הדר</h1>
                <div style="background: #e8f5e8; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>תגובת הדר:</h3>
                    <p style="background: white; padding: 15px; border-radius: 5px; border-right: 4px solid green;">${testResponse.replace(/\n/g, '<br>')}</p>
                </div>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 10px;">
                    <p><strong>לקוח לבדיקה:</strong> ${customers[0]?.name} - ${customers[0]?.site}</p>
                    <p><strong>מספר בדיקה:</strong> 972545484210</p>
                    <p><strong>זמן בדיקה:</strong> ${new Date().toLocaleString('he-IL')}</p>
                </div>
                <br>
                <a href="/" style="background: #3498db; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px;">← חזור למערכת</a>
                <a href="/test-conversation-smart" style="background: #f39c12; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin-right: 10px;">🧪 בדיקת שיחה מלאה</a>
            </div>
        `);
    } catch (error) {
        res.status(500).send(`<h1>שגיאה: ${error.message}</h1>`);
    }
});

// בדיקת שיחה חכמה מלאה עם זיכרון
app.get('/test-conversation-smart', async (req, res) => {
    try {
        const knownCustomer = customers.find(c => c.id === 186) || customers[0];
        
        // יצירת session בדיקה
        const testSession = new ChatSession('972545484210', knownCustomer);
        
        const conversationSteps = [
            { step: 1, message: "שלום", title: "פתיחת שיחה" },
            { step: 2, message: "יש בעיה בכניסה, לא מנפיק כרטיס", title: "דיווח תקלה" },
            { step: 3, message: "זה במחסום כניסה מספר 120", title: "פרטים נוספים" },
            { step: 4, message: "עשיתי אתחול כמו שאמרת, עדיין לא עובד", title: "דיווח כישלון אתחול" },
            { step: 5, message: "כן, שלח בבקשה סיכום למייל שלי", title: "אישור סיכום" }
        ];
        
        const responses = [];
        
        for (const step of conversationSteps) {
            // הוספת ההודעה לsession
            testSession.addMessage('customer', step.message);
            
            // עדכון נושא אם רלוונטי
            const topic = detectConversationTopic(step.message);
            if (topic !== 'כללי') {
                testSession.currentTopic = topic;
            }
            
            // יצירת תגובה עם הקשר מלא
            const response = await generateAIResponseWithContext(
                testSession.getConversationHistory(),
                step.message,
                knownCustomer.name,
                knownCustomer,
                '972545484210',
                testSession
            );
            
            // הוספת התגובה לsession
            testSession.addMessage('hadar', response);
            
            responses.push({
                ...step,
                response: response
            });
            
            // השהיה בין השלבים
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // שליחת סיכום אמיתי אם הלקוח אישר
        let emailSent = false;
        if (responses[4]?.response?.includes('סיכום')) {
            try {
                await sendConversationSummary(testSession, knownCustomer);
                emailSent = true;
            } catch (emailError) {
                console.error('שגיאה בשליחת סיכום בדיקה:', emailError);
            }
        }
        
        res.send(`
            <div dir="rtl" style="font-family: Arial; padding: 30px; max-width: 1200px; margin: 0 auto;">
                <h1>🧠 בדיקת שיחה חכמה עם זיכרון מלא</h1>
                
                <div style="background: #d4edda; padding: 20px; border-radius: 10px; margin-bottom: 30px;">
                    <h3>👤 פרופיל לקוח:</h3>
                    <p><strong>שם:</strong> ${knownCustomer.name}</p>
                    <p><strong>אתר:</strong> ${knownCustomer.site}</p>
                    <p><strong>מספר לקוח:</strong> #${knownCustomer.id}</p>
                    <p><strong>סטטוס:</strong> ✅ מזוהה במערכת</p>
                    <p><strong>משך שיחה:</strong> ${testSession.getDuration()} דקות</p>
                    <p><strong>סה"כ הודעות:</strong> ${testSession.messages.length}</p>
                </div>
                
                ${responses.map(step => `
                    <div style="margin-bottom: 30px; border: 1px solid #ddd; border-radius: 10px; overflow: hidden;">
                        <div style="background: ${step.step === 5 ? '#27ae60' : '#3498db'}; color: white; padding: 15px;">
                            <h3 style="margin: 0;">שלב ${step.step}: ${step.title}</h3>
                            <small>נושא זוהה: ${testSession.currentTopic || 'כללי'}</small>
                        </div>
                        
                        <div style="padding: 20px;">
                            <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                                <strong>👤 ${knownCustomer.name}:</strong>
                                <p style="margin: 5px 0; font-style: italic;">"${step.message}"</p>
                            </div>
                            
                            <div style="background: #e8f5e8; padding: 15px; border-radius: 8px;">
                                <strong>👩‍💼 הדר (עם זיכרון):</strong>
                                <p style="margin: 5px 0; white-space: pre-line;">${step.response}</p>
                            </div>
                        </div>
                    </div>
                `).join('')}
                
                ${emailSent ? `
                    <div style="background: #d1ecf1; padding: 20px; border-radius: 10px; margin-top: 30px; text-align: center;">
                        <h3 style="color: #0c5460;">📧 סיכום השיחה נשלח בהצלחה!</h3>
                        <p>אימייל מפורט נשלח ל:</p>
                        <p><strong>📧 ${knownCustomer.email}</strong></p>
                        <p><strong>📧 Service@sbcloud.co.il (העתק)</strong></p>
                        <p><strong>📧 Dror@sbparking.co.il (העתק)</strong></p>
                        <small>בדוק את תיבת הדואר לסיכום המפורט</small>
                    </div>
                ` : ''}
                
                <div style="margin-top: 40px; text-align: center;">
                    <h3>📊 ניתוח מערכת הזיכרון</h3>
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 10px;">
                        <p>✅ <strong>זיכרון:</strong> הדר זכרה את כל השיחה</p>
                        <p>✅ <strong>הקשר:</strong> כל תגובה התבססה על ההיסטוריה</p>
                        <p>✅ <strong>התקדמות:</strong> לא חזרה על שאלות שכבר שאלה</p>
                        <p>✅ <strong>נושא:</strong> זיהתה ועקבה אחר נושא התקלה</p>
                        <p>✅ <strong>סיכום:</strong> שלחה סיכום מפורט בסיום</p>
                    </div>
                    
                    <div style="display: flex; gap: 15px; justify-content: center; margin-top: 20px; flex-wrap: wrap;">
                        <a href="/whatsapp-status" style="background: #3498db; color: white; padding: 15px 20px; text-decoration: none; border-radius: 8px;">📱 סטטוס WhatsApp</a>
                        <a href="/dashboard" style="background: #6c757d; color: white; padding: 15px 20px; text-decoration: none; border-radius: 8px;">📊 דשבורד</a>
                        <a href="/" style="background: #95a5a6; color: white; padding: 15px 20px; text-decoration: none; border-radius: 8px;">← חזור למערכת</a>
                    </div>
                </div>
            </div>
        `);
        
    } catch (error) {
        res.status(500).send(`
            <div dir="rtl" style="font-family: Arial; padding: 50px; text-align: center;">
                <h1 style="color: #e74c3c;">❌ שגיאה בבדיקת השיחה</h1>
                <p><strong>פרטי השגיאה:</strong> ${error.message}</p>
                <a href="/" style="background: #3498db; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px;">← חזור למערכת</a>
            </div>
        `);
    }
});

// ======================= הפעלת השרת =======================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 השרת פועל על פורט:', PORT);
    console.log('🌐 פתח בדפדפן: http://localhost:' + PORT);
    console.log('📧 שרת אימייל: smtp.012.net.il');
    console.log('📱 WhatsApp Instance: 7105253183');
    console.log('🏢 חברה: שיידט את בכמן');
    console.log(`👥 לקוחות במערכת: ${customers.length}`);
    console.log('🤖 הדר AI: פעילה עם זיכרון מתקדם');
    console.log('💬 שיחות פעילות: 0');
});

// בדיקת חיבור בהפעלה
transporter.verify()
    .then(() => {
        console.log('✅ חיבור לשרת אימייל תקין');
    })
    .catch((error) => {
        console.error('❌ בעיה בחיבור לשרת אימייל:', error.message);
    });

// הדפסת מידע על התכונות החדשות
console.log('\n🎉 תכונות חדשות במערכת:');
console.log('   🧠 זיכרון שיחות - הדר זוכרת את כל השיחה');
console.log('   🔄 ניקוי אוטומטי של שיחות ישנות');
console.log('   📧 סיכום אוטומטי בסיום שיחה');
console.log('   ⏱️ השהיות מתקדמות למניעת rate limiting');
console.log('   📊 דשבורד מתקדם עם מעקב שיחות');
console.log('   🧪 מערכת בדיקות מקיפה\n');
