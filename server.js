// קובץ: server.js - קובץ מלא וגמור עם כל התיקונים
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const axios = require('axios');
const app = express();

// טעינת מסד נתוני לקוחות מקובץ חיצוני
const fs = require('fs');

let customers = [];
let serviceCallCounter = 10001;

// פונקציות עזר נוספות לטיפול בקבצים ב-WhatsApp
function createFileInfoFromWhatsApp(fileData) {
    return {
        originalname: fileData.fileName,
        mimetype: fileData.mimeType,
        size: fileData.fileSize,
        buffer: null,
        downloadUrl: fileData.downloadUrl
    };
}

function analyzeFileForTroubleshooting(fileInfo, messageText) {
    const category = getFileCategory(fileInfo.mimetype);
    const isUrgent = messageText.toLowerCase().includes('תקלה') || 
                     messageText.toLowerCase().includes('בעיה') || 
                     messageText.toLowerCase().includes('לא עובד');
    
    return {
        category: category,
        isUrgent: isUrgent,
        needsTechnician: category === 'image' && isUrgent,
        description: createFileDescription(fileInfo)
    };
}

// פונקציה ליצירת מספר קריאת שירות
function generateServiceCallNumber() {
    const callNumber = `HSC-${serviceCallCounter}`;
    serviceCallCounter++;
    return callNumber;
}

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

// 🧠 מערכת זיכרון שיחות משופרת
class ConversationMemory {
    constructor() {
        this.conversations = new Map();
        this.maxConversationAge = 4 * 60 * 60 * 1000;
        this.cleanupInterval = 60 * 60 * 1000;
        
        setInterval(() => this.cleanupOldConversations(), this.cleanupInterval);
        
        console.log('🧠 מערכת זיכרון הדר הופעלה (4 שעות)');
    }
    
    createConversationKey(phoneNumber, customerData = null) {
        const cleanPhone = phoneNumber.replace(/[^\d]/g, '');
        return customerData ? `${customerData.id}_${cleanPhone}` : cleanPhone;
    }
    
    addMessage(phoneNumber, message, sender, customerData = null) {
        const key = this.createConversationKey(phoneNumber, customerData);
        
        if (!this.conversations.has(key)) {
            this.conversations.set(key, {
                phoneNumber: phoneNumber,
                customer: customerData,
                messages: [],
                startTime: new Date(),
                lastActivity: new Date(),
                status: 'active'
            });
        }
        
        const conversation = this.conversations.get(key);
        conversation.messages.push({
            timestamp: new Date(),
            sender: sender,
            message: message,
            messageId: Date.now().toString()
        });
        
        conversation.lastActivity = new Date();
        
        console.log(`💬 הודעה נוספה לשיחה ${key}: ${sender} - "${message.substring(0, 50)}..."`);
        return conversation;
    }
    
    getConversationContext(phoneNumber, customerData = null) {
        const key = this.createConversationKey(phoneNumber, customerData);
        const conversation = this.conversations.get(key);
        
        if (!conversation) {
            return null;
        }
        
        const context = {
            customer: conversation.customer,
            messageHistory: conversation.messages.slice(-10),
            conversationLength: conversation.messages.length,
            startTime: conversation.startTime,
            status: conversation.status,
            summary: this.buildConversationSummary(conversation)
        };
        
        return context;
    }
    
    buildConversationSummary(conversation) {
        const messages = conversation.messages;
        if (messages.length === 0) return "שיחה ריקה";
        
        const customerMessages = messages.filter(m => m.sender === 'customer');
        const hadarMessages = messages.filter(m => m.sender === 'hadar');
        
        let summary = `שיחה עם ${conversation.customer ? conversation.customer.name : 'לקוח לא מזוהה'}:\n`;
        summary += `• התחלה: ${conversation.startTime.toLocaleString('he-IL')}\n`;
        summary += `• מספר הודעות: ${messages.length} (לקוח: ${customerMessages.length}, הדר: ${hadarMessages.length})\n`;
        
        const allCustomerText = customerMessages.map(m => m.message).join(' ').toLowerCase();
        if (allCustomerText.includes('תקלה') || allCustomerText.includes('בעיה') || allCustomerText.includes('לא עובד')) {
            summary += `• נושא: טיפול בתקלה (זיכרון 4 שעות)\n`;
        } else if (allCustomerText.includes('מחיר') || allCustomerText.includes('הצעה')) {
            summary += `• נושא: הצעת מחיר (זיכרון 4 שעות)\n`;
        } else if (allCustomerText.includes('נזק') || allCustomerText.includes('שבור')) {
            summary += `• נושא: דיווח נזק (זיכרון 4 שעות)\n`;
        } else {
            summary += `• נושא: שאלות כלליות (זיכרון 4 שעות)\n`;
        }
        summary += `• אפשרות: כתוב "קריאה חדשה" לפתיחת קריאה נוספה\n`;
        
        return summary;
    }
    
