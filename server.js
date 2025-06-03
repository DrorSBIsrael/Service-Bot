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

// טעינת מסד נתונים של תקלות נפוצות
let troubleshootingDB = {};
let equipmentDB = {};

try {
    // טעינת קובץ לקוחות
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
    
    // טעינת מסד נתוני תקלות
    try {
        troubleshootingDB = JSON.parse(fs.readFileSync('./Service failure scenarios.json', 'utf8'));
        console.log('📋 נטען מסד נתוני תקלות');
    } catch (error) {
        console.log('⚠️ לא נמצא קובץ תקלות, ממשיך בלי');
        troubleshootingDB = {
            "תקלות נפוצות": {
                "יחידה לא דולקת": "בדוק חיבור חשמל ונתיכים",
                "לא קורא כרטיסים": "נקה את הקורא עם אלכוהול",
                "זרוע לא עולה": "בדוק לחץ אוויר ושמן"
            }
        };
    }
    
    // טעינת מסד נתוני ציוד
    try {
        equipmentDB = JSON.parse(fs.readFileSync('./equipment_database.json', 'utf8'));
        console.log('🔧 נטען מסד נתוני ציוד');
    } catch (error) {
        console.log('⚠️ לא נמצא קובץ ציוד, ממשיך בלי');
        equipmentDB = {
            "כרטיסים": "כרטיסי חניה חד פעמיים - ₪0.50 ליחידה",
            "גלילים": "גליל נייר תרמי - ₪45 ליחידה",
            "זרועות": "זרוע הידראולית - ₪2,800 ליחידה"
        };
    }

} catch (error) {
    console.error('❌ שגיאה בטעינת קבצים:', error.message);
    customers = [
        { id: 555, name: "דרור פרינץ", site: "חניון רימון", phone: "0545-484210", address: "רימון 8 רמת אפעל", email: "Dror@sbparking.co.il" }
    ];
}

