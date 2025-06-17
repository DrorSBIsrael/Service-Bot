require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

// הגדרות דיבוג מתקדמות
const DEBUG_LEVEL = process.env.DEBUG_LEVEL || 'INFO';
const debugLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

function log(level, message, data = null) {
    if (debugLevels[level] >= debugLevels[DEBUG_LEVEL]) {
        const timestamp = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
        console.log(`${timestamp} [${level}] ${message}`);
        if (data && level === 'DEBUG') console.log(data);
    }
}

// מספר קריאה גלובלי
let globalServiceCounter = 10001;
function getNextServiceNumber() {
    return `HSC-${++globalServiceCounter}`;
}

// שעון ישראל
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

// פונקציה להורדת קבצים מוואטסאפ
async function downloadWhatsAppFile(fileUrl, fileName) {
    try {
        log('INFO', `📥 מוריד קובץ: ${fileName}`);
        const response = await axios({
            method: 'GET',
            url: fileUrl,
            responseType: 'stream'
        });
        
        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        const filePath = path.join(uploadsDir, fileName);
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                log('INFO', `✅ קובץ נשמר: ${filePath}`);
                resolve(filePath);
            });
            writer.on('error', reject);
        });
    } catch (error) {
        log('ERROR', '❌ שגיאה בהורדת קובץ:', error.message);
        return null;
    }
}

// טעינת נתונים
let customers = [];
let serviceFailureDB = [];
let trainingDB = {};

// טעינת לקוחות
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
    log('INFO', `📊 נטענו ${customers.length} לקוחות`);
} catch (error) {
    log('ERROR', '❌ שגיאה בטעינת לקוחות:', error.message);
    customers = [{ 
        id: 555, 
        name: "דרור פרינץ", 
        site: "חניון רימון", 
        phone: "0545-484210", 
        address: "רימון 8 רמת אפעל", 
        email: "Dror@sbparking.co.il" 
    }];
}

// טעינת מסד תקלות
try {
    serviceFailureDB = JSON.parse(fs.readFileSync('./Service failure scenarios.json', 'utf8'));
    if (!Array.isArray(serviceFailureDB)) serviceFailureDB = [];
    log('INFO', `📋 מסד תקלות נטען: ${serviceFailureDB.length} תרחישים`);
} catch (error) {
    log('ERROR', '❌ שגיאה בטעינת מסד תקלות:', error.message);
    serviceFailureDB = [
        {
            "תרחיש": "יחידה לא דולקת",
            "שלבים": "1. בדוק חיבור חשמל\n2. בדוק נתיכים\n3. בדוק מתג הפעלה\n4. אתחול המערכת",
            "הערות": "אם לא עוזר - צריך טכנאי"
        },
        {
            "תרחיש": "מחסום לא עולה",
            "שלבים": "1. בדוק אם יש כרטיס תקין ביחידה\n2. נסה הפעלה ידנית\n3. בדוק מנוע המחסום\n4. אתחול מערכת",
            "הערות": "זהירות ממחסום תקוע"
        },
        {
            "תרחיש": "לא מדפיס כרטיסים",
            "שלבים": "1. בדוק נייר בלנק\n2. בדוק ראש מדפסת\n3. ניקוי מדפסת\n4. החלפת גליל נייר",
            "הערות": "נייר איכותי בלבד"
        }
    ];
}

// הגדרות Express
app.use(express.json());
app.use(express.static('public'));

// הגדרת מייל
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.012.net.il',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER || 'Report@sbparking.co.il',
        pass: process.env.EMAIL_PASS || 'o51W38D5'
    }
});

// 🔧 מחלקת זיכרון משופרת
class AdvancedMemory {
    constructor() {
        this.conversations = new Map();
        this.maxAge = 4 * 60 * 60 * 1000; // 4 שעות
        setInterval(() => this.cleanup(), 60 * 60 * 1000); // ניקוי כל שעה
        log('INFO', '🧠 זיכרון מתקדם אותחל');
    }
    
    // יצירת מפתח ייחודי ללקוח
    createKey(phone, customer = null) {
        return customer ? `customer_${customer.id}_${phone}` : `unknown_${phone}`;
    }
    
    // קבלת שיחה
    getConversation(phone, customer = null) {
        const key = this.createKey(phone, customer);
        let conv = this.conversations.get(key);
        
        // אם לא נמצא ויש לקוח, חפש לפי כל המפתחות הקיימים של הטלפון
        if (!conv && customer) {
            for (const [existingKey, existingConv] of this.conversations.entries()) {
                if (existingKey.includes(phone) && existingConv.customer?.id === customer.id) {
                    conv = existingConv;
                    // העבר לכמפתח הנכון
                    this.conversations.delete(existingKey);
                    this.conversations.set(key, conv);
                    log('DEBUG', `🔄 העברתי conversation למפתח הנכון: ${key}`);
                    break;
                }
            }
        }
        
        return conv;
    }
    