    endConversation(phoneNumber, customerData = null) {
        const key = this.createConversationKey(phoneNumber, customerData);
        const conversation = this.conversations.get(key);
        
        if (conversation) {
            conversation.status = 'resolved';
            conversation.endTime = new Date();
            console.log(`✅ שיחה ${key} הסתיימה`);
            return conversation;
        }
        
        return null;
    }
    
    cleanupOldConversations() {
        const now = new Date();
        let cleanedCount = 0;
        
        for (const [key, conversation] of this.conversations.entries()) {
            const age = now - conversation.lastActivity;
            
            if (age > this.maxConversationAge) {
                this.conversations.delete(key);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`🗑️ נוקו ${cleanedCount} שיחות ישנות. סה"כ פעילות: ${this.conversations.size}`);
        }
    }
    
    getStats() {
        const active = Array.from(this.conversations.values()).filter(c => c.status === 'active').length;
        const resolved = Array.from(this.conversations.values()).filter(c => c.status === 'resolved').length;
        
        return {
            total: this.conversations.size,
            active: active,
            resolved: resolved,
            waiting: Array.from(this.conversations.values()).filter(c => c.status === 'waiting_for_technician').length
        };
    }
}

const conversationMemory = new ConversationMemory();

// 🚦 מערכת בקרת קצב API
class RateLimiter {
    constructor() {
        this.requestTimes = [];
        this.maxRequestsPerMinute = 20;
        this.baseDelay = 3000;
        this.lastRequestTime = 0;
    }
    
    async getOptimalDelay() {
        const now = Date.now();
        
        this.requestTimes = this.requestTimes.filter(time => now - time < 60000);
        
        let delay = this.baseDelay;
        
        if (this.requestTimes.length >= this.maxRequestsPerMinute * 0.8) {
            delay = 5000;
            console.log('⚠️ מתקרבים למגבלת קצב - השהיה מוגברת');
        }
        
        if (this.requestTimes.length >= this.maxRequestsPerMinute) {
            delay = 10000;
            console.log('🛑 חרגנו ממגבלת קצב - השהיה ארוכה');
        }
        
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < delay) {
            delay = delay - timeSinceLastRequest + 1000;
        }
        
