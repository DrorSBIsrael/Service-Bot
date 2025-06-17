require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

// הוספת מנגנון דיבוג מתקדם
const DEBUG_LEVEL = process.env.DEBUG_LEVEL || 'INFO'; // DEBUG, INFO, WARN, ERROR
const debugLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

function log(level, message, data = null) {
    if (debugLevels[level] >= debugLevels[DEBUG_LEVEL]) {
        const timestamp = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
        console.log(`${timestamp} [${level}] ${message}`);
        if (data && level === 'DEBUG') console.log(data);
    }
}

// const { OpenAI } = require('openai');
// const openai = new OpenAI({
//     apiKey: process.env.OPENAI_API_KEY,
// });

// מספר תקלה גלובלי עם נומרטור מתקדם
let globalServiceCounter = 10001;

function getNextServiceNumber() {
    return `HSC-${++globalServiceCounter}`;
}

// פונקציה להורדת תמונות מוואטסאפ
async function downloadWhatsAppFile(fileUrl, fileName) {
    try {
        log('INFO', `📥 מוריד קובץ מוואטסאפ: ${fileName}`);
        
        const response = await axios({
            method: 'GET',
            url: fileUrl,
            responseType: 'stream'
        });
        
        // יצירת תיקיית uploads אם לא קיימת
        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        // שמירת הקובץ
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
    log('INFO', `📊 נטענו ${customers.length} לקוחות`);
} catch (error) {
    log('ERROR', '❌ שגיאה בטעינת לקוחות:', error.message);
    customers = [{ id: 555, name: "דרור פרינץ", site: "חניון רימון", phone: "0545-484210", address: "רימון 8 רמת אפעל", email: "Dror@sbparking.co.il" }];
}

// טעינת מסד נתוני תקלות - תיקון מלא
let serviceFailureDB = [];

try {
    const fileContent = fs.readFileSync('./Service failure scenarios.json', 'utf8');
    serviceFailureDB = JSON.parse(fileContent);
    
    // וידוא שזה מערך
    if (!Array.isArray(serviceFailureDB)) {
        log('ERROR', '❌ קובץ התקלות אינו מערך');
        serviceFailureDB = [];
    }
    
    log('INFO', `📋 מסד תקלות נטען בהצלחה - ${serviceFailureDB.length} תרחישים`);
} catch (error) {
    log('ERROR', '❌ שגיאה בטעינת מסד תקלות:', error.message);
    log('INFO', '🔧 יוצר קובץ תקלות דוגמה...');
    
    // יצירת קובץ דוגמה אם לא קיים
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
    
    try {
        fs.writeFileSync('./Service failure scenarios.json', JSON.stringify(serviceFailureDB, null, 2), 'utf8');
        log('INFO', '✅ קובץ תקלות דוגמה נוצר');
    } catch (writeError) {
        log('ERROR', '❌ שגיאה ביצירת קובץ דוגמה:', writeError.message);
    }
}

// טעינת מסדי הדרכה
let trainingDB = {};

try {
    if (fs.existsSync('./Parking operation 1.docx')) {
        trainingDB.parking = fs.readFileSync('./Parking operation 1.docx', 'utf8');
        log('INFO', '📚 מדריך חניונים נטען');
    }
    if (fs.existsSync('./Scheidt system operation.pdf')) {
        trainingDB.scheidt = fs.readFileSync('./Scheidt system operation.pdf', 'utf8');
        log('INFO', '📚 מדריך שיידט נטען');
    }
    if (fs.existsSync('./דוגמאות נוספות.txt')) {
        trainingDB.examples = fs.readFileSync('./דוגמאות נוספות.txt', 'utf8');
        log('INFO', '📚 דוגמאות נטענו');
    }
    
    const loadedFiles = Object.keys(trainingDB).length;
    log('INFO', `📚 ${loadedFiles} מסדי הדרכה נטענו מתוך 3`);
} catch (error) {
    log('ERROR', '❌ שגיאה בטעינת הדרכות:', error.message);
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

// מערכת זיכרון
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
                customer, 
                messages: [], 
                startTime: new Date(), 
                lastActivity: new Date(), 
                stage: customer ? 'greeting' : 'identifying'  // 🔧 תיקון חשוב
            });
        }
        const conv = this.conversations.get(key);
        conv.messages.push({ timestamp: new Date(), sender, message });
        conv.lastActivity = new Date();
        return conv;
    }
    
    get(phone, customer = null) {
        const key = customer ? `${customer.id}_${phone}` : phone;
        const conv = this.conversations.get(key);
        
        // 🔧 תיקון: אם לא נמצא conversation ויש לקוח, צור אותו
        if (!conv && customer) {
            return this.add(phone, '', 'system', customer);
        }
        
        return conv;
    }
    
    updateStage(phone, stage, customer = null) {
        const key = customer ? `${customer.id}_${phone}` : phone;
        const conv = this.conversations.get(key);
        if (conv) {
            conv.stage = stage;
            log('DEBUG', `🔄 עדכון שלב: ${stage} עבור ${customer ? customer.name : phone}`);
        }
    }
    
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