    // יצירת או עדכון שיחה
    createOrUpdateConversation(phone, customer = null, initialStage = 'identifying') {
        const key = this.createKey(phone, customer);
        let conv = this.conversations.get(key);
        
        if (!conv) {
            conv = {
                phone: phone,
                customer: customer,
                stage: customer ? 'menu' : initialStage,
                messages: [],
                startTime: new Date(),
                lastActivity: new Date(),
                data: {} // נתונים נוספים לשיחה
            };
            this.conversations.set(key, conv);
            log('INFO', `➕ יצרתי conversation חדש: ${key} - שלב: ${conv.stage}`);
        } else {
            conv.lastActivity = new Date();
            if (customer && !conv.customer) {
                conv.customer = customer;
                conv.stage = 'menu';
                log('INFO', `🔄 עדכנתי לקוח בconversation: ${customer.name} - שלב: menu`);
            }
        }
        
        return conv;
    }
    
    // הוספת הודעה
    addMessage(phone, message, sender, customer = null) {
        const conv = this.createOrUpdateConversation(phone, customer);
        conv.messages.push({
            timestamp: new Date(),
            sender: sender,
            message: message
        });
        conv.lastActivity = new Date();
        log('DEBUG', `💬 הוספתי הודעה מ-${sender}: ${message.substring(0, 50)}`);
        return conv;
    }
    
    // עדכון שלב
    updateStage(phone, newStage, customer = null, data = {}) {
        const conv = this.getConversation(phone, customer);
        if (conv) {
            const oldStage = conv.stage;
            conv.stage = newStage;
            conv.lastActivity = new Date();
            // עדכון נתונים נוספים
            conv.data = { ...conv.data, ...data };
            log('INFO', `🔄 עדכון שלב: ${oldStage} → ${newStage} עבור ${customer ? customer.name : phone}`);
        } else {
            log('WARN', `⚠️ לא נמצא conversation לעדכון שלב עבור ${phone}`);
        }
        return conv;
    }
    
    // ניקוי זיכרון
    cleanup() {
        const now = new Date();
        const beforeCount = this.conversations.size;
        
        for (const [key, conv] of this.conversations.entries()) {
            if (now - conv.lastActivity > this.maxAge) {
                this.conversations.delete(key);
            }
        }
        
        const afterCount = this.conversations.size;
        if (beforeCount !== afterCount) {
            log('INFO', `🧹 ניקוי זיכרון: ${beforeCount - afterCount} שיחות נמחקו`);
        }
    }
    
    // סטטיסטיקות
    getStats() {
        return {
            total: this.conversations.size,
            withCustomers: Array.from(this.conversations.values()).filter(conv => conv.customer).length
        };
    }
}

const memory = new AdvancedMemory();

// זיהוי לקוח מתקדם - מהקוד המקורי שעובד
function findCustomerByPhone(phone) {
    const cleanPhone = phone.replace(/[^\d]/g, '');
    
    function isPhoneMatch(customerPhone, incomingPhone) {
        if (!customerPhone) return false;
        const cleanCustomerPhone = customerPhone.replace(/[^\d]/g, '');
        
        return cleanCustomerPhone === incomingPhone || 
               cleanCustomerPhone === incomingPhone.substring(3) || 
               ('972' + cleanCustomerPhone) === incomingPhone ||
               cleanCustomerPhone === ('0' + incomingPhone.substring(3)) ||
               ('0' + cleanCustomerPhone.substring(3)) === incomingPhone ||
               cleanCustomerPhone.substring(1) === incomingPhone.substring(3) ||
               ('972' + cleanCustomerPhone.substring(1)) === incomingPhone;
    }
    
    let customer = customers.find(c => {
        return isPhoneMatch(c.phone, cleanPhone) ||
               isPhoneMatch(c.phone1, cleanPhone) ||
               isPhoneMatch(c.phone2, cleanPhone) ||
               isPhoneMatch(c.phone3, cleanPhone) ||
               isPhoneMatch(c.phone4, cleanPhone);
    });
    
    if (customer) {
        log('INFO', `✅ לקוח מזוהה לפי טלפון: ${customer.name} מ${customer.site}`);
        return customer;
    }
    
    log('INFO', `⚠️ לקוח לא מזוהה לפי טלפון: ${phone}`);
    return null;
}