        return delay;
    }
    
    async waitForNextRequest() {
        const delay = await this.getOptimalDelay();
        
        console.log(`⏳ המתנה ${delay/1000} שניות לפני הבקשה הבאה...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        this.requestTimes.push(Date.now());
        this.lastRequestTime = Date.now();
    }
}

const rateLimiter = new RateLimiter();

// 🎯 פונקציה לזיהוי בחירות חכם
function analyzeCustomerChoice(message, conversationContext) {
    const msg = message.trim().toLowerCase();
    
    if (msg === '1' || msg.includes('תקלה')) {
        return {
            type: 'troubleshooting',
            nextQuestion: 'באיזו יחידה יש את התקלה? (מספר יחידה: 101, 204, 603)',
            stage: 'unit_number'
        };
    }
    
    if (msg === '2' || msg.includes('נזק')) {
        return {
            type: 'damage_report',
            nextQuestion: 'אנא צלם את הנזק ושלח מספר היחידה הפגועה',
            stage: 'damage_photo'
        };
    }
    
    if (msg === '3' || msg.includes('מחיר') || msg.includes('הצעה')) {
        return {
            type: 'price_quote',
            nextQuestion: 'מה אתה צריך? (כרטיסים/גלילים/זרועות/אחר)',
            stage: 'equipment_type'
        };
    }
    
    if (msg === '4' || msg.includes('הדרכה')) {
        return {
            type: 'training',
            nextQuestion: 'על איזה נושא? (תפעול/תקלות/מערכת חדשה/אחר)',
            stage: 'training_topic'
        };
    }
    
    const unitMatch = msg.match(/\b(10[0-9]|20[0-9]|30[0-9]|60[0-9])\b/);
    if (unitMatch) {
        return {
            type: 'unit_identified',
            unitNumber: unitMatch[0],
            nextQuestion: `יחידה ${unitMatch[0]} - מה בדיוק התקלה? האם היחידה דולקת?`,
            stage: 'problem_description'
        };
    }
    
    if (conversationContext && conversationContext.messageHistory.length > 0) {
        const lastHadarMessage = conversationContext.messageHistory
            .filter(m => m.sender === 'hadar')
            .slice(-1)[0];
        
        if (lastHadarMessage) {
            if (lastHadarMessage.message.includes('באיזו יחידה')) {
                return {
                    type: 'unit_response',
                    nextQuestion: `מה בדיוק התקלה ביחידה ${msg}? האם היחידה דולקת?`,
                    stage: 'problem_description'
                };
            }
            
            if (lastHadarMessage.message.includes('מה אתה צריך')) {
                return {
                    type: 'equipment_response',
                    equipment: msg,
                    nextQuestion: `כמה ${msg} אתה צריך? מה המפרט? איפה לשלוח?`,
                    stage: 'quantity_specs'
                };
            }
        }
    }
    
    return null;
}

// 🧠 פונקציה לFallback חכם
function generateIntelligentFallback(message, customerData, conversationContext, customerName) {
    console.log('🧠 Fallback חכם פעיל');
    
    const choice = analyzeCustomerChoice(message, conversationContext);
    
    if (choice) {
        console.log('✅ Fallback זיהה בחירה:', choice.type);
        
        if (customerData) {
            let response = `שלום ${customerData.name} 👋\n\n`;
            
            switch(choice.type) {
                case 'troubleshooting':
                    response += `באיזו יחידה יש את התקלה?\n(מספר יחידה: 101, 204, 603)\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
                    break;
                    
                case 'damage_report':
                    response += `אנא צלם את הנזק ושלח מספר היחידה הפגועה\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
                    break;
                    
                case 'price_quote':
                    response += `מה אתה צריך?\n(כרטיסים/גלילים/זרועות/אחר)\nכמות? מפרט? כתובת משלוח?\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
                    break;
                    
                case 'training':
                    response += `על איזה נושא אתה צריך הדרכה?\n(תפעול/תקלות/מערכת חדשה/אחר)\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
                    break;
                    
                case 'unit_identified':
                    response += `יחידה ${choice.unitNumber} - מה בדיוק התקלה?\nהאם היחידה דולקת? אפשר לצרף תמונה?\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
                    break;
                    
                default:
                    response += choice.nextQuestion + `\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
            }
            
            return response;
        } else {
            return `שלום ${customerName} 👋\n\nכדי לטפל בפנייתך, אני זקוקה לפרטי זיהוי:\n- שם מלא\n- שם החניון\n- מספר לקוח\n\n📞 039792365`;
        }
    }
    
    if (customerData) {
        if (conversationContext && conversationContext.conversationLength > 1) {
            return `שלום ${customerData.name} 👋\n\nאני זוכרת את השיחה שלנו מקודם.\n\nאיך אוכל לעזור לך היום?\n1️⃣ תקלה | 2️⃣ נזק | 3️⃣ הצעת מחיר | 4️⃣ הדרכה\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
        } else {
            return `שלום ${customerData.name} מ${customerData.site} 👋\n\nאיך אוכל לעזור לך היום?\n1️⃣ תקלה | 2️⃣ נזק | 3️⃣ הצעת מחיר | 4️⃣ הדרכה\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
        }
    } else {
        return `שלום ${customerName} 👋\n\nכדי לטפל בפנייתך, אני זקוקה לפרטי זיהוי:\n- שם מלא • שם החניון • מספר לקוח\n\n📞 039792365`;
    }
}

// הגדרות בסיסיות
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

// הגדרת multer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 10 * 1024 * 1024,
        files: 10
    },
    fileFilter: (req, file, cb) => {
        console.log(`📁 קובץ שהועלה: ${file.originalname} (${file.mimetype})`);
        
        const allowedMimeTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf',
            'text/plain', 'text/csv'
        ];
        
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            console.log(`❌ סוג קובץ לא מותר: ${file.mimetype}`);
            cb(new Error(`סוג קובץ לא מותר. מותר: תמונות, PDF, טקסט`));
        }
    }
});

// פונקציות עזר לטיפול בקבצים
function getFileCategory(mimetype) {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.includes('pdf')) return 'document';
    if (mimetype.startsWith('text/')) return 'text';
    return 'other';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function createFileDescription(file) {
    const category = getFileCategory(file.mimetype);
    const size = formatFileSize(file.size);
    
    let description = `📁 ${file.originalname} (${size})`;
    
    switch(category) {
        case 'image':
            description += ' - תמונה';
            break;
        case 'document':
            description += ' - מסמך';
            break;
        case 'text':
            description += ' - קובץ טקסט';
            break;
        default:
            description += ' - קובץ אחר';
    }
    
    return description;
}

// עמוד הבית
app.get('/', (req, res) => {
    const memoryStats = conversationMemory.getStats();
    
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
                .memory-stats { background: #fff3cd; padding: 15px; border-radius: 10px; margin: 20px 0; border-right: 4px solid #ffc107; }
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
            </style>
        </head>
        <body>
            <div class="container">
                <div class="company-header">
                    <h1>🚗 שיידט את בכמן</h1>
                    <p>מערכת בקרת חניה מתקדמת עם AI מתקדם</p>
                </div>
                
                <div class="hadar-info">
                    <h3>👩‍💼 הדר - נציגת שירות לקוחות חכמה</h3>
                    <p><strong>🧠 עכשיו עם זיכרון שיחות מתקדם! (4 שעות)</strong></p>
                    <ul>
                        <li>🔧 שירות ודיווח על תקלות עם המשכיות</li>
                        <li>💰 הצעות מחיר לציוד</li>
                        <li>📋 דיווח על נזקים</li>
                        <li>📚 הדרכות תפעול</li>
                        <li>🔄 זיכרון הקשר משיחות קודמות (4 שעות)</li>
                        <li>🆕 אפשרות לפתיחת קריאות מרובות</li>
                    </ul>
                    <p><strong>📞 039792365 | 📧 Service@sbcloud.co.il</strong></p>
                    <small>שעות פעילות: א'-ה' 8:15-17:00</small>
                </div>
                
                <div class="memory-stats">
                    <h3>📊 סטטיסטיקות זיכרון הדר:</h3>
                    <p>💬 <strong>שיחות פעילות:</strong> ${memoryStats.active}</p>
                    <p>✅ <strong>שיחות מסוימות:</strong> ${memoryStats.resolved}</p>
                    <p>🔧 <strong>ממתינות לטכנאי:</strong> ${memoryStats.waiting}</p>
                    <p>📋 <strong>סה"כ שיחות:</strong> ${memoryStats.total}</p>
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
                
                <div style="margin-top: 30px; padding: 20px; background: #ecf0f1; border-radius: 10px;">
                    <h3>📊 מידע טכני מתקדם</h3>
                    <p><strong>WhatsApp Webhook:</strong> <code>/webhook/whatsapp</code></p>
                    <p><strong>מספר מחובר:</strong> 972545484210</p>
                    <p><strong>שרת אימייל:</strong> smtp.012.net.il</p>
                    <p><strong>לקוחות במערכת:</strong> ${customers.length} אתרי בקרת חניה</p>
                    <p><strong>נציגת שירות:</strong> הדר - AI מתקדם עם זיכרון</p>
                    <p><strong>🧠 מערכת זיכרון:</strong> שמירת 4 שעות, קריאות מרובות, ניקוי אוטומטי</p>
                    <p><strong>⚡ בקרת קצב:</strong> מניעת שגיאות 429</p>
                    <p><strong>✅ תיקונים:</strong> מיילים חכמים, זיהוי בחירות, fallback משופר</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// 📲 WhatsApp Webhook משופר עם זיכרון
app.post('/webhook/whatsapp', async (req, res) => {
    try {
        console.log('📲 WhatsApp Webhook received:', JSON.stringify(req.body, null, 2));
        
        if (req.body.typeWebhook === 'incomingMessageReceived') {
            const messageData = req.body.messageData;
            const senderData = req.body.senderData;
            
            const phoneNumber = senderData.sender.replace('@c.us', '');
            let messageText = '';
            let hasFiles = false;
            let fileInfo = null;
            const customerName = senderData.senderName || 'לקוח';

            if (messageData.textMessageData) {
                messageText = messageData.textMessageData.textMessage || 'הודעה ללא טקסט';
            } else if (messageData.fileMessageData) {
                hasFiles = true;
                messageText = messageData.fileMessageData.caption || 'שלח קובץ';
                
                fileInfo = {
                    fileName: messageData.fileMessageData.fileName || 'קובץ ללא שם',
                    mimeType: messageData.fileMessageData.mimeType || 'application/octet-stream',
                    fileSize: messageData.fileMessageData.fileSize || 0,
                    downloadUrl: messageData.fileMessageData.downloadUrl || null
                };
                
                console.log(`📁 קובץ התקבל: ${fileInfo.fileName} (${fileInfo.mimeType}, ${formatFileSize(fileInfo.fileSize)})`);
            } else {
                messageText = 'הודעה מסוג לא זוהה';
            }

            console.log(`📞 הודעה מ-${phoneNumber} (${customerName}): ${messageText}${hasFiles ? ' + קובץ' : ''}`);            
            
            // חיפוש לקוח במסד הנתונים
            const customer = findCustomerByPhoneOrSite(phoneNumber, messageText);
            
            if (customer) {
                console.log(`✅ לקוח מזוהה: ${customer.name} מ${customer.site}`);
            } else {
                console.log(`⚠️ לקוח לא מזוהה: ${phoneNumber}`);
            }
            
            // הוספת ההודעה לזיכרון (עם פרטי קבצים אם יש)
            let messageForMemory = messageText;
            if (hasFiles && fileInfo) {
                const fileAnalysis = analyzeFileForTroubleshooting(fileInfo, messageText);
                messageForMemory += `\n\n📎 קובץ מצורף:\n${fileAnalysis.description}`;
                if (fileAnalysis.isUrgent) {
                    messageForMemory += '\n🚨 זוהה כתקלה דחופה';
                }
            }

            // בדיקה למחיקת זיכרון ללא סגירת שיחה - קריאה חדשה
            if (messageText.includes('קריאה חדשה') || messageText.includes('מחק זיכרון') || messageText.includes('איפוס שיחה')) {
                console.log(`🔄 מנקה זיכרון עבור קריאה חדשה: ${phoneNumber}`);
                const key = conversationMemory.createConversationKey(phoneNumber, customer);
                conversationMemory.conversations.delete(key);
                
                let newCallResponse = customer ? 
                    `שלום ${customer.name} 👋\n\n🆕 זיכרון נוקה לקריאה חדשה.\nכעת אוכל לטפל בנושא חדש.\n\nאיך אוכל לעזור לך?` :
                    `שלום 👋\n\n🆕 זיכרון נוקה לקריאה חדשה.\nאיך אוכל לעזור לך?`;
                
                await sendWhatsAppMessage(phoneNumber, newCallResponse);
                return res.status(200).json({ status: 'OK - Memory cleared for new call' });
            }

            // בדיקה פשוטה לסגירת שיחה
            if (messageText.includes('תקלה חדשה') || messageText.includes('סיום') || messageText.includes('שיחה חדשה')) {
                console.log(`🔄 מנקה זיכרון עבור: ${phoneNumber}`);
                const key = conversationMemory.createConversationKey(phoneNumber, customer);
                conversationMemory.conversations.delete(key);
                
                let closeResponse = customer ? 
                    `שלום ${customer.name} 👋\n\n✅ השיחה נסגרה והזיכרון נוקה.\nאיך אוכל לעזור לך?` :
                    `שלום 👋\n\n✅ השיחה נסגרה והזיכרון נוקה.\nאיך אוכל לעזור לך?`;
                
                await sendWhatsAppMessage(phoneNumber, closeResponse);
                return res.status(200).json({ status: 'OK - Conversation closed' });
            }
            
            // קבלת הקשר השיחה
            const conversationContext = conversationMemory.getConversationContext(phoneNumber, customer);
            
            // יצירת תגובה עם AI (עם השהיה למניעת rate limiting)
            await rateLimiter.waitForNextRequest();
            
            let response;
            if (hasFiles && fileInfo) {
                // תגובה מותאמת לקבצים
                const fileAnalysis = analyzeFileForTroubleshooting(fileInfo, messageText);
                response = await generateFileHandlingResponse(
                    messageText,
                    fileInfo,
                    fileAnalysis,
                    customerName,
                    customer,
                    phoneNumber,
                    conversationContext
                );
            } else {
                // תגובה רגילה לטקסט
                response = await generateAIResponseWithMemory(
                    messageText,
                    customerName,
                    customer,
                    phoneNumber,
                    conversationContext
                );
            }
            
            // הוספת הודעת הלקוח והדר לזיכרון
            conversationMemory.addMessage(phoneNumber, messageForMemory, 'customer', customer);
            conversationMemory.addMessage(phoneNumber, response, 'hadar', customer);

            // שליחת תגובה
            await sendWhatsAppMessage(phoneNumber, response);

            // בדיקה אם השיחה הסתיימה וצריך לשלוח סיכום
            const shouldSendSummary = checkIfConversationEnded(messageText, response);
            if (shouldSendSummary && customer && customer.email) {
                console.log('📋 שליחת סיכום שיחה...');
                await sendConversationSummary(customer, conversationContext);
                conversationMemory.endConversation(phoneNumber, customer);
            }

            // שליחת אימייל התראה למנהל - רק בהודעה ראשונה או תקלה דחופה
            try {
                const isFirstMessage = !conversationContext || conversationContext.conversationLength <= 1;
                const isUrgent = messageText.toLowerCase().includes('תקלה') || 
                                messageText.toLowerCase().includes('דחוף') || 
                                messageText.toLowerCase().includes('בעיה') ||
                                messageText.toLowerCase().includes('לא עובד') ||
                                messageText.toLowerCase().includes('שבור');
                
                // שלח מייל רק אם זה הודעה ראשונה או תקלה דחופה
                if (isFirstMessage || isUrgent) {
                    console.log('📧 שולח התראה למנהל - הודעה ראשונה או תקלה דחופה');
                    
                    const serviceNumber = generateServiceCallNumber();
                    const emailSubject = customer ? 
                        `קריאת שירות ${serviceNumber} - ${customer.name} (${customer.site})` : 
                        `קריאת שירות ${serviceNumber} - ${phoneNumber}`;
                    
                    await transporter.sendMail({
                        from: process.env.EMAIL_USER || 'Report@sbparking.co.il',
                        to: 'Dror@sbparking.co.il',
                        subject: emailSubject,
                        html: generateAlertEmail(phoneNumber, customerName, messageText, response, customer, conversationContext)
                    });
                    console.log('📧 התראה נשלחה למנהל Dror@sbparking.co.il');
                } else {
                    console.log('ℹ️ דילוג על מייל - לא הודעה ראשונה ולא דחוף');
                }
            } catch (emailError) {
                console.error('❌ שגיאה בשליחת התראה:', emailError);
            }
        } else {
            console.log('ℹ️ התעלמות מסטטוס:', req.body.typeWebhook);
        }
        
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('❌ שגיאה בעיבוד webhook:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 🧠 פונקציית AI משופרת עם זיכרון וזיהוי בחירות
async function generateAIResponseWithMemory(message, customerName, customerData, phoneNumber, conversationContext) {
    try {
        console.log('🔍 DEBUG: התחיל AI response');
        console.log('🔍 DEBUG: הודעה:', message);
        console.log('🔍 DEBUG: לקוח:', customerData?.name || 'לא מזוהה');
        console.log('🔍 DEBUG: זיכרון:', conversationContext?.conversationLength || 'אין');
        
        // בדיקה אם זה מספר הבדיקה
        const testPhone = process.env.TEST_PHONE_NUMBER;
        if (testPhone && phoneNumber && phoneNumber === testPhone.replace(/[^\d]/g, '')) {
            if (message.startsWith('בדיקה:')) {
                const testMessage = message.replace('בדיקה:', '').trim();
                console.log(`🧪 מצב בדיקה פעיל: ${testMessage}`);
                return `🧪 מצב בדיקה - הדר עם זיכרון פעילה!\n\nהודעה: "${testMessage}"\n${customerData ? `לקוח: ${customerData.name}` : 'לא מזוהה'}\n${conversationContext ? `שיחות קודמות: ${conversationContext.conversationLength}` : 'שיחה ראשונה'}\n\nהמערכת עובדת! ✅`;
            }
        }

        // 🎯 זיהוי בחירות חכם
        const choice = analyzeCustomerChoice(message, conversationContext);
        
        if (choice) {
            console.log('✅ זוהתה בחירה:', choice.type);
            
            // אם זה לקוח מזוהה - תן תגובה מיידית
            if (customerData) {
                let response = `שלום ${customerData.name} 👋\n\n`;
                response += choice.nextQuestion;
                response += `\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
                return response;
            } else {
                // לקוח לא מזוהה - דרוש זיהוי
                return `שלום ${customerName} 👋\n\nכדי לטפל בפנייתך, אני זקוקה לפרטי זיהוי:\n- שם מלא\n- שם החניון\n- מספר לקוח\n\n📞 039792365`;
            }
        }

        // אם לא זוהתה בחירה ספציפית - חזור ל-AI רגיל או fallback
        console.log('⚠️ לא זוהתה בחירה - עובר ל-AI');

        // הכן prompt ל-OpenAI
        let systemPrompt = `אני הדר, נציגת שירות לקוחות של חברת שיידט את בכמן ישראל.
עכשיו יש לי זיכרון מתקדם של שיחות!`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: `הלקוח ${customerName} שלח: "${message}"`
                }
            ],
            max_tokens: 300,
            temperature: 0.2
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 20000
        });

        console.log('✅ DEBUG: AI Response מוכן');
        return response.data.choices[0].message.content.trim();
        
    } catch (error) {
        console.error('❌ שגיאה ב-OpenAI:', error.message);
        console.log('🔄 DEBUG: נכנס ל-fallback mode');
        
        // תגובות fallback מתוקנות עם זיהוי בחירות
        return generateIntelligentFallback(message, customerData, conversationContext, customerName);
    }
}

