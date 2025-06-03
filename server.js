// קובץ: server-fixed.js
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const axios = require('axios');
const app = express();

// טעינת מסד נתוני לקוחות מקובץ חיצוני
const fs = require('fs');

let customers = [];
let serviceCallCounter = 10001; // התחלה מ-HSC-10001

// פונקציות עזר נוספות לטיפול בקבצים ב-WhatsApp
function createFileInfoFromWhatsApp(fileData) {
    return {
        originalname: fileData.fileName,
        mimetype: fileData.mimeType,
        size: fileData.fileSize,
        buffer: null, // יושלם בהורדה
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

// 🔍 פונקציה לחיפוש במאגר תקלות
function searchFailureScenarios(equipmentType, problemDescription) {
    try {
        // קריאה לקובץ JSON
        const scenariosData = JSON.parse(fs.readFileSync('./Service failure scenarios.json', 'utf8'));
        
        if (!scenariosData.scenarios) {
            console.log('⚠️ לא נמצא מאגר תקלות');
            return null;
        }
        
        // חיפוש תקלה מתאימה
        const matchingScenario = scenariosData.scenarios.find(scenario => {
            const typeMatch = scenario.equipment_type.toLowerCase().includes(equipmentType.toLowerCase());
            const problemMatch = scenario.problem.toLowerCase().includes(problemDescription.toLowerCase()) ||
                                problemDescription.toLowerCase().includes(scenario.problem.toLowerCase());
            return typeMatch && problemMatch;
        });
        
        if (matchingScenario) {
            console.log(`✅ נמצאה תקלה מתאימה: ${matchingScenario.problem}`);
            return {
                diagnosis: matchingScenario.diagnosis,
                solution: matchingScenario.solution,
                warnings: matchingScenario.warnings || [],
                equipment: matchingScenario.equipment_type
            };
        } else {
            console.log(`⚠️ לא נמצאה תקלה מתאימה עבור: ${equipmentType} - ${problemDescription}`);
            return null;
        }
        
    } catch (error) {
        console.error('❌ שגיאה בחיפוש מאגר תקלות:', error.message);
        return null;
    }
}

// פונקציה ליצור תשובה מבוססת מאגר תקלות
function createTroubleshootingResponse(scenario, customerName) {
    if (!scenario) {
        return null;
    }
    
    let response = `🔍 מצאתי במאגר התקלות שלנו:\n\n`;
    response += `📋 **אבחון:** ${scenario.diagnosis}\n\n`;
    response += `🛠️ **שלבי הפתרון:**\n`;
    
    scenario.solution.forEach((step, index) => {
        response += `${index + 1}️⃣ ${step}\n`;
    });
    
    if (scenario.warnings && scenario.warnings.length > 0) {
        response += `\n⚠️ **חשוב לזכור:**\n`;
        scenario.warnings.forEach(warning => {
            response += `• ${warning}\n`;
        });
    }
    
    response += `\n📞 בצע את השלבים ואמור לי איך זה עבד!`;
    
    return response;
}

// פונקציה ליצירת מספר קריאת שירות
function generateServiceCallNumber() {
    const callNumber = `HSC-${serviceCallCounter}`;
    serviceCallCounter++;
    return callNumber;
}

try {
    const customersData = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
    
    // המרה לפורמט הנכון
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
    // רשימה בסיסית כגיבוי
    customers = [
        { id: 123, name: "דני ", site: "חניון שרון", phone: "0545-555555", address: "רימון 8 רמת אפעל", email: "Dany@sbparking.co.il" }
    ];
}

// 🧠 מערכת זיכרון שיחות משופרת
class ConversationMemory {
    constructor() {
        this.conversations = new Map();
        this.maxConversationAge = 2 * 60 * 60 * 1000; // שומר לשעתיים
        this.cleanupInterval = 60 * 60 * 1000; // ניקוי כל שעה
        
        // הפעלת ניקוי אוטומטי
        setInterval(() => this.cleanupOldConversations(), this.cleanupInterval);
        
        console.log('🧠 מערכת זיכרון הדר הופעלה');
    }
    
    // יצירת מפתח ייחודי לשיחה
    createConversationKey(phoneNumber, customerData = null) {
        const cleanPhone = phoneNumber.replace(/[^\d]/g, '');
        return customerData ? `${customerData.id}_${cleanPhone}` : cleanPhone;
    }
    
    // הוספת הודעה לשיחה
    addMessage(phoneNumber, message, sender, customerData = null) {
        const key = this.createConversationKey(phoneNumber, customerData);
        
        if (!this.conversations.has(key)) {
            this.conversations.set(key, {
                phoneNumber: phoneNumber,
                customer: customerData,
                messages: [],
                startTime: new Date(),
                lastActivity: new Date(),
                status: 'active' // active, resolved, waiting_for_technician
            });
        }
        
        const conversation = this.conversations.get(key);
        conversation.messages.push({
            timestamp: new Date(),
            sender: sender, // 'customer' or 'hadar'
            message: message,
            messageId: Date.now().toString()
        });
        
        conversation.lastActivity = new Date();
        
        console.log(`💬 הודעה נוספה לשיחה ${key}: ${sender} - "${message.substring(0, 50)}..."`);
        return conversation;
    }
    
    // קבלת הקשר השיחה
    getConversationContext(phoneNumber, customerData = null) {
        const key = this.createConversationKey(phoneNumber, customerData);
        const conversation = this.conversations.get(key);
        
        if (!conversation) {
            return null;
        }
        
        // בניית הקשר לצורך ה-AI
        const context = {
            customer: conversation.customer,
            messageHistory: conversation.messages.slice(-10), // רק 10 הודעות אחרונות
            conversationLength: conversation.messages.length,
            startTime: conversation.startTime,
            status: conversation.status,
            summary: this.buildConversationSummary(conversation)
        };
        
        return context;
    }
    
    // בניית סיכום השיחה
    buildConversationSummary(conversation) {
        const messages = conversation.messages;
        if (messages.length === 0) return "שיחה ריקה";
        
        const customerMessages = messages.filter(m => m.sender === 'customer');
        const hadarMessages = messages.filter(m => m.sender === 'hadar');
        
        let summary = `שיחה עם ${conversation.customer ? conversation.customer.name : 'לקוח לא מזוהה'}:\n`;
        summary += `• התחלה: ${conversation.startTime.toLocaleString('he-IL')}\n`;
        summary += `• מספר הודעות: ${messages.length} (לקוח: ${customerMessages.length}, הדר: ${hadarMessages.length})\n`;
        
        // זיהוי נושא השיחה
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
    
    // סיום שיחה
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
    
    // ניקוי שיחות ישנות
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
    
    // סטטיסטיקות
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

// יצירת מערכת הזיכרון
const conversationMemory = new ConversationMemory();

// 🚦 מערכת בקרת קצב API (למניעת 429)
class RateLimiter {
    constructor() {
        this.requestTimes = [];
        this.maxRequestsPerMinute = 20; // מקסימום 20 בקשות לדקה
        this.baseDelay = 3000; // 3 שניות בסיס
        this.lastRequestTime = 0;
    }
    
    async getOptimalDelay() {
        const now = Date.now();
        
        // ניקוי בקשות ישנות (מעל דקה)
        this.requestTimes = this.requestTimes.filter(time => now - time < 60000);
        
        // אם יש יותר מדי בקשות - השהיה ארוכה יותר
        let delay = this.baseDelay;
        
        if (this.requestTimes.length >= this.maxRequestsPerMinute * 0.8) {
            delay = 5000; // 5 שניות אם מתקרבים למגבלה
            console.log('⚠️ מתקרבים למגבלת קצב - השהיה מוגברת');
        }
        
        if (this.requestTimes.length >= this.maxRequestsPerMinute) {
            delay = 10000; // 10 שניות אם חרגנו
            console.log('🛑 חרגנו ממגבלת קצב - השהיה ארוכה');
        }
        
        // ודא שלא עברה מספיק זמן מהבקשה הקודמת
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < delay) {
            delay = delay - timeSinceLastRequest + 1000; // תוספת של שנייה
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

// הגדרות בסיסיות
app.use(express.json());
app.use(express.static('public'));

// הגדרת nodemailer עם השרת שלך
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.012.net.il',
    port: parseInt(process.env.EMAIL_PORT) || 465,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER || 'Report@sbparking.co.il',
        pass: process.env.EMAIL_PASS || 'o51W38D5'
    }
});

// הגדרת multer להעלאת תמונות ומסמכים
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { 
        fileSize: 10 * 1024 * 1024, // 10MB במקום 5MB
        files: 10 // מקסימום 10 קבצים
    },
    fileFilter: (req, file, cb) => {
        console.log(`📁 קובץ שהועלה: ${file.originalname} (${file.mimetype})`);
        
        // רשימת סוגי קבצים מותרים
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

// עמוד הבית המעודכן - טופס אימייל
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
                    <p><strong>🧠 עכשיו עם זיכרון שיחות מתקדם!</strong></p>
                    <ul>
                        <li>🔧 שירות ודיווח על תקלות עם המשכיות</li>
                        <li>💰 הצעות מחיר לציוד</li>
                        <li>📋 דיווח על נזקים</li>
                        <li>📚 הדרכות תפעול</li>
                        <li>🔄 זיכרון הקשר משיחות קודמות</li>
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
                
                <div class="service-areas">
                    <h3>🛠️ תחומי שירות</h3>
                    <div class="service-area">
                        <strong>ציוד בקרת חניה:</strong> כניסה, יציאה, קורא אשראי, מחסומים, גלאי כביש, מצלמות LPR, מקודדים, אינטרקום, מחשב ראשי, תחנת עבודה
                    </div>
                    <div class="service-area">
                        <strong>טווחי יחידות:</strong> 100 כניסות | 200 יציאות | 300 מעברים | 600 אוטומטיות 
                    </div>
                </div>
                
                <div class="quick-actions">
                    <a href="#email-form" class="quick-btn">📧 שליחת אימייל</a>
                    <a href="#customer-search" class="quick-btn">🔍 חיפוש לקוח</a>
                    <a href="/memory-dashboard" class="quick-btn">🧠 דשבורד זיכרון</a>
                    <a href="/test-memory" class="quick-btn">🧪 בדיקת זיכרון</a>
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
                    <h3>📊 מידע טכני מתקדם</h3>
                    <p><strong>WhatsApp Webhook:</strong> <code>/webhook/whatsapp</code></p>
                    <p><strong>מספר מחובר:</strong> 972545484210</p>
                    <p><strong>שרת אימייל:</strong> smtp.012.net.il</p>
                    <p><strong>לקוחות במערכת:</strong> ${customers.length} אתרי בקרת חניה</p>
                    <p><strong>נציגת שירות:</strong> הדר - AI מתקדם עם זיכרון</p>
                    <p><strong>🧠 מערכת זיכרון:</strong> שמירת לשעתיים, ניקוי אוטומטי</p>
                    <p><strong>⚡ בקרת קצב:</strong> מניעת שגיאות 429</p>
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

// 📧 API לשליחת אימייל עם תמונות
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
            console.log(`📎 מצרף ${req.files.length} תמונות`);
            htmlContent += '<br><h3 style="color: #2c3e50;">📷 תמונות מצורפות:</h3>';
            
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
                        <p><strong>📷 תמונות:</strong> ${req.files ? req.files.length : 0}</p>
                        <p><strong>🆔 Message ID:</strong> <code>${result.messageId}</code></p>
                    </div>
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="/" style="background: linear-gradient(45deg, #3498db, #2980b9); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">🔙 חזור למערכת</a>
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
                        <a href="/" style="background: #3498db; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px;">🔙 חזור לנסות שוב</a>
                    </div>
                </div>
            </div>
        `);
    }
});

// 📲 WhatsApp Webhook משופר עם זיכרון
app.post('/webhook/whatsapp', async (req, res) => {
    try {
        console.log('📲 WhatsApp Webhook received:', JSON.stringify(req.body, null, 2));
        
        // רק הודעות נכנסות - לא סטטוסים
        if (req.body.typeWebhook === 'incomingMessageReceived') {
            const messageData = req.body.messageData;
            const senderData = req.body.senderData;
            
const phoneNumber = senderData.sender.replace('@c.us', '');
let messageText = '';
let hasFiles = false;
let fileInfo = null;
const customerName = senderData.senderName || 'לקוח';

// זיהוי סוג ההודעה - טקסט או קובץ
if (messageData.textMessageData) {
    // הודעת טקסט רגילה
    messageText = messageData.textMessageData.textMessage || 'הודעה ללא טקסט';
} else if (messageData.fileMessageData) {
    // הודעה עם קובץ
    hasFiles = true;
    messageText = messageData.fileMessageData.caption || 'שלח קובץ';
    
    // פרטי הקובץ מ-WhatsApp
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
            console.log(`📞 הודעה מ-${phoneNumber} (${customerName}): ${messageText}`);
            
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
            // הוספת תגובת הדר לזיכרון
	conversationMemory.addMessage(phoneNumber, messageForMemory, 'customer', customer);
            
            // שליחת תגובה
            await sendWhatsAppMessage(phoneNumber, response);
            
            // בדיקה אם השיחה הסתיימה וצריך לשלוח סיכום
            const shouldSendSummary = checkIfConversationEnded(messageText, response);
            if (shouldSendSummary && customer && customer.email) {
                console.log('📋 שליחת סיכום שיחה...');
                await sendConversationSummary(customer, conversationContext);
                conversationMemory.endConversation(phoneNumber, customer);
            }
            
            // שליחת אימייל התראה למנהל
            try {
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

// 🧠 פונקציית AI משופרת עם זיכרון
async function generateAIResponseWithMemory(message, customerName, customerData, phoneNumber, conversationContext) {
    try {
        // בדיקה אם זה מספר הבדיקה
        const testPhone = process.env.TEST_PHONE_NUMBER;
        if (testPhone && phoneNumber && phoneNumber === testPhone.replace(/[^\d]/g, '')) {
            if (message.startsWith('בדיקה:')) {
                const testMessage = message.replace('בדיקה:', '').trim();
                console.log(`🧪 מצב בדיקה פעיל: ${testMessage}`);
                return `🧪 מצב בדיקה - הדר עם זיכרון פעילה!\n\nהודעה: "${testMessage}"\n${customerData ? `לקוח: ${customerData.name}` : 'לא מזוהה'}\n${conversationContext ? `שיחות קודמות: ${conversationContext.conversationLength}` : 'שיחה ראשונה'}\n\nהמערכת עובדת! ✅`;
            }
        }

        // בניית prompt עם הקשר מלא
        let systemPrompt = `אני הדר, נציגת שירות לקוחות של חברת שיידט את בכמן ישראל.
עכשיו יש לי זיכרון מתקדם של שיחות!

🧠 מצב הזיכרון הנוכחי:`;

        if (conversationContext && conversationContext.conversationLength > 1) {
            systemPrompt += `
✅ זוהי שיחה מתמשכת!
- התחלנו לדבר ב: ${new Date(conversationContext.startTime).toLocaleString('he-IL')}
- מספר הודעות בשיחה: ${conversationContext.conversationLength}
- סטטוס השיחה: ${conversationContext.status}

📜 היסטוריית השיחה האחרונה:
${conversationContext.messageHistory.slice(-6).map(msg => 
    `${msg.sender === 'customer' ? '👤 לקוח' : '👩‍💼 הדר'}: "${msg.message}"`
).join('\n')}

📋 סיכום השיחה עד כה:
${conversationContext.summary}

🎯 אני צריכה להמשיך את השיחה בהתאם להקשר הזה!`;
        } else {
            systemPrompt += `
🆕 זוהי שיחה חדשה או הראשונה עם הלקוח הזה.`;
        }

systemPrompt += `

🔍 כללי זיהוי לקוח:
${customerData ? `
✅ לקוח מזוהה במערכת:
- שם: ${customerData.name}
- שם החניה: ${customerData.site}
- מספר לקוח: #${customerData.id}
- טלפון: ${customerData.phone}
- אימייל: ${customerData.email}

מכיוון שהלקוח מזוהה, אני אוכל לטפל בפנייתו לפי התסריט המלא.
` : `
⚠️ לקוח לא מזוהה במערכת!
אני חייבת לזהות את הלקוח קודם כל. אבקש:
- שם מלא
- שם החניון/אתר החניה  
- מספר לקוח (אם יודע)
ללא זיהוי לא אוכל לטפל בפנייה.
`}

📋 תסריט השיחה החדש:

🟢 פתיחת שיחה:
${conversationContext && conversationContext.conversationLength > 1 ? `
🔄 לקוח מזוהה עם זיכרון:
"שלום ${customerData?.name || customerName} מחניון ${customerData?.site || 'לא מזוהה'}! 👋
אני זוכרת את הטיפול הקודם שלנו. איך אפשר לעזור היום?
1️⃣ תקלה | 2️⃣ נזק | 3️⃣ הצעת מחיר | 4️⃣ הדרכה"
` : `
🆕 לקוח חדש או שיחה ראשונה:
"שלום! 👋 איך אפשר לעזור היום?
1️⃣ תקלה | 2️⃣ נזק | 3️⃣ הצעת מחיר | 4️⃣ הדרכה"
`}

🟠 טיפול בתקלות (מבוסס Service failure scenarios.json):
1. "באיזו יחידה יש את התקלה? (מספר יחידה: 101, 204, 603)"
2. "מה בדיוק התקלה? האם היחידה דולקת? אפשר לצרף תמונה?"
3. 🔍 חיפוש במאגר התקלות לפי סוג הציוד והבעיה
4. מתן פתרון מותאם: שלבי אתחול, אזהרות, הנחיות ספציפיות
5. אם לא עזר: "אפתח דיווח תקלה לטכנאי עם כל הפרטים"

🟠 טיפול בנזקים:
1. "אנא צלם את הנזק ושלח מספר היחידה הפגועה"
2. דחיפות לפי חומרת הנזק (דחוף אם חוסם פעילות)
3. "דיווח נשלח לצוות הטכני"

🟠 הצעות מחיר:
1. "מה אתה צריך? (כרטיסים/גלילים/זרועות/אחר)"
2. "כמות, מפרט, כתובת משלוח?"
3. "הצעת מחיר תישלח תוך 24 שעות"

🟠 הדרכות (מבוסס Parking operation 1.docx):
1. "על איזה נושא? (תפעול/תקלות/מערכת חדשה/אחר)"
2. מתן הדרכה מהמסמכים שלנו או הפניה לנציג טכני
3. "האם להעביר המדריך המלא למייל?"

🔵 סיום שיחה:
1. "כדי לשלוח סיכום: אנא אמת מייל"
2. "סיכום נשלח - מספר עוקב: REF-XXXX"
3. "יש עוד דבר?"

📸 טיפול בקבצים ותמונות:
- תמונות תקלה: ניתוח חזותי + פתרון מהמאגר
- מסמכים: הכנת הצעות מחיר
- אישור קבלה: "קיבלתי את הקובץ [שם], מנתח..."

⚠️ כללי תגובה חשובים:
- רק ללקוחות מזוהים
- שלבים ברורים ומסודרים
- שימוש במאגר הידע (Service failure scenarios.json)
- מעבר לטכנאי כשנדרש
- תיעוד מלא בסיום
- בקרת זמן (10 דקות חוסר פעילות)

🆕 קריאה חדשה: כשכותבים "קריאה חדשה" - מנקה זיכרון ומתחיל מחדש`;
🛠️ ציוד שאני מטפלת בו:
כניסה, יציאה, קורא אשראי, מחסומים, גלאי כביש, מצלמות LPR, מקודדים, אינטרקום, מחשב ראשי, מחשב אשראי, תחנת עבודה, מרכזיית אינטרקום.

📞 פרטי קשר:
- משרד: 039792365
- שירות: Service@sbcloud.co.il  
- שעות: א'-ה' 8:15-17:00

🧠 זיהוי שלב השיחה עם זיכרון:
- אם זו השיחה הראשונה → "איך אוכל לעזור?"
- אם ממשיכים נושא קיים → המשכת טיפול לפי ההיסטוריה
- אם סיימנו נושא ועוברים לחדש → "יש עוד דבר?"
- אם הלקוח מתבלבל → הזכרת ההקשר בעדינות
- סיום טיפול → "האם לשלוח סיכום שיחה לאימייל?"

כללי תגובה:
- אדיבה, מקצועית, עניינית
- שאלות מדויקות לפי הנושא
- שימוש בזיכרון להמשכיות
- בסיום - תמיד שואלת על שליחת סיכום
- מקפידה על זיהוי לקוח לפני כל טיפול`;

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
            temperature: 0.2 // נמוך למקצועיות ועקביות
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
        
        // תגובות fallback מותאמות להדר עם זיכרון
        let fallbackMessage;
        
const serviceNumber = generateServiceCallNumber();
const currentTime = new Date().toLocaleString('he-IL');

if (error.response?.status === 429) {
    console.log('⏱️ מכסת OpenAI מלאה - תגובת הדר עם זיכרון');
    
    if (customerData) {
        if (conversationContext && conversationContext.conversationLength > 1) {
            fallbackMessage = `שלום ${customerData.name} 👋

🔧 נפתחה קריאת שירות למחלקה הטכנית
⏰ **זמן תגובה:** טכנאי יחזור תוך 4 שעות בימי עבודה
📋 **מספר קריאה:** ${serviceNumber}

אני זוכרת את השיחה שלנו מקודם ואטפל בהתאם.

📞 039792365 | 📧 Service@sbcloud.co.il`;
        } else {
            fallbackMessage = `שלום ${customerData.name} מ${customerData.site} 👋

🔧 נפתחה קריאת שירות למחלקה הטכנית  
⏰ **זמן תגובה:** טכנאי יחזור תוך 4 שעות בימי עבודה
📋 **מספר קריאה:** ${serviceNumber}

איך אוכל לעזור לך היום?

📞 039792365 | 📧 Service@sbcloud.co.il`;
        }
    } else {
        fallbackMessage = `שלום ${customerName} 👋

🔧 נפתחה קריאת שירות 
⏰ **זמן תגובה:** טכנאי יחזור תוך 4 שעות בימי עבודה  
📋 **מספר קריאה:** ${serviceNumber}

כדי לטפל בפנייתך, אני זקוקה לפרטי זיהוי:
- שם מלא • שם החניון • מספר לקוח

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

// 🤖 פונקציה ליצירת תגובה מותאמת לקבצים
async function generateFileHandlingResponse(messageText, fileInfo, fileAnalysis, customerName, customerData, phoneNumber, conversationContext) {
    try {
        // אם זה מספר הבדיקה
        const testPhone = process.env.TEST_PHONE_NUMBER;
        if (testPhone && phoneNumber === testPhone.replace(/[^\d]/g, '')) {
            return `🧪 בדיקת קבצים הצליחה!\n\nהתקבל קובץ: ${fileInfo.fileName}\nסוג: ${fileAnalysis.category}\n${fileAnalysis.isUrgent ? '🚨 זוהה כדחוף' : '✅ רגיל'}\n\nהמערכת עובדת!`;
        }

        let systemPrompt = `אני הדר, נציגת שירות לקוחות של שיידט את בכמן.
הלקוח ${customerName} שלח קובץ.

🔍 פרטי הקובץ:
- שם: ${fileInfo.fileName}
- סוג: ${fileAnalysis.category}
- גודל: ${formatFileSize(fileInfo.size)}
- דחיפות: ${fileAnalysis.isUrgent ? 'גבוהה' : 'רגילה'}

${customerData ? `
✅ לקוח מזוהה: ${customerData.name} מ${customerData.site}
` : `
⚠️ לקוח לא מזוהה - אבקש זיהוי לפני טיפול
`}

🎯 הנחיות לתגובה:

אם זה תמונה של תקלה:
- "רואה את התמונה, מנתח את התקלה..."
- זיהוי מה נראה בתמונה (כללי)
- המלצות ראשוניות
- אם דחוף: "אפתח דיווח תקלה לטכנאי עם התמונה"

אם זה מסמך:
- "קיבלתי את המסמך, אעבור עליו ואחזור אליך"
- אם מפרט: "אכין הצעת מחיר לפי המפרט"

אם לקוח לא מזוהה:
- "קיבלתי את הקובץ, אבל צריכה לזהות אותך קודם"
- בקשת פרטי זיהוי

תמיד אאשר קבלת הקובץ ואסביר את הצעד הבא.`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: `הלקוח שלח: "${messageText}" עם קובץ: ${fileInfo.fileName}`
                }
            ],
            max_tokens: 200,
            temperature: 0.3
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 20000
        });

        return response.data.choices[0].message.content.trim();
        
    } catch (error) {
        console.error('❌ שגיאה ב-OpenAI לקבצים:', error.message);
        
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
    }
}

// 📋 פונקציה לבדיקה אם השיחה הסתיימה
function checkIfConversationEnded(lastCustomerMessage, hadarResponse) {
    const customerMsg = lastCustomerMessage.toLowerCase();
    const hadarMsg = hadarResponse.toLowerCase();
    
    // סימנים לסיום שיחה
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
        
        // ניתוח נושא השיחה
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
                    
                    <div style="background: #fff3cd; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h3 style="color: #856404; margin-top: 0;">📊 סיכום השיחה:</h3>
                        <p><strong>סוג פנייה:</strong> ${issueType}</p>
                        <p><strong>מספר הודעות:</strong> ${messages.length} (לקוח: ${customerMessages.length}, הדר: ${hadarMessages.length})</p>
                        <p><strong>משך השיחה:</strong> ${Math.round((new Date() - new Date(conversationContext.startTime)) / 60000)} דקות</p>
                        <p><strong>דחיפות:</strong> ${urgency}</p>
                    </div>
                    
                    <div style="background: white; padding: 20px; border-radius: 10px; border-right: 4px solid #3498db; margin-bottom: 20px;">
                        <h3 style="color: #2c3e50; margin-top: 0;">💬 תמליל השיחה:</h3>
                        ${messages.map(msg => `
                            <div style="margin: 10px 0; padding: 10px; background: ${msg.sender === 'customer' ? '#e3f2fd' : '#e8f5e8'}; border-radius: 8px;">
                                <strong>${msg.sender === 'customer' ? '👤 ' + customer.name : '👩‍💼 הדר'}:</strong>
                                <small style="color: #666; float: left;">${new Date(msg.timestamp).toLocaleTimeString('he-IL')}</small>
                                <p style="margin: 5px 0 0 0; clear: both;">"${msg.message}"</p>
                            </div>
                        `).join('')}
                    </div>
                    
                    <div style="background: #d1ecf1; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                        <h3 style="color: #0c5460; margin-top: 0;">📞 פעולות המשך:</h3>
                        <p>🎯 <strong>פעולות נדרשות:</strong> ${nextSteps}</p>
                        <p>⏰ <strong>זמן תגובה:</strong> תוך 24 שעות בימי עבודה</p>
                        <p>📋 <strong>מספר עוקב:</strong> REF-${Date.now().toString().slice(-6)}</p>
                        <p>🚨 <strong>דחיפות:</strong> ${urgency}</p>
                    </div>
                    
                    <hr style="margin: 30px 0; border: none; border-top: 2px solid #ecf0f1;">
                    
                    <div style="background: #ecf0f1; padding: 15px; border-radius: 8px; text-align: center;">
                        <p style="color: #7f8c8d; font-size: 12px; margin: 0;">
                            📧 סיכום זה נוצר אוטומטי ונשמר במערכת הזיכרון של הדר<br>
                            📞 משרד: 039792365 | 📧 שירות: Service@sbcloud.co.il<br>
                            ⏰ שעות פעילות: א'-ה' 8:15-17:00<br>
                            🧠 מערכת AI עם זיכרון מתקדם
                        </p>
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
                    <p><strong>אימייל:</strong> ${customer.email}</p>
                    <p><strong>כתובת:</strong> ${customer.address}</p>
                    <p><strong>מספר לקוח:</strong> #${customer.id}</p>
                </div>
                ` : `
                <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-right: 4px solid #ffc107; margin-top: 15px;">
                    <p style="color: #856404; margin: 0;"><strong>⚠️ לקוח לא מזוהה במערכת</strong></p>
                    <small style="color: #856404;">ייתכן שצריך לבקש פרטי זיהוי נוספים</small>
                </div>
                `}
            </div>
            
            ${conversationContext ? `
            <div style="background: #e8f4f8; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                <h3 style="color: #0c5460; margin-top: 0;">🧠 מצב הזיכרון:</h3>
                <p><strong>מספר הודעות בשיחה:</strong> ${conversationContext.conversationLength}</p>
                <p><strong>התחלת שיחה:</strong> ${new Date(conversationContext.startTime).toLocaleString('he-IL')}</p>
                <p><strong>סטטוס שיחה:</strong> ${conversationContext.status}</p>
                <div style="background: white; padding: 10px; border-radius: 5px; margin-top: 10px;">
                    <strong>📋 סיכום:</strong><br>
                    <small>${conversationContext.summary.replace(/\n/g, '<br>')}</small>
                </div>
            </div>
            ` : `
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <p style="color: #856404; margin: 0;"><strong>🆕 שיחה חדשה - אין זיכרון קודם</strong></p>
            </div>
            `}
            
            <div style="background: white; padding: 20px; border-radius: 10px; border-right: 4px solid #3498db; margin-bottom: 20px;">
                <h3 style="color: #2c3e50; margin-top: 0;">📥 ההודעה:</h3>
                <p style="font-size: 16px; line-height: 1.5; background: #f8f9fa; padding: 15px; border-radius: 8px;">"${messageText}"</p>
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 10px; border-right: 4px solid #27ae60;">
                <h3 style="color: #2c3e50; margin-top: 0;">📤 התגובה שנשלחה:</h3>
                <p style="font-size: 14px; line-height: 1.5; background: #e8f5e8; padding: 15px; border-radius: 8px;">"${response}"</p>
            </div>
            
            <div style="margin-top: 20px; padding: 15px; background: #ecf0f1; border-radius: 8px; text-align: center;">
                <p style="color: #7f8c8d; font-size: 12px; margin: 0;">
                    📅 זמן: ${new Date().toLocaleString('he-IL')}<br>
                    🤖 הודעה זו נשלחה אוטומטית ממערכת הדר עם זיכרון מתקדם<br>
                    📊 סה"כ לקוחות במערכת: ${customers.length}
                </p>
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

// 🧠 דשבורד זיכרון מתקדם
app.get('/memory-dashboard', (req, res) => {
    const stats = conversationMemory.getStats();
    const allConversations = Array.from(conversationMemory.conversations.entries());
    
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>🧠 דשבורד זיכרון הדר - שיידט את בכמן</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
                .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
                .header { background: white; padding: 30px; border-radius: 15px; margin-bottom: 30px; text-align: center; }
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
                .stat-card { background: white; padding: 25px; border-radius: 15px; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
                .stat-number { font-size: 2.5em; font-weight: bold; color: #3498db; margin: 10px 0; }
                .conversations-table { background: white; border-radius: 15px; overflow: hidden; box-shadow: 0 5px 15px rgba(0,0,0,0.1); margin-bottom: 30px; }
                .table-header { background: #3498db; color: white; padding: 20px; }
                .conversation-row { padding: 15px 20px; border-bottom: 1px solid #ecf0f1; }
                .conversation-row:hover { background: #f8f9fa; }
                .status-active { background: #d4edda; color: #155724; padding: 5px 10px; border-radius: 15px; font-size: 12px; }
                .status-resolved { background: #d1ecf1; color: #0c5460; padding: 5px 10px; border-radius: 15px; font-size: 12px; }
                .status-waiting { background: #fff3cd; color: #856404; padding: 5px 10px; border-radius: 15px; font-size: 12px; }
                .back-btn { display: inline-block; background: #27ae60; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
                .refresh-btn { background: #f39c12; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 10px; }
                .cleanup-btn { background: #e74c3c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 10px; }
            </style>
            <script>
                function refreshPage() {
                    location.reload();
                }
                
                function cleanupOld() {
                    if(confirm('האם אתה בטוח שברצונך לנקות שיחות ישנות?')) {
                        fetch('/cleanup-conversations', {method: 'POST'})
                            .then(() => location.reload());
                    }
                }
            </script>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🧠 דשבורד זיכרון הדר</h1>
                    <p>מעקב אחר שיחות והקשר של הלקוחות</p>
                    <button onclick="refreshPage()" class="refresh-btn">🔄 רענן</button>
                    <button onclick="cleanupOld()" class="cleanup-btn">🗑️ נקה ישנות</button>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <h3>💬 שיחות פעילות</h3>
                        <div class="stat-number">${stats.active}</div>
                        <p>שיחות במהלך טיפול</p>
                    </div>
                    <div class="stat-card">
                        <h3>✅ שיחות מסוימות</h3>
                        <div class="stat-number">${stats.resolved}</div>
                        <p>שיחות שהסתיימו בהצלחה</p>
                    </div>
                    <div class="stat-card">
                        <h3>⏳ ממתינות לטכנאי</h3>
                        <div class="stat-number">${stats.waiting}</div>
                        <p>שיחות שהועברו לטכנאי</p>
                    </div>
                    <div class="stat-card">
                        <h3>📊 סה"כ שיחות</h3>
                        <div class="stat-number">${stats.total}</div>
                        <p>כל השיחות במערכת</p>
                    </div>
                </div>
                
                <div class="conversations-table">
                    <div class="table-header">
                        <h2>📞 שיחות אחרונות</h2>
                    </div>
                    ${allConversations.length > 0 ? 
                        allConversations.slice(0, 20).map(([key, conv]) => `
                            <div class="conversation-row">
                                <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 2fr; gap: 15px; align-items: center;">
                                    <div>
                                        <strong>${conv.customer ? conv.customer.name : 'לא מזוהה'}</strong><br>
                                        <small style="color: #666;">${conv.customer ? conv.customer.site : conv.phoneNumber}</small>
                                    </div>
                                    <div>
                                        <span class="status-${conv.status}">${
                                            conv.status === 'active' ? 'פעיל' : 
                                            conv.status === 'resolved' ? 'נפתר' : 'ממתין'
                                        }</span>
                                    </div>
                                    <div>
                                        📞 ${conv.phoneNumber}<br>
                                        💬 ${conv.messages.length} הודעות
                                    </div>
                                    <div>
                                        <small>התחלה: ${new Date(conv.startTime).toLocaleString('he-IL', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</small><br>
                                        <small>אחרון: ${new Date(conv.lastActivity).toLocaleString('he-IL', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</small>
                                    </div>
                                    <div>
                                        <small style="color: #666;">
                                            ${conv.messages.length > 0 ? 
                                                '"' + conv.messages[conv.messages.length - 1].message.substring(0, 40) + '..."' : 
                                                'אין הודעות'
                                            }
                                        </small>
                                    </div>
                                </div>
                            </div>
                        `).join('') :
                        '<div style="padding: 40px; text-align: center; color: #666;">אין שיחות פעילות כרגע</div>'
                    }
                </div>
                
                <div style="background: white; padding: 20px; border-radius: 15px; margin-bottom: 20px;">
                    <h3>🔧 מידע טכני על הזיכרון</h3>
                    <p><strong>מקסימום זמן שמירה:</strong> 24 שעות</p>
                    <p><strong>ניקוי אוטומטי:</strong> כל שעה</p>
                    <p><strong>מקסימום הודעות לשמירה:</strong> 10 אחרונות לכל שיחה</p>
                    <p><strong>סוגי סטטוס:</strong> פעיל, נפתר, ממתין לטכנאי</p>
                </div>
                
                <a href="/" class="back-btn">🔙 חזור למערכת הראשית</a>
            </div>
        </body>
        </html>
    `);
});

// API לניקוי שיחות ישנות ידנית
app.post('/cleanup-conversations', (req, res) => {
    try {
        conversationMemory.cleanupOldConversations();
        res.json({ success: true, message: 'ניקוי בוצע בהצלחה' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

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

// API לקבלת רשימת כל הלקוחות
app.get('/api/customers', (req, res) => {
    res.json(customers);
});

// API לקבלת לקוח ספציפי
app.get('/api/customers/:id', (req, res) => {
    const customer = customers.find(c => c.id == req.params.id);
    if (customer) {
        res.json(customer);
    } else {
        res.status(404).json({ error: 'לקוח לא נמצא' });
    }
});

// API לקבלת סטטיסטיקות זיכרון
app.get('/api/memory/stats', (req, res) => {
    res.json(conversationMemory.getStats());
});

// בדיקת webhook (GET request)
app.get('/webhook/whatsapp', (req, res) => {
    res.json({ 
        message: 'WhatsApp Webhook is working!', 
        timestamp: new Date().toISOString(),
        instance: '7105253183',
        company: 'שיידט את בכמן',
        memoryEnabled: true,
        activeConversations: conversationMemory.getStats().active
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
            memorySystem: 'פעיל'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '❌ בעיה בחיבור לשרת האימייל',
            error: error.message
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
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// הפעלת השרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 השרת פועל על פורט:', PORT);
    console.log('🌐 פתח בדפדפן: http://localhost:' + PORT);
    console.log('📧 שרת אימייל: smtp.012.net.il');
    console.log('📲 WhatsApp Instance: 7105253183');
    console.log('🏢 חברה: שיידט את בכמן');
    console.log(`👥 לקוחות במערכת: ${customers.length}`);
    console.log('🧠 מערכת זיכרון הדר: פעילה');
    console.log('⚡ בקרת קצב API: מופעלת');
});

// בדיקת חיבור בהפעלה
transporter.verify()
    .then(() => {
        console.log('✅ חיבור לשרת אימייל תקין');
    })
    .catch((error) => {
        console.error('❌ בעיה בחיבור לשרת אימייל:', error.message);
    });

// הדפסת מידע על מערכת הזיכרון
console.log('🧠 מערכת זיכרון הדר הופעלה בהצלחה');
console.log('📋 פונקציות זיכרון זמינות:');
console.log('   - שמירת הקשר שיחות למשך 24 שעות');
console.log('   - ניקוי אוטומטי של שיחות ישנות');
console.log('   - סיכום שיחות אוטומטי');
console.log('   - מעקב סטטוסים (פעיל/נפתר/ממתין)');
console.log('   - API לניהול הזיכרון');

// בדיקת מערכת הזיכרון בהפעלה
const initialStats = conversationMemory.getStats();
console.log(`📊 סטטיסטיקות זיכרון: ${initialStats.total} שיחות (${initialStats.active} פעילות)`);

// 🧪 עמוד בדיקת קבצים
app.get('/test-files', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>🧪 בדיקת מערכת קבצים - הדר</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
                .container { max-width: 800px; margin: 0 auto; padding: 20px; }
                .header { background: white; padding: 30px; border-radius: 15px; margin-bottom: 30px; text-align: center; }
                .test-section { background: white; padding: 25px; border-radius: 15px; margin-bottom: 20px; }
                .status { padding: 15px; margin: 15px 0; border-radius: 8px; }
                .status.success { background: #d4edda; color: #155724; border-right: 4px solid #28a745; }
                .status.error { background: #f8d7da; color: #721c24; border-right: 4px solid #dc3545; }
                .supported-files { background: #e8f5e8; padding: 20px; border-radius: 10px; margin: 20px 0; }
                .back-btn { background: #27ae60; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🧪 בדיקת מערכת קבצים</h1>
                    <p>הדר - בוט שירות לקוחות עם תמיכה בקבצים</p>
                </div>
                
                <div class="test-section">
                    <h2>✅ מערכת קבצים מוכנה!</h2>
                    <div class="status success">
                        <h3>🎯 מה המערכת יכולה לעשות עכשיו:</h3>
                        <ul>
                            <li>📸 <strong>תמונות תקלות:</strong> הדר תזהה תמונות ותספק הנחיות ראשוניות</li>
                            <li>📄 <strong>מסמכים:</strong> PDF וקבצי טקסט לבקשות הצעות מחיר</li>
                            <li>🚨 <strong>זיהוי דחיפות:</strong> זיהוי אוטומטי של מילות מפתח לתקלות</li>
                            <li>🧠 <strong>שילוב עם זיכרון:</strong> הקבצים נשמרים בהקשר השיחה</li>
                            <li>📧 <strong>התראות לצוות:</strong> הצוות יקבל התראה על קבצים שהתקבלו</li>
                        </ul>
                    </div>
                </div>
                
                <div class="supported-files">
                    <h3>✅ סוגי קבצים נתמכים:</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                        <div>
                            <h4>📸 תמונות:</h4>
                            <small>JPG, PNG, GIF, WebP</small>
                        </div>
                        <div>
                            <h4>📄 מסמכים:</h4>
                            <small>PDF</small>
                        </div>
                        <div>
                            <h4>📝 טקסט:</h4>
                            <small>TXT, CSV</small>
                        </div>
                    </div>
                    <p><strong>⚠️ מגבלות:</strong> עד 10MB לקובץ, מקסימום 10 קבצים בבת אחת</p>
                </div>
                
                <div class="test-section">
                    <h3>🧪 איך לבדוק:</h3>
                    <ol>
                        <li><strong>שלח תמונה ב-WhatsApp</strong> למספר הבוט עם הודעה "יש לי תקלה"</li>
                        <li><strong>שלח PDF</strong> עם הודעה "רוצה הצעת מחיר"</li>
                        <li><strong>בדוק את התגובות</strong> - הדר אמורה לזהות ולהגיב בהתאם</li>
                        <li><strong>בדוק במייל</strong> - הצוות יקבל התראות</li>
                    </ol>
                    
                    <div class="status success">
                        📱 <strong>מספר הבדיקה:</strong> ${process.env.TEST_PHONE_NUMBER || 'לא מוגדר'}<br>
                        📧 <strong>התראות נשלחות ל:</strong> Dror@sbparking.co.il<br>
                        🤖 <strong>AI מופעל:</strong> ${process.env.OPENAI_API_KEY ? '✅ כן' : '❌ לא'}
                    </div>
                </div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="/" class="back-btn">🔙 חזור למערכת הראשית</a>
                    <a href="/memory-dashboard" class="back-btn" style="background: #f39c12; margin-right: 15px;">🧠 דשבורד זיכרון</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

module.exports = app;