// זיהוי לקוח לפי שם חניון - מהקוד המקורי שעובד
function findCustomerByName(message) {
    const msg = message.toLowerCase();
    
    log('DEBUG', `🔍 מחפש לקוח עבור: "${msg}"`);
    
    // רשימת מילות מפתח לניקוי
    const wordsToRemove = ['חניון', 'מרכז', 'קניון', 'מגדל', 'בית', 'פארק', 'סנטר', 'מול'];
    
    // ניקוי הטקסט
    let cleanMsg = msg;
    wordsToRemove.forEach(word => {
        cleanMsg = cleanMsg.replace(new RegExp(`\\b${word}\\b`, 'g'), '').trim();
    });
    
    log('DEBUG', `🧹 טקסט נקי: "${cleanMsg}"`);
    
    // חיפוש מדויק לפי שם חניון - עדיפות גבוהה
    let bestMatch = null;
    let bestScore = 0;
    
    customers.forEach(customer => {
        if (!customer.site) return;
        
        const siteName = customer.site.toLowerCase();
        
        // בדיקה מדויקת - רק אם המילה קיימת במלואה
        const siteWords = siteName.split(/\s+/).filter(word => word.length > 2);
        const msgWords = cleanMsg.split(/\s+/).filter(word => word.length > 2);
        
        let score = 0;
        
        // בדיקת התאמה מדויקת
        siteWords.forEach(siteWord => {
            msgWords.forEach(msgWord => {
                // התאמה מלאה
                if (siteWord === msgWord) {
                    score += 10;
                    log('DEBUG', `✅ התאמה מלאה: ${siteWord} = ${msgWord} (+10)`);
                }
                // התאמה חלקית (לפחות 3 תווים)
                else if (siteWord.length >= 3 && msgWord.length >= 3) {
                    if (siteWord.includes(msgWord) || msgWord.includes(siteWord)) {
                        score += 5;
                        log('DEBUG', `✅ התאמה חלקית: ${siteWord} ~ ${msgWord} (+5)`);
                    }
                }
            });
        });
        
        // מקרים מיוחדים - התאמות ידועות
        const specialMatches = {
            'אינפיניטי': ['אינפיניטי', 'infinity'],
            'עזריאלי': ['עזריאלי', 'azrieli'],
            'גבעתיים': ['גבעתיים', 'givatayim'],
            'אלקטרה': ['אלקטרה', 'electra'],
            'מודיעין': ['מודיעין', 'modiin'],
            'אושילנד': ['אושילנד', 'oshiland'],
            'ביג': ['ביג', 'big'],
            'פנורמה': ['פנורמה', 'panorama']
        };
        
        // בדיקת התאמות מיוחדות
        Object.entries(specialMatches).forEach(([key, variations]) => {
            variations.forEach(variation => {
                if (siteName.includes(variation) && cleanMsg.includes(variation)) {
                    score += 15;
                    log('DEBUG', `🎯 התאמה מיוחדת: ${variation} (+15)`);
                }
            });
        });
        
        // הדפסת ציון רק אם יש התאמה
        if (score > 0) {
            log('DEBUG', `📊 ציון ללקוח ${customer.name} (${siteName}): ${score}`);
        }
        
        if (score > bestScore && score >= 5) {
            bestScore = score;
            bestMatch = customer;
        }
    });
    
    if (bestMatch) {
        log('INFO', `🏆 נמצא לקוח: ${bestMatch.name} מ${bestMatch.site} (ציון: ${bestScore})`);
        
        // קביעת רמת ביטחון
        let confidence = 'low';
        if (bestScore >= 15) confidence = 'high';
        else if (bestScore >= 10) confidence = 'medium';
        
        return { 
            customer: bestMatch, 
            confidence: confidence,
            method: `זוהה לפי שם החניון: ${bestMatch.site} (ציון: ${bestScore})`
        };
    }
    
    // חיפוש לפי שם לקוח
    const nameMatch = customers.find(c => 
        c.name && cleanMsg.includes(c.name.toLowerCase())
    );
    if (nameMatch) {
        log('INFO', `👤 נמצא לקוח לפי שם: ${nameMatch.name}`);
        return { 
            customer: nameMatch, 
            confidence: 'high',
            method: `זוהה לפי שם הלקוח: ${nameMatch.name}`
        };
    }
    
    // חיפוש לפי מספר לקוח
    const idMatch = msg.match(/\b\d{2,4}\b/);
    if (idMatch) {
        const customerId = parseInt(idMatch[0]);
        const customerById = customers.find(c => c.id === customerId);
        if (customerById) {
            log('INFO', `🔢 נמצא לקוח לפי מספר: ${customerId}`);
            return { 
                customer: customerById, 
                confidence: 'high',
                method: `זוהה לפי מספר לקוח: ${customerId}`
            };
        }
    }
    
    log('WARN', 'לא נמצא לקוח מתאים');
    return null;
}

// פתרון תקלות
async function findSolution(problemDescription, customer) {
    try {
        log('INFO', '🔍 מחפש פתרון במסד תקלות...');
        
        if (!serviceFailureDB || !Array.isArray(serviceFailureDB) || serviceFailureDB.length === 0) {
            log('ERROR', '❌ מסד התקלות ריק');
            return {
                found: false,
                response: '🔧 **בעיה במאגר התקלות**\n\n📧 שלחתי מייל לטכנאי\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף:** 039792365'
            };
        }
        
        const problem = problemDescription.toLowerCase();
        
        for (const scenario of serviceFailureDB) {
            if (!scenario.תרחיש || !scenario.שלבים) continue;
            
            const scenarioText = scenario.תרחיש.toLowerCase();
            const scenarioWords = scenarioText.split(' ').filter(word => word.length > 2);
            const problemWords = problem.split(' ').filter(word => word.length > 2);
            
            let matchCount = 0;
            scenarioWords.forEach(scenarioWord => {
                problemWords.forEach(problemWord => {
                    if (scenarioWord.includes(problemWord) || problemWord.includes(scenarioWord)) {
                        matchCount++;
                    }
                });
            });
            
            if (matchCount > 0 || scenarioText.includes(problem.substring(0, 8))) {
                let solution = `🔧 **פתרון לתקלה: ${scenario.תרחיש}**\n\n📋 **שלבי הפתרון:**\n${scenario.שלבים}`;
                
                if (scenario.הערות) {
                    solution += `\n\n💡 **הערות חשובות:**\n${scenario.הערות}`;
                }
                
                solution += `\n\n❓ **האם הפתרון עזר?** (כן/לא)`;
                
                log('INFO', `✅ נמצא פתרון: ${scenario.תרחיש} (התאמות: ${matchCount})`);
                return { found: true, response: solution, scenario: scenario };
            }
        }
        
        log('INFO', '⚠️ לא נמצא פתרון במסד');
        return {
            found: false,
            response: '🔧 **לא נמצא פתרון מיידי**\n\n📧 שלחתי מייל לטכנאי\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף:** 039792365'
        };
        
    } catch (error) {
        log('ERROR', '❌ שגיאה בחיפוש פתרון:', error.message);
        return {
            found: false,
            response: '🔧 **בעיה זמנית במערכת**\n\n📧 שלחתי מייל לטכנאי\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף:** 039792365'
        };
    }
}

