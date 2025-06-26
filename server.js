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
    try {
        if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEETS_ID) {
            log('WARN', '⚠️ Google Sheets לא מוגדר');
            return false;
        }

        auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const authClient = await auth.getClient();
        google.options({ auth: authClient });
        
        log('INFO', '📊 Google Sheets מחובר');
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
            serviceData.referenceType || 'guest', // ברירת מחדל לאורח
            serviceData.customerName || 'לקוח חדש',
            serviceData.customerSite || 'לא מזוהה',
            serviceData.problemDescription || 'פנייה כללית',
            serviceData.resolved || 'התקבל'
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
            formattedResponse += `\n\n❓ **האם הפתרון עזר?**\n\n✅ כתוב "כן" אם הבעיה נפתרה\n❌ כתוב "לא" אם עדיין יש בעיה\n\n🟡 רשום כן/לא לשליחת מייל`;
            
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

// טעינת לקוחות עם דיבוג משופר
try {
    const customersData = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
    
    // בדיקת המבנה של הקובץ
    log('DEBUG', '🔍 בדיקת מבנה קובץ לקוחות:');
    if (customersData.length > 0) {
        const firstCustomer = customersData[0];
        log('DEBUG', 'שדות זמינים:', Object.keys(firstCustomer));
        log('DEBUG', 'דוגמה ללקוח ראשון:', JSON.stringify(firstCustomer, null, 2));
    }
    
customers = customersData.map(client => ({
    id: client["מס' לקוח"] || client["מספר לקוח"] || client.id || client.customer_id || "N/A",
    name: client["שם לקוח"] || client.name || client.customer_name,
    site: client["שם החניון"] || client.site || client.parking_name,
    phone: client["טלפון"] || client.phone || client.phone1 || client.mobile,
    phone1: client["טלפון1"] || client.phone1,
    phone2: client["טלפון2"] || client.phone2, 
    phone3: client["טלפון3"] || client.phone3,
    phone4: client["טלפון4"] || client.phone4,
    address: client["כתובת הלקוח"] || client.address || client.customer_address,
    email: client["דואר אלקטרוני"] || client["מייל"] || client.email
}));
    
log('DEBUG', '🔍 בדיקת שדות לקוח ראשון:');
if (customersData.length > 0) {
    const firstClient = customersData[0];
    log('DEBUG', 'שדות זמינים בקובץ JSON:', Object.keys(firstClient));
    log('DEBUG', 'דוגמה לנתונים מהקובץ:', JSON.stringify(firstClient, null, 2));
    
    // הצגת הלקוח אחרי הניפוי
    const mappedCustomer = customers[0];
    log('DEBUG', 'לקוח אחרי מיפוי:', JSON.stringify(mappedCustomer, null, 2));
}

log('INFO', `📊 נטענו ${customers.length} לקוחות`);

    // הצגת כמה דוגמאות לדיבוג
    log('DEBUG', '👥 דוגמאות לקוחות:');
    customers.slice(0, 3).forEach((customer, index) => {
        log('DEBUG', `${index + 1}. ${customer.name} - טלפון: ${customer.phone}`);
    });
    
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
    const cleanPhone = phone.replace(/[^\d]/g, '');
    return `conv_${cleanPhone}`;
}

// קבלת שיחה - גרסה מתוקנת
getConversation(phone, customer = null) {
    const cleanPhone = phone.replace(/[^\d]/g, '');
    const key = this.createKey(phone, customer);
    
    let conv = this.conversations.get(key);
    
    // אם נמצא conversation ויש לקוח חדש - עדכן אותו
    if (conv && customer && !conv.customer) {
        conv.customer = customer;
        conv.stage = 'menu';
        log('DEBUG', `🔄 עדכנתי conversation עם לקוח: ${customer.name}`);
    }
    
    return conv;
}
    
