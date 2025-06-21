require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
const OpenAI = require('openai');
// Google Sheets Integration
const { google } = require('googleapis');

// הגדרת Google Sheets
const sheets = google.sheets('v4');
let auth = null;
let sheetsAvailable = false;

// אתחול Google Sheets
async function initializeGoogleSheets() {
// שורות דיבוג זמניות
    console.log('🔍 DEBUG - SHEETS_ID:', process.env.GOOGLE_SHEETS_ID);
    console.log('🔍 DEBUG - EMAIL:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    console.log('🔍 DEBUG - PRIVATE_KEY exists:', !!process.env.GOOGLE_PRIVATE_KEY);
    try {
        if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEETS_ID) {
            log('WARN', '⚠️ Google Sheets לא מוגדר - פועל ללא תיעוד');
            return false;
        }

        auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        // בדיקת חיבור
        const authClient = await auth.getClient();
        google.options({ auth: authClient });
        
log('INFO', '📊 Google Sheets מחובר בהצלחה');
log('INFO', 'מזהה הטבלה:', process.env.GOOGLE_SHEETS_ID);
log('INFO', 'Service Account:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
        sheetsAvailable = true;
        return true;
    } catch (error) {
        log('ERROR', '❌ שגיאה בחיבור Google Sheets:', error.message);
        sheetsAvailable = false;
        return false;
    }
}

// פונקציה לקריאת מספר הקריאה האחרון מהטבלה
async function getLastServiceNumber() {
    try {
        if (!sheetsAvailable) return globalServiceCounter;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEETS_ID,
            range: 'Sheet1!A:A',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            log('INFO', '📊 טבלה ריקה - מתחיל מ-HSC-10001');
            return 10001;
        }

        // מחפש את המספר הגבוה ביותר
        let maxNumber = 10001;
        for (let i = 1; i < rows.length; i++) {
            const serviceNumber = rows[i][0];
            if (serviceNumber && serviceNumber.startsWith('HSC-')) {
                const number = parseInt(serviceNumber.replace('HSC-', ''));
                if (number > maxNumber) {
                    maxNumber = number;
                }
            }
        }

        log('INFO', `📊 מספר הקריאה האחרון בטבלה: HSC-${maxNumber}`);
        return maxNumber;
} catch (error) {
    console.log('FULL ERROR:', error);
    log('ERROR', '❌ שגיאה בקריאת מספר קריאה מהטבלה:', error);
    return globalServiceCounter;
}
}

// פונקציה לכתיבה לטבלה
async function writeToGoogleSheets(serviceData) {
    try {
        if (!sheetsAvailable) {
            log('WARN', '⚠️ Google Sheets לא זמין - לא כותב לטבלה');
            return false;
        }

        const row = [
            serviceData.serviceNumber,
            serviceData.timestamp,
            serviceData.referenceType,
            serviceData.customerName,
            serviceData.customerSite,
            serviceData.problemDescription,
            serviceData.resolved
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEETS_ID,
            range: 'Sheet1!A:G',
            valueInputOption: 'RAW',
            requestBody: {
                values: [row],
            },
        });

        log('INFO', `📊 נרשם ב-Google Sheets: ${serviceData.serviceNumber}`);
        return true;
} catch (error) {
    console.log('FULL ERROR:', error);
    log('ERROR', '❌ שגיאה ביצירת כותרות:', error);
    return false;
}
}

// פונקציה ליצירת כותרות בטבלה
async function createSheetsHeaders() {
    try {
        if (!sheetsAvailable) return false;

        // בדיקה אם יש כבר כותרות
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEETS_ID,
            range: 'Sheet1!A1:G1',
        });

        if (response.data.values && response.data.values.length > 0) {
            log('INFO', '📊 כותרות כבר קיימות בטבלה');
            return true;
        }

        // יצירת כותרות
        const headers = [
            'Service Number',
            'Timestamp', 
            'Reference Type',
            'Customer Name',
            'Customer Site',
            'Problem Description',
            'Resolved'
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SHEETS_ID,
            range: 'Sheet1!A1:G1',
            valueInputOption: 'RAW',
            requestBody: {
                values: [headers],
            },
        });

        log('INFO', '📊 כותרות נוצרו בטבלה');
        return true;
} catch (error) {
    console.log('FULL ERROR:', error);
    log('ERROR', '❌ שגיאה ביצירת כותרות:', error);
    return false;
}
}

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

// מספר קריאה גלובלי - עדכון מהטבלה
let globalServiceCounter = 10001;
let sheetsInitialized = false;

async function getNextServiceNumber() {
    // אם זו הפעם הראשונה, קרא מהטבלה
    if (!sheetsInitialized && sheetsAvailable) {
        globalServiceCounter = await getLastServiceNumber();
        sheetsInitialized = true;
    }
    
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

// פונקציות OpenAI Assistant
async function createThread() {
    try {
        const thread = await openai.beta.threads.create();
        log('INFO', `🧵 נוצר thread חדש: ${thread.id}`);
        return thread.id;
    } catch (error) {
        log('ERROR', '❌ שגיאה ביצירת thread:', error.message);
        return null;
    }
}

async function addMessageToThread(threadId, message) {
    try {
        await openai.beta.threads.messages.create(threadId, {
            role: "user",
            content: message
        });
        log('DEBUG', `💬 הודעה נוספה ל-thread ${threadId}`);
        return true;
    } catch (error) {
        log('ERROR', '❌ שגיאה בהוספת הודעה:', error.message);
        return false;
    }
}

async function runAssistant(threadId, assistantId, instructions = "") {
    try {
        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: assistantId,
            instructions: instructions
        });
        
        log('INFO', `🤖 מפעיל Assistant: ${run.id}`);
        
        // המתנה לסיום
        let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
        
        while (runStatus.status === 'queued' || runStatus.status === 'in_progress') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
        }
        
        if (runStatus.status === 'completed') {
            const messages = await openai.beta.threads.messages.list(threadId);
            const lastMessage = messages.data[0];
            
            if (lastMessage.role === 'assistant') {
                const response = lastMessage.content[0].text.value;
                log('INFO', '✅ תגובה מהAssistant התקבלה');
                return response;
            }
        }
        
        log('WARN', `⚠️ Assistant לא השלים בהצלחה: ${runStatus.status}`);
        return null;
        
    } catch (error) {
        log('ERROR', '❌ שגיאה בהפעלת Assistant:', error.message);
        return null;
    }
}