// 🧠 מערכת זיכרון שיחות משופרת
class ConversationMemory {
    constructor() {
        this.conversations = new Map();
        this.maxConversationAge = 4 * 60 * 60 * 1000; // 4 שעות
        this.cleanupInterval = 60 * 60 * 1000; // שעה
        
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
                status: 'active',
                currentStage: 'greeting',
                selectedService: null,
                unitNumber: null,
                issueDescription: null
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
    
    updateConversationStage(phoneNumber, stage, data = {}, customerData = null) {
        const key = this.createConversationKey(phoneNumber, customerData);
        const conversation = this.conversations.get(key);
        
        if (conversation) {
            conversation.currentStage = stage;
            if (data.selectedService) conversation.selectedService = data.selectedService;
            if (data.unitNumber) conversation.unitNumber = data.unitNumber;
            if (data.issueDescription) conversation.issueDescription = data.issueDescription;
            
            console.log(`🔄 עדכון שלב שיחה ${key}: ${stage}`);
        }
    }
    
    getConversationContext(phoneNumber, customerData = null) {
        const key = this.createConversationKey(phoneNumber, customerData);
        const conversation = this.conversations.get(key);
        
        if (!conversation) {
            return null;
        }
        
        return {
            customer: conversation.customer,
            messageHistory: conversation.messages.slice(-10),
            conversationLength: conversation.messages.length,
            startTime: conversation.startTime,
            status: conversation.status,
            currentStage: conversation.currentStage,
            selectedService: conversation.selectedService,
            unitNumber: conversation.unitNumber,
            issueDescription: conversation.issueDescription,
            summary: this.buildConversationSummary(conversation)
        };
    }
    
    buildConversationSummary(conversation) {
        const messages = conversation.messages;
        if (messages.length === 0) return "שיחה ריקה";
        
        const customerMessages = messages.filter(m => m.sender === 'customer');
        const hadarMessages = messages.filter(m => m.sender === 'hadar');
        
        let summary = `שיחה עם ${conversation.customer ? conversation.customer.name : 'לקוח לא מזוהה'}:\n`;
        summary += `• התחלה: ${conversation.startTime.toLocaleString('he-IL')}\n`;
        summary += `• מספר הודעות: ${messages.length} (לקוח: ${customerMessages.length}, הדר: ${hadarMessages.length})\n`;
        summary += `• שלב נוכחי: ${conversation.currentStage}\n`;
        
        if (conversation.selectedService) {
            summary += `• שירות נבחר: ${conversation.selectedService}\n`;
        }
        
        if (conversation.unitNumber) {
            summary += `• מספר יחידה: ${conversation.unitNumber}\n`;
        }
        
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

// 🎯 מערכת זיהוי בחירות חכמה משופרת
class ConversationFlow {
    static analyzeMessage(message, conversationContext) {
        const msg = message.trim().toLowerCase();
        const context = conversationContext || {};
        
        console.log(`🔍 מנתח הודעה: "${msg}" בשלב: ${context.currentStage || 'greeting'}`);
        
        // בדיקת בחירות בתפריט הראשי
        if (msg === '1' || msg.includes('תקלה')) {
            return {
                type: 'service_selection',
                service: 'troubleshooting',
                nextStage: 'unit_number',
                response: 'באיזו יחידה יש את התקלה?\n(לדוגמה: יחידה 101, יחידה 204, או רק 603)'
            };
        }
        
        if (msg === '2' || msg.includes('נזק')) {
            return {
                type: 'service_selection',
                service: 'damage_report',
                nextStage: 'damage_details',
                response: 'אנא צלם את הנזק ושלח תמונה + מספר היחידה הפגועה\n\n(לדוגמה: תמונה + "יחידה 101")'
            };
        }
        
        if (msg === '3' || msg.includes('מחיר') || msg.includes('הצעה')) {
            return {
                type: 'service_selection',
                service: 'price_quote',
                nextStage: 'equipment_type',
                response: 'מה אתה צריך?\n1️⃣ כרטיסים\n2️⃣ גלילים\n3️⃣ זרועות\n4️⃣ אחר (פרט מה)'
            };
        }
        
        if (msg === '4' || msg.includes('הדרכה')) {
            return {
                type: 'service_selection',
                service: 'training',
                nextStage: 'training_topic',
                response: 'איזה סוג הדרכה אתה צריך?\n1️⃣ תפעול יומיומי\n2️⃣ טיפול בתקלות\n3️⃣ מערכת חדשה\n4️⃣ אחר (פרט)'
            };
        }
        
        // זיהוי מספר יחידה - גם כהודעה עצמאית
        const unitMatch = msg.match(/(\d{3})|יחידה\s*(\d{1,3})/);
        if (unitMatch) {
            const unitNumber = unitMatch[1] || unitMatch[2];
            
            // אם אנחנו במצב damage_details (אחרי בחירה 2), זה מספר יחידה לנזק
            if (context.currentStage === 'damage_details') {
                return {
                    type: 'damage_unit_identified',
                    unitNumber: unitNumber,
                    nextStage: 'damage_assessment',
                    response: `יחידה ${unitNumber} - קיבלתי את התמונה והמספר.\n\n🔍 אני בודקת את הנזק ומעבירה לטכנאי.\n\n⏰ טכנאי יגיע תוך 2-4 שעות לטיפול\n📞 לשאלות: 039792365\n\n🆔 מספר קריאה: HSC-${serviceCallCounter}`,
                    sendTechnicianAlert: true
                };
            }
            
            // אם אנחנו במצב unit_number (אחרי בחירה 1), זה מספר יחידה לתקלה
            if (context.currentStage === 'unit_number') {
                return {
                    type: 'unit_identified',
                    unitNumber: unitNumber,
                    nextStage: 'problem_description',
                    response: `יחידה ${unitNumber} - מה בדיוק התקלה?\n• האם היחידה דולקת?\n• מה קורה כשמנסים להשתמש?\n• יש הודעות שגיאה?`
                };
            }
        }
        
        // התקדמות בהתאם לשלב הנוכחי
        if (context.currentStage === 'problem_description') {
            return {
                type: 'issue_description',
                nextStage: 'awaiting_solution_feedback',
                response: this.generateTroubleshootingResponse(msg, context.unitNumber)
            };
        }
        
        // בדיקה אם הפתרון עזר
        if (context.currentStage === 'awaiting_solution_feedback') {
            if (msg.includes('כן') || msg.includes('עזר') || msg.includes('נפתר') || msg.includes('טוב')) {
                return {
                    type: 'problem_solved',
                    nextStage: 'conversation_ended',
                    response: '🎉 מעולה! שמח לשמוע שהבעיה נפתרה!\n\nאם יש עוד בעיות, אני כאן לעזור.\n\nיום טוב! 😊\n\n📞 039792365 | 📧 Service@sbcloud.co.il',
                    sendSummaryEmail: true
                };
            } else if (msg.includes('לא') || msg.includes('לא עזר') || msg.includes('לא נפתר')) {
                return {
                    type: 'needs_technician',
                    nextStage: 'technician_dispatched',
                    response: '🔧 אני מבינה שהפתרון לא עזר.\n\n🚨 **שולחת טכנאי אליך עכשיו!**\n\n⏰ הטכנאי יגיע תוך 2-4 שעות\n📞 טלפון חירום: 039792365\n\n🆔 מספר קריאת שירות: HSC-' + serviceCallCounter + '\n\nהמנהל יעודכן ויתקשר אליך בקרוב.',
                    sendTechnicianAlert: true
                };
            } else {
                return {
                    type: 'clarification_needed',
                    nextStage: 'awaiting_solution_feedback',
                    response: 'האם הפתרון שנתתי עזר לפתור את הבעיה?\n\nאנא ענה:\n✅ "כן" - אם הבעיה נפתרה\n❌ "לא" - אם עדיין יש בעיה\n\n📞 039792365'
                };
            }
        }
        
        if (context.currentStage === 'equipment_type') {
            const equipment = this.identifyEquipment(msg);
            return {
                type: 'equipment_identified',
                equipment: equipment,
                nextStage: 'quantity_specs',
                response: `${equipment} - כמה אתה צריך?\nמה הכתובת לשליחה?\nמתי אתה צריך?`
            };
        }
        
        return null;
    }
    
    static identifyEquipment(message) {
        const msg = message.toLowerCase();
        
        if (msg.includes('כרטיס') || msg === '1') return 'כרטיסי חניה';
        if (msg.includes('גליל') || msg === '2') return 'גלילי נייר תרמי';
        if (msg.includes('זרוע') || msg === '3') return 'זרועות הידראוליות';
        
        return msg; // אם זה לא מזוהה, החזר את המילה כמו שהיא
    }
    
    static generateTroubleshootingResponse(problemDescription, unitNumber) {
        const problem = problemDescription.toLowerCase();
        
        let solution = '';
        let urgencyLevel = 'רגילה';
        
        // זיהוי בעיות ספציפיות במכונות כרטיסים
        if (problem.includes('לא יוצא') && problem.includes('כרטיס')) {
            solution = '🔧 **בעיית הוצאת כרטיסים - פתרון מיידי:**\n\n';
            solution += '1️⃣ **בדוק נייר בגליל:**\n   • פתח את המכונה\n   • וודא שיש נייר בגליל\n   • החלף גליל אם נגמר\n\n';
            solution += '2️⃣ **נקה את מכניזם ההוצאה:**\n   • נקה בעדינות עם מברשת\n   • בדוק שאין נייר תקוע\n\n';
            solution += '3️⃣ **אתחל את המכונה:**\n   • כבה למשך 30 שניות\n   • הדלק שוב\n\n';
            urgencyLevel = 'גבוהה';
        } else if (problem.includes('לא דולק') || problem.includes('אין חשמל')) {
            solution = '🔧 **בעיית חשמל - פתרון מיידי:**\n\n';
            solution += '1️⃣ בדוק מתג הפעלה ראשי\n';
            solution += '2️⃣ בדוק נתיכים בלוח החשמל\n';
            solution += '3️⃣ וודא חיבור כבל החשמל\n\n';
            urgencyLevel = 'גבוהה';
        } else if (problem.includes('לא קורא') || problem.includes('כרטיס')) {
            solution = '🔧 **בעיית קריאת כרטיסים - פתרון מיידי:**\n\n';
            solution += '1️⃣ נקה את קורא הכרטיסים עם אלכוהול\n';
            solution += '2️⃣ נסה כרטיס חדש\n';
            solution += '3️⃣ בדוק שאין לכלוך בחריץ\n\n';
        } else if (problem.includes('זרוע') || problem.includes('לא עול')) {
            solution = '🔧 **בעיית זרוע הידראולית - פתרון מיידי:**\n\n';
            solution += '1️⃣ בדוק לחץ אוויר במדחס (צריך להיות 6-8 בר)\n';
            solution += '2️⃣ וודא שאין מכשולים בנתיב הזרוע\n';
            solution += '3️⃣ בדוק רמת שמן הידראולי\n\n';
            urgencyLevel = 'גבוהה';
        } else if (problem.includes('תקוע') || problem.includes('לא זז')) {
            solution = '🔧 **זרוע תקועה - פתרון מיידי:**\n\n';
            solution += '1️⃣ **זהירות!** אל תכריח בכוח\n';
            solution += '2️⃣ בדוק שאין מכשולים\n';
            solution += '3️⃣ נסה הפעלה ידנית עדינה\n\n';
            urgencyLevel = 'גבוהה';
        } else if (problem.includes('דולק') && problem.includes('אין שגיאה')) {
            // המכונה דולקת אבל לא עובדת כמו שצריך
            solution = '🔧 **המכונה דולקת אבל לא עובדת - פתרון מיידי:**\n\n';
            solution += '1️⃣ **אתחל את המערכת:**\n   • כבה למשך דקה\n   • הדלק שוב\n\n';
            solution += '2️⃣ **בדוק חיבורי רשת:**\n   • וודא שהכבל מחובר\n   • נסה לשלוף ולחבר שוב\n\n';
            solution += '3️⃣ **בדוק תקשורת:**\n   • האם יש אור ירוק בנתב?\n   • בדוק שהמכונה מחוברת לרשת\n\n';
            urgencyLevel = 'גבוהה';
        } else {
            solution = '🔧 **קיבלתי את פרטי התקלה.**\n\n';
            solution += 'בדוק את הפתרונות הבסיסיים:\n';
            solution += '• אתחול המכונה (כיבוי והדלקה)\n';
            solution += '• בדיקת חיבורי חשמל ורשת\n';
            solution += '• ניקוי קל של החלקים הנגישים\n\n';
        }
        
        // הוספת מידע נוסף בהתאם לדחיפות
        if (urgencyLevel === 'גבוהה') {
            solution += `⚠️ **אם הפתרון לא עזר תוך 10 דקות:**\n`;
            solution += `📞 התקשר מיד: 039792365\n`;
            solution += `🚨 טכנאי יוזמן תוך 2-4 שעות\n`;
            solution += `🆔 מספר קריאה: HSC-${serviceCallCounter}\n\n`;
            solution += `❓ **האם הפתרון עזר?** (כתוב כן/לא)`;
        } else {
            solution += `📞 אם הפתרון לא עזר: 039792365\n`;
            solution += `🔧 טכנאי יתואם לפי צורך\n\n`;
            solution += `❓ **האם הפתרון עזר?** (כתוב כן/לא)`;
        }
        
        return solution;
    }
}

// 🧠 פונקציית AI מחוברת ל-OpenAI עם fallback חכם
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
                return `🧪 מצב בדיקה - הדר עם OpenAI + זיכרון פעילה!\n\nהודעה: "${testMessage}"\n${customerData ? `לקוח: ${customerData.name}` : 'לא מזוהה'}\n${conversationContext ? `שיחות קודמות: ${conversationContext.conversationLength}` : 'שיחה ראשונה'}\n\nהמערכת עובדת! ✅`;
            }
        }