// 🤖 פונקציה ליצירת תגובה מותאמת לקבצים
async function generateFileHandlingResponse(messageText, fileInfo, fileAnalysis, customerName, customerData, phoneNumber, conversationContext) {
    try {
        // אם זה מספר הבדיקה
        const testPhone = process.env.TEST_PHONE_NUMBER;
        if (testPhone && phoneNumber === testPhone.replace(/[^\d]/g, '')) {
            return `🧪 בדיקת קבצים הצליחה!\n\nהתקבל קובץ: ${fileInfo.fileName}\nסוג: ${fileAnalysis.category}\n${fileAnalysis.isUrgent ? '🚨 זוהה כדחוף' : '✅ רגיל'}\n\nהמערכת עובדת!`;
        }

        // תגובת fallback לקבצים
        if (customerData) {
            return `שלום ${customerData.name} 👋

קיבלתי את הקובץ: ${fileInfo.fileName}
${fileAnalysis.isUrgent ? '🚨 זוהה כתקלה דחופה' : '📁 בבדיקה'}

אני בודקת ואחזור אליך בהקדם.
במקרה דחוף: 📞 039792365

הדר - שיידט את בכמן`;
        } else {
            return `שלום ${customerName} 👋

קיבלתי קובץ, אבל כדי לטפל בפנייה אני צריכה לזהות אותך קודם:

- שם מלא
- שם החניון/אתר החניה  
- מספר לקוח

📞 039792365`;
        }
        
    } catch (error) {
        console.error('❌ שגיאה בטיפול בקבצים:', error.message);
        return `שלום! קיבלתי קובץ אבל יש בעיה טכנית. אנא צור קשר: 📞 039792365`;
    }
}