// פונקציה מיוחדת לטיפול בתקלות עם Assistant
async function handleProblemWithAssistant(problemDescription, customer) {
    try {
        log('INFO', '🔧 מעבד תקלה עם OpenAI Assistant...');
        
        // יצירת thread חדש
        const threadId = await createThread();
        if (!threadId) {
            log('WARN', '⚠️ נכשל ביצירת thread - עובר לשיטה הרגילה');
            return await findSolution(problemDescription, customer);
        }
        
        // בניית הודעה מפורטת עם קשר לקבצי החניה
        const contextMessage = `
שלום! אני עוזר טכני למערכות בקרת חניה של חברת שיידט את בכמן.

פרטי הלקוח:
- שם: ${customer.name}
- חניון: ${customer.site}
- כתובת: ${customer.address}

תיאור התקלה שדווחה:
"${problemDescription}"

אנא חפש במדריכי ההפעלה שלך פתרון מתאים לתקלה זו ותן הוראות צעד אחר צעד. 
השתמש במידע מהקבצים המצורפים במערכת (מדריכי הפעלה של מערכות החניה).
התמקד בפתרונות מעשיים שהלקוח יכול לבצע בעצמו.
`;

        // שליחת ההודעה ל-Assistant
        const messageAdded = await addMessageToThread(threadId, contextMessage);
        if (!messageAdded) {
            log('WARN', '⚠️ נכשל בהוספת הודעה - עובר לשיטה הרגילה');
            return await findSolution(problemDescription, customer);
        }
        
        // הפעלת Assistant עם אינסטרוקציות מותאמות לחברה
        const assistantResponse = await runAssistant(
            threadId, 
            process.env.OPENAI_ASSISTANT_ID,
            "אתה מומחה למערכות בקרת חניה של חברת שיידט את בכמן. השתמש במדריכי ההפעלה במערכת כדי לתת פתרון מדויק ומפורט בעברית. השתמש באימוג'י לבהירות."
        );
        
        if (assistantResponse) {
            log('INFO', '✅ Assistant נתן פתרון מותאם אישית');
            
            // עיצוב התגובה
            let formattedResponse = `🔧 **פתרון מותאם אישית מהמומחה שלנו:**\n\n${assistantResponse}`;
            formattedResponse += `\n\n❓ **האם הפתרון עזר?** (כן/לא)`;
            
            return { 
                found: true, 
                response: formattedResponse, 
                source: 'assistant',
                threadId: threadId 
            };
        } else {
            log('WARN', '⚠️ Assistant לא החזיר תגובה - עובר לשיטה הרגילה');
            return await findSolution(problemDescription, customer);
        }
        
    } catch (error) {
        log('ERROR', '❌ שגיאה כללית בAssistant - עובר לשיטה הרגילה:', error.message);
        return await findSolution(problemDescription, customer);
    }
}

// פונקציה מיוחדת לטיפול בהדרכה עם Assistant
async function handleTrainingWithAssistant(trainingRequest, customer) {
    try {
        log('INFO', '📚 מעבד בקשת הדרכה עם OpenAI Assistant...');
        
        const threadId = await createThread();
        if (!threadId) {
            return null;
        }
        
        const contextMessage = `
שלום! אני מבקש הדרכה למערכת בקרת החניה של שיידט את בכמן.

פרטי הלקוח:
- שם: ${customer.name}
- חניון: ${customer.site}
- כתובת: ${customer.address}

נושא ההדרכה:
"${trainingRequest}"

אנא חפש במדריכי ההפעלה והחומרים שלך והכן חומר הדרכה מפורט ומותאם לנושא זה.
השתמש במידע מהקבצים המצורפים במערכת (מדריכי הפעלה של מערכות החניה).
כלול הסברים צעד אחר צעד, טיפים חשובים ודברים שחשוב להימנע מהם.
`;

        const messageAdded = await addMessageToThread(threadId, contextMessage);
        if (!messageAdded) return null;
        
        const assistantResponse = await runAssistant(
            threadId, 
            process.env.OPENAI_ASSISTANT_ID,
            "אתה מדריך מומחה למערכות בקרת חניה של חברת שיידט את בכמן. השתמש במדריכי ההפעלה במערכת להכנת חומר הדרכה מפורט, ברור ומעשי בעברית. השתמש באימוג'י ובמבנה ברור."
        );
        
        if (assistantResponse) {
            log('INFO', '✅ Assistant הכין חומר הדרכה מותאם');
            return {
                success: true,
                content: assistantResponse,
                source: 'assistant',
                threadId: threadId
            };
        }
        
        return null;
        
    } catch (error) {
        log('ERROR', '❌ שגיאה בהדרכה עם Assistant:', error.message);
        return null;
    }
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

// טעינת מסד תקלות עם בדיקות מפורטות
try {
    const rawData = fs.readFileSync('./Service failure scenarios.json', 'utf8');
    log('DEBUG', '📄 קובץ התרחישים נקרא בהצלחה');
    
    serviceFailureDB = JSON.parse(rawData);
    if (!Array.isArray(serviceFailureDB)) {
        log('WARN', '⚠️ קובץ התרחישים אינו מערך - מתקן...');
        serviceFailureDB = [];
    }
    
    log('INFO', `📋 מסד תקלות נטען: ${serviceFailureDB.length} תרחישים`);
    
    // בדיקה מפורטת של התוכן
    serviceFailureDB.forEach((scenario, index) => {
        log('DEBUG', `תרחיש ${index + 1}: "${scenario.תרחיש || 'לא הוגדר'}"`);
        
        // בדיקת תקינות התרחיש
        if (!scenario.תרחיש || !scenario.שלבים) {
            log('WARN', `⚠️ תרחיש ${index + 1} לא שלם - חסרים פרטים`);
        }
    });
    
    // אם יש תרחישים - הדפס דוגמה
    if (serviceFailureDB.length > 0) {
        log('DEBUG', '🔍 דוגמה לתרחיש ראשון:');
        log('DEBUG', JSON.stringify(serviceFailureDB[0], null, 2));
    }
    
} catch (error) {
    log('ERROR', '❌ שגיאה בטעינת מסד תקלות:', error.message);
    log('ERROR', '📝 יוצר מסד תקלות ברירת מחדל...');
    
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
        },
        {
            "תרחיש": "בעיות אשראי",
            "שלבים": "1. בדוק חיבור אינטרנט\n2. נסה כמה כרטיסי אשראי שונים\n3. בדוק הגדרות מסוף האשראי\n4. אתחל מסוף אשראי\n5. צור קשר עם חברת האשראי",
            "הערות": "בעיה יכולה להיות ברשת או במסוף עצמו"
        },
        {
            "תרחיש": "מסך לא עובד",
            "שלבים": "1. בדוק חיבור המסך\n2. בדוק כבל החשמל של המסך\n3. נסה הפעלה מחדש של המערכת\n4. בדוק בהירות המסך",
            "הערות": "ייתכן בעיה בכבל או בכרטיס מסך"
        }
    ];
    
    log('INFO', `📋 נוצר מסד תקלות ברירת מחדל: ${serviceFailureDB.length} תרחישים`);
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