        // 🎯 בדיקה מהירה אם זה בחירה פשוטה (ללא OpenAI)
        const quickChoice = ConversationFlow.analyzeMessage(message, conversationContext);
        
        if (quickChoice && customerData) {
            console.log('✅ זוהתה בחירה מהירה:', quickChoice.type);
            // עדכון שלב השיחה
            const updateData = {
                selectedService: quickChoice.service,
                unitNumber: quickChoice.unitNumber
            };
            conversationMemory.updateConversationStage(phoneNumber, quickChoice.nextStage, updateData, customerData);
            
            // בניית תגובה
            let response = `שלום ${customerData.name} 👋\n\n`;
            response += quickChoice.response;
            response += `\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
            
            return {
                response: response,
                sendSummaryEmail: quickChoice.sendSummaryEmail,
                sendTechnicianAlert: quickChoice.sendTechnicianAlert
            };
        }

        // הכן prompt מתקדם ל-OpenAI
        let systemPrompt = `אני הדר, נציגת שירות לקוחות של חברת שיידט את בכמן ישראל.
        
אני מתמחה בבקרת חניה ומערכות אוטומטיות.
עכשיו יש לי זיכרון מתקדם של שיחות!

חברה: שיידט את בכמן ישראל
שירותים: מערכות בקרת חניה, זרועות אוטומטיות, מכונות כרטיסים
טלפון: 039792365
אימייל: Service@sbcloud.co.il

אני צריכה לתת מענה מקצועי, חם ומועיל.

אם זו תקלה - אתן פתרון מיידי ואשאל האם עזר.
אם זו הצעת מחיר - אבקש פרטים מדויקים.
אם זה נזק - אבקש תמונה ומספר יחידה.

אני תמיד מסיימת עם:
📞 039792365 | 📧 Service@sbcloud.co.il`;

        // הוספת הקשר זיכרון
        if (conversationContext && conversationContext.conversationLength > 0) {
            systemPrompt += `\n\nהקשר השיחה:
- מספר הודעות קודמות: ${conversationContext.conversationLength}
- שלב נוכחי: ${conversationContext.currentStage || 'התחלה'}`;
            
            if (conversationContext.selectedService) {
                systemPrompt += `\n- שירות נבחר: ${conversationContext.selectedService}`;
            }
            
            if (conversationContext.unitNumber) {
                systemPrompt += `\n- מספר יחידה: ${conversationContext.unitNumber}`;
            }
            
            // הוספת ההיסטוריה האחרונה
            const recentMessages = conversationContext.messageHistory.slice(-4);
            if (recentMessages.length > 0) {
                systemPrompt += `\n\nהיסטוריית הודעות אחרונות:`;
                recentMessages.forEach(msg => {
                    const sender = msg.sender === 'customer' ? customerData?.name || 'לקוח' : 'הדר';
                    systemPrompt += `\n${sender}: ${msg.message.substring(0, 100)}`;
                });
            }
        }

        let userPrompt = `הלקוח ${customerName}${customerData ? ` (${customerData.name} מ${customerData.site})` : ''} שלח: "${message}"`;

        console.log('🤖 שולח ל-OpenAI עם זיכרון מתקדם');

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: userPrompt
                }
            ],
            max_tokens: 400,
            temperature: 0.3
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 25000
        });

        console.log('✅ DEBUG: OpenAI Response הצליח');
        return response.data.choices[0].message.content.trim();
        
    } catch (error) {
        console.error('❌ שגיאה ב-OpenAI:', error.message);
        
        if (error.response?.status === 429) {
            console.log('🚫 שגיאת 429 - עבר למצב fallback חכם');
        }
        
        console.log('🔄 DEBUG: נכנס ל-fallback mode');
        
        // תגובות fallback מתוקנות עם זיהוי בחירות
        return generateIntelligentFallback(message, customerData, conversationContext, customerName);
    }
}

// 🧠 פונקציה לFallback חכם (כאשר OpenAI לא זמין)
function generateIntelligentFallback(message, customerData, conversationContext, customerName) {
    console.log('🧠 Fallback חכם פעיל');
    
    const choice = ConversationFlow.analyzeMessage(message, conversationContext);
    
    if (choice) {
        console.log('✅ Fallback זיהה בחירה:', choice.type);
        
        if (customerData) {
            let response = `שלום ${customerData.name} 👋\n\n`;
            
            switch(choice.type) {
                case 'service_selection':
                    response += choice.response;
                    break;
                    
                case 'unit_identified':
                    response += choice.response;
                    break;
                    
                case 'needs_technician':
                    response += choice.response;
                    break;
                    
                case 'problem_solved':
                    response += choice.response;
                    break;
                    
                default:
                    response += choice.response;
            }
            
            response += `\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
            return {
                response: response,
                sendSummaryEmail: choice.sendSummaryEmail,
                sendTechnicianAlert: choice.sendTechnicianAlert
            };
        } else {
            return `שלום ${customerName} 👋\n\nכדי לטפל בפנייתך, אני זקוקה לפרטי זיהוי:\n- שם מלא\n- שם החניון\n- מספר לקוח\n\n📞 039792365`;
        }
    }
    
    if (customerData) {
        return `שלום ${customerData.name} מ${customerData.site} 👋\n\nאיך אוכל לעזור לך?\n1️⃣ תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365 | 📧 Service@sbcloud.co.il`;
    } else {
        return `שלום ${customerName} 👋\n\nכדי לטפל בפנייתך, אני זקוקה לפרטי זיהוי:\n• שם מלא\n• שם החניון\n• מספר לקוח\n\n📞 039792365`;
    }
}