// 📋 פונקציה לבדיקה אם השיחה הסתיימה
function checkIfConversationEnded(lastCustomerMessage, hadarResponse) {
    const customerMsg = lastCustomerMessage.toLowerCase();
    const hadarMsg = hadarResponse.toLowerCase();
    
    const endIndicators = [
        'תודה', 'טוב', 'בסדר', 'כן שלח', 'כן תשלח', 'שלח סיכום', 
        'תודה רבה', 'הכל ברור', 'אוקיי', 'מעולה'
    ];
    
    const summaryRequested = customerMsg.includes('סיכום') || customerMsg.includes('מייל') || 
                            hadarMsg.includes('סיכום') || hadarMsg.includes('אשלח');
    
    const thanksGiven = endIndicators.some(indicator => customerMsg.includes(indicator));
    
    return summaryRequested && thanksGiven;
}

// 📧 פונקציה לשליחת סיכום שיחה מפורט
async function sendConversationSummary(customer, conversationContext) {
    try {
        if (!customer.email) {
            console.log('⚠️ אין אימייל ללקוח לשליחת סיכום');
            return;
        }
        
        const messages = conversationContext.messageHistory;
        const customerMessages = messages.filter(m => m.sender === 'customer');
        const hadarMessages = messages.filter(m => m.sender === 'hadar');
        
        const allCustomerText = customerMessages.map(m => m.message).join(' ').toLowerCase();
        let issueType = 'שאלות כלליות';
        let urgency = 'רגילה';
        let nextSteps = 'אין פעולות נוספות נדרשות';
        
        if (allCustomerText.includes('תקלה') || allCustomerText.includes('בעיה') || allCustomerText.includes('לא עובד')) {
            issueType = 'תקלה טכנית';
            urgency = 'גבוהה';
            nextSteps = 'נפתחה קריאת שירות לטכנאי';
        } else if (allCustomerText.includes('מחיר') || allCustomerText.includes('הצעה')) {
            issueType = 'הצעת מחיר';
            nextSteps = 'תישלח הצעת מחיר תוך 24 שעות';
        } else if (allCustomerText.includes('נזק') || allCustomerText.includes('שבור')) {
            issueType = 'דיווח נזק';
            urgency = 'גבוהה';
            nextSteps = 'הועבר לטיפול טכנאי מיידי';
        }
        
        const emailResult = await transporter.sendMail({
            from: process.env.EMAIL_USER || 'Report@sbparking.co.il',
            to: customer.email,
            cc: 'Service@sbcloud.co.il, Dror@sbparking.co.il',
            subject: `📋 סיכום שיחה - ${customer.name} (${customer.site}) - ${issueType}`,
            html: `
                <div dir="rtl" style="font-family: Arial, sans-serif;">
                    <div style="background: linear-gradient(45deg, #3498db, #2980b9); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h2 style="margin: 0;">📋 סיכום שיחה - הדר שירות לקוחות</h2>
                        <p style="margin: 5px 0 0 0;">שיידט את בכמן - מערכת בקרת חניה מתקדמת</p>
                    </div>
                    
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h3 style="color: #2c3e50; margin-top: 0;">👤 פרטי לקוח:</h3>
                        <p><strong>שם:</strong> ${customer.name}</p>
                        <p><strong>אתר חניה:</strong> ${customer.site}</p>
                        <p><strong>מספר לקוח:</strong> #${customer.id}</p>
                        <p><strong>טלפון:</strong> ${customer.phone}</p>
                        <p><strong>אימייל:</strong> ${customer.email}</p>
                        <p><strong>כתובת:</strong> ${customer.address}</p>
                        <p><strong>תאריך ושעה:</strong> ${new Date().toLocaleString('he-IL')}</p>
                    </div>
                </div>
            `
        });
        
        console.log('📧 סיכום שיחה נשלח בהצלחה:', emailResult.messageId);
        return emailResult;
        
    } catch (error) {
        console.error('❌ שגיאה בשליחת סיכום שיחה:', error);
        throw error;
    }
}