// הגדרת OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
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

// קבלת שיחה - גרסה מתוקנת
getConversation(phone, customer = null) {
    // קודם חפש לפי המפתח המדויק
    const key = this.createKey(phone, customer);
    let conv = this.conversations.get(key);
    
    // אם לא נמצא ויש לקוח, חפש לפי כל המפתחות הקיימים של הטלפון
    if (!conv && customer) {
        for (const [existingKey, existingConv] of this.conversations.entries()) {
            if (existingKey.includes(phone)) {
                conv = existingConv;
                log('DEBUG', `🔍 נמצא conversation קיים: ${existingKey} עם שלב: ${conv.stage}`);
                break;
            }
        }
    }
    
    // אם עדיין לא נמצא, חפש רק לפי טלפון בלי לקוח
    if (!conv) {
        for (const [existingKey, existingConv] of this.conversations.entries()) {
            if (existingKey.includes(phone)) {
                conv = existingConv;
                log('DEBUG', `🔍 נמצא conversation כללי: ${existingKey} עם שלב: ${conv.stage}`);
                break;
            }
        }
    }
    
    return conv;
}
    
// יצירת או עדכון שיחה - גרסה מתוקנת
createOrUpdateConversation(phone, customer = null, initialStage = 'identifying') {
    // חיפוש conversation קיים לפי טלפון
    let existingConv = null;
    for (const [key, conv] of this.conversations.entries()) {
        if (key.includes(phone)) {
            existingConv = conv;
            break;
        }
    }
    
    if (existingConv) {
        // עדכן conversation קיים
        existingConv.lastActivity = new Date();
        if (customer && !existingConv.customer) {
            existingConv.customer = customer;
        }
        log('DEBUG', `🔄 מצאתי conversation קיים - שלב: ${existingConv.stage}`);
        return existingConv;
    }
    
// יצירת conversation חדש רק אם לא קיים
const key = this.createKey(phone, customer);

// אם יש לקוח - נקה conversations ישנים של אותו טלפון קודם
if (customer) {
    for (const [existingKey, existingConv] of this.conversations.entries()) {
        if (existingKey !== key && existingKey.includes(phone)) {
            this.conversations.delete(existingKey);
            log('DEBUG', `🧹 ניקיתי conversation ישן: ${existingKey}`);
        }
    }
}

const conv = {
    phone: phone,
    customer: customer,
    stage: customer ? 'menu' : initialStage,
    messages: [],
    startTime: new Date(),
    lastActivity: new Date(),
    data: {}
};
this.conversations.set(key, conv);
log('INFO', `➕ יצרתי conversation חדש: ${key} - שלב: ${conv.stage}`);
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

// אתחול Google Sheets
(async () => {
    const initialized = await initializeGoogleSheets();
    if (initialized) {
        await createSheetsHeaders();
        globalServiceCounter = await getLastServiceNumber();
        log('INFO', `📊 Google Sheets מוכן - מספר קריאה הבא: HSC-${globalServiceCounter + 1}`);
    }
})();

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

// פתרון תקלות עם OpenAI - prompt משופר
async function findSolution(problemDescription, customer) {
    try {
        log('INFO', '🔍 מחפש פתרון במסד תקלות עם OpenAI...');
        
        if (!serviceFailureDB || !Array.isArray(serviceFailureDB) || serviceFailureDB.length === 0) {
            log('ERROR', '❌ מסד התקלות ריק');
            return {
                found: false,
                response: '🔧 **בעיה במאגר התקלות**\n\n📧 שלחתי מייל לטכנאי\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף:** 039792365'
            };
        }

        // בדיקה שיש API Key ושהוא נכון
        if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_API_KEY.startsWith('sk-')) {
            log('WARN', '⚠️ OpenAI API Key לא מוגדר נכון - עובר ל-fallback');
            return await findSolutionFallback(problemDescription);
        }
        
        try {
            // יצירת prompt משופר עבור OpenAI
            const scenariosText = serviceFailureDB.map((scenario, index) => 
                `${index + 1}. ${scenario.תרחיש} - ${scenario.שלבים.substring(0, 50)}...`
            ).join('\n');
            
            const prompt = `אתה מומחה טכני למערכות בקרת חניה. אנא קרא בעיון את תיאור התקלה ומצא את התרחיש המתאים ביותר.

תיאור התקלה: "${problemDescription}"

תרחישי פתרון זמינים:
${scenariosText}

כללי התאמה:
- "לא עובד" או "לא דולק" = תרחיש 1 (יחידה לא דולקת)  
- "מחסום לא עולה" או "לא נפתח" = תרחיש 2 (מחסום לא עולה)
- "לא מדפיס" או "נייר" = תרחיש 3 (לא מדפיס כרטיסים)
- "אשראי" או "תשלום" = תרחיש 4 (בעיות אשראי)
- "מסך" או "תצוגה" = תרחיש 5 (מסך לא עובד)

אם יש התאמה ברורה - החזר את מספר התרחיש (1-${serviceFailureDB.length})
אם אין התאמה ברורה - החזר 0
רק מספר, בלי הסברים.

מספר התרחיש:`;

            log('DEBUG', '🤖 שולח בקשה ל-OpenAI עם prompt משופר...');
            
            // קריאה ל-OpenAI עם timeout
            const completion = await Promise.race([
                openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 5,
                    temperature: 0.1
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('OpenAI timeout')), 10000)
                )
            ]);
            
            const aiResponse = completion.choices[0].message.content.trim();
            const scenarioNumber = parseInt(aiResponse);
            
            log('INFO', `🤖 OpenAI החזיר: "${aiResponse}" -> תרחיש מספר: ${scenarioNumber}`);
            
            // בדיקה אם נמצא תרחיש מתאים
            if (scenarioNumber > 0 && scenarioNumber <= serviceFailureDB.length) {
                const scenario = serviceFailureDB[scenarioNumber - 1];
                
                let solution = `🔧 **פתרון לתקלה: ${scenario.תרחיש}**\n\n📋 **שלבי הפתרון:**\n${scenario.שלבים}`;
                
                if (scenario.הערות) {
                    solution += `\n\n💡 **הערות חשובות:**\n${scenario.הערות}`;
                }
                
                solution += `\n\n❓ **האם הפתרון עזר?** (כן/לא)`;
                
                log('INFO', `✅ OpenAI מצא פתרון מתאים: ${scenario.תרחיש}`);
                return { found: true, response: solution, scenario: scenario };
            } else {
                log('INFO', '⚠️ OpenAI לא מצא פתרון מתאים - עובר ל-fallback');
                return await findSolutionFallback(problemDescription);
            }
            
        } catch (aiError) {
            log('ERROR', `❌ שגיאה ב-OpenAI: ${aiError.message}`);
            
            // fallback למערכת הישנה
            log('INFO', '🔄 עובר לחיפוש ישן כ-fallback...');
            return await findSolutionFallback(problemDescription);
        }
        
    } catch (error) {
        log('ERROR', `❌ שגיאה כללית בחיפוש פתרון: ${error.message}`);
        return await findSolutionFallback(problemDescription);
    }
}