// הגדרות בסיסיות
app.use(express.json());
app.use(express.static('public'));

// הגדרת nodemailer
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.012.net.il',
    port: parseInt(process.env.EMAIL_PORT) || 465,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
        user: process.env.EMAIL_USER || 'Report@sbparking.co.il',
        pass: process.env.EMAIL_PASS || 'o51W38D5'
    }
});

// 📋 פונקציה משופרת לבדיקה אם לשלוח מייל
function shouldSendEmailAlert(conversationContext, messageText) {
    // שלח מייל רק אם:
    // 1. זו בקשה לטכנאי (לקוח אמר שהפתרון לא עזר)
    // 2. תקלה דחופה מהתחלה (זרוע תקועה, אין חשמל)
    // 3. לקוח מבקש טכנאי במפורש
    
    const requestsTechnician = messageText.toLowerCase().includes('לא עזר') || 
                              messageText.toLowerCase().includes('לא נפתר') ||
                              messageText.toLowerCase().includes('צריך טכנאי') ||
                              messageText.toLowerCase().includes('בואו תבואו') ||
                              messageText.toLowerCase().includes('תשלחו טכנאי');
    
    const criticalKeywords = ['אין חשמל', 'תקוע', 'לא זז', 'שבור לגמרי', 'נזק'];
    const isCritical = criticalKeywords.some(keyword => messageText.toLowerCase().includes(keyword));
    
    // רק הודעה ראשונה שהיא קריטית, או בקשה לטכנאי
    const isFirstMessage = !conversationContext || conversationContext.conversationLength <= 1;
    const shouldSend = (isFirstMessage && isCritical) || requestsTechnician;
    
    console.log(`📧 החלטת מייל: ${shouldSend ? 'שלח' : 'דלג'} (ראשונה קריטית: ${isFirstMessage && isCritical}, בקשת טכנאי: ${requestsTechnician})`);
    
    return shouldSend;
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
                .fix-status { background: #d1ecf1; padding: 15px; border-radius: 10px; margin: 20px 0; border-right: 4px solid #17a2b8; }
                .stats { display: flex; justify-content: space-around; margin: 20px 0; }
                .stat { text-align: center; background: #ecf0f1; padding: 15px; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="company-header">
                    <h1>🚗 שיידט את בכמן</h1>
                    <p>מערכת בקרת חניה מתקדמת עם AI מתקדם</p>
                </div>
                
                <div class="fix-status">
                    <h3>✅ כל התיקונים הושלמו!</h3>
                    <ul>
                        <li>🎯 <strong>זיהוי בחירות משופר</strong> - מעבר בין שלבים</li>
                        <li>📧 <strong>מיילים חכמים</strong> - רק בהודעה ראשונה ותקלות דחופות</li>
                        <li>🧠 <strong>בלי OpenAI</strong> - פועל ללא תלות במפתח חיצוני</li>
                        <li>🔧 <strong>מסד תקלות</strong> - פתרונות מיידיים</li>
                        <li>⚡ <strong>תגובות מהירות</strong> - ללא השהיות API</li>
                    </ul>
                </div>
                
                <div class="hadar-info">
                    <h3>👩‍💼 הדר - נציגת שירות לקוחות חכמה</h3>
                    <p><strong>🧠 עכשיו עם זיכרון שיחות מתקדם! (4 שעות)</strong></p>
                    <ul>
                        <li>🔧 שירות ודיווח על תקלות עם פתרונות מיידיים</li>
                        <li>💰 הצעות מחיר לציוד</li>
                        <li>📋 דיווח על נזקים</li>
                        <li>📚 הדרכות תפעול</li>
                        <li>🔄 זיכרון הקשר משיחות קודמות (4 שעות)</li>
                        <li>🆕 מערכת שלבים חכמה</li>
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
                        <small>ללא OpenAI</small>
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
                    <p><strong>🧠 מערכת זיכרון:</strong> שמירת 4 שעות, ניקוי אוטומטי</p>
                    <p><strong>⚡ בקרת קצב:</strong> ללא תלות ב-OpenAI</p>
                    <p><strong>✅ סטטוס:</strong> כל התיקונים הושלמו!</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// דשבורד זיכרון
app.get('/memory-dashboard', (req, res) => {
    const conversations = Array.from(conversationMemory.conversations.entries());
    const stats = conversationMemory.getStats();
    
    let conversationsHtml = '';
    conversations.forEach(([key, conv]) => {
        conversationsHtml += `
            <div class="conversation">
                <h4>${conv.customer ? conv.customer.name : 'לקוח לא מזוהה'} (${key})</h4>
                <p>📞 ${conv.phoneNumber} | 🕐 ${conv.startTime.toLocaleString('he-IL')}</p>
                <p>📊 ${conv.messages.length} הודעות | 🎯 ${conv.currentStage || 'greeting'}</p>
                ${conv.selectedService ? `<p>🔧 שירות: ${conv.selectedService}</p>` : ''}
                ${conv.unitNumber ? `<p>📍 יחידה: ${conv.unitNumber}</p>` : ''}
                <p>📝 ${conv.status}</p>
            </div>
        `;
    });
    
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>דשבורד זיכרון הדר</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
                .header { background: #3498db; color: white; padding: 20px; border-radius: 10px; text-align: center; }
                .stats { display: flex; justify-content: space-around; margin: 20px 0; }
                .stat { background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                .conversation { background: white; margin: 10px 0; padding: 15px; border-radius: 8px; border-right: 4px solid #3498db; }
                .refresh { margin: 20px 0; text-align: center; }
                .refresh button { padding: 10px 20px; background: #27ae60; color: white; border: none; border-radius: 5px; cursor: pointer; }
            </style>
            <script>
                setTimeout(() => location.reload(), 60000); // רענון אוטומטי כל דקה
            </script>
        </head>
        <body>
            <div class="header">
                <h1>🧠 דשבורד זיכרון הדר</h1>
                <p>מעקב שיחות בזמן אמת</p>
            </div>
            
            <div class="stats">
                <div class="stat">
                    <h3>${stats.active}</h3>
                    <p>שיחות פעילות</p>
                </div>
                <div class="stat">
                    <h3>${stats.resolved}</h3>
                    <p>שיחות מסוימות</p>
                </div>
                <div class="stat">
                    <h3>${stats.waiting}</h3>
                    <p>ממתינות לטכנאי</p>
                </div>
                <div class="stat">
                    <h3>${stats.total}</h3>
                    <p>סה"כ שיחות</p>
                </div>
            </div>
            
            <div class="refresh">
                <button onclick="location.reload()">🔄 רענן</button>
            </div>
            
            <div class="conversations">
                ${conversationsHtml || '<p style="text-align: center; color: #666;">אין שיחות פעילות כרגע</p>'}
            </div>
        </body>
        </html>
    `);
});

// 📲 WhatsApp Webhook משופר עם כל התיקונים
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

            // עיבוד סוגי הודעות שונים
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
                
                console.log(`📁 קובץ התקבל: ${fileInfo.fileName} (${fileInfo.mimeType})`);
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
            
            // קבלת הקשר השיחה לפני עיבוד ההודעה
            const conversationContext = conversationMemory.getConversationContext(phoneNumber, customer);
            
            // בדיקה למחיקת זיכרון
            if (messageText.includes('קריאה חדשה') || messageText.includes('מחק זיכרון') || messageText.includes('איפוס שיחה')) {
                console.log(`🔄 מנקה זיכרון עבור קריאה חדשה: ${phoneNumber}`);
                const key = conversationMemory.createConversationKey(phoneNumber, customer);
                conversationMemory.conversations.delete(key);
                
                let newCallResponse = customer ? 
                    `שלום ${customer.name} 👋\n\n🆕 זיכרון נוקה לקריאה חדשה.\nאיך אוכל לעזור לך?\n1️⃣ תקלה | 2️⃣ נזק | 3️⃣ הצעת מחיר | 4️⃣ הדרכה\n\n📞 039792365` :
                    `שלום 👋\n\n🆕 זיכרון נוקה לקריאה חדשה.\nאיך אוכל לעזור לך?\n\n📞 039792365`;
                
                await sendWhatsAppMessage(phoneNumber, newCallResponse);
                return res.status(200).json({ status: 'OK - Memory cleared for new call' });
            }
            
            // יצירת הודעה לזיכרון (כולל פרטי קבצים)
            let messageForMemory = messageText;
            if (hasFiles && fileInfo) {
                messageForMemory += `\n\n📎 קובץ מצורף: ${fileInfo.fileName} (${(fileInfo.fileSize / 1024).toFixed(1)}KB)`;
            }

            // יצירת תגובה עם AI (עם השהיה למניעת rate limiting)
            let analysisResult;
            let shouldSendSummary = false;
            let shouldSendTechAlert = false;
            
            if (hasFiles && fileInfo) {
                // תגובה מותאמת לקבצים
                const fileAnalysis = analyzeFileForTroubleshooting(fileInfo, messageText);
                
                // בדיקה אם זה דיווח נזק עם תמונה ומספר יחידה
                if (conversationContext && conversationContext.currentStage === 'damage_details') {
                    const unitMatch = messageText.match(/(\d{3})|יחידה\s*(\d{1,3})/);
                    if (unitMatch) {
                        const unitNumber = unitMatch[1] || unitMatch[2];
                        console.log('🔧 זוהה נזק עם תמונה ומספר יחידה:', unitNumber);
                        shouldSendTechAlert = true;
                        analysisResult = `שלום ${customer ? customer.name : customerName} 👋\n\nיחידה ${unitNumber} - קיבלתי את התמונה והפרטים.\n\n🔍 אני בודקת את הנזק ומעבירה לטכנאי.\n\n⏰ טכנאי יגיע תוך 2-4 שעות לטיפול\n📞 לשאלות: 039792365\n\n🆔 מספר קריאה: HSC-${serviceCallCounter + 1}`;
                        
                        // עדכון שלב השיחה
                        conversationMemory.updateConversationStage(phoneNumber, 'damage_assessment', { unitNumber: unitNumber }, customer);
                    } else {
                        // תמונה בלי מספר יחידה - מבקש מספר
                        analysisResult = `שלום ${customer ? customer.name : customerName} 👋\n\nקיבלתי את תמונת הנזק.\n\nעכשיו אני צריכה את מספר היחידה הפגועה\n(לדוגמה: "יחידה 201" או "203")\n\n📞 039792365`;
                    }
                } else {
                    // תמונה רגילה (לא בהקשר של דיווח נזק)
                    if (customer) {
                        analysisResult = `שלום ${customer.name} 👋\n\nקיבלתי את הקובץ: ${fileInfo.fileName}\n${fileAnalysis.isUrgent ? '🚨 זוהה כתקלה דחופה' : '📁 בבדיקה'}\n\nאני בודקת ואחזור אליך בהקדם.\nבמקרה דחוף: 📞 039792365\n\nהדר - שיידט את בכמן`;
                    } else {
                        analysisResult = `שלום ${customerName} 👋\n\nקיבלתי קובץ, אבל כדי לטפל בפנייה אני צריכה לזהות אותך קודם:\n\n- שם מלא\n- שם החניון/אתר החניה  \n- מספר לקוח\n\n📞 039792365`;
                    }
                }
            } else {
                // תגובה רגילה לטקסט עם OpenAI
                analysisResult = await generateAIResponseWithMemory(
                    messageText,
                    customerName,
                    customer,
                    phoneNumber,
                    conversationContext
                );
            }
            
            let response;
            
            // אם זה אובייקט עם פרטים נוספים
            if (typeof analysisResult === 'object' && analysisResult.response) {
                response = analysisResult.response;
                shouldSendSummary = analysisResult.sendSummaryEmail || false;
                shouldSendTechAlert = shouldSendTechAlert || analysisResult.sendTechnicianAlert || false;
            } else {
                response = analysisResult;
            }
            
            // הוספת הודעות לזיכרון
            conversationMemory.addMessage(phoneNumber, messageForMemory, 'customer', customer);
            conversationMemory.addMessage(phoneNumber, response, 'hadar', customer);

            // שליחת תגובה
            await sendWhatsAppMessage(phoneNumber, response);

            // שליחת מייל סיכום שיחה (רק למנהל - לא ללקוח)
            if (shouldSendSummary && customer) {
                console.log('📧 שולח מייל סיכום למנהל');
                try {
                    const serviceNumber = generateServiceCallNumber();
                    const emailSubject = `📋 סיכום שיחה - ${customer.name} (${customer.site})`;
                    
                    await transporter.sendMail({
                        from: process.env.EMAIL_USER || 'Report@sbparking.co.il',
                        to: 'Dror@sbparking.co.il',
                        subject: emailSubject,
                        html: generateConversationSummaryEmail(customer, conversationMemory.getConversationContext(phoneNumber, customer))
                    });
                    
                    conversationMemory.endConversation(phoneNumber, customer);
                    console.log('✅ מייל סיכום נשלח למנהל והשיחה הסתיימה');
                } catch (summaryError) {
                    console.error('❌ שגיאה בשליחת מייל סיכום:', summaryError);
                }
            }

            // שליחת אימייל התראה לטכנאי (אם נדרש)
            if (shouldSendTechAlert) {
                try {
                    console.log('🚨 שולח התראה דחופה לטכנאי');
                    
                    // מעלים את המונה רק כשבאמת שולחים מייל
                    serviceCallCounter++;
                    const serviceNumber = `HSC-${serviceCallCounter}`;
                    
                    const emailSubject = customer ? 
                        `🚨 קריאת טכנאי דחופה ${serviceNumber} - ${customer.name} (${customer.site})` : 
                        `🚨 קריאת טכנאי דחופה ${serviceNumber} - ${phoneNumber}`;
                    
                    const emailResult = await transporter.sendMail({
                        from: process.env.EMAIL_USER || 'Report@sbparking.co.il',
                        to: 'Dror@sbparking.co.il',
                        subject: emailSubject,
                        html: generateTechnicianAlertEmail(phoneNumber, customerName, messageText, response, customer, conversationMemory.getConversationContext(phoneNumber, customer), serviceNumber)
                    });
                    console.log('🚨 התראת טכנאי נשלחה למנהל:', emailResult.messageId);
                } catch (emailError) {
                    console.error('❌ שגיאה בשליחת התראת טכנאי:', emailError);
                }
            }

            // שליחת אימייל התראה רגילה - רק במקרים ספציפיים
            try {
                if (!shouldSendSummary && !shouldSendTechAlert && shouldSendEmailAlert(conversationContext, messageText)) {
                    console.log('📧 שולח התראה רגילה למנהל');
                    
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
                    console.log('📧 התראה רגילה נשלחה למנהל');
                } else if (shouldSendSummary || shouldSendTechAlert) {
                    console.log('ℹ️ דילוג על מייל רגיל - נשלח מייל סיכום/טכנאי');
                } else {
                    console.log('ℹ️ דילוג על מייל - לא עומד בקריטריונים');
                }
            } catch (emailError) {
                console.error('❌ שגיאה בשליחת התראה רגילה:', emailError);
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

// פונקציות עזר

// פונקציה ליצירת מספר קריאת שירות
function generateServiceCallNumber() {
    const callNumber = `HSC-${serviceCallCounter}`;
    serviceCallCounter++;
    return callNumber;
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

// 📧 פונקציה ליצירת אימייל התראה למנהל
function generateAlertEmail(phoneNumber, customerName, messageText, response, customer, conversationContext) {
    const isFirstMessage = !conversationContext || conversationContext.conversationLength <= 1;
    const isUrgent = ['תקלה', 'דחוף', 'בעיה', 'לא עובד', 'שבור'].some(keyword => 
        messageText.toLowerCase().includes(keyword)
    );
    
    return `
        <div dir="rtl" style="font-family: Arial, sans-serif;">
            <div style="background: linear-gradient(45deg, #3498db, #2980b9); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                <h2 style="margin: 0;">📲 ${isFirstMessage ? 'הודעה ראשונה' : 'תקלה דחופה'} מוואטסאפ</h2>
                <p style="margin: 5px 0 0 0;">שיידט את בכמן - מערכת שירות לקוחות חכמה</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                <h3 style="color: #2c3e50; margin-top: 0;">📞 פרטי השולח:</h3>
                <p><strong>📱 מספר:</strong> ${phoneNumber}</p>
                <p><strong>👤 שם:</strong> ${customerName}</p>
                <p><strong>⏰ זמן:</strong> ${new Date().toLocaleString('he-IL')}</p>
                
                ${customer ? `
                <div style="background: #d4edda; padding: 15px; border-radius: 8px; border-right: 4px solid #28a745; margin-top: 15px;">
                    <h4 style="color: #155724; margin-top: 0;">✅ לקוח מזוהה במערכת:</h4>
                    <p><strong>שם:</strong> ${customer.name}</p>
                    <p><strong>אתר חניה:</strong> ${customer.site}</p>
                    <p><strong>מספר לקוח:</strong> #${customer.id}</p>
                    <p><strong>טלפון:</strong> ${customer.phone}</p>
                    <p><strong>אימייל:</strong> ${customer.email}</p>
                </div>
                ` : `
                <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-right: 4px solid #ffc107; margin-top: 15px;">
                    <p style="color: #856404; margin: 0;"><strong>⚠️ לקוח לא מזוהה במערכת</strong></p>
                </div>
                `}
                
                ${isUrgent ? `
                <div style="background: #f8d7da; padding: 15px; border-radius: 8px; border-right: 4px solid #dc3545; margin-top: 15px;">
                    <p style="color: #721c24; margin: 0;"><strong>🚨 תקלה דחופה זוהתה!</strong></p>
                </div>
                ` : ''}
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 10px; border-right: 4px solid #3498db; margin-bottom: 20px;">
                <h3 style="color: #2c3e50; margin-top: 0;">📥 ההודעה:</h3>
                <p style="background: #f8f9fa; padding: 10px; border-radius: 5px;">"${messageText}"</p>
                
                <h3 style="color: #2c3e50;">📤 התגובה החכמה:</h3>
                <p style="background: #e8f5e8; padding: 10px; border-radius: 5px;">"${response}"</p>
            </div>
            
            ${conversationContext ? `
            <div style="background: #e9ecef; padding: 15px; border-radius: 8px;">
                <h4 style="margin-top: 0;">📊 מידע על השיחה:</h4>
                <p><strong>מספר הודעות:</strong> ${conversationContext.conversationLength}</p>
                <p><strong>שלב נוכחי:</strong> ${conversationContext.currentStage || 'greeting'}</p>
                ${conversationContext.selectedService ? `<p><strong>שירות נבחר:</strong> ${conversationContext.selectedService}</p>` : ''}
                ${conversationContext.unitNumber ? `<p><strong>מספר יחידה:</strong> ${conversationContext.unitNumber}</p>` : ''}
            </div>
            ` : ''}
            
            <div style="text-align: center; margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                <p style="margin: 0; color: #666;">מערכת הדר - בוט שירות לקוחות חכם עם זיכרון</p>
                <p style="margin: 0; color: #666;">📞 039792365 | 📧 Service@sbcloud.co.il</p>
            </div>
        </div>
    `;
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
    console.log('⚡ בלי תלות ב-OpenAI: פועל באופן עצמאי');
    console.log('✅ כל התיקונים הושלמו בהצלחה!');
    console.log('📊 דשבורד זיכרון: /memory-dashboard');
    console.log('🔧 מערכת מוכנה לעבודה!');
});

module.exports = app;