// 📧 פונקציה ליצירת אימייל התראה למנהל
function generateAlertEmail(phoneNumber, customerName, messageText, response, customer, conversationContext) {
    return `
        <div dir="rtl" style="font-family: Arial, sans-serif;">
            <div style="background: linear-gradient(45deg, #3498db, #2980b9); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                <h2 style="margin: 0;">📲 הודעה חדשה מוואטסאפ</h2>
                <p style="margin: 5px 0 0 0;">שיידט את בכמן - מערכת שירות לקוחות עם זיכרון</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                <h3 style="color: #2c3e50; margin-top: 0;">📞 פרטי השולח:</h3>
                <p><strong>📱 מספר:</strong> ${phoneNumber}</p>
                <p><strong>👤 שם:</strong> ${customerName}</p>
                
                ${customer ? `
                <div style="background: #d4edda; padding: 15px; border-radius: 8px; border-right: 4px solid #28a745; margin-top: 15px;">
                    <h4 style="color: #155724; margin-top: 0;">✅ לקוח מזוהה במערכת:</h4>
                    <p><strong>שם:</strong> ${customer.name}</p>
                    <p><strong>אתר חניה:</strong> ${customer.site}</p>
                    <p><strong>מספר לקוח:</strong> #${customer.id}</p>
                </div>
                ` : `
                <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-right: 4px solid #ffc107; margin-top: 15px;">
                    <p style="color: #856404; margin: 0;"><strong>⚠️ לקוח לא מזוהה במערכת</strong></p>
                </div>
                `}
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 10px; border-right: 4px solid #3498db;">
                <h3 style="color: #2c3e50; margin-top: 0;">📥 ההודעה:</h3>
                <p>"${messageText}"</p>
                <h3 style="color: #2c3e50;">📤 התגובה:</h3>
                <p>"${response}"</p>
            </div>
        </div>
    `;
}