// פונקציית fallback משופרת - עם התאמה מדויקת יותר
async function findSolutionFallback(problemDescription) {
    try {
        log('INFO', '🔄 מפעיל מערכת fallback חכמה...');
        
        const problem = problemDescription.toLowerCase();
        
        // מילות מפתח מדויקות לכל תרחיש
        const keywordMapping = {
            'אשראי': ['אשראי', 'כרטיס אשראי', 'תשלום', 'חיוב', 'visa', 'mastercard', 'מסוף'],
            'מחסום לא עולה': ['מחסום לא עולה', 'מחסום תקוע', 'לא עולה', 'לא נפתח', 'חסום'],
            'יחידה לא דולקת': ['לא דולקת', 'לא עובד', 'כבוי', 'מת', 'חשמל', 'לא מגיב', 'נתיך'],
            'לא מדפיס': ['לא מדפיס', 'נייר', 'גליל', 'מדפסת', 'כרטיס לא יוצא'],
            'מסך': ['מסך', 'תצוגה', 'מסך שחור', 'כהה', 'לא מציג', 'תצוגה כהה']
        };
        
        let bestMatch = null;
        let bestScore = 0;
        
        // חיפוש מדויק
        for (const [keyword, variations] of Object.entries(keywordMapping)) {
            let score = 0;
            
            for (const variation of variations) {
                if (problem.includes(variation)) {
                    score += variation.length; // ציון גבוה יותר למילים ארוכות
                    log('DEBUG', `✅ נמצאה מילת מפתח: "${variation}" עבור ${keyword} (+${variation.length})`);
                }
            }
            
            if (score > bestScore) {
                // מציאת התרחיש המתאים
                const foundScenario = serviceFailureDB.find(scenario => 
                    scenario.תרחיש && scenario.תרחיש.toLowerCase().includes(keyword)
                );
                
                if (foundScenario) {
                    bestScore = score;
                    bestMatch = foundScenario;
                    log('DEBUG', `🎯 נמצא תרחיש: ${foundScenario.תרחיש} (ציון: ${score})`);
                }
            }
        }
        
        if (bestMatch && bestScore >= 3) {
            let solution = `🔧 **פתרון לתקלה: ${bestMatch.תרחיש}**\n\n📋 **שלבי הפתרון:**\n${bestMatch.שלבים}`;
            
            if (bestMatch.הערות) {
                solution += `\n\n💡 **הערות חשובות:**\n${bestMatch.הערות}`;
            }
            
            solution += `\n\n❓ **האם הפתרון עזר?** (כן/לא)`;
            
            log('INFO', `✅ Fallback מצא פתרון: ${bestMatch.תרחיש} (ציון: ${bestScore})`);
            return { found: true, response: solution, scenario: bestMatch };
        }
        
        log('INFO', '⚠️ גם fallback לא מצא פתרון מתאים');
        return {
            found: false,
            response: '🔧 **לא נמצא פתרון מיידי**\n\n📧 שלחתי מייל לטכנאי\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף:** 039792365'
        };
        
    } catch (error) {
        log('ERROR', '❌ שגיאה גם ב-fallback:', error.message);
        return {
            found: false,
            response: '🔧 **בעיה זמנית במערכת**\n\n📧 שלחתי מייל לטכנאי\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף:** 039792365'
        };
    }
}

// פונקציה חדשה לזיהוי מילות סיום - הוסף לפני ה-ResponseHandler:
function isFinishingWord(message) {
    const msg = message.toLowerCase().trim();
    const finishingWords = [
        'סיום', 'לסיים', 'להגיש', 'לשלוח', 'סיימתי', 
        'זהו', 'תם', 'הסתיים', 'בחלוק', 'finish', 'done', 'end'
    ];
    
    return finishingWords.some(word => msg === word || msg.includes(word));
}