// יצירת או עדכון שיחה - גרסה מתוקנת
createOrUpdateConversation(phone, customer = null, initialStage = 'identifying') {
    const key = this.createKey(phone, customer);
    let conv = this.conversations.get(key);
    
    if (conv) {
        // עדכן conversation קיים
        conv.lastActivity = new Date();
        if (customer && !conv.customer) {
            conv.customer = customer;
            conv.stage = 'menu';
        }
        log('DEBUG', `🔄 מצאתי conversation קיים - שלב: ${conv.stage}`);
        return conv;
    }
    
    // יצירת conversation חדש
    conv = {
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

class MessageTracker {
    constructor() {
        this.processedMessages = new Map(); // שנה ל-Map עם זמן
        setInterval(() => this.cleanup(), 30 * 60 * 1000); // 30 דקות במקום 10
    }
    
    isProcessed(messageId) {
        const entry = this.processedMessages.get(messageId);
        if (!entry) return false;
        // אם עברו יותר מ-30 דקות, נחשב שלא עובד
        return (Date.now() - entry.timestamp) < 30 * 60 * 1000;
    }
    
    markProcessed(messageId) {
        this.processedMessages.set(messageId, { timestamp: Date.now() });
    }
    
    cleanup() {
        const now = Date.now();
        for (const [messageId, entry] of this.processedMessages.entries()) {
            if (now - entry.timestamp > 30 * 60 * 1000) {
                this.processedMessages.delete(messageId);
            }
        }
    }
}

const messageTracker = new MessageTracker();
const memory = new AdvancedMemory();

// מחלקת טיימרים אוטומטיים
class AutoFinishManager {
    constructor() {
        this.timers = new Map(); // טיימרים פעילים
        this.TIMEOUT_DURATION = 90 * 1000; // 90 שניות במילישניות
        log('INFO', '⏰ מנהל סיום אוטומטי הופעל');
    }
    
    // התחלת טיימר חדש או איפוס קיים
    startTimer(phone, customer, stage, callback) {
        const key = this.createKey(phone);
        
        // אם יש טיימר קיים - בטל אותו
        this.clearTimer(phone);
        
        log('INFO', `⏱️ התחלת טיימר 90 שניות עבור ${customer ? customer.name : phone} בשלב ${stage}`);
        
        const timer = setTimeout(() => {
            log('INFO', `⏰ טיימר פג עבור ${customer ? customer.name : phone} - מפעיל סיום אוטומטי`);
            this.timers.delete(key);
            callback(phone, customer, stage);
        }, this.TIMEOUT_DURATION);
        
        this.timers.set(key, {
            timer: timer,
            customer: customer,
            stage: stage,
            startTime: Date.now()
        });
    }
    
    // ביטול טיימר
    clearTimer(phone) {
        const key = this.createKey(phone);
        const timerData = this.timers.get(key);
        
        if (timerData) {
            clearTimeout(timerData.timer);
            this.timers.delete(key);
            
            const elapsed = Math.round((Date.now() - timerData.startTime) / 1000);
            log('INFO', `⏹️ טיימר בוטל עבור ${phone} (פעל ${elapsed} שניות)`);
        }
    }
    
    // יצירת מפתח
    createKey(phone) {
        return `timer_${phone.replace(/[^\d]/g, '')}`;
    }
    
    // איפוס טיימר (הפעלה מחדש)
    resetTimer(phone, customer, stage, callback) {
        this.startTimer(phone, customer, stage, callback);
    }
    
    // סטטיסטיקות
    getActiveTimers() {
        return this.timers.size;
    }
    
    // ניקוי כל הטיימרים
    clearAllTimers() {
        this.timers.forEach((timerData, key) => {
            clearTimeout(timerData.timer);
        });
        this.timers.clear();
        log('INFO', '🧹 כל הטיימרים נוקו');
    }
}

// יצירת מופע גלובלי
const autoFinishManager = new AutoFinishManager();

// פונקציה לטיפול בסיום אוטומטי
async function handleAutoFinish(phone, customer, stage) {
    try {
        log('INFO', `🤖 מבצע סיום אוטומטי עבור ${customer ? customer.name : phone} בשלב ${stage}`);
        
        // בדיקה באיזה שלב אנחנו וביצוע סיום מתאים
        if (stage === 'waiting_feedback') {
            await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 90 שניות**\n❌ לא התקבל משוב על הפתרון\n\n🔧מעביר את הפנייה לטכנאי \n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה `);
            
            // שלח מייל טכנאי
            const conversation = memory.getConversation(phone, customer);
            if (conversation && conversation.data) {
                const serviceNumber = await getNextServiceNumber();
                await sendEmail(customer, 'technician', conversation.data.problemDescription, {
                    serviceNumber: serviceNumber,
                    problemDescription: conversation.data.problemDescription,
                    solution: conversation.data.solution,
                    resolved: false,
                    attachments: conversation.data.attachments
                });
            }
            
        } else if (stage === 'waiting_training_feedback') {
            await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 90 שניות**\n\n❌ לא התקבל משוב על ההדרכה\n\n📧 אשלח הדרכה מפורטת למייל\n\n📞 039792365`);
            
        } else if (stage === 'damage_photo') {
            await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 90 שניות**\n\n❌ לא התקבלו קבצים נוספים\n\nכדי לדווח על נזק יש צורך לפחות ב:\n• תמונה/סרטון של הנזק\n• מספר היחידה\n\nאנא התחל מחדש ושלח קבצים עם מספר יחידה\n\n📞 039792365`);
            
        } else if (stage === 'order_request') {
            await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 90 שניות**\n\n❌ לא התקבלה הזמנה מפורטת\n\nכדי להזמין יש לכתוב פרטי ההזמנה\n\nאנא התחל מחדש וכתוב מה ברצונך להזמין\n\n📞 039792365`);
            
        } else if (stage === 'training_request') {
            await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 90 שניות**\n\n❌ לא התקבלה בקשת הדרכה מפורטת\n\nכדי לקבל הדרכה יש לציין את הנושא\n\nאנא התחל מחדש וכתוב על איזה נושא אתה זקוק להדרכה\n\n📞 039792365`);
            
        } else if (stage === 'general_office_request') {
            await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 90 שניות**\n\n❌ לא התקבלה פנייה מפורטת\n\nכדי לפנות למשרד יש לכתוב את נושא הפנייה\n\nאנא התחל מחדש וכתוב את בקשתך\n\n📞 039792365`);
            
        } else {
            // ברירת מחדל
            await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 90 שניות**\n\n❌ לא התקבלה תגובה\n\nאנא התחל מחדש או צור קשר:\n📞 039792365`);
        }
        
        // איפוס השיחה לתפריט הראשי
        if (customer) {
            memory.updateStage(phone, 'menu', customer);
        } else {
            memory.updateStage(phone, 'identifying', null);
        }
        
    } catch (error) {
        log('ERROR', '❌ שגיאה בסיום אוטומטי:', error.message);
    }
}

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
    const cleanIncomingPhone = phone.replace(/[^\d]/g, '');
    
    log('DEBUG', `🔍 מחפש לקוח עבור טלפון נכנס: ${phone} -> נקי: ${cleanIncomingPhone}`);
    
    function normalizePhone(phoneNumber) {
        if (!phoneNumber) return '';
        
        // הסרת כל התווים שאינם ספרות
        let clean = phoneNumber.replace(/[^\d]/g, '');
        
        // רשימת נורמליזציות אפשריות
        const normalized = [];
        
        // הוספת המספר כפי שהוא
        normalized.push(clean);
        
        // אם מתחיל ב-972 (קוד ישראל) - הוסף גרסה ללא 972
        if (clean.startsWith('972')) {
            normalized.push(clean.substring(3));
        }
        
        // אם מתחיל ב-0 - הוסף גרסה עם 972
        if (clean.startsWith('0')) {
            normalized.push('972' + clean.substring(1));
            normalized.push(clean.substring(1)); // גם בלי ה-0
        }
        
        // אם לא מתחיל ב-972 או ב-0, נסה להוסיף 972
        if (!clean.startsWith('972') && !clean.startsWith('0') && clean.length >= 9) {
            normalized.push('972' + clean);
            normalized.push('0' + clean);
        }
        
        // אם מתחיל ב-5 (סלולרי ישראלי) - הוסף גרסאות נוספות
        if (clean.startsWith('5') && clean.length === 9) {
            normalized.push('0' + clean);
            normalized.push('972' + clean);
        }
        
        return [...new Set(normalized)]; // הסרת כפילויות
    }
    
    // נורמליזציה של הטלפון הנכנס
    const incomingVariations = normalizePhone(cleanIncomingPhone);
    
    log('DEBUG', `📱 וריאציות טלפון נכנס: ${incomingVariations.join(', ')}`);
    
    // חיפוש בכל הלקוחות
    for (const customer of customers) {
        const phoneFields = [
            customer.phone, 
            customer.phone1, 
            customer.phone2, 
            customer.phone3, 
            customer.phone4,
            customer.טלפון, // אולי יש שדה עברית
            customer.mobile,
            customer.cell
        ].filter(p => p && p.trim() !== '');
        
        for (const customerPhone of phoneFields) {
            const customerVariations = normalizePhone(customerPhone);
            
            // בדיקת התאמה בין כל הוריאציות
            for (const incomingVar of incomingVariations) {
                for (const customerVar of customerVariations) {
                    // התאמה מדויקת
                    if (incomingVar === customerVar) {
                        log('INFO', `✅ התאמה מדויקת: ${incomingVar} = ${customerVar} ללקוח ${customer.name}`);
                        return customer;
                    }
                    
                    // התאמה חלקית (8-9 ספרות אחרונות)
                    if (incomingVar.length >= 8 && customerVar.length >= 8) {
                        const incomingSuffix = incomingVar.slice(-9);
                        const customerSuffix = customerVar.slice(-9);
                        
                        if (incomingSuffix === customerSuffix) {
                            log('INFO', `✅ התאמה חלקית: ${incomingSuffix} ללקוח ${customer.name}`);
                            return customer;
                        }
                    }
                }
            }
        }
    }
    
    log('WARN', `⚠️ לא נמצא לקוח עבור טלפון: ${phone} (נורמליזציות: ${incomingVariations.join(', ')})`);
    return null;
}

// זיהוי לקוח לפי שם חניון - מהקוד המקורי שעובד
function findCustomerByName(message) {
    const msg = message.toLowerCase().trim();
    
    log('DEBUG', `🔍 מחפש לקוח עבור: "${msg}"`);
    
    // מילות מפתח לניקוי
    const wordsToRemove = ['חניון', 'מרכז', 'קניון', 'מגדל', 'בית', 'פארק', 'סנטר', 'מול'];
    
    // ניקוי הטקסט
    let cleanMsg = msg;
    wordsToRemove.forEach(word => {
        cleanMsg = cleanMsg.replace(new RegExp(`\\b${word}\\b`, 'g'), '').trim();
    });
    
    log('DEBUG', `🧹 טקסט נקי: "${cleanMsg}"`);
    
    // חיפוש מדויק לפי שם חניון
    let bestMatch = null;
    let bestScore = 0;
    
    customers.forEach(customer => {
        if (!customer.site) return;
        
        const siteName = customer.site.toLowerCase();
        let score = 0;
        
        // בדיקה אם המילה קיימת בשם החניון
        const msgWords = cleanMsg.split(/\s+/).filter(word => word.length > 2);
        
        msgWords.forEach(msgWord => {
            if (siteName.includes(msgWord)) {
                score += msgWord.length * 2; // ציון כפול למילים ארוכות
                log('DEBUG', `✅ התאמה: "${msgWord}" נמצא ב-"${siteName}" (+${msgWord.length * 2})`);
            }
        });
        
        // התאמות מיוחדות לחניונים נפוצים
        const specialMatches = {
            'דיזינגוף': ['דיזינגוף', 'dizengoff'],
            'עזריאלי': ['עזריאלי', 'azrieli'],
            'אינפיניטי': ['אינפיניטי', 'infinity'],
            'גבעתיים': ['גבעתיים', 'givatayim'],
            'מודיעין': ['מודיעין', 'modiin'],
            'אלקטרה': ['אלקטרה', 'electra'],
            'ביג': ['ביג', 'big'],
            'פנורמה': ['פנורמה', 'panorama']
        };
        
        Object.entries(specialMatches).forEach(([key, variations]) => {
            variations.forEach(variation => {
                if (siteName.includes(key) && cleanMsg.includes(variation)) {
                    score += 20;
                    log('DEBUG', `🎯 התאמה מיוחדת: ${variation} ל-${key} (+20)`);
                }
            });
        });
        
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
        
        let confidence = 'low';
        if (bestScore >= 20) confidence = 'high';
        else if (bestScore >= 10) confidence = 'medium';
        
        return { 
            customer: bestMatch, 
            confidence: confidence,
            method: `זוהה לפי שם החניון: ${bestMatch.site} (ציון: ${bestScore})`
        };
    }
    
    log('WARN', 'לא נמצא לקוח מתאים');
    return null;
}

async function findSolution(problemDescription, customer) {
    try {
        log('INFO', '🔍 מחפש פתרון במסד תקלות עם OpenAI...');
        
        if (!serviceFailureDB || !Array.isArray(serviceFailureDB) || serviceFailureDB.length === 0) {
            log('ERROR', '❌ מסד התקלות ריק');
            return await findSolutionFallback(problemDescription);
        }

        // בדיקה מהירה של API Key
        if (!process.env.OPENAI_API_KEY?.startsWith('sk-')) {
            log('WARN', '⚠️ OpenAI API Key לא תקין - עובר ל-fallback');
            return await findSolutionFallback(problemDescription);
        }
        
        try {
            // prompt קצר ומהיר יותר
            const scenariosText = serviceFailureDB.map((scenario, index) => 
                `${index + 1}. ${scenario.תרחיש}`
            ).join('\n');
            
            const prompt = `תיאור התקלה: "${problemDescription}"
            
תרחישים:
${scenariosText}

החזר רק מספר (1-${serviceFailureDB.length}) או 0 אם אין התאמה:`;

            log('DEBUG', '🤖 שולח ל-OpenAI...');
            
            // קריאה מהירה יותר עם timeout קצר
            const completion = await Promise.race([
                openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 5,
                    temperature: 0
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('OpenAI timeout')), 5000) // 5 שניות במקום 10
                )
            ]);
            
            const aiResponse = completion.choices[0].message.content.trim();
            const scenarioNumber = parseInt(aiResponse);
            
            log('INFO', `🤖 OpenAI: "${aiResponse}" -> תרחיש: ${scenarioNumber}`);
            
            if (scenarioNumber > 0 && scenarioNumber <= serviceFailureDB.length) {
                const scenario = serviceFailureDB[scenarioNumber - 1];
                
                let solution = `🔧 **פתרון: ${scenario.תרחיש}**\n\n📋 **שלבים:**\n${scenario.שלבים}`;
                
                if (scenario.הערות) {
                    solution += `\n\n💡 **הערות:** ${scenario.הערות}`;
                }
                
                solution += `\n\n❓ **האם הפתרון עזר?** (כן/לא)`;
                
                log('INFO', `✅ נמצא פתרון: ${scenario.תרחיש}`);
                return { found: true, response: solution, scenario: scenario };
            } else {
                log('INFO', '⚠️ OpenAI לא מצא פתרון - עובר ל-fallback');
                return await findSolutionFallback(problemDescription);
            }
            
        } catch (aiError) {
            log('ERROR', `❌ שגיאה ב-OpenAI: ${aiError.message}`);
            return await findSolutionFallback(problemDescription);
        }
        
    } catch (error) {
        log('ERROR', `❌ שגיאה כללית: ${error.message}`);
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
                    score += variation.length;
                    log('DEBUG', `✅ נמצאה מילת מפתח: "${variation}" עבור ${keyword} (+${variation.length})`);
                }
            }
            
            if (score > bestScore) {
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
            let solution = `🔧 **פתרון: ${bestMatch.תרחיש}**\n\n${bestMatch.שלבים}`;
            
            if (bestMatch.הערות) {
                solution += `\n\n💡 ${bestMatch.הערות}`;
            }
            
            solution += `\n\n❓ האם עזר? (כן/לא)`;
            
            log('INFO', `✅ Fallback מצא פתרון: ${bestMatch.תרחיש} (ציון: ${bestScore})`);
            return { found: true, response: solution, scenario: bestMatch };
        }
        
        log('INFO', '⚠️ גם fallback לא מצא פתרון מתאים');
        return {
            found: false,
            response: '🔧 **אשלח טכנאי**\n\n⏰ יצור קשר תוך 2-4 שעות בשעות העבודה\n📞 039792365'
        };
        
    } catch (error) {
        log('ERROR', '❌ שגיאה גם ב-fallback:', error.message);
        return {
            found: false,
            response: '🔧 **אשלח טכנאי**\n\n⏰ יצור קשר תוך 2-4 שעות בשעות העבודה\n📞 039792365'
        };
    }
}

// פונקציה חדשה לזיהוי מילות סיום - הוסף לפני ה-ResponseHandler:
function isFinishingWord(message) {
    const msg = message.toLowerCase().trim();
    
    // רשימת מילות סיום מורחבת
    const finishingWords = [
        'סיום', 'לסיים', 'להגיש', 'לשלוח', 'סיימתי', 
        'זהו', 'תם', 'הסתיים', 'בחלק', 'finish', 'done', 'end',
        'תודה', 'תודה רבה', 'די', 'מספיק', 'הכל'
    ];
    
    // בדיקה אם המילה קיימת בהודעה (לא רק כמו שהיא)
    const containsFinishingWord = finishingWords.some(word => 
        msg.includes(word) || msg.startsWith(word) || msg.endsWith(word)
    );
    
    if (containsFinishingWord) {
        log('INFO', `✅ זוהתה מילת סיום בהודעה: "${message}"`);
        return true;
    }
    
    return false;
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
        
        log('INFO', `🎯 מעבד הודעה: "${message}" מ-${customer ? customer.name : 'לא מזוהה'} - שלב: ${conversation ? conversation.stage : 'אין'}`);                
        // ביטול טיימר אוטומטי אם קיים
        autoFinishManager.clearTimer(phone);
        // שלב 1: זיהוי לקוח אם לא קיים
        if (!customer) {
            return await this.handleCustomerIdentification(message, phone, conversation);
        }
        
        // שלב 2: טיפול לפי שלב נוכחי
        return await this.handleByStage(message, phone, customer, conversation, hasFile, fileType, downloadedFiles);
    }

    async handleCustomerIdentification(message, phone, conversation) {
        const msg = message.toLowerCase().trim();
        
        log('DEBUG', `🔍 זיהוי לקוח - הודעה: "${message}"`);
        log('DEBUG', `🔍 msg נקי: "${msg}"`);
        
        // 🔧 טיפול בלקוח אורח - בדיקה מפורטת
        if (msg === '1' || msg === 'לקוח חדש' || msg === 'אינני לקוח' || msg === 'guest') {
            log('INFO', '🆕 לקוח בחר אפשרות אורח');
            
            // מעבר לשלב איסוף פרטי אורח
            this.memory.updateStage(phone, 'guest_details', null, { isGuest: true });
            
            return {
                response: `👋 **ברוכים הבאים ללקוחות חדשים!**\n\nכדי לטפל בפנייתך אני צריכה פרטים:\n\n📝 **אנא כתוב הודעה אחת עם:**\n• שמך המלא\n• מספר טלפון\n• כתובת מייל\n• שם החניון/אתר\n• תיאור הבעיה או הבקשה\n\n**דוגמה:**\nדרור פרינץ\n0545484210\nDror@sbparking.co.il\nחניון עזריאלי\nמבקש הצעת מחיר\n\n📞 039792365`,
                stage: 'guest_details'
            };
        }
        
        // בדיקה אם אנחנו בשלב איסוף פרטי אורח
        if (conversation?.stage === 'guest_details' && conversation?.data?.isGuest) {
            log('INFO', '🔄 בשלב איסוף פרטי אורח');
            
            // הלקוח שלח את הפרטים - סיים את הטיפול
            if (message && message.trim().length > 20) {
                log('INFO', '✅ פרטים מספיקים - סיום טיפול באורח');
                
                const serviceNumber = await getNextServiceNumber();
                this.memory.updateStage(phone, 'completed', null);
                
                // שלח מייל אורח
                await sendGuestEmail(message, phone, serviceNumber);
                // רישום ב-Google Sheets
                const serviceData = {
                   serviceNumber: serviceNumber,
                   timestamp: getIsraeliTime(),
                   referenceType: 'guest',
                   customerName: 'לקוח חדש',
                   customerSite: 'לא מזוהה',
                   problemDescription: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
                   resolved: 'התקבל'
                };
                await writeToGoogleSheets(serviceData);
                
                return {
                    response: `✅ **פנייתך התקבלה בהצלחה!**\n\n📧 המשרד יעבור על הפרטים ויחזור אליך תוך 24-48 שעות\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
                    stage: 'completed',
                    serviceNumber: serviceNumber
                };
            } else {
                log('WARN', '⚠️ פרטים לא מספיקים');
                return {
                    response: `📝 **אנא שלח פרטים מפורטים יותר:**\n\n• שמך המלא\n• מספר טלפון\n• כתובת מייל\n• שם החניון/אתר\n• תיאור הבעיה או הבקשה\n\n**דוגמה:**\nדרור פרינץ\n0545484210\nDror@sbparking.co.il\nחניון עזריאלי\nמבקש הצעת מחיר\n\n📞 039792365`,
                    stage: 'guest_details'
                };
            }
        }
        
        // נסיון זיהוי לפי שם חניון
        const identification = findCustomerByName(message);
        
        if (identification) {
            if (identification.confidence === 'high') {
                const customer = identification.customer;
                this.memory.createOrUpdateConversation(phone, customer, 'menu');
                this.memory.addMessage(phone, `זוהה כלקוח: ${customer.name}`, 'system', customer);
                return {
                    response: `שלום ${customer.name} מחניון ${customer.site} 👋 - אני הבוט של שיידט\n\nזיהיתי אותך!\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
                    stage: 'menu',
                    customer: customer
                };
            } else {
                // שמירת הלקוח הזמני בנתונים
                this.memory.updateStage(phone, 'confirming_identity', null, {
                    tentativeCustomer: identification.customer
                });
                
                return {
                    response: `שלום! 👋 - אני הבוט של שיידט\n\nהאם אתה ${identification.customer.name} מחניון ${identification.customer.site}?\n\n✅ כתוב "כן" לאישור\n❌ או כתוב שם החניון הנכון\n❓ **אם אינך לקוח קיים - כתוב 1**\n\n📞 039792365`,
                    stage: 'confirming_identity',
                    tentativeCustomer: identification.customer
                };
            }
        }
        
        // אישור זהות
        if (conversation?.stage === 'confirming_identity' && conversation.data?.tentativeCustomer) {
            if (message.toLowerCase().includes('כן') || 
                message.toLowerCase().includes('נכון') || 
                message.toLowerCase().includes('תקין') ||
                message.toLowerCase().includes('yes')) {
                
                const customer = conversation.data.tentativeCustomer;
                this.memory.updateStage(phone, 'menu', customer, { tentativeCustomer: null });
                this.memory.addMessage(phone, `אושר כלקוח: ${customer.name}`, 'system', customer);
                
                return {
                    response: `מעולה! שלום ${customer.name} מחניון ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
                    stage: 'menu',
                    customer: customer
                };
            } else {
                // הלקוח אמר לא - נסה זיהוי מחדש
                this.memory.updateStage(phone, 'identifying', null, { tentativeCustomer: null });
                
                // נסה זיהוי לפי ההודעה החדשה
                const newIdentification = findCustomerByName(message);
                if (newIdentification) {
                    if (newIdentification.confidence === 'high') {
                        const customer = newIdentification.customer;
                        this.memory.updateStage(phone, 'menu', customer);
                        return {
                            response: `מעולה! שלום ${customer.name} מחניון ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
                            stage: 'menu',
                            customer: customer
                        };
                    } else {
                        this.memory.updateStage(phone, 'confirming_identity', null, {
                            tentativeCustomer: newIdentification.customer
                        });
                        return {
                            response: `האם אתה ${newIdentification.customer.name} מחניון ${newIdentification.customer.site}?\n\n✅ כתוב "כן" לאישור\n❌ או כתוב שם החניון הנכון\n❓ **אם אינך לקוח קיים - כתוב 1**\n\n📞 039792365`,
                            stage: 'confirming_identity',
                            tentativeCustomer: newIdentification.customer
                        };
                    }
                }
                
                return {
                    response: `לא זיהיתי את החניון.\n\nאנא כתוב את שם החניון הנכון:\n\nדוגמאות:\n• "תפארת העיר"\n• "שניידר"\n• "אינפיניטי"\n• "עזריאלי"\n\n❓ **במידה ואינך לקוח לחץ 1**\n\n📞 039792365`,
                    stage: 'identifying'
                };
            }
        }
        
        // בקשת זיהוי ראשונה
        return {
            response: `שלום! 👋 - אני הבוט של שיידט\n\nכדי לטפל בפנייתך אני צריכה:\n\n🏢 **שם החניון שלך**\n\nדוגמאות:\n• "תפארת העיר"\n• "שניידר" \n• "אינפיניטי"\n• "עזריאלי גבעתיים"\n\n❓ **במידה ואינך לקוח לחץ 1**\n\n📞 039792365`,
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
                    response: `שלום ${customer.name} 👋\n\n🔧 **תיאור התקלה:**\n\nאנא כתוב תיאור קצר של התקלה\n\n📷 **אפשר לצרף:** תמונה או סרטון\n\nדוגמאות:\n• "היחידה לא דולקת"\n• "מחסום לא עולה"\n• "לא מדפיס כרטיסים"\n\nהמתן מספר שניות לתשובה🤞`,
                    stage: 'problem_description',
                    customer: customer
                };
            }
            
// דיווח נזק
if (msg === '2' || msg.includes('נזק')) {
    this.memory.updateStage(phone, 'damage_photo', customer);
    return {
        response: `שלום ${customer.name} 👋 - אני הבוט של שיידט\n\n📷 **דיווח נזק:**\n\nאנא שלח תמונות/סרטונים/מסמכים של הנזק + מספר היחידה\n\n📎 **ניתן לשלוח עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, Word, Excel\n\nדוגמה: תמונות + "יחידה 101"\n\n📞 039792365`,
        stage: 'damage_photo',
        customer: customer
    };
}

// הצעת מחיר
if (msg === '3' || msg.includes('מחיר')) {
    this.memory.updateStage(phone, 'order_request', customer);
    return {
        response: `שלום ${customer.name} 👋 - אני הבוט של שיידט\n\n💰 **הצעת מחיר / הזמנה**\n\nמה אתה מבקש להזמין?\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel, סרטונים\n\nדוגמאות:\n• "20,000 כרטיסים"\n• "3 גלילים נייר" + תמונה\n• "זרוע חלופית" + PDF מפרט\n\n📞 039792365`,
        stage: 'order_request',
        customer: customer
    };
}

// הדרכה
if (msg === '4' || msg.includes('הדרכה')) {
    this.memory.updateStage(phone, 'training_request', customer);
    return {
        response: `שלום ${customer.name} 👋 - אני הבוט של שיידט\n\n📚 **הדרכה**\n\nבאיזה נושא אתה זקוק להדרכה?\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, מסמכים\n\nדוגמאות:\n• "הפעלת המערכת" + תמונת מסך\n• "החלפת נייר"\n• "טיפול בתקלות" \n\nהמתן מספר שניות לתשובה🤞`,
        stage: 'training_request',
        customer: customer
    };
}

// משרד כללי
if (msg === '5' || msg.includes('משרד')) {
    this.memory.updateStage(phone, 'general_office_request', customer);
    return {
        response: `שלום ${customer.name} 👋 - אני הבוט של שיידט\n\n🏢 **פנייה למשרד כללי**\n\nאנא תאר את בקשתך או הנושא שברצונך לטפל בו\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel, מסמכים\n\nדוגמאות:\n• "עדכון פרטי התקשרות"\n• "בקשה להדרכה מורחבת"\n• "בעיה בחיוב" + קובץ PDF\n\n📞 039792365`,
        stage: 'general_office_request',
        customer: customer
    };
}

            // אם לא הבין - חזור לתפריט
            this.memory.updateStage(phone, 'menu', customer);
            return {
                response: `שלום ${customer.name} מחניון ${customer.site} 👋 - אני הבוט של שיידט\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
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
        if (currentStage === 'waiting_feedback') {
    return await this.handleFeedback(message, phone, customer, conversation);
        }
        // טיפול בהדרכה
        if (currentStage === 'training_request') {
            return await this.handleTrainingRequest(message, phone, customer, hasFile, downloadedFiles);
        }
        // טיפול בפניות משרד כללי
        if (currentStage === 'general_office_request') {
        return await this.handleGeneralOfficeRequest(message, phone, customer, hasFile, downloadedFiles);
        }

        // 🔧 NEW: משוב על הדרכה
        if (currentStage === 'waiting_training_feedback') {
            return await this.handleTrainingFeedback(message, phone, customer, conversation);
        }
        
        // ברירת מחדל - חזור לתפריט
        this.memory.updateStage(phone, 'menu', customer);
        return {
            response: `לא הבנתי את הבקשה.\n\nחזרה לתפריט הראשי:\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
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
    
    // מיד עבד את התקלה - בין אם יש קבצים או לא
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
        // התחל טיימר 90 שניות למשוב
        autoFinishManager.startTimer(phone, customer, 'waiting_feedback', handleAutoFinish);

        let responseMessage = `📋 **קיבלתי את התיאור**\n\n"${message}"`;
        
        // אם יש קבצים מצורפים - הוסף אישור
        if (downloadedFiles && downloadedFiles.length > 0) {
            const fileTypes = downloadedFiles.map((_, index) => `קובץ ${index + 1}`).join(', ');
            responseMessage += `\n\n📎 **קבצים שהתקבלו:** ${fileTypes}`;
        }
        
        responseMessage += `\n\n${solution.response}\n\n🆔 מספר קריאה: ${serviceNumber}`;
        
        return {
            response: responseMessage,
            stage: 'waiting_feedback',
            customer: customer,
            serviceNumber: serviceNumber
        };
    } else {
        // לא נמצא פתרון - שלח טכנאי
        this.memory.updateStage(phone, 'completed', customer);
        
        let responseMessage = `📋 **קיבלתי את התיאור**\n\n"${message}"`;
        
        // אם יש קבצים מצורפים - הוסף אישור
        if (downloadedFiles && downloadedFiles.length > 0) {
            const fileTypes = downloadedFiles.map((_, index) => `קובץ ${index + 1}`).join(', ');
            responseMessage += `\n\n📎 **קבצים שהתקבלו:** ${fileTypes}`;
        }
        
        responseMessage += `\n\n${solution.response}\n\n🆔 מספר קריאה: ${serviceNumber}`;
        
        return {
            response: responseMessage,
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
    const msg = message.toLowerCase().trim();
    const conversation = this.memory.getConversation(phone, customer);
    
    // בדיקה אם הלקוח רוצה לחזור לתפריט
    if (isMenuRequest(message)) {
        this.memory.updateStage(phone, 'menu', customer);
        autoFinishManager.clearTimer(phone);
        return {
            response: `🔄 **חזרה לתפריט הראשי**\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
            stage: 'menu',
            customer: customer
        };
    }
    
    // זיהוי מספר יחידה בהודעה הנוכחית
    let unitNumber = null;
    const unitMatch = message.match(/(?:יחידה\s*)?(?:מחסום\s*)?(?:חמסון\s*)?(?:מספר\s*)?(\d{1,3})/i);
    if (unitMatch) {
        unitNumber = unitMatch[1];
        log('DEBUG', `🎯 זוהה מספר יחידה: ${unitNumber} מתוך הודעה: "${message}"`);
    }
    
    // אם לא נמצא, חפש בהודעות קודמות
    if (!unitNumber && conversation && conversation.messages) {
        for (let i = conversation.messages.length - 1; i >= 0; i--) {
            const pastMessage = conversation.messages[i];
            if (pastMessage.sender === 'customer') {
                const pastUnitMatch = pastMessage.message.match(/(?:יחידה\s*)?(?:מחסום\s*)?(?:חמסון\s*)?(?:מספר\s*)?(\d{1,3})/i);
                if (pastUnitMatch) {
                    unitNumber = pastUnitMatch[1];
                    log('DEBUG', `נמצא מספר יחידה בהודעה קודמת: ${unitNumber}`);
                    break;
                }
            }
        }
    }
    
    // קבלת כל הקבצים
    const tempFiles = conversation?.data?.tempFiles || [];
    const allFiles = [...(downloadedFiles || []), ...tempFiles.map(f => f.path)];
    
    log('DEBUG', `בדיקת סיום - קבצים: ${allFiles.length}, מספר יחידה: ${unitNumber}, יש קובץ חדש: ${hasFile}`);
    
    // סיום אוטומטי אם יש גם קובץ וגם מספר יחידה
    if ((hasFile || allFiles.length > 0) && unitNumber) {
        log('INFO', '✅ יש גם קובץ וגם מספר יחידה - מסיים אוטומטית');
        
        autoFinishManager.clearTimer(phone);
        const serviceNumber = await getNextServiceNumber();
        this.memory.updateStage(phone, 'completed', customer);
        
        const filesDescription = allFiles.length > 1 ? `${allFiles.length} קבצים` : fileType || 'קובץ';
        
        return {
            response: `✅ **הדיווח הושלם בהצלחה!**\n\nיחידה ${unitNumber} - קיבלתי ${filesDescription}!\n\n🔍 מעביר לטכנאי\n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
            stage: 'completed',
            customer: customer,
            serviceNumber: serviceNumber,
            sendDamageEmail: true,
            problemDescription: `נזק ביחידה ${unitNumber} - ${message}`,
            attachments: allFiles
        };
    }
    
    // בדיקה אם הלקוח רוצה לסיים ידנית
    const hasFinishingWord = isFinishingWord(message);
    if (hasFinishingWord) {
        log('INFO', '✅ זוהתה מילת סיום - בודק תנאים להשלמה');
        
        // בדיקה שיש קבצים
        if (!allFiles || allFiles.length === 0) {
            autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
            return {
                response: `📷 **לא ניתן לסיים - חסרים קבצים**\n\nכדי לדווח על נזק אני צריכה לפחות:\n• תמונה/סרטון אחד של הנזק\n• מספר היחידה\n\nאנא שלח תמונות/סרטונים עם מספר היחידה\n\n⏰ **סיום אוטומטי בעוד 90 שניות**\n\n📞 039792365`,
                stage: 'damage_photo',
                customer: customer
            };
        }
        
        // בדיקה שיש מספר יחידה
        if (!unitNumber) {
            autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
            return {
                response: `📷 **אנא כתוב מספר היחידה**\n\nקיבלתי ${allFiles.length} קבצים ✅\n\nעכשיו אני צריכה את מספר היחידה\n\nדוגמה: "יחידה 101" או "202" או "מחסום 150"\n\n⏰ **סיום אוטומטי בעוד 90 שניות**\n\n📞 039792365`,
                stage: 'damage_photo',
                customer: customer
            };
        }
        
        // אם הכל בסדר - סיום
        autoFinishManager.clearTimer(phone);
        const serviceNumber = await getNextServiceNumber();
        this.memory.updateStage(phone, 'completed', customer);
        
        const filesDescription = allFiles.length > 1 ? `${allFiles.length} קבצים` : fileType || 'קובץ';
        
        return {
            response: `✅ **הדיווח הושלם בהצלחה!**\n\nיחידה ${unitNumber} - קיבלתי ${filesDescription}!\n\n🔍 מעביר לטכנאי\n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
            stage: 'completed',
            customer: customer,
            serviceNumber: serviceNumber,
            sendDamageEmail: true,
            problemDescription: `נזק ביחידה ${unitNumber} - ${message}`,
            attachments: allFiles
        };
    }
    
    // אם יש קובץ חדש - הוסף אותו לזמניים
    if (hasFile && downloadedFiles && downloadedFiles.length > 0) {
        const updatedFiles = [...tempFiles, { 
            path: downloadedFiles[0], 
            type: fileType, 
            name: `file_${Date.now()}` 
        }];
        
        this.memory.updateStage(phone, 'damage_photo', customer, { 
            ...conversation?.data, 
            tempFiles: updatedFiles 
        });
        
        // אם יש גם מספר יחידה בהודעה - סיים אוטומטית
        if (unitNumber) {
            log('INFO', '✅ קובץ חדש + מספר יחידה באותה הודעה - מסיים אוטומטית');
            
            autoFinishManager.clearTimer(phone);
            const serviceNumber = await getNextServiceNumber();
            this.memory.updateStage(phone, 'completed', customer);
            
            const allFilesNow = [...downloadedFiles, ...tempFiles.map(f => f.path)];
            
            return {
                response: `✅ **הדיווח הושלם בהצלחה!**\n\nיחידה ${unitNumber} - קיבלתי ${fileType}!\n\n🔍 מעביר לטכנאי\n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
                stage: 'completed',
                customer: customer,
                serviceNumber: serviceNumber,
                sendDamageEmail: true,
                problemDescription: `נזק ביחידה ${unitNumber} - ${message}`,
                attachments: allFilesNow
            };
        }
        
        // אם אין מספר יחידה - בקש אותו
        autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
        
        return {
            response: `✅ **${fileType} התקבל!**\n\nעכשיו אני צריכה את מספר היחידה\n\nדוגמה: "יחידה 101" או "מחסום 208"\n\n✏️ **לסיום:** כתוב מספר היחידה + "סיום"\n\n⏰ **סיום אוטומטי בעוד 90 שניות**\n\n📞 039792365`,
            stage: 'damage_photo',
            customer: customer
        };
    }
    
    // אם אין קובץ אבל יש טקסט - בדוק אם יש מספר יחידה
    if (unitNumber) {
        log('DEBUG', `זוהה מספר יחידה: ${unitNumber} מתוך הודעה: "${message}"`);
        
        autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
        
        return {
            response: `📝 **מספר יחידה נרשם: ${unitNumber}**\n\nעכשיו שלח תמונות/סרטונים של הנזק\n\n📎 **ניתן לשלוח עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, Word, Excel\n\n✏️ **לסיום:** כתוב "סיום"\n\n⏰ **סיום אוטומטי בעוד 90 שניות**\n\n📞 039792365`,
            stage: 'damage_photo',
            customer: customer
        };
    }
    
    // אם לא הבין מה הלקוח רוצה
    autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
    
    return {
        response: `📷 **דיווח נזק - הנחיות**\n\nאני צריכה:\n• תמונות/סרטונים של הנזק\n• מספר היחידה\n\n📎 **ניתן לשלוח עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, Word, Excel\n\nדוגמה: תמונות + "יחידה 101" או "מחסום 208"\n\n✏️ **לסיום:** כתוב "סיום"\n\n⏰ **סיום אוטומטי בעוד 90 שניות**\n\n📞 039792365`,
        stage: 'damage_photo',
        customer: customer
    };
}

async handleOrderRequest(message, phone, customer, hasFile, downloadedFiles) {
    const msg = message.toLowerCase().trim();
    
    // בדיקה אם הלקוח רוצה לחזור לתפריט
    if (isMenuRequest(message)) {
        this.memory.updateStage(phone, 'menu', customer);
        return {
            response: `🔄 **חזרה לתפריט הראשי**\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
            stage: 'menu',
            customer: customer
        };
    }
    
    // בדיקה אם הלקוח רוצה לסיים
    if (message.toLowerCase().includes('סיום') || message.toLowerCase().includes('לסיים')) {
        // חיפוש הזמנה קודמת בשיחה
        const conversation = this.memory.getConversation(phone, customer);
        let orderDescription = '';
        
        if (conversation && conversation.messages) {
            const orderMessages = conversation.messages.filter(msg => 
                msg.sender === 'customer' && 
                msg.message.length > 4 && 
                !msg.message.toLowerCase().includes('סיום') &&
                !msg.message.toLowerCase().includes('לסיים')
            );
            
            if (orderMessages.length > 0) {
                orderDescription = orderMessages[orderMessages.length - 1].message;
            }
        }
        
        // אם לא נמצאה הזמנה קודמת
        if (!orderDescription) {
            return {
                response: `📋 **אנא כתוב מה אתה מבקש להזמין**\n\nדוגמה: "250000 כרטיסים + סיום"\n\n📞 039792365`,
                stage: 'order_request',
                customer: customer
            };
        }
        
        // סיום ההזמנה
        const serviceNumber = await getNextServiceNumber();
        this.memory.updateStage(phone, 'completed', customer);
        
        return {
            response: `✅ **הזמנה התקבלה בהצלחה!**\n\n📋 **מבוקש:** ${orderDescription}\n\n📧 נכין הצעת מחיר ונשלח תוך 24 שעות\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
            stage: 'completed',
            customer: customer,
            serviceNumber: serviceNumber,
            sendOrderEmail: true,
            orderDetails: orderDescription,
            attachments: downloadedFiles
        };
    }

    // אם יש קובץ חדש - הוסף אותו
    if (hasFile && downloadedFiles && downloadedFiles.length > 0) {
        // התחל טיימר 90 שניות
        autoFinishManager.startTimer(phone, customer, 'order_request', handleAutoFinish);
        
        return {
            response: `✅ **קובץ התקבל!**\n\nשלח עוד קבצים או כתוב מה אתה מבקש להזמין\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel, מפרטים\n\n✏️ **לסיום:** כתוב "סיום"\n\nדוגמה: "20,000 כרטיסים + סיום"\n\n⏰ **סיום אוטומטי בעוד 90 שניות**\n\n📞 039792365`,
            stage: 'order_request',
            customer: customer
        };
    }
    
    // טיפול בהודעה רגילה
    if (message && message.trim().length >= 5) {
        return {
            response: `📋 **הזמנה נרשמה:** "${message}"\n\n📎 **רוצה לצרף קבצים?** (תמונות, מפרטים, PDF)\n\nאו כתוב "סיום" כדי לשלוח את ההזמנה\n\n🟡 רשום סיום לשליחת המייל`,
            stage: 'order_request',
            customer: customer
        };
    }
    
    // אם לא הבין מה הלקוח רוצה
    return {
        response: `💰 **הצעת מחיר / הזמנה**\n\nמה אתה מבקש להזמין?\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel\n\nדוגמאות:\n• "20,000 כרטיסים"\n• "3 גלילים נייר" + תמונה\n• "זרוע חלופית" + PDF מפרט\n\n📞 039792365`,
        stage: 'order_request',
        customer: customer
    };
} 

// תחליף את הפונקציה handleTrainingRequest ב-ResponseHandler:

async handleTrainingRequest(message, phone, customer, hasFile, downloadedFiles) {
    const serviceNumber = await getNextServiceNumber();
    
    // בדיקה אם הלקוח רוצה לחזור לתפריט
    if (isMenuRequest(message)) {
        this.memory.updateStage(phone, 'menu', customer);
        return {
            response: `🔄 **חזרה לתפריט הראשי**\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
            stage: 'menu',
            customer: customer
        };
    }
    
    // ניסיון יצירת חומר הדרכה עם Assistant
    let trainingContent = null;
    if (process.env.OPENAI_ASSISTANT_ID) {
        log('INFO', '📚 מנסה הדרכה עם OpenAI Assistant...');
        trainingContent = await handleTrainingWithAssistant(message, customer);
    }
    
    if (trainingContent && trainingContent.success) {
        // נוצר חומר הדרכה מותאם - המתן למשוב כמו בתקלות
        this.memory.updateStage(phone, 'waiting_training_feedback', customer, {
            serviceNumber: serviceNumber,
            trainingRequest: message,
            trainingContent: trainingContent.content,
            attachments: downloadedFiles
        });
        
        // שליחת החומר ישירות בWhatsApp (עד 4096 תווים)
        let immediateResponse = `📚 **חומר הדרכה מותאם אישית:**\n\n${trainingContent.content}`;
        
        // אם החומר ארוך מדי, קצר אותו ושלח גם למייל
        let needsEmail = false;
        if (immediateResponse.length > 4000) {
            const shortContent = trainingContent.content.substring(0, 3500) + "...\n\n📧 **החומר המלא נשלח למייל**";
            immediateResponse = `📚 **חומר הדרכה מותאם אישית:**\n\n${shortContent}`;
            needsEmail = true;
        }
        
        immediateResponse += `\n\n❓ **האם ההדרכה ברורה?** (כן/לא)`;
        immediateResponse += `\n\n🆔 מספר קריאה: ${serviceNumber}`;
        
        return {
            response: immediateResponse,
            stage: 'waiting_training_feedback',
            customer: customer,
            serviceNumber: serviceNumber,
            sendTrainingEmailImmediate: needsEmail, // שלח מייל מיד אם החומר ארוך
            trainingRequest: message,
            trainingContent: trainingContent.content,
            attachments: downloadedFiles
        };

    } else {
        // Assistant לא זמין או נכשל - שיטה רגילה עם מייל
        this.memory.updateStage(phone, 'completed', customer);
        
        return {
            response: `📚 **קיבלתי את בקשת ההדרכה!**\n\n"${message}"\n\n📧 אשלח חומר הדרכה מפורט למייל\n⏰ תוך 24 שעות\n\n❓ **כדי לחזור לתפריט הראשי** - כתוב "תפריט"\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
            stage: 'completed',
            customer: customer,
            serviceNumber: serviceNumber,
            sendTrainingEmail: true,
            trainingRequest: message,
            attachments: downloadedFiles
        };
    }
}

// הוסף פונקציה חדשה לטיפול במשוב הדרכה:
async handleTrainingFeedback(message, phone, customer, conversation) {
    const msg = message.toLowerCase().trim();
    const data = conversation.data;
    
    if (msg.includes('כן') || msg.includes('ברור') || msg.includes('תודה')) {
        this.memory.updateStage(phone, 'menu', customer);
        
        return {
            response: `🎉 **מעולה! ההדרכה הייתה ברורה!**\n\n🔄 **חזרה לתפריט:**\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
            stage: 'menu',
            customer: customer,
            sendTrainingEmailFinal: true,
            serviceNumber: data.serviceNumber,
            resolved: true
        };
    } else if (msg.includes('לא')) {
        this.memory.updateStage(phone, 'menu', customer);
        
        return {
            response: `📚 **אשלח הדרכה מפורטת למייל**\n\n🔄 **חזרה לתפריט:**\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
            stage: 'menu',
            customer: customer,
            sendTrainingEmailExpanded: true,
            serviceNumber: data.serviceNumber,
            resolved: false
        };
    } else {
        return {
            response: `❓ **האם ההדרכה ברורה?** (כן/לא)\n\n🟡 רשום כן/לא לשליחת מייל`,
            stage: 'waiting_training_feedback',
            customer: customer
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
                response: `🔧 **מבין שהפתרון לא עזר**\n\n📋 מעבירה את הפניה לטכנאי מומחה\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה\n📞 039792365\n\n🆔 מספר קריאה: ${data.serviceNumber}`,
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
response: `❓ **האם הפתרון עזר?**\n\n✅ כתוב "כן" אם הבעיה נפתרה\n❌ כתוב "לא" אם עדיין יש בעיה\n\n🟡 רשום כן/לא לשליחת מייל`,
                stage: 'waiting_feedback',
                customer: customer
            };
        }
    }

    async handleGeneralOfficeRequest(message, phone, customer, hasFile, downloadedFiles) {
        const msg = message.toLowerCase().trim();
        
        // בדיקה אם הלקוח רוצה לחזור לתפריט
        if (isMenuRequest(message)) {
            this.memory.updateStage(phone, 'menu', customer);
            return {
                response: `🔄 **חזרה לתפריט הראשי**\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
                stage: 'menu',
                customer: customer
            };
        }
        
        // בדיקה אם הלקוח רוצה לסיים
        if (message.toLowerCase().includes('סיום') || message.toLowerCase().includes('לסיים')) {
            // חיפוש בקשה קודמת בשיחה
            const conversation = this.memory.getConversation(phone, customer);
            let requestDescription = '';
            
            if (conversation && conversation.messages) {
                const requestMessages = conversation.messages.filter(msg => 
                    msg.sender === 'customer' && 
                    msg.message.length > 4 && 
                    !msg.message.toLowerCase().includes('סיום') &&
                    !msg.message.toLowerCase().includes('לסיים')
                );
                
                if (requestMessages.length > 0) {
                    requestDescription = requestMessages[requestMessages.length - 1].message;
                }
            }
            
            // אם לא נמצאה בקשה קודמת
            if (!requestDescription) {
                return {
                    response: `📋 **אנא תאר את בקשתך**\n\nדוגמה: "עדכון פרטי התקשרות + סיום"\n\n📞 039792365`,
                    stage: 'general_office_request',
                    customer: customer
                };
            }
            
            // סיום הבקשה
            const serviceNumber = await getNextServiceNumber();
            this.memory.updateStage(phone, 'completed', customer);
            
            return {
                response: `✅ **פנייה למשרד התקבלה בהצלחה!**\n\n📋 **נושא הפנייה:** ${requestDescription}\n\n📧 המשרד יטפל בפנייתך ויחזור אליך תוך 24-48 שעות\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
                stage: 'completed',
                customer: customer,
                serviceNumber: serviceNumber,
                sendGeneralOfficeEmail: true,
                officeRequestDetails: requestDescription,
                attachments: downloadedFiles
            };
        }

// אם יש קובץ חדש - הוסף אותו
if (hasFile && downloadedFiles && downloadedFiles.length > 0) {
    // התחל טיימר 90 שניות
    autoFinishManager.startTimer(phone, customer, 'general_office_request', handleAutoFinish);
    
    return {
        response: `✅ **קובץ התקבל!**\n\nשלח עוד קבצים או תאר את בקשתך\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel, מסמכים\n\n✏️ **לסיום:** כתוב "סיום"\n\nדוגמה: "עדכון פרטי לקוח + סיום"\n\n⏰ **סיום אוטומטי בעוד 90 שניות**\n\n📞 039792365`,
        stage: 'general_office_request',
        customer: customer
    };
}
        
        // טיפול בהודעה רגילה
        if (message && message.trim().length >= 5) {
            return {
                response: `📋 **נושא הפנייה נרשם:** "${message}"\n\n📎 **רוצה לצרף מסמכים?** (תמונות, PDF, Word, Excel)\n\nאו כתוב "סיום" כדי לשלוח את הפנייה\n\n📞 039792365`,
                stage: 'general_office_request',
                customer: customer
            };
        }
        
        // אם לא הבין מה הלקוח רוצה
        return {
            response: `🏢 **פנייה למשרד כללי**\n\nאנא תאר את בקשתך או הנושא שברצונך לטפל בו\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel, מסמכים\n\nדוגמאות:\n• "עדכון פרטי התקשרות"\n• "בקשה להדרכה מורחבת"\n• "בעיה בחיוב" + מסמכים\n\n🟡 רשום כן / לא לשליחת המייל`,
            stage: 'general_office_request',
            customer: customer
        };
    }

} // סגירת המחלקה ResponseHandler

// פונקציות עזר משופרות
function extractUnitNumber(message, conversation = null) {
    const patterns = [
        /יחידה\s*(\d{1,3})/i,
        /מחסום\s*(\d{1,3})/i,
        /חמסון\s*(\d{1,3})/i,
        /מספר\s*(\d{1,3})/i,
        /\b(\d{1,3})\b/i
    ];
    
    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match) {
            log('DEBUG', `🎯 זוהה מספר יחידה: ${match[1]} (תבנית: ${pattern})`);
            return match[1];
        }
    }
    
    if (conversation && conversation.messages) {
        for (let i = conversation.messages.length - 1; i >= 0; i--) {
            const pastMessage = conversation.messages[i];
            if (pastMessage.sender === 'customer') {
                for (const pattern of patterns) {
                    const match = pastMessage.message.match(pattern);
                    if (match) {
                        log('DEBUG', `נמצא מספר יחידה בהודעה קודמת: ${match[1]}`);
                        return match[1];
                    }
                }
            }
        }
    }
    
    return null;
}

// שיפור מילות סיום
function isFinishingWord(message) {
    const msg = message.toLowerCase().trim();
    
    const finishingWords = [
        'סיום', 'לסיים', 'להגיש', 'לשלוח', 'סיימתי', 
        'זהו', 'תם', 'הסתיים', 'בחלק', 'finish', 'done', 'end',
        'תודה', 'תודה רבה', 'די', 'מספיק', 'הכל', 'בסדר', 'מוכן'
    ];
    
    return finishingWords.some(word => {
        return msg === word || 
               msg.startsWith(word + ' ') || 
               msg.endsWith(' ' + word) ||
               msg.includes(' ' + word + ' ');
    });
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

// מזהה קבוצת WhatsApp לתקלות דחופות
const GROUP_CHAT_ID = '972545484210-1354702417@g.us'; // קבוצת שיידט את בכמן ישראל

// שליחת WhatsApp לקבוצה
async function sendWhatsAppToGroup(message) {
    const instanceId = '7105253183';
    const token = '2fec0da532cc4f1c9cb5b1cdc561d2e36baff9a76bce407889';
    const url = `https://7105.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`;
    
    try {
        const response = await axios.post(url, {
            chatId: GROUP_CHAT_ID,
            message: message
        });
        log('INFO', `✅ הודעה נשלחה לקבוצה: ${response.data ? 'הצלחה' : 'כשל'}`);
        return response.data;
    } catch (error) {
        log('ERROR', '❌ שגיאת שליחה לקבוצה:', error.message);
        throw error;
    }
}

// בדיקת שעות עבודה
function isWorkingHours() {
    const now = new Date();
    const israelTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
    
    const hour = israelTime.getHours();
    const day = israelTime.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    
    // בדיקת יום - 0=ראשון, 1=שני, 2=שלישי, 3=רביעי, 4=חמישי, 5=שישי, 6=שבת
    const isFridayOrSaturday = (day === 5 || day === 6); // שישי או שבת
    const isWorkingDay = (day >= 0 && day <= 4); // ראשון עד חמישי
    
    // שעות עבודה: 9:00-16:00
    const isWorkingHour = (hour >= 9 && hour < 16);
    
    const result = {
        hour: hour,
        day: day,
        dayName: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][day],
        isFridayOrSaturday: isFridayOrSaturday,
        isWorkingDay: isWorkingDay,
        isWorkingHour: isWorkingHour,
        isWorkingTime: isWorkingDay && isWorkingHour,
        shouldSendSMS: !isWorkingDay || !isWorkingHour // שלח SMS אם לא בשעות עבודה
    };
    
    log('DEBUG', `🕐 בדיקת שעות עבודה: ${result.dayName} ${hour}:00 - עבודה: ${result.isWorkingTime}, SMS: ${result.shouldSendSMS}`);
    
    return result;
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
        } else if (type === 'general_office') {
          subject = `🏢 פנייה למשרד כללי ${serviceNumber} - ${customer.name}`;
          emailType = '🏢 פנייה למשרד כללי';
          bgColor = '#6f42c1, #5a32a3';
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
       if (extraData.officeRequestDetails) {
            conversationSummary += `<p><strong>נושא הפנייה:</strong> ${extraData.officeRequestDetails}</p>`;
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
        
// קביעת כתובות מייל לפי סוג הקריאה ושעות עבודה
let emailRecipients = [];
switch(type) {
    case 'technician':
        // בדיקת שעות עבודה לטכנאים
        const workingHours = isWorkingHours();
        
        // תמיד שלח ל-service
        emailRecipients = ['service@sbcloud.co.il'];
        
        // הוסף SMS רק מחוץ לשעות עבודה
        if (workingHours.shouldSendSMS) {
            emailRecipients.push('SMS@sbparking.co.il');
            log('INFO', `📱 שולח גם ל-SMS - ${workingHours.dayName} ${workingHours.hour}:00 (מחוץ לשעות עבודה)`);
            
            // 🔧 חדש: שליחה לקבוצת WhatsApp במקרה של תקלה מחוץ לשעות עבודה
            try {
                let problemText = details;
if (extraData.problemDescription) {
    problemText = extraData.problemDescription;
} else if (extraData.orderDetails) {
    problemText = extraData.orderDetails;
} else if (extraData.trainingRequest) {
    problemText = extraData.trainingRequest;
}
                const groupMessage = `🚨 **תקלה דחופה מחוץ לשעות עבודה**\n\n` +
                    `👤 **לקוח:** ${customer.name}\n` +
                    `🏢 **חניון:** ${customer.site}\n` +
                    `📞 **טלפון:** ${customer.phone}\n` +
                    `🆔 **מספר קריאה:** ${extraData.serviceNumber || 'לא זמין'}\n\n` +
                    `🔧 **תיאור התקלה:**\n${details}\n\n` +
                    `⏰ **זמן:** ${getIsraeliTime()}\n\n` ;
                
                await sendWhatsAppToGroup(groupMessage);
                log('INFO', `📱 הודעה נשלחה לקבוצת WhatsApp: ${customer.name}`);
            } catch (groupError) {
                log('ERROR', '❌ שגיאה בשליחה לקבוצה:', groupError.message);
                // ממשיך גם אם השליחה לקבוצה נכשלת
            }
        } else {
            log('INFO', `💼 שעות עבודה - ${workingHours.dayName} ${workingHours.hour}:00 (רק service@sbcloud.co.il)`);
        }
        break;
        
    case 'order':
        emailRecipients = ['service@sbcloud.co.il', 'office@SBcloud.co.il'];
        break;
    case 'damage':
        emailRecipients = ['service@sbcloud.co.il', 'office@SBcloud.co.il'];
        break;
    case 'training':
        emailRecipients = ['service@sbcloud.co.il'];
        break;
    case 'general_office':
        emailRecipients = ['service@sbcloud.co.il', 'office@SBcloud.co.il'];
        break;
    default:
        emailRecipients = ['service@sbcloud.co.il'];
        break;
}

// הוספת לוג מפורט
log('INFO', `📧 נמענים: ${emailRecipients.join(', ')}`);

const mailOptions = {
    from: 'Report@sbparking.co.il',
    to: emailRecipients.join(','),
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
            referenceType: type === 'technician' ? 'problem' : type === 'damage' ? 'damage' : type === 'order' ? 'order' : type === 'training' ? 'training' : type === 'general_office' ? 'general_office' : 'problem',
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

// שליחת מייל אישור ללקוח
async function sendCustomerConfirmationEmail(customer, type, serviceNumber, details = '') {
    try {
        // בדיקה שיש כתובת מייל ללקוח
        if (!customer.email || customer.email === 'לא רשום' || !customer.email.includes('@')) {
            log('WARN', `⚠️ אין כתובת מייל תקינה ללקוח ${customer.name}`);
            return false;
        }

        let subject, emailType, content;
        
        switch(type) {
            case 'technician':
                subject = `✅ קריאה ${serviceNumber} - התקבלה בהצלחה`;
                emailType = '🔧 קריאת טכנאי';
                content = `
                    <p>קריאת השירות שלך נרשמה במערכת שלנו.</p>
                    <p><strong>פרטי הקריאה:</strong> ${details}</p>
                    <p>🕐 <strong>זמן טיפול צפוי:</strong> 2-4 שעות</p>
                    <p>📞 הטכנאי יצור איתך קשר ישירות</p>
                `;
                break;
            case 'order':
                subject = `✅ הזמנה ${serviceNumber} - התקבלה בהצלחה`;
                emailType = '💰 בקשת הצעת מחיר';
                content = `
                    <p>הזמנתך נרשמה במערכת שלנו.</p>
                    <p><strong>פרטי ההזמנה:</strong> ${details}</p>
                    <p>📧 נכין הצעת מחיר מפורטת ונשלח תוך 24 שעות</p>
                `;
                break;
            case 'damage':
                subject = `✅ דיווח נזק ${serviceNumber} - התקבלה בהצלחה`;
                emailType = '🚨 דיווח נזק';
                content = `
                    <p>דיווח הנזק שלך נרשם במערכת שלנו.</p>
                    <p><strong>פרטי הנזק:</strong> ${details}</p>
                    <p>🔍 הטכנאי שלנו יבדוק את הנזק ויצור קשר תוך 2-4 שעות בשעות העבודה</p>
                `;
                break;
case 'training':
    subject = `✅ בקשת הדרכה ${serviceNumber} - התקבלה בהצלחה`;
    emailType = '📚 בקשת הדרכה';
    content = `
        <p>בקשת ההדרכה שלך נרשמה במערכת שלנו.</p>
        <p><strong>נושא ההדרכה:</strong> ${details}</p>
        <p>📖 נכין חומר הדרכה מפורט ונשלח תוך 24 שעות</p>
    `;
    break;
    
case 'general_office':
    subject = `✅ פנייה ${serviceNumber} - התקבלה בהצלחה`;
    emailType = '🏢 פנייה למשרד';
    content = `
        <p>פנייתך למשרד נרשמה במערכת שלנו.</p>
        <p><strong>נושא הפנייה:</strong> ${details}</p>
        <p>📞 המשרד יטפל בפנייתך ויחזור אליך תוך 24-48 שעות</p>
    `;
    break;
            default:
                subject = `✅ פנייה ${serviceNumber} - התקבלה בהצלחה`;
                emailType = '📋 פניית שירות';
                content = `<p>פנייתך נרשמה במערכת שלנו ואנו נטפל בה בהקדם.</p>`;
                break;
        }

        const html = `
            <div dir="rtl" style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
                <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px;">
                    <div style="background: linear-gradient(45deg, #28a745, #20c997); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; text-align: center;">
                        <h1 style="margin: 0;">${emailType}</h1>
                        <p style="margin: 5px 0 0 0;">שיידט את בכמן</p>
                    </div>
                    <p>שלום ${customer.name},</p>
                    <p>תודה שפנית אלינו!</p>
                    ${content}
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; margin: 20px 0;">
                        <p><strong>מספר קריאה:</strong> ${serviceNumber}</p>
                        <p><strong>חניון:</strong> ${customer.site}</p>
                        <p><strong>תאריך:</strong> ${getIsraeliTime()}</p>
                    </div>
                    <div style="background: #17a2b8; color: white; padding: 15px; border-radius: 10px; text-align: center;">
                        <p style="margin: 0;"><strong>📞 039792365 | 📧 Service@sbcloud.co.il</strong></p>
                    </div>
                </div>
            </div>
        `;

        const mailOptions = {
            from: 'Report@sbparking.co.il',
            to: customer.email,
            subject: subject,
            html: html
        };

        await transporter.sendMail(mailOptions);
        log('INFO', `📧 מייל אישור נשלח ללקוח: ${customer.name} (${customer.email})`);
        return true;
        
    } catch (error) {
        log('ERROR', `❌ שגיאה בשליחת מייל ללקוח ${customer.name}:`, error.message);
        return false;
    }
}
// שליחת מייל אורח - גרסה משופרת
async function sendGuestEmail(guestDetails, phone, serviceNumber) {
    try {
        const subject = `🆕 פנייה מלקוח חדש ${serviceNumber} - טלפון: ${phone}`;
        
        const html = `
            <div dir="rtl" style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
                <div style="max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                    
                    <div style="background: linear-gradient(45deg, #ff6b35, #f7931e); color: white; padding: 20px; border-radius: 10px; margin-bottom: 30px; text-align: center;">
                        <h1 style="margin: 0; font-size: 24px;">🆕 לקוח חדש</h1>
                        <p style="margin: 5px 0 0 0; font-size: 16px;">שיידט את בכמן - מערכת בקרת חניה</p>
                    </div>
                    
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-right: 4px solid #007bff;">
                        <h2 style="color: #2c3e50; margin-top: 0;">👤 פרטי פנייה</h2>
                        <p><strong>מספר טלפון:</strong> ${phone}</p>
                        <p><strong>תאריך ושעה:</strong> ${getIsraeliTime()}</p>
                        <p><strong>סוג פנייה:</strong> לקוח חדש</p>
                    </div>
                    
                    <div style="background: #fff3cd; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-right: 4px solid #ffc107;">
                        <h2 style="color: #856404; margin-top: 0;">📋 פרטי הקריאה</h2>
                        <p><strong>מספר קריאה:</strong> <span style="background: #dc3545; color: white; padding: 5px 10px; border-radius: 5px; font-weight: bold;">${serviceNumber}</span></p>
                        <p><strong>סטטוס:</strong> <span style="color: #28a745; font-weight: bold;">חדש - ממתין לטיפול</span></p>
                    </div>
                    
                    <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 2px solid #e9ecef;">
                        <h2 style="color: #2c3e50; margin-top: 0;">📝 פרטים שהתקבלו מהלקוח</h2>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; white-space: pre-line; font-family: monospace;">${guestDetails}</div>
                    </div>
                    
                    <div style="background: #e8f5e8; padding: 15px; border-radius: 10px; margin-bottom: 20px; border-right: 4px solid #28a745;">
                        <h3 style="margin-top: 0; color: #155724;">📞 פעולות נדרשות</h3>
                        <ul style="margin: 0; padding-right: 20px;">
                            <li>לבדוק את פרטי הלקוח</li>
                            <li>לזהות את סוג הבקשה</li>
                            <li>לחזור ללקוח תוך 24-48 שעות</li>
                            <li>לעדכן במערכת הלקוחות במידת הצורך</li>
                        </ul>
                    </div>
                    
                    <div style="background: #17a2b8; color: white; padding: 15px; border-radius: 10px; text-align: center;">
                        <p style="margin: 0;"><strong>📞 039792365 | 📧 Service@sbcloud.co.il</strong></p>
                    </div>
                </div>
            </div>
        `;

        const mailOptions = {
            from: 'Report@sbparking.co.il',
            to: 'service@sbcloud.co.il,office@sbcloud.co.il',
            subject: subject,
            html: html
        };

        await transporter.sendMail(mailOptions);
        log('INFO', `📧 מייל לקוח אורח נשלח: ${serviceNumber}`);
        
        // 🔧 כתיבה ל-Google Sheets
        const serviceData = {
            serviceNumber: serviceNumber,
            timestamp: getIsraeliTime(),
            referenceType: 'guest',
            customerName: 'לקוח חדש',
            customerSite: 'לא מזוהה',
            problemDescription: guestDetails.substring(0, 100) + (guestDetails.length > 100 ? '...' : ''),
            resolved: 'התקבל'
        };
        await writeToGoogleSheets(serviceData);
        
        return true;
        
    } catch (error) {
        log('ERROR', `❌ שגיאה בשליחת מייל לקוח אורח:`, error.message);
        return false;
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
        if (req.body.senderData && req.body.senderData.sender.includes('@g.us')) {
            log('INFO', `🚫 מתעלם מהודעה מקבוצה: ${req.body.senderData.sender}`);
            return res.status(200).json({ status: 'OK - group message ignored' });
        }
        
        // בדיקה נוספת - אם זה הטלפון של המערכת עצמה
        if (req.body.senderData && req.body.senderData.sender) {
            const phoneCheck = req.body.senderData.sender.replace('@c.us', '');
            const systemPhone = '546284210'; // הטלפון של הבוט
            if (phoneCheck.includes(systemPhone)) {
                log('INFO', `🚫 מתעלם מהודעה מהמערכת עצמה: ${phoneCheck}`);
                return res.status(200).json({ status: 'OK - system message ignored' });
            }
        }
        const messageId = req.body.messageData?.id || req.body.messageData?.messageId || Date.now();
        messageTracker.markProcessed(messageId);
        const messageData = req.body.messageData;
        const senderData = req.body.senderData;
        
        const phone = senderData.sender.replace('@c.us', '');
        const customerName = senderData.senderName || 'לקוח';
        let messageText = '';
        let hasFile = false;
        let fileType = '';
        let downloadedFiles = [];

// עיבוד טקסט - גרסה מתוקנת
if (messageData.textMessageData && messageData.textMessageData.textMessage) {
    // הודעת טקסט רגילה
    messageText = messageData.textMessageData.textMessage.trim();
    log('DEBUG', `📝 טקסט רגיל: "${messageText}"`);
} else if (messageData.fileMessageData) {
    // הודעה עם קובץ
    hasFile = true;
    
    // תיקון חשוב: בדיקה טובה יותר של caption
    const caption = messageData.fileMessageData.caption;
    if (caption && caption.trim() && caption.trim() !== '') {
        messageText = caption.trim();
        log('DEBUG', `📎 קובץ עם טקסט: "${messageText}"`);
    } else {
        messageText = messageData.fileMessageData.fileName || 'שלח קובץ';
        log('DEBUG', `📎 קובץ ללא טקסט, שם: "${messageText}"`);
    }
    
    const fileName = messageData.fileMessageData.fileName || '';
    const mimeType = messageData.fileMessageData.mimeType || '';
    
    fileType = getFileType(fileName, mimeType);
    log('INFO', `📁 ${fileType}: ${fileName} - Caption מקורי: "${messageData.fileMessageData.caption}" - טקסט סופי: "${messageText}"`);
} else {
    // מקרה חירום - סוג הודעה לא מזוהה
    messageText = 'הודעה לא מזוהה';
    log('WARN', '⚠️ סוג הודעה לא מזוהה, messageData:', JSON.stringify(messageData, null, 2));
}

log('INFO', `📞 הודעה מ-${phone} (${customerName}): ${messageText}`);
        
// זיהוי לקוח
let customer = findCustomerByPhone(phone);
if (!customer) {
    const existingConv = memory.getConversation(phone);
    if (existingConv && existingConv.customer) {
        customer = existingConv.customer;
        log('DEBUG', `🔍 נמצא לקוח בזיכרון: ${customer.name}`);
    }
}

const currentConv = memory.getConversation(phone, customer);
log('DEBUG', `💭 conversation נוכחי: שלב=${currentConv ? currentConv.stage : 'אין'}, לקוח=${currentConv?.customer?.name || 'אין'}`);

if (hasFile && messageData.fileMessageData && messageData.fileMessageData.downloadUrl) {
    const conversation = memory.getConversation(phone, customer);
    
    // התעלם מקבצים במצב waiting_feedback
    if (conversation?.stage === 'waiting_feedback') {
        log('INFO', `⚠️ מתעלם מקובץ - כבר במצב המתנה למשוב`);
        return res.status(200).json({ status: 'OK - ignoring file after solution' });
    }
    
    // תיקון: טיפול מיוחד בנזקים עם caption
    if (conversation?.stage === 'damage_photo') {
        const timestamp = Date.now();
        const fileExtension = getFileExtension(messageData.fileMessageData.fileName || '', messageData.fileMessageData.mimeType || '');
        const fileName = `file_${customer ? customer.id : 'unknown'}_${timestamp}${fileExtension}`;
        
        const filePath = await downloadWhatsAppFile(messageData.fileMessageData.downloadUrl, fileName);
        if (filePath) {
            downloadedFiles.push(filePath);
            log('INFO', `✅ ${fileType} הורד עם טקסט: "${messageText}"`);
            
            // אם יש מספר יחידה בטקסט - עבד מיד
            const unitMatch = messageText.match(/(?:יחידה\s*)?(?:מחסום\s*)?(?:חמסון\s*)?(?:מספר\s*)?(\d{1,3})/i);
            if (unitMatch) {
                log('INFO', `🎯 מצאתי מספר יחידה: ${unitMatch[1]} - מעבד מיד`);
                
                const result = await responseHandler.generateResponse(
                    messageText, 
                    phone, 
                    customer, 
                    hasFile, 
                    fileType, 
                    downloadedFiles
                );
                
                await sendWhatsApp(phone, result.response);
                memory.addMessage(phone, result.response, 'hadar', result.customer);
                
                // שליחת מיילים
                if (result.sendDamageEmail) {
                    await sendEmail(result.customer, 'damage', result.problemDescription, {
                        serviceNumber: result.serviceNumber,
                        problemDescription: result.problemDescription,
                        attachments: result.attachments
                    });
                    await sendCustomerConfirmationEmail(result.customer, 'damage', result.serviceNumber, result.problemDescription);
                }
                return res.status(200).json({ status: 'OK - damage processed' });
            }
        }
    }

    // טיפול מיוחד עבור תקלות - עבד מיד ללא המתנה לסיום
    if (conversation?.stage === 'problem_description') {
        const timestamp = Date.now();
        const fileExtension = getFileExtension(messageData.fileMessageData.fileName || '', messageData.fileMessageData.mimeType || '');
        const fileName = `file_${customer ? customer.id : 'unknown'}_${timestamp}${fileExtension}`;
        
        const filePath = await downloadWhatsAppFile(messageData.fileMessageData.downloadUrl, fileName);
        if (filePath) {
            downloadedFiles.push(filePath);
            log('INFO', `✅ ${fileType} הורד עבור תקלה: ${fileName}`);
            
            // עבד את התקלה מיד עם הקובץ
            const result = await responseHandler.generateResponse(
                messageText, 
                phone, 
                customer, 
                hasFile, 
                fileType, 
                downloadedFiles
            );
            
            await sendWhatsApp(phone, result.response);
            memory.addMessage(phone, result.response, 'hadar', result.customer);
            
            log('INFO', `📤 תקלה עובדה עם קובץ ללקוח ${result.customer ? result.customer.name : 'לא מזוהה'}: ${result.stage}`);

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
    // מייל אישור ללקוח
    await sendCustomerConfirmationEmail(result.customer, 'technician', result.serviceNumber, result.problemDescription);
            } else if (result.sendSummaryEmail) {
                log('INFO', `📧 שולח מייל סיכום ללקוח ${result.customer.name}`);
                await sendEmail(result.customer, 'summary', 'בעיה נפתרה בהצלחה', {
                    serviceNumber: result.serviceNumber,
                    problemDescription: result.problemDescription,
                    solution: result.solution,
                    resolved: result.resolved
                });
            }
            return res.status(200).json({ status: 'OK - problem processed with file' });
        }
    }
    
    // עבור שלבים אחרים (damage_photo, order_request וכו') - השאר את הלוגיקה הקיימת
    const existingFiles = conversation?.data?.tempFiles || [];
    
    // בדיקה שלא חורגים מ-4 קבצים בסה"כ
    if (existingFiles.length >= 4) {
        await sendWhatsApp(phone, `⚠️ **הגבלת קבצים**\n\nניתן לשלוח עד 4 קבצים בלבד בפנייה אחת.\n\nכתוב "סיום" כדי לסיים עם הקבצים הקיימים\n\nאו שלח "תפריט" לחזרה לתפריט הראשי\n\n🟡 רשום סיום לשליחת המייל`);
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
        
        // הנחיות ברורות לסיום (רק עבור נזקים והזמנות)
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
await sendCustomerConfirmationEmail(result.customer, 'technician', result.serviceNumber, result.problemDescription);
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
await sendCustomerConfirmationEmail(result.customer, 'order', result.serviceNumber, result.orderDetails);
} else if (result.sendDamageEmail) {
    log('INFO', `📧 שולח מייל נזק ללקוח ${result.customer.name}`);
    await sendEmail(result.customer, 'damage', result.problemDescription, {
        serviceNumber: result.serviceNumber,
        problemDescription: result.problemDescription,
        attachments: result.attachments
    });
await sendCustomerConfirmationEmail(result.customer, 'damage', result.serviceNumber, result.problemDescription);
} else if (result.sendTrainingEmail) {
    log('INFO', `📧 שולח מייל הדרכה ללקוח ${result.customer.name}`);
    await sendEmail(result.customer, 'training', result.trainingRequest, {
        serviceNumber: result.serviceNumber,
        trainingRequest: result.trainingRequest,
        trainingContent: result.trainingContent,
        attachments: result.attachments
    });
await sendCustomerConfirmationEmail(result.customer, 'training', result.serviceNumber, result.trainingRequest);
} else if (result.sendGeneralOfficeEmail) {
    log('INFO', `📧 שולח מייל משרד כללי ללקוח ${result.customer.name}`);
    await sendEmail(result.customer, 'general_office', result.officeRequestDetails, {
        serviceNumber: result.serviceNumber,
        officeRequestDetails: result.officeRequestDetails,
        attachments: result.attachments
    });
await sendCustomerConfirmationEmail(result.customer, 'general_office', result.serviceNumber, result.officeRequestDetails);
}

        if (result.sendTrainingEmailImmediate) {
            log('INFO', `📧 שולח מייל הדרכה מיידי ללקוח ${result.customer.name}`);
            await sendEmail(result.customer, 'training', result.trainingRequest, {
                serviceNumber: result.serviceNumber,
                trainingRequest: result.trainingRequest,
                trainingContent: result.trainingContent,
                attachments: result.attachments
            });
        }
        
        if (result.sendTrainingEmailFinal) {
            log('INFO', `📧 שולח מייל הדרכה סופי ללקוח ${result.customer.name}`);
            await sendEmail(result.customer, 'training', result.trainingRequest, {
                serviceNumber: result.serviceNumber,
                trainingRequest: result.trainingRequest,
                trainingContent: result.trainingContent,
                resolved: result.resolved,
                attachments: result.attachments
            });
        }
        
        if (result.sendTrainingEmailExpanded) {
            log('INFO', `📧 שולח מייל הדרכה מורחב ללקוח ${result.customer.name}`);
            await sendEmail(result.customer, 'training', `${result.trainingRequest} - דרושה הדרכה מורחבת`, {
                serviceNumber: result.serviceNumber,
                trainingRequest: result.trainingRequest,
                trainingContent: result.trainingContent,
                resolved: result.resolved,
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