// 🔧 לוגיקת תגובות מרכזית ומשופרת
class ResponseHandler {
    constructor(memory, customers) {
        this.memory = memory;
        this.customers = customers;
    }
    
    async generateResponse(message, phone, customer = null, hasFile = false, fileType = '', downloadedFiles = []) {
        const msg = message.toLowerCase().trim();
        const conversation = this.memory.getConversation(phone, customer);
        
        log('INFO', `🎯 מעבד הודעה מ-${customer ? customer.name : 'לא מזוהה'} - שלב: ${conversation ? conversation.stage : 'אין'}`);
        
        // שלב 1: זיהוי לקוח אם לא קיים
        if (!customer) {
            return await this.handleCustomerIdentification(message, phone, conversation);
        }
        
        // שלב 2: טיפול לפי שלב נוכחי
        return await this.handleByStage(message, phone, customer, conversation, hasFile, fileType, downloadedFiles);
    }
    
    async handleCustomerIdentification(message, phone, conversation) {
        // נסיון זיהוי לפי שם חניון
        const identification = findCustomerByName(message);
        
        if (identification) {
            if (identification.confidence === 'high') {
                const customer = identification.customer;
                this.memory.createOrUpdateConversation(phone, customer, 'menu');
                return {
                    response: `שלום ${customer.name} מחניון ${customer.site} 👋\n\nזיהיתי אותך!\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`,
                    stage: 'menu',
                    customer: customer
                };
            } else {
                return {
                    response: `שלום! 👋\n\nהאם אתה ${identification.customer.name} מחניון ${identification.customer.site}?\n\n✅ כתוב "כן" לאישור\n❌ או כתוב שם החניון הנכון\n\n📞 039792365`,
                    stage: 'confirming_identity',
                    tentativeCustomer: identification.customer
                };
            }
        }
        
        // אישור זהות
        if (conversation?.stage === 'confirming_identity' && conversation.data?.tentativeCustomer) {
            if (msg.includes('כן') || msg.includes('נכון') || msg.includes('תקין')) {
                const customer = conversation.data.tentativeCustomer;
                this.memory.updateStage(phone, 'menu', customer);
                return {
                    response: `מעולה! שלום ${customer.name} מחניון ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`,
                    stage: 'menu',
                    customer: customer
                };
            } else {
                this.memory.updateStage(phone, 'identifying');
                return {
                    response: `בסדר, אנא כתוב את שם החניון הנכון:\n\nלדוגמה: "אינפיניטי" או "עזריאלי גבעתיים"\n\n📞 039792365`,
                    stage: 'identifying'
                };
            }
        }
        
        // בקשת זיהוי ראשונה
        return {
            response: `שלום! 👋\n\nכדי לטפל בפנייתך אני צריכה:\n\n🏢 **שם החניון שלך**\n\nלדוגמה: "אינפיניטי" או "עזריאלי תל אביב"\n\n📞 039792365`,
            stage: 'identifying'
        };
    }
    