// הוספת תמיכה במילים נוספות לחזרה לתפריט בכל שלב:
function isMenuRequest(message) {
    const msg = message.toLowerCase().trim();
    const menuWords = [
        'תפריט', 'תפריט ראשי', 'חזרה', 'התחלה מחדש', 
        'ביטול', 'לבטל', 'menu', 'main', 'cancel', 'restart'
    ];
    
    return menuWords.some(word => msg === word || msg.includes(word));
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
                this.memory.addMessage(phone, `זוהה כלקוח: ${customer.name}`, 'system', customer);
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
                    response: `שלום ${customer.name} 👋\n\n🔧 **תיאור התקלה:**\n\nאנא כתוב תיאור קצר של התקלה\n\n📷 **אפשר לצרף:** תמונה או סרטון\n\nדוגמאות:\n• "היחידה לא דולקת"\n• "מחסום לא עולה"\n• "לא מדפיס כרטיסים"\n• "המתן מספר שניות לתשובה"\n\n📞 039792365`,
                    stage: 'problem_description',
                    customer: customer
                };
            }
            
// נזק
if (msg === '2' || msg.includes('נזק')) {
    this.memory.updateStage(phone, 'damage_photo', customer);
    return {
        response: `שלום ${customer.name} 👋\n\n📷 **דיווח נזק:**\n\nאנא שלח תמונות/סרטונים/מסמכים של הנזק + מספר היחידה\n\n📎 **ניתן לשלוח עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, Word, Excel\n\nדוגמה: תמונות + "יחידה 101"\n\n📞 039792365`,
        stage: 'damage_photo',
        customer: customer
    };
}

// הצעת מחיר
if (msg === '3' || msg.includes('מחיר')) {
    this.memory.updateStage(phone, 'order_request', customer);
    return {
        response: `שלום ${customer.name} 👋\n\n💰 **הצעת מחיר / הזמנה**\n\nמה אתה מבקש להזמין?\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel, סרטונים\n\nדוגמאות:\n• "20,000 כרטיסים"\n• "3 גלילים נייר" + תמונה\n• "זרוע חלופית" + PDF מפרט\n\n📞 039792365`,
        stage: 'order_request',
        customer: customer
    };
}