// פונקציה לחיפוש לקוח לפי מספר טלפון
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

// פונקציה לחיפוש לקוח גם לפי שם החניון
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

// פונקציה לשליחת הודעות WhatsApp
async function sendWhatsAppMessage(phoneNumber, message) {
    const instanceId = process.env.WHATSAPP_INSTANCE || '7105253183';
    const token = process.env.WHATSAPP_TOKEN || '2fec0da532cc4f1c9cb5b1cdc561d2e36baff9a76bce407889';
    const url = `https://7105.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`;
    
    try {
        const response = await axios.post(url, {
            chatId: `${phoneNumber}@c.us`,
            message: message
        });
        console.log('✅ הודעת WhatsApp נשלחה:', response.data);
        return response.data;
    } catch (error) {
        console.error('❌ שגיאה בשליחת WhatsApp:', error.response?.data || error.message);
        throw error;
    }
}

// הפעלת השרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 השרת פועל על פורט:', PORT);
    console.log('🌐 פתח בדפדפן: http://localhost:' + PORT);
    console.log('📧 שרת אימייל: smtp.012.net.il');
    console.log('📲 WhatsApp Instance: 7105253183');
    console.log('🏢 חברה: שיידט את בכמן');
    console.log(`👥 לקוחות במערכת: ${customers.length}`);
    console.log('🧠 מערכת זיכרון הדר: פעילה (4 שעות)');
    console.log('⚡ בקרת קצב API: מופעלת');
    console.log('✅ כל התיקונים יושמו: מיילים חכמים, זיהוי בחירות, fallback משופר');
    console.log('🔧 קובץ מלא וגמור!');
});

module.exports = app;