    async handleByStage(message, phone, customer, conversation, hasFile, fileType, downloadedFiles) {
        const msg = message.toLowerCase().trim();
        const currentStage = conversation ? conversation.stage : 'menu';
        
        // תפריט ראשי
        if (currentStage === 'menu' || !currentStage) {
            if (msg === '1' || msg.includes('תקלה')) {
                this.memory.updateStage(phone, 'problem_description', customer);
                return {
                    response: `שלום ${customer.name} 👋\n\n🔧 **תיאור התקלה:**\n\nאנא כתוב תיאור קצר של התקלה\n\n📷 **אפשר לצרף:** תמונה או סרטון\n\nדוגמאות:\n• "היחידה לא דולקת"\n• "מחסום לא עולה"\n• "לא מדפיס כרטיסים"\n\n📞 039792365`,
                    stage: 'problem_description',
                    customer: customer
                };
            }
            
            if (msg === '2' || msg.includes('נזק')) {
                this.memory.updateStage(phone, 'damage_photo', customer);
                return {
                    response: `שלום ${customer.name} 👋\n\n📷 **דיווח נזק:**\n\nאנא צלם את הנזק ושלח תמונה/סרטון + מספר היחידה\n\nדוגמה: תמונה + "יחידה 101"\n\n📞 039792365`,
                    stage: 'damage_photo',
                    customer: customer
                };
            }
            
            if (msg === '3' || msg.includes('מחיר')) {
                this.memory.updateStage(phone, 'order_request', customer);
                return {
                    response: `שלום ${customer.name} 👋\n\n💰 **הצעת מחיר / הזמנה**\n\nמה אתה מבקש להזמין?\n\n📷 **אפשר לצרף:** תמונה או סרטון\n\nדוגמאות:\n• "20,000 כרטיסים"\n• "3 גלילים נייר"\n• "זרוע חלופית"\n\n📞 039792365`,
                    stage: 'order_request',
                    customer: customer
                };
            }
            
            if (msg === '4' || msg.includes('הדרכה')) {
                this.memory.updateStage(phone, 'training_request', customer);
                return {
                    response: `שלום ${customer.name} 👋\n\n📚 **הדרכה**\n\nבאיזה נושא אתה זקוק להדרכה?\n\n📷 **אפשר לצרף:** תמונה או סרטון\n\nדוגמאות:\n• "הפעלת המערכת"\n• "החלפת נייר"\n• "טיפול בתקלות"\n\n📞 039792365`,
                    stage: 'training_request',
                    customer: customer
                };
            }
            
            // אם לא הבין - חזור לתפריט
            this.memory.updateStage(phone, 'menu', customer);
            return {
                response: `שלום ${customer.name} מחניון ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`,
                stage: 'menu',
                customer: customer
            };
        }
        
        // טיפול בתקלות
        if (currentStage === 'problem_description') {
            return await this.handleProblemDescription(message, phone, customer, hasFile, downloadedFiles);
        }
        
        // טיפול בנזק
        if (currentStage === 'damage_photo') {
            return await this.handleDamageReport(message, phone, customer, hasFile, fileType, downloadedFiles);
        }
        
        // טיפול בהזמנות
        if (currentStage === 'order_request') {
            return await this.handleOrderRequest(message, phone, customer, hasFile, downloadedFiles);
        }
        
        // טיפול בהדרכה
        if (currentStage === 'training_request') {
            return await this.handleTrainingRequest(message, phone, customer, hasFile, downloadedFiles);
        }
        
        // משוב על פתרון
        if (currentStage === 'waiting_feedback') {
            return await this.handleFeedback(message, phone, customer, conversation);
        }
        
        // ברירת מחדל - חזור לתפריט
        this.memory.updateStage(phone, 'menu', customer);
        return {
            response: `לא הבנתי את הבקשה.\n\nחזרה לתפריט הראשי:\n\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`,
            stage: 'menu',
            customer: customer
        };
    }
    
    async handleProblemDescription(message, phone, customer, hasFile, downloadedFiles) {
        const serviceNumber = getNextServiceNumber();
        
        // שמירת פרטי התקלה בזיכרון
        this.memory.updateStage(phone, 'processing_problem', customer, {
            serviceNumber: serviceNumber,
            problemDescription: message,
            attachments: downloadedFiles
        });
        
        // חיפוש פתרון
        const solution = await findSolution(message, customer);
        
        if (solution.found) {
            // נמצא פתרון - המתן למשוב
            this.memory.updateStage(phone, 'waiting_feedback', customer, {
                serviceNumber: serviceNumber,
                problemDescription: message,
                solution: solution.response,
                attachments: downloadedFiles
            });
            
            return {
                response: `📋 **קיבלתי את התיאור**\n\n"${message}"\n\n${solution.response}\n\n🆔 מספר קריאה: ${serviceNumber}`,
                stage: 'waiting_feedback',
                customer: customer,
                serviceNumber: serviceNumber
            };
        } else {
            // לא נמצא פתרון - שלח טכנאי
            this.memory.updateStage(phone, 'completed', customer);
            
            return {
                response: `📋 **קיבלתי את התיאור**\n\n"${message}"\n\n${solution.response}\n\n🆔 מספר קריאה: ${serviceNumber}`,
                stage: 'completed',
                customer: customer,
                serviceNumber: serviceNumber,
                sendTechnicianEmail: true,
                problemDescription: message,
                attachments: downloadedFiles
            };
        }
    }
    
    async handleDamageReport(message, phone, customer, hasFile, fileType, downloadedFiles) {
        if (!hasFile) {
            return {
                response: `📷 **דיווח נזק - חסרה תמונה**\n\nאנא שלח תמונה של הנזק עם מספר היחידה\n\nדוגמה: תמונה + "יחידה 101"\n\n📞 039792365`,
                stage: 'damage_photo',
                customer: customer
            };
        }
        
        // חיפוש מספר יחידה
        const unitMatch = message.match(/(\d{2,3})|יחידה\s*(\d{1,3})/);
        if (!unitMatch) {
            return {
                response: `📷 **אנא כתוב מספר היחידה עם התמונה**\n\nדוגמה: "יחידה 101" או סט "202"\n\n📞 039792365`,
                stage: 'damage_photo',
                customer: customer
            };
        }
        
        const unit = unitMatch[1] || unitMatch[2];
        const serviceNumber = getNextServiceNumber();
        
        this.memory.updateStage(phone, 'completed', customer);
        
        return {
            response: `שלום ${customer.name} 👋\n\nיחידה ${unit} - קיבלתי את ה${fileType}!\n\n🔍 מעביר לטכנאי\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
            stage: 'completed',
            customer: customer,
            serviceNumber: serviceNumber,
            sendTechnicianEmail: true,
            problemDescription: `נזק ביחידה ${unit} - ${message}`,
            attachments: downloadedFiles
        };
    }
    
    async handleOrderRequest(message, phone, customer, hasFile, downloadedFiles) {
        const serviceNumber = getNextServiceNumber();
        
        this.memory.updateStage(phone, 'completed', customer);
        
        return {
            response: `📋 **קיבלתי את בקשת ההזמנה!**\n\n"${message}"\n\n📧 אשלח הצעת מחיר מפורטת למייל\n⏰ תוך 24 שעות\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
            stage: 'completed',
            customer: customer,
            serviceNumber: serviceNumber,
            sendOrderEmail: true,
            orderDetails: message,
            attachments: downloadedFiles
        };
    }
    