// זיהוי לקוח מתקדם
function findCustomer(phone, message = '') {
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
        log('INFO', `✅ לקוח מזוהה: ${customer.name} מ${customer.site}`);
        return customer;
    }
    
    log('INFO', `⚠️ לקוח לא מזוהה: ${phone}`);
    return null;
}

function identifyCustomerInteractively(message) {
    const msg = message.toLowerCase().trim();
    
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

// פונקציה לחיפוש פתרון (ללא OpenAI - פשוטה ויעילה)
async function getAISolution(problemDescription, customer) {
    try {
        log('INFO', '🔍 מחפש פתרון במסד התקלות...');
        
        const problem = problemDescription.toLowerCase();
        let foundSolution = null;
        let foundScenario = null;
        
        // בדיקה שהמסד טעון
        if (!serviceFailureDB || !Array.isArray(serviceFailureDB) || serviceFailureDB.length === 0) {
            log('ERROR', '❌ מסד התקלות ריק או לא טעון');
            const serviceNumber = getNextServiceNumber();
            await sendEmail(customer, 'technician', problemDescription, {
                serviceNumber: serviceNumber,
                problemDescription: problemDescription,
                solution: 'בעיה במאגר התקלות - נשלח טכנאי',
                resolved: false
            });
            return {
                response: '🔧 **בעיה במאגר התקלות**\n\n📧 שלחתי מייל לשירות\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף בלבד:** 039792365',
                serviceNumber: serviceNumber,
                emailSent: true
            };
        }
        
        log('INFO', `📋 בודק ${serviceFailureDB.length} תרחישי תקלות...`);
        
        // חיפוש במאגר התקלות
        for (const scenario of serviceFailureDB) {
            if (!scenario.תרחיש || !scenario.שלבים) {
                log('INFO', '⚠️ תרחיש פגום - מדלג');
                continue;
            }
            
            const scenarioText = scenario.תרחיש.toLowerCase();
            log('INFO', `🔍 בודק תרחיש: ${scenario.תרחיש}`);
            
            // בדיקות התאמה מתקדמות
            const scenarioWords = scenarioText.split(' ').filter(word => word.length > 2);
            const problemWords = problem.split(' ').filter(word => word.length > 2);
            
            // בדיקת חפיפה במילות מפתח
            let matchCount = 0;
            scenarioWords.forEach(scenarioWord => {
                problemWords.forEach(problemWord => {
                    if (scenarioWord.includes(problemWord) || problemWord.includes(scenarioWord)) {
                        matchCount++;
                    }
                });
            });
            
            // אם יש התאמה טובה (לפחות מילה אחת)
            if (matchCount > 0 || 
                scenarioText.includes(problem.substring(0, 10)) || 
                problem.includes(scenarioText.substring(0, 10))) {
                
                foundSolution = `🔧 **פתרון לתקלה: ${scenario.תרחיש}**\n\n📋 **שלבי הפתרון:**\n${scenario.שלבים}`;
                
                if (scenario.הערות && scenario.הערות.trim() !== '') {
                    foundSolution += `\n\n💡 **הערות חשובות:**\n${scenario.הערות}`;
                }
                
                foundScenario = scenario;
                log('INFO', `✅ נמצא פתרון לתקלה: ${scenario.תרחיש} (התאמות: ${matchCount})`);
                break;
            }
        }
        
        // אם נמצא פתרון במאגר
        if (foundSolution && foundScenario) {
            log('INFO', '✅ נמצא פתרון במאגר התקלות');
            return {
                response: `${foundSolution}\n\n📧 **אם הפתרון לא עזר:** אעביר מייל לשירות\n\n❓ **האם הפתרון עזר?** (כן/לא)`,
                emailSent: false
            };
        }
        
        // אם לא נמצא פתרון - שלח מייל מיידי
        log('INFO', '⚠️ לא נמצא פתרון - שולח מייל מיידי');
        const serviceNumber = getNextServiceNumber();
        await sendEmail(customer, 'technician', problemDescription, {
            serviceNumber: serviceNumber,
            problemDescription: problemDescription,
            solution: 'לא נמצא פתרון במאגר - נשלח טכנאי',
            resolved: false
        });
        
        return {
            response: '🔧 **לא נמצא פתרון מיידי**\n\n📧 שלחתי מייל לשירות\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף בלבד:** 039792365',
            serviceNumber: serviceNumber,
            emailSent: true
        };
        
    } catch (error) {
        log('ERROR', '❌ שגיאה כללית בחיפוש פתרון:', error.message);
        const serviceNumber = getNextServiceNumber();
        await sendEmail(customer, 'technician', problemDescription, {
            serviceNumber: serviceNumber,
            problemDescription: problemDescription,
            solution: 'שגיאה במערכת - נשלח טכנאי',
            resolved: false
        });
        
        return {
            response: '🔧 **בעיה זמנית במערכת**\n\n📧 שלחתי מייל לשירות\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף בלבד:** 039792365',
            serviceNumber: serviceNumber,
            emailSent: true
        };
    }
}








// פונקציה משופרת ל-generateResponse - מחליפה את הישנה
function generateResponse(message, customer, context, phone) {
    const msg = message.toLowerCase();
    
    log('INFO', `🎯 generateResponse - לקוח: ${customer ? customer.name : 'לא מזוהה'}, שלב: ${context?.stage || 'אין'}`);
    
    // אם אין לקוח מזוהה, נסה זיהוי אינטראקטיבי
    if (!customer) {
        const identification = identifyCustomerInteractively(message);
        if (identification) {
            log('INFO', `🔍 ${identification.method} (רמת ביטחון: ${identification.confidence})`);
            
            if (identification.confidence === 'high') {
                // צור או עדכן זיכרון עם הלקוח החדש
                memory.add(phone, message, 'customer', identification.customer);
                memory.updateStage(phone, 'menu', identification.customer);
                
                return { 
                    response: `שלום ${identification.customer.name} מחניון ${identification.customer.site} 👋\n\nזיהיתי אותך!\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, 
                    stage: 'menu',
                    customer: identification.customer
                };
            } else {
                return { 
                    response: `שלום! 👋\n\nהאם אתה ${identification.customer.name} מחניון ${identification.customer.site}?\n\n✅ כתוב "כן" לאישור\n❌ או כתוב שם החניון הנכון\n\n📞 039792365`,
                    stage: 'confirming_identity',
                    tentativeCustomer: identification.customer
                };
            }
        }
        
        return { 
            response: `שלום! 👋\n\nכדי לטפל בפנייתך אני צריכה:\n\n🏢 **שם החניון שלך**\n\nלדוגמה: "אינפיניטי" או "עזריאלי תל אביב"\n\n📞 039792365`, 
            stage: 'identifying' 
        };
    }
    
    // אם יש לקוח מזוהה - בדוק שלב נוכחי
    if (customer) {
        // אישור זהות
        if (context?.stage === 'confirming_identity') {
            if (msg.includes('כן') || msg.includes('נכון') || msg.includes('תקין')) {
                memory.add(phone, message, 'customer', context.tentativeCustomer);
                memory.updateStage(phone, 'menu', context.tentativeCustomer);
                
                return { 
                    response: `מעולה! שלום ${context.tentativeCustomer.name} מחניון ${context.tentativeCustomer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, 
                    stage: 'menu',
                    customer: context.tentativeCustomer
                };
            } else {
                return { 
                    response: `בסדר, אנא כתוב את שם החניון הנכון:\n\nלדוגמה: "אינפיניטי" או "עזריאלי גבעתיים"\n\n📞 039792365`, 
                    stage: 'identifying' 
                };
            }
        }

        // תפריט ראשי - תקלה
        if ((msg === '1' || msg.includes('תקלה'))) {
            log('INFO', `✅ תקלה עם לקוח: ${customer.name}`);
            return { 
                response: `שלום ${customer.name} 👋\n\n🔧 **תיאור התקלה:**\n\nאנא כתוב תיאור קצר של התקלה\n\n📷 **אפשר לצרף:** תמונה או סרטון קצר\n\nדוגמאות:\n• "היחידה לא דולקת"\n• "מחסום לא עולה"\n• "לא מדפיס כרטיסים"\n\n📞 039792365`, 
                stage: 'problem_description',
                customer: customer
            };
        }

        // תפריט ראשי - נזק
        if ((msg === '2' || msg.includes('נזק'))) {
            log('INFO', `✅ נזק עם לקוח: ${customer.name}`);
            return { 
                response: `שלום ${customer.name} 👋\n\n📷 **דיווח נזק:**\n\nאנא צלם את הנזק ושלח תמונה/סרטון + מספר היחידה\n\nדוגמה: תמונה + "יחידה 101"\n\n📞 039792365`,
                stage: 'damage_photo',
                customer: customer
            };
        }

        // תפריט ראשי - הצעת מחיר  
        if ((msg === '3' || msg.includes('מחיר'))) {
            log('INFO', `✅ הצעת מחיר עם לקוח: ${customer.name}`);
            return { 
                response: `שלום ${customer.name} 👋\n\n💰 **הצעת מחיר / הזמנה**\n\nמה אתה מבקש להזמין?\n\n📷 **אפשר לצרף:** תמונה או סרטון של הפריט\n\nדוגמאות:\n• "20,000 כרטיסים"\n• "3 גלילים נייר"\n• "זרוע חלופית"\n\n📞 039792365`,
                stage: 'order_request',
                customer: customer
            };
        }

        // תפריט ראשי - הדרכה
        if ((msg === '4' || msg.includes('הדרכה'))) {
            log('INFO', `✅ הדרכה עם לקוח: ${customer.name}`);
            return { 
                response: `שלום ${customer.name} 👋\n\n📚 **הדרכה**\n\nבאיזה נושא אתה זקוק להדרכה?\n\n📷 **אפשר לצרף:** תמונה או סרטון של הבעיה\n\nדוגמאות:\n• "הפעלת המערכת"\n• "החלפת נייר"\n• "טיפול בתקלות"\n\n📞 039792365`,
                stage: 'training_request',
                customer: customer
            };
        }

// תפריט ראשי - נזק
if ((msg === '2' || msg.includes('נזק')) && customer) {
    log('INFO', `✅ נזק עם לקוח: ${customer.name}`);
    return { 
        response: `שלום ${customer.name} 👋\n\n📷 **דיווח נזק:**\n\nאנא צלם את הנזק ושלח תמונה/סרטון + מספר היחידה\n\nדוגמה: תמונה + "יחידה 101"\n\n📞 039792365`,
        stage: 'damage_photo',
        customer: customer
    };
}

// תפריט ראשי - הצעת מחיר  
if ((msg === '3' || msg.includes('מחיר')) && customer) {
    log('INFO', `✅ הצעת מחיר עם לקוח: ${customer.name}`);
    return { 
        response: `שלום ${customer.name} 👋\n\n💰 **הצעת מחיר / הזמנה**\n\nמה אתה מבקש להזמין?\n\n📷 **אפשר לצרף:** תמונה או סרטון של הפריט\n\nדוגמאות:\n• "20,000 כרטיסים"\n• "3 גלילים נייר"\n• "זרוע חלופית"\n\n📞 039792365`,
        stage: 'order_request',
        customer: customer
    };
}

// תפריט ראשי - הדרכה
if ((msg === '4' || msg.includes('הדרכה')) && customer) {
    log('INFO', `✅ הדרכה עם לקוח: ${customer.name}`);
    return { 
        response: `שלום ${customer.name} 👋\n\n📚 **הדרכה**\n\nבאיזה נושא אתה זקוק להדרכה?\n\n📷 **אפשר לצרף:** תמונה או סרטון של הבעיה\n\nדוגמאות:\n• "הפעלת המערכת"\n• "החלפת נייר"\n• "טיפול בתקלות"\n\n📞 039792365`,
        stage: 'training_request',
        customer: customer
    };
}

// עיבוד נזק
if (context?.stage === 'damage_photo' && customer) {
    // אם יש תמונה - זה יטופל בקטע הקבצים למעלה
    // אם אין תמונה - בקש תמונה
    return { 
        response: `📷 **דיווח נזק - חסרה תמונה**\n\nאנא שלח תמונה של הנזק עם מספר היחידה\n\nדוגמה: תמונה + "יחידה 101"\n\n📞 039792365`, 
        stage: 'damage_photo',
        customer: customer
    };
}

    // עיבוד הזמנה
    if (context?.stage === 'order_request' && customer) {
        return { 
            response: `📋 **קיבלתי את בקשת ההזמנה!**\n\n"${message}"\n\n📧 אשלח הצעת מחיר מפורטת למייל\n⏰ תוך 24 שעות\n\n📞 039792365`, 
            stage: 'order_completed',
            sendOrderEmail: true,
            orderDetails: message,
            customer: customer
        };
    }
    
    // עיבוד בקשת הדרכה
    if (context?.stage === 'training_request' && customer) {
        log('INFO', `🔍 מחפש הדרכה עבור: ${message}`);
        
        let trainingContent = '';
        const searchTerm = message.toLowerCase();
        
        if (trainingDB.examples && trainingDB.examples.toLowerCase().includes(searchTerm)) {
            trainingContent = 'נמצא במדריך הדוגמאות';
        } else if (trainingDB.parking && trainingDB.parking.toLowerCase().includes(searchTerm)) {
            trainingContent = 'נמצא במדריך הפעלת חניונים';
        } else if (trainingDB.scheidt && trainingDB.scheidt.toLowerCase().includes(searchTerm)) {
            trainingContent = 'נמצא במדריך מערכת שיידט';
        } else {
            trainingContent = 'אכין חומר הדרכה מותאם';
        }
        
        return { 
            response: `📚 **קיבלתי את בקשת ההדרכה!**\n\n"${message}"\n\n🔍 ${trainingContent}\n📧 אשלח חומר הדרכה מפורט למייל\n⏰ תוך 24 שעות\n\n📞 039792365`, 
            stage: 'training_completed',
            sendTrainingEmail: true,
            trainingRequest: message,
            trainingContent: trainingContent,
            customer: customer
        };
    }
    
    // עיבוד תיאור הבעיה
    if (context?.stage === 'problem_description' && customer) {
        const currentServiceNumber = getNextServiceNumber();
        
        return { 
            response: `📋 **קיבלתי את התיאור**\n\n"${message}"\n\n🔍 מחפש פתרון במאגר התקלות...\n⏳ רגע אחד...\n\n🆔 מספר קריאה: ${currentServiceNumber}\n\n📞 039792365`, 
            stage: 'processing_with_ai',
            serviceNumber: currentServiceNumber,
            problemDescription: message,
            customer: customer
        };
    }
    
    // משוב על פתרון
    if (context?.stage === 'waiting_feedback' && customer) {
        if (msg.includes('כן') || msg.includes('נפתר') || msg.includes('תודה') || (msg.includes('עזר') && !msg.includes('לא עזר'))) {
            return { 
                response: `🎉 **מעולה! הבעיה נפתרה!**\n\nשמח לשמוע שהפתרון עזר!\n\nיום טוב! 😊\n\n📞 039792365`, 
                stage: 'resolved', 
                sendSummary: true,
                serviceNumber: context.serviceNumber,
                problemDescription: context.problemDescription,
                solution: context.aiSolution,
                resolved: true,
                customer: customer
            };
        } else if (msg.includes('לא') || msg.includes('לא עזר') || msg.includes('לא עובד')) {
            return { 
                response: `🔧 **מבין שהפתרון לא עזר**\n\n📋 מעבירה את הפניה לטכנאי מומחה\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n📞 039792365\n\n🆔 מספר קריאה: ${context.serviceNumber}`, 
                stage: 'technician_dispatched', 
                sendTechnician: true,
                serviceNumber: context.serviceNumber,
                problemDescription: context.problemDescription,
                solution: context.aiSolution,
                resolved: false,
                customer: customer
            };
        } else {
            return {
                response: `❓ **האם הפתרון עזר?**\n\n✅ כתוב "כן" אם הבעיה נפתרה\n❌ כתוב "לא" אם עדיין יש בעיה\n\n📞 039792365`,
                stage: 'waiting_feedback',
                customer: customer
            };
        }
    }
    
// ברירת מחדל - אם יש לקוח אבל לא מובן מה הוא רוצה
if (customer) {
    // אל תחזור לתפריט אם אנחנו באמצע תהליך
    if (context?.stage && ['damage_photo', 'order_request', 'training_request', 'problem_description', 'waiting_feedback'].includes(context.stage)) {
        return {
            response: `לא הבנתי את התגובה.\n\nאנא כתוב בבירור מה אתה צריך.\n\n📞 039792365`,
            stage: context.stage,
            customer: customer
        };
    }
    
    return { 
        response: `שלום ${customer.name} מחניון ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, 
        stage: 'menu',
        customer: customer
    };
}
            // ברירת מחדל - תפריט ראשי
        return { 
            response: `שלום ${customer.name} מחניון ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, 
            stage: 'menu',
            customer: customer
        };
    }

    // ברירת מחדל - אין לקוח
    return { 
        response: `שלום! 👋\n\nכדי לטפל בפנייתך אני צריכה:\n\n🏢 **שם החניון שלך**\n\nלדוגמה: "אינפיניטי" או "עזריאלי תל אביב"\n\n📞 039792365`, 
        stage: 'identifying' 
    };
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
        log('INFO', `✅ WhatsApp נשלח: ${response.data ? 'הצלחה' : 'כשל'}`);
        return response.data;
    } catch (error) {
        log('ERROR', '❌ שגיאת WhatsApp:', error.message);
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
        } else if (type === 'training') {
            subject = `📚 בקשת הדרכה ${serviceNumber} - ${customer.name}`;
            emailType = '📚 בקשת הדרכה';
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
        if (extraData.trainingRequest) {
            conversationSummary += `<p><strong>נושא ההדרכה:</strong> ${extraData.trainingRequest}</p>`;
            if (extraData.trainingContent) {
                conversationSummary += `<p><strong>מקור החומר:</strong> ${extraData.trainingContent}</p>`;
            }
        }
        if (extraData.resolved !== undefined) {
            const status = extraData.resolved ? '✅ נפתר בהצלחה' : '❌ לא נפתר - נשלח טכנאי';
            conversationSummary += `<p><strong>סטטוס:</strong> <span style="color: ${extraData.resolved ? 'green' : 'red'};">${status}</span></p>`;
        }
        if (extraData.attachments && extraData.attachments.length > 0) {
            conversationSummary += `<p><strong>📎 קבצים מצורפים:</strong> ${extraData.attachments.length} תמונות</p>`;
        }

        const html = `
            <div dir="rtl" style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
                <div style="max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                    
                    <div style="background: linear-gradient(45deg, ${type === 'technician' ? '#dc3545, #c82333' : type === 'order' ? '#ffc107, #e0a800' : type === 'training' ? '#17a2b8, #138496' : '#28a745, #20c997'}); color: white; padding: 20px; border-radius: 10px; margin-bottom: 30px; text-align: center;">
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
                    contentType: 'image/jpeg'
                };
            });
            log('INFO', `📎 מצרף ${extraData.attachments.length} קבצים למייל`);
        }
        
        await transporter.sendMail(mailOptions);
        log('INFO', `📧 מייל נשלח: ${type} - ${customer.name} - ${serviceNumber}${extraData.attachments ? ` עם ${extraData.attachments.length} תמונות` : ''}`);
    } catch (error) {
        log('ERROR', '❌ שגיאת מייל:', error);
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
                        <li>🔧 תקלות ופתרונות מתקדמים</li>
                        <li>📋 דיווח נזקים עם תמונות</li>
                        <li>💰 הצעות מחיר</li>
                        <li>📚 הדרכות</li>
                        <li>🧠 זיכרון שיחות (4 שעות)</li>
                        <li>🤖 AI חכם לפתרונות</li>
                    </ul>
                    <p><strong>📞 039792365 | 📧 Service@sbcloud.co.il</strong></p>
                </div>
                <div style="text-align: center; background: #f8f9fa; padding: 20px; border-radius: 10px;">
                    <p><strong>📲 WhatsApp:</strong> 972546284210</p>
                    <p><strong>👥 לקוחות:</strong> ${customers.length}</p>
                    <p><strong>🧠 שיחות פעילות:</strong> ${memory.conversations.size}</p>
                    <p><strong>📋 מסד תקלות:</strong> ${serviceFailureDB.length} תרחישים</p>
                    <p><strong>📚 מסדי הדרכה:</strong> ${Object.keys(trainingDB).length} קבצים</p>
                    <p><strong>🤖 OpenAI:</strong> ${process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('fake') && !process.env.OPENAI_API_KEY.includes('כאן') ? '✅ פעיל' : '❌ לא פעיל'}</p>
                    <p><strong>✅ מערכת מושלמת מוכנה!</strong></p>
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
            
            if (messageData.textMessageData) {
                messageText = messageData.textMessageData.textMessage;
            } else if (messageData.fileMessageData) {
                hasFile = true;
                messageText = messageData.fileMessageData.caption || 'שלח קובץ';
                log('INFO', `📁 קובץ: ${messageData.fileMessageData.fileName}`);
            }
            
            log('INFO', `📞 הודעה מ-${phone} (${customerName}): ${messageText}`);
            
// 🔧 תיקון: תחילה חפש לקוח לפי טלפון
let customer = findCustomer(phone, messageText);
log('INFO', `🔍 זיהוי לפי טלפון: ${customer ? customer.name + ' מ' + customer.site : 'לא מזוהה'}`);

// 🔧 תיקון: קבל context (אם יש לקוח - השתמש בו, אחרת רק לפי טלפון)
let context = customer ? memory.get(phone, customer) : memory.get(phone);
log('INFO', `📊 Context stage: ${context?.stage || 'אין'}`);

// 🔧 תיקון: אם יש context עם לקוח, השתמש בו
if (context?.customer && !customer) {
    customer = context.customer;
    log('INFO', `🧠 לקוח מהזיכרון: ${customer.name} מ${customer.site}`);
}

// 🔧 תיקון: קרא ל-generateResponse עם הפרמטרים הנכונים
let result = generateResponse(messageText, customer, context, phone);

// 🔧 תיקון חשוב: אם generateResponse זיהה לקוח חדש, עדכן אותו
if (result.customer && result.customer !== customer) {
    customer = result.customer;
    log('INFO', `🆕 לקוח חדש מזוהה: ${customer.name} מ${customer.site}`);
}


// 🔧 תיקון: עדכן את הזיכרון הנכון
if (customer) {
    // אם יש כבר conversation, רק עדכן אותו
    const existingConv = memory.get(phone);
    if (existingConv && !existingConv.customer) {
        existingConv.customer = customer;
        existingConv.stage = result.stage;
        log('INFO', `🔄 עדכון conversation קיים: ${customer.name} - שלב: ${result.stage}`);
    } else {
        memory.add(phone, messageText, 'customer', customer);
        memory.updateStage(phone, result.stage, customer);
        log('INFO', `✅ הוסף לזיכרון: ${customer.name} - שלב: ${result.stage}`);
    }
} else {
    memory.add(phone, messageText, 'customer');
    memory.updateStage(phone, result.stage);
    log('INFO', `⚠️ הוסף לזיכרון ללא לקוח - שלב: ${result.stage}`);
}

            // זיהוי סוג קובץ (תמונה/סרטון)
            let fileType = '';
            let downloadedFiles = [];
            
            if (hasFile && messageData.fileMessageData) {
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
            
            // טיפול בקבצים לכל סוג פניה
            if (hasFile && customer) {
                const currentServiceNumber = getNextServiceNumber();
                
                // הורדת הקובץ
                if (messageData.fileMessageData && messageData.fileMessageData.downloadUrl) {
                    const timestamp = Date.now();
                    const fileExtension = getFileExtension(messageData.fileMessageData.fileName || '', messageData.fileMessageData.mimeType || '');
                    let filePrefix = 'file';
                    
                    // קביעת סוג הקובץ לפי השלב
                    if (context?.stage === 'damage_photo') {
                        filePrefix = 'damage';
                    } else if (context?.stage === 'problem_description') {
                        filePrefix = 'problem';
                    } else if (context?.stage === 'order_request') {
                        filePrefix = 'order';
                    } else if (context?.stage === 'training_request') {
                        filePrefix = 'training';
                    }
                    
                    const fileName = `${filePrefix}_${customer.id}_${timestamp}${fileExtension}`;
                    
                    const filePath = await downloadWhatsAppFile(messageData.fileMessageData.downloadUrl, fileName);
                    if (filePath) {
                        downloadedFiles.push(filePath);
                        log('INFO', `✅ ${fileType} הורד: ${fileName}`);
                    }
                }
                
                // טיפול בקבצים לפניות שונות
                if (context?.stage === 'order_request') {
                    const response = `📋 **קיבלתי את בקשת ההזמנה עם ${fileType}!**\n\n"${messageText}"\n\n📧 אשלח הצעת מחיר מפורטת למייל\n⏰ תוך 24 שעות\n\n🆔 מספר קריאה: ${currentServiceNumber}\n\n📞 039792365`;
                    
                    await sendWhatsApp(phone, response);
                    await sendEmail(customer, 'order', messageText, {
                        serviceNumber: currentServiceNumber,
                        orderDetails: messageText,
                        attachments: downloadedFiles
                    });
                    memory.updateStage(phone, 'order_completed', customer);
                    
                    log('INFO', `✅ הזמנה עם ${fileType} - מייל נשלח - ${currentServiceNumber}`);
                    return res.status(200).json({ status: 'OK' });
                }
                
                if (context?.stage === 'training_request') {
                    const response = `📚 **קיבלתי את בקשת ההדרכה עם ${fileType}!**\n\n"${messageText}"\n\n📧 אשלח חומר הדרכה מפורט למייל\n⏰ תוך 24 שעות\n\n🆔 מספר קריאה: ${currentServiceNumber}\n\n📞 039792365`;
                    
                    await sendWhatsApp(phone, response);
                    await sendEmail(customer, 'training', messageText, {
                        serviceNumber: currentServiceNumber,
                        trainingRequest: messageText,
                        trainingContent: 'חומר הדרכה מותאם עם קבצים מצורפים',
                        attachments: downloadedFiles
                    });
                    memory.updateStage(phone, 'training_completed', customer);
                    
                    log('INFO', `✅ הדרכה עם ${fileType} - מייל נשלח - ${currentServiceNumber}`);
                    return res.status(200).json({ status: 'OK' });
                }
                
                // טיפול בתקלות עם קבצים
                if (context?.stage === 'problem_description') {
                    log('INFO', `📁 תקלה עם ${fileType} - יטופל עם הפתרון`);
                }
            }

            // הלוגיקה לתקלות עם פתרון תקלות
                if (result.stage === 'processing_with_ai' && result.problemDescription && context?.stage === 'problem_description') {
                log('INFO', '🔍 מחפש פתרון לתקלה...');
                
                try {
                    // הורדת קבצים אם יש (לתקלות)
                    if (hasFile && downloadedFiles.length === 0 && messageData.fileMessageData?.downloadUrl) {
                        const timestamp = Date.now();
                        const fileExtension = getFileExtension(messageData.fileMessageData.fileName || '', messageData.fileMessageData.mimeType || '');
                        const fileName = `problem_${customer.id}_${timestamp}${fileExtension}`;
                        
                        const filePath = await downloadWhatsAppFile(messageData.fileMessageData.downloadUrl, fileName);
                        if (filePath) {
                            downloadedFiles.push(filePath);
                            log('INFO', `✅ ${fileType} הורד לתקלה: ${fileName}`);
                        }
                    }
                    
                    const solution = await getAISolution(result.problemDescription, customer);
                    
                    let finalResponse;
                    
                    // אם לא נמצא פתרון - שלח מייל מיידי
                    if (solution.emailSent) {
                        finalResponse = `${solution.response}\n\n🆔 מספר קריאה: ${solution.serviceNumber}`;
                        
                        // שלח מייל עם קבצים אם יש
                        if (downloadedFiles.length > 0) {
                            await sendEmail(customer, 'technician', result.problemDescription, {
                                serviceNumber: solution.serviceNumber,
                                problemDescription: result.problemDescription,
                                solution: 'קבצים צורפו לקריאה - לא נמצא פתרון',
                                resolved: false,
                                attachments: downloadedFiles
                            });
                        }
                        
                        await sendWhatsApp(phone, finalResponse);
                        memory.add(phone, finalResponse, 'hadar', customer);
                        memory.updateStage(phone, 'completed', customer);
                        
                        log('INFO', `✅ לא נמצא פתרון - מייל נשלח ללקוח ${customer.name} - ${solution.serviceNumber}`);
                        
                    } else {
                        // אם נמצא פתרון - רק המתן למשוב
                        finalResponse = `${solution.response}\n\n🆔 מספר קריאה: ${result.serviceNumber}`;
                        
                        await sendWhatsApp(phone, finalResponse);
                        memory.add(phone, finalResponse, 'hadar', customer);
                        memory.updateStage(phone, 'waiting_feedback', customer);
                        
                        // שמור את המידע לזיכרון
                        const contextAfter = memory.get(phone, customer);
                        if (contextAfter) {
                            contextAfter.serviceNumber = result.serviceNumber;
                            contextAfter.problemDescription = result.problemDescription;
                            contextAfter.aiSolution = solution.response;
                            if (downloadedFiles.length > 0) {
                                contextAfter.attachments = downloadedFiles;
                            }
                        }
                        
                        log('INFO', `✅ נמצא פתרון - ממתין למשוב מלקוח ${customer.name} - ${result.serviceNumber}`);
                    }
                    
                    return res.status(200).json({ status: 'OK' });
                    
                } catch (error) {
                    log('ERROR', '❌ שגיאה בחיפוש פתרון:', error);
                    await sendWhatsApp(phone, `⚠️ יש בעיה זמנית במערכת\n\nאנא התקשר ישירות: 📞 039792365\n\n🆔 מספר קריאה: ${result.serviceNumber}`);
                    return res.status(200).json({ status: 'OK' });
                }
            }

            // בדיקה מיוחדת לקבצים עם יחידה (נזק)
            if (hasFile && customer && context?.stage === 'damage_photo') {
                const unitMatch = messageText.match(/(\d{3})|יחידה\s*(\d{1,3})/);
                if (unitMatch) {
                    const unit = unitMatch[1] || unitMatch[2];
                    const currentServiceNumber = getNextServiceNumber();
                    
                    log('INFO', `📁 נזק ביחידה ${unit} - תמונה התקבלה מ${customer.name}`);
                    
                    // הורדת התמונה מוואטסאפ
                    let downloadedFiles = [];
                    if (messageData.fileMessageData && messageData.fileMessageData.downloadUrl) {
                        const timestamp = Date.now();
                        const fileName = `damage_${customer.id}_${unit}_${timestamp}.jpg`;
                        
                        const filePath = await downloadWhatsAppFile(messageData.fileMessageData.downloadUrl, fileName);
                        if (filePath) {
                            downloadedFiles.push(filePath);
                            log('INFO', `✅ תמונה הורדה: ${fileName}`);
                        }
                    }
                    
                    const response = `שלום ${customer.name} 👋\n\nיחידה ${unit} - קיבלתי את התמונה!\n\n🔍 מעביר לטכנאי\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n🆔 מספר קריאה: ${currentServiceNumber}\n\n📞 039792365`;
                    
                    await sendWhatsApp(phone, response);
                    await sendEmail(customer, 'technician', `נזק ביחידה ${unit} - תמונה צורפה`, {
                        serviceNumber: currentServiceNumber,
                        problemDescription: `נזק ביחידה ${unit} - ${messageText}`,
                        solution: 'נשלח טכנאי לטיפול באתר',
                        resolved: false,
                        attachments: downloadedFiles
                    });
                    memory.updateStage(phone, 'damage_completed', customer);
                    
                    log('INFO', `✅ נזק יחידה ${unit} - מייל עם תמונה נשלח - ${currentServiceNumber}`);
                    return res.status(200).json({ status: 'OK' });
                } else {
                    await sendWhatsApp(phone, `אנא כתוב מספר היחידה עם התמונה\n\nלדוגמה: "יחידה 101"\n\n📞 039792365`);
                    log('INFO', `⚠️ תמונה ללא מספר יחידה מ${customer.name}`);
                    return res.status(200).json({ status: 'OK' });
                }
            }

            // 🔧 תיקון: שלח תגובה עם הלקוח הנכון
            await sendWhatsApp(phone, result.response);
            memory.add(phone, result.response, 'hadar', customer);
            memory.updateStage(phone, result.stage, customer);
            
            log('INFO', `📤 תגובה נשלחה ללקוח ${customer ? customer.name : 'לא מזוהה'}: ${result.stage}`);
            
            // שליחת מיילים עם סיכום מלא
            if (result.sendTechnician) {
                log('INFO',`📧 שולח מייל טכנאי ללקוח ${customer.name}`);
                await sendEmail(customer, 'technician', messageText, {
                    serviceNumber: result.serviceNumber,
                    problemDescription: result.problemDescription,
                    solution: result.solution,
                    resolved: result.resolved
                });
            } else if (result.sendSummary) {
                log('INFO',`📧 שולח מייל סיכום ללקוח ${customer.name}`);
                await sendEmail(customer, 'summary', 'בעיה נפתרה בהצלחה', {
                    serviceNumber: result.serviceNumber,
                    problemDescription: result.problemDescription,
                    solution: result.solution,
                    resolved: result.resolved
                });
            } else if (result.sendOrderEmail) {
                log('INFO',`📧 שולח מייל הזמנה ללקוח ${customer.name}`);
                await sendEmail(customer, 'order', result.orderDetails, {
                    serviceNumber: getNextServiceNumber(),
                    orderDetails: result.orderDetails
                });
            } else if (result.sendTrainingEmail) {
                log('INFO',`📧 שולח מייל הדרכה ללקוח ${customer.name}`);
                await sendEmail(customer, 'training', result.trainingRequest, {
                    serviceNumber: getNextServiceNumber(),
                    trainingRequest: result.trainingRequest,
                    trainingContent: result.trainingContent
                });
            }
        }
        
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        log('ERROR', '❌ שגיאה כללית:', error);
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
    log('INFO', '🧠 זיכרון: 4 שעות');
    log('INFO', `📋 מסד תקלות: ${serviceFailureDB.length} תרחישים`);
    log('INFO', `📚 מסדי הדרכה: ${Object.keys(trainingDB).length} קבצים`);
    log('INFO', `🤖 OpenAI: ${process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('fake') && !process.env.OPENAI_API_KEY.includes('כאן') ? '✅ פעיל' : '❌ צריך מפתח'}`);
    log('INFO', `🔢 מספרי קריאה: HSC-${globalServiceCounter + 1}+`);
    log('INFO', '📧 מיילים: סיכום מלא בכל קריאה');
    log('INFO', '✅ מערכת מושלמת מוכנה!');
});

function getFileExtension(fileName, mimeType) {
    // אם יש שם קובץ עם סיומת
    if (fileName && fileName.includes('.')) {
        const extension = fileName.substring(fileName.lastIndexOf('.'));
        return extension;
    }
    
    // אם אין שם קובץ, נקבע לפי mimeType
    if (mimeType) {
        if (mimeType.startsWith('image/')) {
            if (mimeType.includes('jpeg')) return '.jpg';
            if (mimeType.includes('png')) return '.png';
            if (mimeType.includes('gif')) return '.gif';
            return '.jpg'; // ברירת מחדל לתמונות
        } else if (mimeType.startsWith('video/')) {
            if (mimeType.includes('mp4')) return '.mp4';
            if (mimeType.includes('avi')) return '.avi';
            if (mimeType.includes('quicktime')) return '.mov';
            return '.mp4'; // ברירת מחדל לסרטונים
        }
    }
    
    return '.file'; // ברירת מחדל
}
module.exports = app;