// הדרכה
if (msg === '4' || msg.includes('הדרכה')) {
    this.memory.updateStage(phone, 'training_request', customer);
    return {
        response: `שלום ${customer.name} 👋\n\n📚 **הדרכה**\n\nבאיזה נושא אתה זקוק להדרכה?\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, מסמכים\n\nדוגמאות:\n• "הפעלת המערכת" + תמונת מסך\n• "החלפת נייר"\n• "טיפול בתקלות" \n• "המתן מספר שניות לתשובה"\n\n📞 039792365`,
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
    const serviceNumber = await getNextServiceNumber();
    
    // שמירת פרטי התקלה בזיכרון
    this.memory.updateStage(phone, 'processing_problem', customer, {
        serviceNumber: serviceNumber,
        problemDescription: message,
        attachments: downloadedFiles
    });
    
    // ניסיון פתרון עם Assistant קודם
    let solution;
    if (process.env.OPENAI_ASSISTANT_ID) {
        log('INFO', '🤖 מנסה פתרון עם OpenAI Assistant...');
        solution = await handleProblemWithAssistant(message, customer);
    } else {
        log('INFO', '🔧 Assistant לא זמין - משתמש בשיטה הרגילה');
        solution = await findSolution(message, customer);
    }
    
    if (solution.found) {
        // נמצא פתרון - המתן למשוב
        this.memory.updateStage(phone, 'waiting_feedback', customer, {
            serviceNumber: serviceNumber,
            problemDescription: message,
            solution: solution.response,
            attachments: downloadedFiles,
            threadId: solution.threadId || null,
            source: solution.source || 'database'
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

async handleOrderRequest(message, phone, customer, hasFile, downloadedFiles) {
    // בדיקה אם הלקוח רוצה לחזור לתפריט
    if (isMenuRequest(message)) {
        this.memory.updateStage(phone, 'menu', customer);
        return {
            response: `🔄 **חזרה לתפריט הראשי**\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`,
            stage: 'menu',
            customer: customer
        };
    }

    const serviceNumber = await getNextServiceNumber();
    
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

// תחליף את הפונקציה handleDamageReport בקוד שלך:
async handleDamageReport(message, phone, customer, hasFile, fileType, downloadedFiles) {
    const msg = message.toLowerCase().trim();
    
    // בדיקה אם הלקוח רוצה לחזור לתפריט
    if (isMenuRequest(message)) {
        this.memory.updateStage(phone, 'menu', customer);
        return {
            response: `🔄 **חזרה לתפריט הראשי**\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`,
            stage: 'menu',
            customer: customer
        };
    }
    
    // בדיקה אם הלקוח רוצה לסיים
    if (isFinishingWord(message)) {
        // בדיקה שיש לפחות קובץ אחד וגם מספר יחידה
        const conversation = this.memory.getConversation(phone, customer);
        const allFiles = downloadedFiles || [];
        
        // חיפוש מספר יחידה בהודעות הקודמות או בהודעה הנוכחית
        let unitNumber = null;
        
        // חיפוש ביחידה בהודעה הנוכחית - תיקון הביטוי הרגולרי
        let unitMatch = message.match(/(\d{1,3})|יחידה\s*(\d{1,3})|מחסום\s*(\d{1,3})|חמסון\s*(\d{1,3})/);
        if (unitMatch) {
            unitNumber = unitMatch[1] || unitMatch[2] || unitMatch[3] || unitMatch[4];
        }
        
        // אם לא נמצא, חפש בהודעות קודמות
        if (!unitNumber && conversation && conversation.messages) {
            for (let i = conversation.messages.length - 1; i >= 0; i--) {
                const pastMessage = conversation.messages[i];
                if (pastMessage.sender === 'customer') {
                    const pastUnitMatch = pastMessage.message.match(/(\d{1,3})|יחידה\s*(\d{1,3})|מחסום\s*(\d{1,3})|חמסון\s*(\d{1,3})/);
                    if (pastUnitMatch) {
                        unitNumber = pastUnitMatch[1] || pastUnitMatch[2] || pastUnitMatch[3] || pastUnitMatch[4];
                        console.log(`DEBUG: נמצא מספר יחידה בהודעה קודמת: ${unitNumber} מתוך: "${pastMessage.message}"`);
                        break;
                    }
                }
            }
        }
        
        console.log(`DEBUG: בדיקת סיום - קבצים: ${allFiles.length}, מספר יחידה: ${unitNumber}`);
        
        // בדיקה שיש קבצים
        if (!allFiles || allFiles.length === 0) {
            return {
                response: `📷 **לא ניתן לסיים - חסרים קבצים**\n\nכדי לדווח על נזק אני צריכה לפחות:\n• תמונה/סרטון אחד של הנזק\n• מספר היחידה\n\nאנא שלח תמונות/סרטונים עם מספר היחידה\n\n📞 039792365`,
                stage: 'damage_photo',
                customer: customer
            };
        }
        
        // בדיקה שיש מספר יחידה
        if (!unitNumber) {
            return {
                response: `📷 **אנא כתוב מספר היחידה**\n\nקיבלתי ${allFiles.length} קבצים ✅\n\nעכשיו אני צריכה את מספר היחידה\n\nדוגמה: "יחידה 101" או "202" או "מחסום 150"\n\n📞 039792365`,
                stage: 'damage_photo',
                customer: customer
            };
        }
        
        // אם הכל בסדר - סיום ושליחת מייל
        const serviceNumber = await getNextServiceNumber();
        this.memory.updateStage(phone, 'completed', customer);
        
        const filesDescription = allFiles.length > 1 ? `${allFiles.length} קבצים` : fileType;
        
        console.log(`DEBUG: שולח מייל עם ${allFiles.length} קבצים ליחידה ${unitNumber}`);
        
        return {
            response: `✅ **הדיווח הושלם בהצלחה!**\n\nיחידה ${unitNumber} - קיבלתי ${filesDescription}!\n\n🔍 מעביר לטכנאי\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
            stage: 'completed',
            customer: customer,
            serviceNumber: serviceNumber,
            sendTechnicianEmail: true,
            problemDescription: `נזק ביחידה ${unitNumber} - ${message}`,
            attachments: allFiles
        };
    }
    
    // אם יש קובץ חדש - הוסף אותו
    if (hasFile && downloadedFiles && downloadedFiles.length > 0) {
        // הודעת אישור על הקבלת הקובץ
        return {
            response: `✅ **${fileType} התקבל!**\n\nשלח עוד קבצים או כתוב את מספר היחידה\n\n📎 **אפשר לשלוח עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, Word, Excel\n\n✏️ **לסיום:** כתוב "סיום" + מספר היחידה\n\nדוגמה: "סיום יחידה 101"\n\n📞 039792365`,
            stage: 'damage_photo',
            customer: customer
        };
    }
    
    // אם אין קובץ אבל יש טקסט - בדוק אם יש מספר יחידה - תיקון הביטוי הרגולרי
    const unitMatch = message.match(/(\d{1,3})|יחידה\s*(\d{1,3})|מחסום\s*(\d{1,3})|חמסון\s*(\d{1,3})/);
    if (unitMatch) {
        const unit = unitMatch[1] || unitMatch[2] || unitMatch[3] || unitMatch[4];
        console.log(`DEBUG: זוהה מספר יחידה: ${unit} מתוך הודעה: "${message}"`);
        return {
            response: `📝 **מספר יחידה נרשם: ${unit}**\n\nעכשיו שלח תמונות/סרטונים של הנזק\n\n📎 **ניתן לשלוח עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, Word, Excel\n\n✏️ **לסיום:** כתוב "סיום"\n\n📞 039792365`,
            stage: 'damage_photo',
            customer: customer
        };
    }
    
    // אם לא הבין מה הלקוח רוצה
    return {
        response: `📷 **דיווח נזק - הנחיות**\n\nאני צריכה:\n• תמונות/סרטונים של הנזק\n• מספר היחידה\n\n📎 **ניתן לשלוח עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, Word, Excel\n\nדוגמה: תמונות + "יחידה 101" או "מחסום 208"\n\n✏️ **לסיום:** כתוב "סיום"\n\n📞 039792365`,
        stage: 'damage_photo',
        customer: customer
    };
}

async handleTrainingRequest(message, phone, customer, hasFile, downloadedFiles) {
    const serviceNumber = await getNextServiceNumber();
    
    // ניסיון יצירת חומר הדרכה עם Assistant
    let trainingContent = null;
    if (process.env.OPENAI_ASSISTANT_ID) {
        log('INFO', '📚 מנסה הדרכה עם OpenAI Assistant...');
        trainingContent = await handleTrainingWithAssistant(message, customer);
    }
    
    if (trainingContent && trainingContent.success) {
        // נוצר חומר הדרכה מותאם - שלח מיד
        this.memory.updateStage(phone, 'completed', customer);
        
        // שליחת החומר ישירות בWhatsApp (עד 4096 תווים)
        let immediateResponse = `📚 **חומר הדרכה מותאם אישית:**\n\n${trainingContent.content}`;
        
        // אם החומר ארוך מדי, קצר אותו ושלח גם למייל
        if (immediateResponse.length > 4000) {
            const shortContent = trainingContent.content.substring(0, 3500) + "...\n\n📧 **החומר המלא נשלח למייל**";
            immediateResponse = `📚 **חומר הדרכה מותאם אישית:**\n\n${shortContent}`;
        }
        
        immediateResponse += `\n\n🆔 מספר קריאה: ${serviceNumber}\n📞 039792365`;
        
        return {
            response: immediateResponse,
            stage: 'completed',
            customer: customer,
            serviceNumber: serviceNumber,
            sendTrainingEmail: true,
            trainingRequest: message,
            trainingContent: trainingContent.content,
            attachments: downloadedFiles
        };

    } else {
        // Assistant לא זמין או נכשל - שיטה רגילה
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
       if (extraData.trainingContent) {
            conversationSummary += `<div style="background: #e8f5e8; padding: 15px; border-radius: 5px; margin-top: 10px;"><h4>📚 חומר הדרכה מותאם:</h4><div style="white-space: pre-line;">${extraData.trainingContent.replace(/\n/g, '<br>')}</div></div>`;
        }
        if (extraData.resolved !== undefined) {
            const status = extraData.resolved ? '✅ נפתר בהצלחה' : '❌ לא נפתר - נשלח טכנאי';
            conversationSummary += `<p><strong>סטטוס:</strong> <span style="color: ${extraData.resolved ? 'green' : 'red'};">${status}</span></p>`;
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
    try {
        mailOptions.attachments = extraData.attachments.map(filePath => {
            const fileName = path.basename(filePath);
            return {
                filename: fileName,
                path: filePath
            };
        });
        log('INFO', `📎 מצרף ${extraData.attachments.length} קבצים למייל`);
    } catch (attachmentError) {
        log('ERROR', '❌ שגיאה בהכנת קבצים מצורפים:', attachmentError.message);
    }
}

        await transporter.sendMail(mailOptions);
        log('INFO', `📧 מייל נשלח: ${type} - ${customer.name} - ${serviceNumber}${extraData.attachments ? ` עם ${extraData.attachments.length} קבצים` : ''}`);
        
// כתיבה ל-Google Sheets
        const serviceData = {
            serviceNumber: serviceNumber,
            timestamp: getIsraeliTime(),
            referenceType: type === 'technician' ? 'problem' : type === 'order' ? 'order' : type === 'training' ? 'training' : 'problem',
            customerName: customer.name,
            customerSite: customer.site,
            problemDescription: extraData.problemDescription || extraData.orderDetails || extraData.trainingRequest || details,
            resolved: extraData.resolved !== undefined ? (extraData.resolved ? 'כן' : 'לא') : 'בטיפול'
        };
        
        await writeToGoogleSheets(serviceData);

} catch (error) {
    log('ERROR', '❌ שגיאת מייל מפורטת:', error.message);
    log('ERROR', 'פרטים נוספים:', error);
}
}

// קביעת סוג קובץ
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
            if (mimeType.includes('webp')) return '.webp';
            return '.jpg'; // ברירת מחדל לתמונות
        } else if (mimeType.startsWith('video/')) {
            if (mimeType.includes('mp4')) return '.mp4';
            if (mimeType.includes('avi')) return '.avi';
            if (mimeType.includes('quicktime')) return '.mov';
            if (mimeType.includes('x-msvideo')) return '.avi';
            return '.mp4'; // ברירת מחדל לסרטונים
        } else if (mimeType.includes('pdf')) {
            return '.pdf';
        } else if (mimeType.includes('msword') || mimeType.includes('wordprocessingml')) {
            return mimeType.includes('wordprocessingml') ? '.docx' : '.doc';
        } else if (mimeType.includes('excel') || mimeType.includes('spreadsheetml')) {
            return mimeType.includes('spreadsheetml') ? '.xlsx' : '.xls';
        } else if (mimeType.includes('powerpoint') || mimeType.includes('presentationml')) {
            return mimeType.includes('presentationml') ? '.pptx' : '.ppt';
        } else if (mimeType.includes('text/plain')) {
            return '.txt';
        }
    }
    
    return '.file'; // ברירת מחדל
}

// פונקציה לזיהוי סוג קובץ - הוסף אחרי getFileExtension
function getFileType(fileName, mimeType) {
    const extension = fileName ? fileName.toLowerCase() : '';
    
    // תמונות
    if (mimeType?.startsWith('image/') || extension.match(/\.(jpg|jpeg|png|gif|bmp|webp|tiff)$/)) {
        return 'תמונה';
    }
    
    // סרטונים
    if (mimeType?.startsWith('video/') || extension.match(/\.(mp4|avi|mov|wmv|mkv|flv|webm|3gp)$/)) {
        return 'סרטון';
    }
    
    // מסמכי PDF
    if (mimeType?.includes('pdf') || extension.includes('.pdf')) {
        return 'PDF';
    }
    
    // מסמכי Word
    if (mimeType?.includes('msword') || mimeType?.includes('wordprocessingml') || 
        extension.match(/\.(doc|docx)$/)) {
        return 'מסמך Word';
    }
    
    // מסמכי Excel
    if (mimeType?.includes('excel') || mimeType?.includes('spreadsheetml') || 
        extension.match(/\.(xls|xlsx)$/)) {
        return 'קובץ Excel';
    }
    
    // מסמכי PowerPoint
    if (mimeType?.includes('powerpoint') || mimeType?.includes('presentationml') || 
        extension.match(/\.(ppt|pptx)$/)) {
        return 'מצגת PowerPoint';
    }
    
    // קבצי טקסט
    if (mimeType?.includes('text/') || extension.match(/\.(txt|rtf)$/)) {
        return 'קובץ טקסט';
    }
    
    // קבצי אודיו
    if (mimeType?.startsWith('audio/') || extension.match(/\.(mp3|wav|ogg|m4a|aac)$/)) {
        return 'קובץ אודיו';
    }
    
    return 'קובץ';
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
        
// עיבוד טקסט - הגרסה הסופית והנכונה
if (messageData.textMessageData) {
    messageText = messageData.textMessageData.textMessage;
} else if (messageData.fileMessageData) {
    hasFile = true;
    messageText = messageData.fileMessageData.caption || 'שלח קובץ';
    
    const fileName = messageData.fileMessageData.fileName || '';
    const mimeType = messageData.fileMessageData.mimeType || '';
    
    fileType = getFileType(fileName, mimeType); // 🔧 רק השורה הזו!
    log('INFO', `📁 ${fileType}: ${fileName}`);
}

      log('INFO', `📞 הודעה מ-${phone} (${customerName}): ${messageText}`);
        
// זיהוי לקוח
let customer = findCustomerByPhone(phone);

// בדיקה אם יש לקוח בזיכרון
const existingConv = memory.getConversation(phone);
if (existingConv && existingConv.customer && !customer) {
    customer = existingConv.customer;
    log('DEBUG', `🔍 נמצא לקוח בזיכרון: ${customer.name}`);
}

log('DEBUG', `🎯 מעבד הודעה: טלפון=${phone}, לקוח=${customer ? customer.name : 'לא מזוהה'}, הודעה="${messageText}"`);

const currentConv = memory.getConversation(phone, customer);
log('DEBUG', `💭 conversation נוכחי: שלב=${currentConv ? currentConv.stage : 'אין'}, לקוח=${currentConv?.customer?.name || 'אין'}`);

// הורדת קבצים אם יש - עם הגבלת 4 קבצים מקסימום
if (hasFile && messageData.fileMessageData && messageData.fileMessageData.downloadUrl) {
    const conversation = memory.getConversation(phone, customer);
    const existingFiles = conversation?.data?.tempFiles || [];
    
    // בדיקה שלא חורגים מ-4 קבצים בסה"כ
    if (existingFiles.length >= 4) {
        await sendWhatsApp(phone, `⚠️ **הגבלת קבצים**\n\nניתן לשלוח עד 4 קבצים בלבד בפנייה אחת.\n\nכתוב "סיום" כדי לסיים עם הקבצים הקיימים\n\nאו שלח "תפריט" לחזרה לתפריט הראשי\n\n📞 039792365`);
        return res.status(200).json({ status: 'OK - file limit reached' });
    }
    
    const timestamp = Date.now();
    const fileExtension = getFileExtension(messageData.fileMessageData.fileName || '', messageData.fileMessageData.mimeType || '');
    const fileName = `file_${customer ? customer.id : 'unknown'}_${timestamp}${fileExtension}`;
    
    const filePath = await downloadWhatsAppFile(messageData.fileMessageData.downloadUrl, fileName);
    if (filePath) {
        downloadedFiles.push(filePath);
        log('INFO', `✅ ${fileType} הורד: ${fileName}`);
        
        // שמירת הקובץ בזיכרון הזמני של השיחה
        const updatedFiles = [...existingFiles, { path: filePath, type: fileType, name: fileName }];
        memory.updateStage(phone, conversation?.stage || 'identifying', customer, { 
            ...conversation?.data, 
            tempFiles: updatedFiles 
        });
        
        // הודעת אישור עם הנחיות ברורות
        const filesSummary = updatedFiles.map((file, index) => `${index + 1}. ${file.type}`).join('\n');
        const remainingSlots = 4 - updatedFiles.length;
        
        let confirmMessage = `✅ **${fileType} התקבל בהצלחה!**\n\nקבצים שהתקבלו (${updatedFiles.length}/4):\n${filesSummary}`;
        
        if (remainingSlots > 0) {
            confirmMessage += `\n\n📎 ניתן לשלוח עוד ${remainingSlots} קבצים`;
        }
        
        // הנחיות ברורות לסיום
        if (conversation?.stage === 'damage_photo') {
            confirmMessage += `\n\n✏️ **לסיום הדיווח:** כתוב "סיום" + מספר היחידה`;
            confirmMessage += `\nדוגמה: "סיום יחידה 101"`;
        } else {
            confirmMessage += `\n\n✏️ **לסיום:** כתוב "סיום"`;
        }
        
        confirmMessage += `\n\n📞 039792365`;
        
        await sendWhatsApp(phone, confirmMessage);
        return res.status(200).json({ status: 'OK - file received' });
    }
}

// הוספה לזיכרון
memory.addMessage(phone, messageText, 'customer', customer);

// אם יש קבצים זמניים, הוסף אותם לקבצים הנוכחיים
const conversation = memory.getConversation(phone, customer);
const tempFiles = conversation?.data?.tempFiles || [];
if (tempFiles.length > 0) {
    downloadedFiles = [...downloadedFiles, ...tempFiles.map(f => f.path)];
    // נקה את הקבצים הזמניים מהזיכרון רק אם הלקוח סיים
    if (messageText.toLowerCase().includes('סיום') || 
        messageText.toLowerCase().includes('לסיים') || 
        messageText.toLowerCase().includes('להגיש')) {
        memory.updateStage(phone, conversation?.stage, customer, { 
            ...conversation?.data, 
            tempFiles: [] 
        });
    }
}

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
        trainingContent: result.trainingContent,
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

// 🔧 בדיקות מערכת - חדש!
function checkOpenAIConfig() {
    console.log('🔍 בדיקת הגדרות OpenAI Assistant:');
    console.log('OPENAI_ASSISTANT_ID:', process.env.OPENAI_ASSISTANT_ID ? '✅ מוגדר' : '❌ חסר');
    console.log('OPENAI_VECTOR_STORE_ID:', process.env.OPENAI_VECTOR_STORE_ID ? '✅ מוגדר' : '❌ חסר');
    console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ מוגדר' : '❌ חסר');
    
    if (process.env.OPENAI_ASSISTANT_ID && process.env.OPENAI_API_KEY) {
        console.log('🤖 Assistant מוכן לפעולה!');
    } else {
        console.log('⚠️ Assistant לא יפעל - משתמש בשיטה הרגילה');
    }
}

checkOpenAIConfig();

// בדיקת Google Sheets
function checkGoogleSheetsConfig() {
    console.log('🔍 בדיקת הגדרות Google Sheets:');
    console.log('GOOGLE_SHEETS_ID:', process.env.GOOGLE_SHEETS_ID ? '✅ מוגדר' : '❌ חסר');
    console.log('GOOGLE_SERVICE_ACCOUNT_EMAIL:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? '✅ מוגדר' : '❌ חסר');
    console.log('GOOGLE_PRIVATE_KEY:', process.env.GOOGLE_PRIVATE_KEY ? '✅ מוגדר' : '❌ חסר');
    
    if (process.env.GOOGLE_SHEETS_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        console.log('📊 Google Sheets מוכן לפעולה!');
    } else {
        console.log('⚠️ Google Sheets לא יפעל - חסרים פרמטרים');
    }
}

checkGoogleSheetsConfig();

module.exports = app;