    async handleTrainingRequest(message, phone, customer, hasFile, downloadedFiles) {
        const serviceNumber = getNextServiceNumber();
        
        this.memory.updateStage(phone, 'completed', customer);
        
        return {
            response: `📚 **קיבלתי את בקשת ההדרכה!**\n\n"${message}"\n\n📧 אשלח חומר הדרכה מפורט למייל\n⏰ תוך 24 שעות\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
            stage: 'completed',
            customer: customer,
            serviceNumber: serviceNumber,
            sendTrainingEmail: true,
            trainingRequest: message,
            attachments: downloadedFiles
        };
    }
    
    async handleFeedback(message, phone, customer, conversation) {
        const msg = message.toLowerCase().trim();
        const data = conversation.data;
        
        if (msg.includes('כן') || msg.includes('נפתר') || msg.includes('תודה') || (msg.includes('עזר') && !msg.includes('לא עזר'))) {
            this.memory.updateStage(phone, 'completed', customer);
            
            return {
                response: `🎉 **מעולה! הבעיה נפתרה!**\n\nשמח לשמוע שהפתרון עזר!\n\nיום טוב! 😊\n\n📞 039792365`,
                stage: 'completed',
                customer: customer,
                sendSummaryEmail: true,
                serviceNumber: data.serviceNumber,
                problemDescription: data.problemDescription,
                solution: data.solution,
                resolved: true
            };
        } else if (msg.includes('לא') || msg.includes('לא עזר') || msg.includes('לא עובד')) {
            this.memory.updateStage(phone, 'completed', customer);
            
            return {
                response: `🔧 **מבין שהפתרון לא עזר**\n\n📋 מעבירה את הפניה לטכנאי מומחה\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n📞 039792365\n\n🆔 מספר קריאה: ${data.serviceNumber}`,
                stage: 'completed',
                customer: customer,
                sendTechnicianEmail: true,
                serviceNumber: data.serviceNumber,
                problemDescription: data.problemDescription,
                solution: data.solution,
                resolved: false,
                attachments: data.attachments
            };
        } else {
            return {
                response: `❓ **האם הפתרון עזר?**\n\n✅ כתוב "כן" אם הבעיה נפתרה\n❌ כתוב "לא" אם עדיין יש בעיה\n\n📞 039792365`,
                stage: 'waiting_feedback',
                customer: customer
            };
        }
    }
}

const responseHandler = new ResponseHandler(memory, customers);

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
        log('INFO', `✅ WhatsApp נשלח: ${response.data ? 'הצלחה' : 'כשל'}`);
        return response.data;
    } catch (error) {
        log('ERROR', '❌ שגיאת WhatsApp:', error.message);
        throw error;
    }
}

// שליחת מייל משופרת
async function sendEmail(customer, type, details, extraData = {}) {
    try {
        const serviceNumber = extraData.serviceNumber || getNextServiceNumber();
        
        // רשימת טלפונים
        const phoneList = [customer.phone, customer.phone1, customer.phone2, customer.phone3, customer.phone4]
            .filter(phone => phone && phone.trim() !== '')
            .map((phone, index) => {
                const label = index === 0 ? 'טלפון ראשי' : `טלפון ${index}`;
                return `<p><strong>${label}:</strong> ${phone}</p>`;
            })
            .join('');
        
        let subject, emailType, bgColor;
        if (type === 'technician') {
            subject = `🚨 קריאת טכנאי ${serviceNumber} - ${customer.name} (${customer.site})`;
            emailType = '🚨 קריאת טכנאי דחופה';
            bgColor = '#dc3545, #c82333';
        } else if (type === 'order') {
            subject = `💰 בקשת הצעת מחיר ${serviceNumber} - ${customer.name}`;
            emailType = '💰 בקשת הצעת מחיר';
            bgColor = '#ffc107, #e0a800';
        } else if (type === 'training') {
            subject = `📚 בקשת הדרכה ${serviceNumber} - ${customer.name}`;
            emailType = '📚 בקשת הדרכה';
            bgColor = '#17a2b8, #138496';
        } else {
            subject = `📋 סיכום קריאת שירות ${serviceNumber} - ${customer.name}`;
            emailType = '📋 סיכום קריאת שירות';
            bgColor = '#28a745, #20c997';
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
        if (extraData.trainingRequest) {
            conversationSummary += `<p><strong>נושא ההדרכה:</strong> ${extraData.trainingRequest}</p>`;
        }
        if (extraData.resolved !== undefined) {
            const status = extraData.resolved ? '✅ נפתר בהצלחה' : '❌ לא נפתר - נשלח טכנאי';
            conversationSummary += `<p><strong>סטטוס:</strong> <span style="color: ${extraData.resolved ? 'green' : 'red'};">${status}</span></p>`;
        }
        if (extraData.attachments && extraData.attachments.length > 0) {
            conversationSummary += `<p><strong>📎 קבצים מצורפים:</strong> ${extraData.attachments.length} קבצים</p>`;
        }

        const html = `
            <div dir="rtl" style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
                <div style="max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                    
                    <div style="background: linear-gradient(45deg, ${bgColor}); color: white; padding: 20px; border-radius: 10px; margin-bottom: 30px; text-align: center;">
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
                        <p><strong>סוג טיפול:</strong> ${type === 'technician' ? 'קריאת טכנאי' : type === 'order' ? 'בקשת הצעת מחיר' : type === 'training' ? 'בקשת הדרכה' : 'פתרון טלפוני'}</p>
                    </div>
                    
                    ${conversationSummary ? `
                    <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 2px solid #e9ecef;">
                        <h2 style="color: #2c3e50; margin-top: 0;">💬 סיכום השיחה</h2>
                        ${conversationSummary}
                    </div>
                    ` : ''}
                    
                    <div style="background: #17a2b8; color: white; padding: 15px; border-radius: 10px; text-align: center;">
                        <p style="margin: 0;"><strong>📞 039792365 | 📧 Service@sbcloud.co.il</strong></p>
                    </div>
                </div>
            </div>
        `;
        
        const mailOptions = {
            from: 'Report@sbparking.co.il',
            to: 'Dror@sbparking.co.il',
            subject: subject,
            html: html
        };
        
        if (extraData.attachments && extraData.attachments.length > 0) {
            mailOptions.attachments = extraData.attachments.map(filePath => {
                const fileName = path.basename(filePath);
                return {
                    filename: fileName,
                    path: filePath,
                    contentType: fileName.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'
                };
            });
            log('INFO', `📎 מצרף ${extraData.attachments.length} קבצים למייל`);
        }
        
        await transporter.sendMail(mailOptions);
        log('INFO', `📧 מייל נשלח: ${type} - ${customer.name} - ${serviceNumber}${extraData.attachments ? ` עם ${extraData.attachments.length} קבצים` : ''}`);
        
    } catch (error) {
        log('ERROR', '❌ שגיאת מייל:', error.message);
    }
}

// קביעת סוג קובץ
function getFileExtension(fileName, mimeType) {
    if (fileName && fileName.includes('.')) {
        return fileName.substring(fileName.lastIndexOf('.'));
    }
    
    if (mimeType) {
        if (mimeType.startsWith('image/')) {
            if (mimeType.includes('jpeg')) return '.jpg';
            if (mimeType.includes('png')) return '.png';
            if (mimeType.includes('gif')) return '.gif';
            return '.jpg';
        } else if (mimeType.startsWith('video/')) {
            if (mimeType.includes('mp4')) return '.mp4';
            if (mimeType.includes('avi')) return '.avi';
            if (mimeType.includes('quicktime')) return '.mov';
            return '.mp4';
        }
    }
    
    return '.file';
}

// עמוד בית
app.get('/', (req, res) => {
    const stats = memory.getStats();
    res.send(`
        <div dir="rtl" style="font-family: Arial; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <div style="max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 15px;">
                <h1 style="color: #2c3e50; text-align: center;">🚗 שיידט את בכמן - גרסה מעולה</h1>
                <div style="background: #e8f5e8; padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>👩‍💼 הדר - נציגת שירות לקוחות מתקדמת</h3>
                    <ul>
                        <li>🔧 תקלות ופתרונות AI מתקדמים</li>
                        <li>📋 דיווח נזקים עם תמונות וסרטונים</li>
                        <li>💰 הצעות מחיר מהירות</li>
                        <li>📚 הדרכות מותאמות אישית</li>
                        <li>🧠 זיכרון חכם וקבוע (4 שעות)</li>
                        <li>🎯 זיהוי לקוח מדויק</li>
                        <li>📊 ניהול שלבים מושלם</li>
                    </ul>
                    <p><strong>📞 039792365 | 📧 Service@sbcloud.co.il</strong></p>
                </div>
                <div style="text-align: center; background: #f8f9fa; padding: 20px; border-radius: 10px;">
                    <p><strong>📲 WhatsApp:</strong> 972546284210</p>
                    <p><strong>👥 לקוחות רשומים:</strong> ${customers.length}</p>
                    <p><strong>💬 שיחות פעילות:</strong> ${stats.total}</p>
                    <p><strong>👤 שיחות עם לקוחות:</strong> ${stats.withCustomers}</p>
                    <p><strong>📋 מסד תקלות:</strong> ${serviceFailureDB.length} תרחישים</p>
                    <p><strong>🔢 מספר קריאה הבא:</strong> HSC-${globalServiceCounter + 1}</p>
                    <p><strong>⏰ זמן שרת:</strong> ${getIsraeliTime()}</p>
                    <p style="color: green; font-weight: bold;">✅ מערכת מושלמת מוכנה לפעולה!</p>
                </div>
            </div>
        </div>
    `);
});

// WhatsApp Webhook מעולה
app.post('/webhook/whatsapp', async (req, res) => {
    try {
        if (req.body.typeWebhook !== 'incomingMessageReceived') {
            return res.status(200).json({ status: 'OK - not a message' });
        }
        
        const messageData = req.body.messageData;
        const senderData = req.body.senderData;
        
        const phone = senderData.sender.replace('@c.us', '');
        const customerName = senderData.senderName || 'לקוח';
        let messageText = '';
        let hasFile = false;
        let fileType = '';
        let downloadedFiles = [];
        
        // עיבוד טקסט
        if (messageData.textMessageData) {
            messageText = messageData.textMessageData.textMessage;
        } else if (messageData.fileMessageData) {
            hasFile = true;
            messageText = messageData.fileMessageData.caption || 'שלח קובץ';
            
            const fileName = messageData.fileMessageData.fileName || '';
            const mimeType = messageData.fileMessageData.mimeType || '';
            
            if (mimeType.startsWith('image/') || fileName.match(/\.(jpg|jpeg|png|gif|bmp)$/i)) {
                fileType = 'תמונה';
            } else if (mimeType.startsWith('video/') || fileName.match(/\.(mp4|avi|mov|wmv|3gp)$/i)) {
                fileType = 'סרטון';
            } else {
                fileType = 'קובץ';
            }
            
            log('INFO', `📁 ${fileType}: ${fileName}`);
        }
        
        log('INFO', `📞 הודעה מ-${phone} (${customerName}): ${messageText}`);
        
        // זיהוי לקוח
        let customer = findCustomerByPhone(phone);
        
        // הורדת קבצים אם יש
        if (hasFile && messageData.fileMessageData && messageData.fileMessageData.downloadUrl) {
            const timestamp = Date.now();
            const fileExtension = getFileExtension(messageData.fileMessageData.fileName || '', messageData.fileMessageData.mimeType || '');
            const fileName = `file_${customer ? customer.id : 'unknown'}_${timestamp}${fileExtension}`;
            
            const filePath = await downloadWhatsAppFile(messageData.fileMessageData.downloadUrl, fileName);
            if (filePath) {
                downloadedFiles.push(filePath);
                log('INFO', `✅ ${fileType} הורד: ${fileName}`);
            }
        }
        
        // הוספה לזיכרון
        memory.addMessage(phone, messageText, 'customer', customer);
        
        // יצירת תגובה
        const result = await responseHandler.generateResponse(
            messageText, 
            phone, 
            customer, 
            hasFile, 
            fileType, 
            downloadedFiles
        );
        
        // שליחת תגובה
        await sendWhatsApp(phone, result.response);
        memory.addMessage(phone, result.response, 'hadar', result.customer);
        
        log('INFO', `📤 תגובה נשלחה ללקוח ${result.customer ? result.customer.name : 'לא מזוהה'}: ${result.stage}`);
        
        // שליחת מיילים לפי הצורך
        if (result.sendTechnicianEmail) {
            log('INFO', `📧 שולח מייל טכנאי ללקוח ${result.customer.name}`);
            await sendEmail(result.customer, 'technician', messageText, {
                serviceNumber: result.serviceNumber,
                problemDescription: result.problemDescription,
                solution: result.solution,
                resolved: result.resolved,
                attachments: result.attachments
            });
        } else if (result.sendSummaryEmail) {
            log('INFO', `📧 שולח מייל סיכום ללקוח ${result.customer.name}`);
            await sendEmail(result.customer, 'summary', 'בעיה נפתרה בהצלחה', {
                serviceNumber: result.serviceNumber,
                problemDescription: result.problemDescription,
                solution: result.solution,
                resolved: result.resolved
            });
        } else if (result.sendOrderEmail) {
            log('INFO', `📧 שולח מייל הזמנה ללקוח ${result.customer.name}`);
            await sendEmail(result.customer, 'order', result.orderDetails, {
                serviceNumber: result.serviceNumber,
                orderDetails: result.orderDetails,
                attachments: result.attachments
            });
        } else if (result.sendTrainingEmail) {
            log('INFO', `📧 שולח מייל הדרכה ללקוח ${result.customer.name}`);
            await sendEmail(result.customer, 'training', result.trainingRequest, {
                serviceNumber: result.serviceNumber,
                trainingRequest: result.trainingRequest,
                attachments: result.attachments
            });
        }
        
        res.status(200).json({ status: 'OK' });
        
    } catch (error) {
        log('ERROR', '❌ שגיאה כללית:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// הפעלת שרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    log('INFO', `🚀 השרת פועל על פורט: ${PORT}`);
    log('INFO', `🕐 שעה נוכחית (ישראל): ${getIsraeliTime()}`);
    log('INFO', '📲 WhatsApp: 972546284210');
    log('INFO', `👥 לקוחות: ${customers.length}`);
    log('INFO', '🧠 זיכרון מתקדם: 4 שעות');
    log('INFO', `📋 מסד תקלות: ${serviceFailureDB.length} תרחישים`);
    log('INFO', `🔢 מספרי קריאה: HSC-${globalServiceCounter + 1}+`);
    log('INFO', '📧 מיילים: סיכום מלא בכל קריאה');
    log('INFO', '🎯 זיהוי לקוח: מדויק ומהיר');
    log('INFO', '📊 ניהול שלבים: מושלם');
    log('INFO', '✅ מערכת מעולה מוכנה!');
});

module.exports = app;
