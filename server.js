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
            instructions: instructions,
            // 🔧 הוספת פרמטרים למהירות
            model: "gpt-4o-mini", // מודל מהיר יותר אם זמין
            max_completion_tokens: 1000, // הגבלת אורך התשובה
            temperature: 0.3 // יותר עקבי, פחות יצירתי
        });
        
        log('INFO', `🤖 מפעיל Assistant: ${run.id}`);
        
        // המתנה עם timeout מהיר יותר
        let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
        let attempts = 0;
        const maxAttempts = 15; // 15 שניות מקסימום
        
        while ((runStatus.status === 'queued' || runStatus.status === 'in_progress') && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
            attempts++;
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
        
        log('WARN', `⚠️ Assistant לא השלים בזמן או נכשל: ${runStatus.status}`);
        return null;
        
    } catch (error) {
        log('ERROR', '❌ שגיאה בהפעלת Assistant:', error.message);
        return null;
    }
}

// פונקציה מיוחדת לטיפול בתקלות עם Assistant
async function handleProblemWithAssistant(problemDescription, customer) {
    try {
        log('INFO', '🔧 מעבד תקלה עם OpenAI Assistant מותאם...');
        
        const threadId = await createThread();
        if (!threadId) {
            log('WARN', '⚠️ נכשל ביצירת thread - עובר לשיטה הרגילה');
            return await findSolution(problemDescription, customer);
        }
        
        // 🔧 Prompt משופר וממוקד
        const contextMessage = `
SYSTEM: אתה טכנאי מומחה למערכות בקרת חניה של שיידט את בכמן.

CUSTOMER INFO:
- שם: ${customer.name}
- חניון: ${customer.site}
- כתובת: ${customer.address}

PROBLEM REPORTED:
"${problemDescription}"

INSTRUCTIONS:
1. חפש במדריכי ההפעלה המצורפים פתרון ספציפי לתקלה זו
2. אם לא נמצא פתרון מדויק, השתמש בידע הכללי על מערכות חניה
3. תן הוראות צעד אחר צעד, ברורות ומעשיות
4. התמקד בפתרונות שהלקוח יכול לבצע בעצמו
5. אם צריך טכנאי - ציין זאת במפורש
6. השתמש באימוג'י לבהירות
7. תשובה קצרה ועניינית - מקסימום 300 מילים

FORMAT:
🔧 **פתרון לתקלה: [שם התקלה]**

📋 **שלבי הפתרון:**
1. [שלב ראשון]
2. [שלב שני]
3. [שלב שלישי]

💡 **הערות חשובות:**
[הערות בטיחות או טיפים]

⚠️ **אם לא עוזר:**
[מתי לקרוא לטכנאי]
`;

        const messageAdded = await addMessageToThread(threadId, contextMessage);
        if (!messageAdded) {
            log('WARN', '⚠️ נכשל בהוספת הודעה - עובר לשיטה הרגילה');
            return await findSolution(problemDescription, customer);
        }
        
        // 🔧 הפעלת Assistant עם הוראות מותאמות
        const assistantResponse = await runAssistant(
            threadId, 
            process.env.OPENAI_ASSISTANT_ID,
            `אתה טכנאי מומחה למערכות בקרת חניה של שיידט את בכמן. 
            השתמש רק במידע מהמדריכים המצורפים. 
            תן פתרון מעשי וקצר בעברית עם אימוג'י. 
            מקסימום 300 מילים.
            פורמט: 🔧 פתרון → 📋 שלבים → 💡 הערות → ⚠️ אם לא עוזר`
        );
        
        if (assistantResponse) {
            log('INFO', '✅ Assistant נתן פתרון מותאם אישית');
            
            // עיצוב התגובה עם הוראות ברורות
            let formattedResponse = `${assistantResponse}`;
            formattedResponse += `\n\n❓ **האם הפתרון עזר?**\n✅ כתוב "כן" אם הבעיה נפתרה\n❌ כתוב "לא" אם עדיין יש בעיה`;
            
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
        if (!threadId) return null;
        
        // 🔧 Prompt מותאם להדרכה
        const contextMessage = `
SYSTEM: אתה מדריך מומחה למערכות בקרת חניה של שיידט את בכמן.

CUSTOMER INFO:
- שם: ${customer.name}
- חניון: ${customer.site}
- כתובת: ${customer.address}

TRAINING REQUEST:
"${trainingRequest}"

INSTRUCTIONS:
1. חפש במדריכי ההפעלה חומר הדרכה רלוונטי
2. הכן הדרכה מפורטת ומותאמת לנושא הספציפי
3. כלול הסברים צעד אחר צעד
4. הוסף טיפים חשובים ודברים להימנע מהם
5. השתמש באימוג'י ובמבנה ברור
6. תשובה מפורטת - 400-600 מילים

FORMAT:
📚 **הדרכה: [נושא ההדרכה]**

🎯 **מטרה:**
[מה נלמד]

📋 **שלבים מפורטים:**
1. [שלב ראשון עם הסבר]
2. [שלב שני עם הסבר]
...

💡 **טיפים חשובים:**
- [טיפ 1]
- [טיפ 2]

⚠️ **זהירות - אל תעשה:**
- [מה להימנע]

🔧 **בעיות נפוצות ופתרונות:**
- בעיה: פתרון
`;

        const messageAdded = await addMessageToThread(threadId, contextMessage);
        if (!messageAdded) return null;
        
        const assistantResponse = await runAssistant(
            threadId, 
            process.env.OPENAI_ASSISTANT_ID,
            `אתה מדריך מומחה למערכות בקרת חניה של שיידט את בכמן. 
            השתמש במדריכי ההפעלה במערכת להכנת הדרכה מפורטת וברורה בעברית. 
            כלול שלבים מפורטים, טיפים, והזהרות.
            400-600 מילים.
            פורמט: 📚 הדרכה → 🎯 מטרה → 📋 שלבים → 💡 טיפים → ⚠️ זהירות → 🔧 בעיות נפוצות`
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
    
    log('INFO', '🔍 בדיקת תוכן קובץ התרחישים:');
    if (serviceFailureDB.length > 0) {
        serviceFailureDB.forEach((scenario, index) => {
            log('DEBUG', `${index + 1}. "${scenario.תרחיש}" - יש פתרון: ${scenario.שלבים ? 'כן' : 'לא'} - יש הערות: ${scenario.הערות ? 'כן' : 'לא'}`);
        });
        
        const validScenarios = serviceFailureDB.filter(s => s.תרחיש && s.שלבים);
        const invalidScenarios = serviceFailureDB.filter(s => !s.תרחיש || !s.שלבים);
        
        log('INFO', `📊 תרחישים תקינים: ${validScenarios.length}/${serviceFailureDB.length}`);
        if (invalidScenarios.length > 0) {
            log('WARN', `⚠️ תרחישים לא תקינים: ${invalidScenarios.length}`);
        }
    } else {
        log('ERROR', '❌ קובץ התרחישים ריק או לא נטען!');
    }
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
            const timeSinceLastActivity = now - conv.lastActivity;
            
            // 🔧 ניקוי אגרסיבי - מחק שיחות ישנות או תקועות
            if (timeSinceLastActivity > this.maxAge || 
                (timeSinceLastActivity > 10 * 60 * 1000 && // 10 דקות
                 ['identifying', 'confirming_identity', 'guest_details'].includes(conv.stage))) {
                
                this.conversations.delete(key);
                log('INFO', `🧹 נוקה conversation תקוע: ${key} - שלב: ${conv.stage}`);
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
        this.TIMEOUT_DURATION = 60 * 1000; // 60 שניות במילישניות
        log('INFO', '⏰ מנהל סיום אוטומטי הופעל');
    }
    
    // התחלת טיימר חדש או איפוס קיים
    startTimer(phone, customer, stage, callback) {
        const key = this.createKey(phone);
        
        // אם יש טיימר קיים - בטל אותו
        this.clearTimer(phone);
        
        log('INFO', `⏱️ התחלת טיימר 60 שניות עבור ${customer ? customer.name : phone} בשלב ${stage}`);
        
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
        log('INFO', `🤖 מבצע המשך אוטומטי עבור ${customer ? customer.name : phone} בשלב ${stage}`);
        
        const conversation = memory.getConversation(phone, customer);
        
        // בדיקה באיזה שלב אנחנו וביצוע המשך מתאים
        if (stage === 'waiting_feedback') {
            // 🔧 שינוי: במקום לבטל - מעביר לטכנאי אוטומטית
            await sendWhatsApp(phone, `⏰ **המשך אוטומטי לאחר 60 שניות**\n🔧 מעביר את הפנייה לטכנאי מומחה\n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה`);
            
            // שלח מייל טכנאי
            if (conversation && conversation.data) {
                const serviceNumber = conversation.data.serviceNumber || await getNextServiceNumber();
                await sendEmail(customer, 'technician', conversation.data.problemDescription, {
                    serviceNumber: serviceNumber,
                    problemDescription: conversation.data.problemDescription,
                    solution: conversation.data.solution,
                    resolved: false,
                    attachments: conversation.data.attachments
                }, phone);
            }
            
            memory.updateStage(phone, 'completed', customer, {
                autoFinished: true,
                lastIssue: conversation?.data?.problemDescription || 'תקלה',
                lastServiceNumber: conversation?.data?.serviceNumber
            });
            
        } else if (stage === 'waiting_training_feedback') {
            // 🔧 שינוי: שלח הדרכה מורחבת אוטומטית
            await sendWhatsApp(phone, `⏰ **המשך אוטומטי לאחר 60 שניות**\n📧 אשלח הדרכה מפורטת למייל\n⏰ תקבל תוך 24 שעות\n\n📞 039792365`);
            
            if (conversation && conversation.data) {
                await sendEmail(customer, 'training', `${conversation.data.trainingRequest} - הדרכה מורחבת`, {
                    serviceNumber: conversation.data.serviceNumber,
                    trainingRequest: conversation.data.trainingRequest,
                    trainingContent: conversation.data.trainingContent,
                    resolved: true,
                    attachments: conversation.data.attachments
                });
            }
            
            memory.updateStage(phone, 'completed', customer, {
                autoFinished: true,
                lastIssue: conversation?.data?.trainingRequest || 'הדרכה'
            });
            
        } else if (stage === 'damage_photo') {
            // 🔧 שינוי: אם יש קבצים - שלח איתם, אם לא - בקש שוב
            const tempFiles = conversation?.data?.tempFiles || [];
            
            if (tempFiles.length > 0) {
                // יש קבצים - שלח עם מה שיש
                const serviceNumber = await getNextServiceNumber();
                await sendWhatsApp(phone, `⏰ **המשך אוטומטי לאחר 60 שניות**\n✅ נשלח דיווח נזק עם ${tempFiles.length} קבצים\n🔍 מעביר לטכנאי\n⏰ יצור קשר תוך 2-4 שעות\n🆔 מספר קריאה: ${serviceNumber}`);
                
                const allFilePaths = tempFiles.map(f => f.path);
                await sendEmail(customer, 'damage', `נזק - דיווח אוטומטי עם ${tempFiles.length} קבצים`, {
                    serviceNumber: serviceNumber,
                    problemDescription: `נזק - דיווח אוטומטי עם ${tempFiles.length} קבצים`,
                    attachments: allFilePaths
                });
                await sendCustomerConfirmationEmail(customer, 'damage', serviceNumber, `נזק עם ${tempFiles.length} קבצים`);
                
                memory.updateStage(phone, 'completed', customer, {
                    autoFinished: true,
                    lastIssue: 'דיווח נזק'
                });
            } else {
                // אין קבצים - חזור לתפריט
                await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 60 שניות**\n❌ לא התקבלו קבצים\n🔄 חזרה לתפריט הראשי\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`);
                
                memory.updateStage(phone, 'menu', customer);
            }
            
        } else if (stage === 'order_request') {
            // 🔧 שינוי: חפש הזמנה בהודעות ושלח אם נמצאה
            let orderDescription = '';
            if (conversation && conversation.messages) {
                const orderMessages = conversation.messages.filter(msg => 
                    msg.sender === 'customer' && 
                    msg.message.length > 4 && 
                    !msg.message.toLowerCase().includes('3') &&
                    !msg.message.toLowerCase().includes('מחיר') &&
                    !msg.message.toLowerCase().includes('הצעת') &&
                    (msg.message.match(/\d+/) || // מכיל מספרים
                     msg.message.toLowerCase().includes('כרטיס') ||
                     msg.message.toLowerCase().includes('נייר') ||
                     msg.message.toLowerCase().includes('גליל') ||
                     msg.message.toLowerCase().includes('זרוע') ||
                     msg.message.toLowerCase().includes('חלק') ||
                     msg.message.toLowerCase().includes('מבקש') ||
                     msg.message.toLowerCase().includes('צריך'))
                );
                
                if (orderMessages.length > 0) {
                    orderDescription = orderMessages[orderMessages.length - 1].message;
                }
            }
            
            if (orderDescription && orderDescription.length >= 5) {
                const serviceNumber = await getNextServiceNumber();
                
                await sendWhatsApp(phone, `⏰ **המשך אוטומטי לאחר 60 שניות**\n✅ **הזמנה התקבלה:** ${orderDescription}\n📧 נכין הצעת מחיר ונשלח תוך 24 שעות\n🆔 מספר קריאה: ${serviceNumber}`);
                
                await sendEmail(customer, 'order', orderDescription, {
                    serviceNumber: serviceNumber,
                    orderDetails: orderDescription,
                    attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                });
                
                await sendCustomerConfirmationEmail(customer, 'order', serviceNumber, orderDescription);
                
                memory.updateStage(phone, 'completed', customer, {
                    autoFinished: true,
                    lastIssue: orderDescription
                });
            } else {
                // לא נמצאה הזמנה - חזור לתפריט
                await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 60 שניות**\n❌ לא התקבלה הזמנה מפורטת\n🔄 חזרה לתפריט הראשי\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`);
                
                memory.updateStage(phone, 'menu', customer);
            }
            
        } else if (stage === 'training_request') {
            // 🔧 שינוי: חפש בקשת הדרכה ושלח אם נמצאה
            let trainingRequest = '';
            if (conversation && conversation.messages) {
                const trainingMessages = conversation.messages.filter(msg => 
                    msg.sender === 'customer' && 
                    msg.message.length > 4 && 
                    !msg.message.toLowerCase().includes('4') &&
                    !msg.message.toLowerCase().includes('הדרכה') &&
                    (msg.message.toLowerCase().includes('הפעל') ||
                     msg.message.toLowerCase().includes('החלפ') ||
                     msg.message.toLowerCase().includes('טיפול') ||
                     msg.message.toLowerCase().includes('בעי') ||
                     msg.message.toLowerCase().includes('איך') ||
                     msg.message.toLowerCase().includes('למד') ||
                     msg.message.toLowerCase().includes('עזר'))
                );
                
                if (trainingMessages.length > 0) {
                    trainingRequest = trainingMessages[trainingMessages.length - 1].message;
                }
            }
            
            if (trainingRequest && trainingRequest.length >= 5) {
                const serviceNumber = await getNextServiceNumber();
                
                await sendWhatsApp(phone, `⏰ **המשך אוטומטי לאחר 60 שניות**\n✅ **בקשת הדרכה התקבלה:** ${trainingRequest}\n📧 נכין חומר הדרכה ונשלח תוך 24 שעות\n🆔 מספר קריאה: ${serviceNumber}`);
                
                await sendEmail(customer, 'training', trainingRequest, {
                    serviceNumber: serviceNumber,
                    trainingRequest: trainingRequest,
                    attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                });
                
                await sendCustomerConfirmationEmail(customer, 'training', serviceNumber, trainingRequest);
                
                memory.updateStage(phone, 'completed', customer, {
                    autoFinished: true,
                    lastIssue: trainingRequest
                });
            } else {
                // לא נמצאה בקשת הדרכה - חזור לתפריט
                await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 60 שניות**\n❌ לא התקבלה בקשת הדרכה מפורטת\n🔄 חזרה לתפריט הראשי\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`);
                
                memory.updateStage(phone, 'menu', customer);
            }
            
        } else if (stage === 'general_office_request') {
            // 🔧 שינוי: חפש פנייה למשרד ושלח אם נמצאה
            let officeRequestDetails = '';
            if (conversation && conversation.messages) {
                const officeMessages = conversation.messages.filter(msg => 
                    msg.sender === 'customer' && 
                    msg.message.length > 4 && 
                    !msg.message.toLowerCase().includes('5') &&
                    !msg.message.toLowerCase().includes('משרד') &&
                    (msg.message.toLowerCase().includes('עדכון') ||
                     msg.message.toLowerCase().includes('בקש') ||
                     msg.message.toLowerCase().includes('בעי') ||
                     msg.message.toLowerCase().includes('חיוב') ||
                     msg.message.toLowerCase().includes('פרט') ||
                     msg.message.toLowerCase().includes('שינוי') ||
                     msg.message.toLowerCase().includes('טלפון') ||
                     msg.message.toLowerCase().includes('מייל'))
                );
                
                if (officeMessages.length > 0) {
                    officeRequestDetails = officeMessages[officeMessages.length - 1].message;
                }
            }
            
            if (officeRequestDetails && officeRequestDetails.length >= 5) {
                const serviceNumber = await getNextServiceNumber();
                
                await sendWhatsApp(phone, `⏰ **המשך אוטומטי לאחר 60 שניות**\n✅ **פנייה התקבלה:** ${officeRequestDetails}\n📧 המשרד יטפל בפנייתך ויחזור אליך תוך 24-48 שעות\n🆔 מספר קריאה: ${serviceNumber}`);
                
                await sendEmail(customer, 'general_office', officeRequestDetails, {
                    serviceNumber: serviceNumber,
                    officeRequestDetails: officeRequestDetails,
                    attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                });
                
                await sendCustomerConfirmationEmail(customer, 'general_office', serviceNumber, officeRequestDetails);
                
                memory.updateStage(phone, 'completed', customer, {
                    autoFinished: true,
                    lastIssue: officeRequestDetails
                });
            } else {
                // לא נמצאה פנייה - חזור לתפריט
                await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 60 שניות**\n❌ לא התקבלה פנייה מפורטת\n🔄 חזרה לתפריט הראשי\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`);
                
                memory.updateStage(phone, 'menu', customer);
            }
            
        } else if (stage === 'problem_confirmation') {
            // 🔧 חדש: אם יש תקלה בהמתנה - אשר אותה אוטומטית
            const problemDescription = conversation?.data?.pendingProblem;
            
            if (problemDescription) {
                await sendWhatsApp(phone, `⏰ **המשך אוטומטי לאחר 60 שניות**\n✅ מאשר ומעבד את התקלה אוטומטית\n\n"${problemDescription}"\n\nהמתן לפתרון...`);
                
                // עבד את התקלה אוטומטית
                const serviceNumber = await getNextServiceNumber();
                
                memory.updateStage(phone, 'processing_problem', customer, {
                    serviceNumber: serviceNumber,
                    problemDescription: problemDescription,
                    attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                });
                
                let solution;
                if (process.env.OPENAI_ASSISTANT_ID) {
                    solution = await handleProblemWithAssistant(problemDescription, customer);
                } else {
                    solution = await findSolution(problemDescription, customer);
                }
                
                if (solution.found) {
                    memory.updateStage(phone, 'waiting_feedback', customer, {
                        serviceNumber: serviceNumber,
                        problemDescription: problemDescription,
                        solution: solution.response,
                        attachments: conversation?.data?.tempFiles?.map(f => f.path) || [],
                        threadId: solution.threadId || null,
                        source: solution.source || 'database'
                    });
                    
                    autoFinishManager.startTimer(phone, customer, 'waiting_feedback', handleAutoFinish);
        
                    let responseMessage = `🔧 **פתרון לתקלה:**\n\n"${problemDescription}"\n\n${solution.response}\n\n🆔 מספר קריאה: ${serviceNumber}`;
                    
                    await sendWhatsApp(phone, responseMessage);
                } else {
                    memory.updateStage(phone, 'completed', customer);
                    
                    await sendEmail(customer, 'technician', problemDescription, {
                        serviceNumber: serviceNumber,
                        problemDescription: problemDescription,
                        resolved: false,
                        attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                    });
                    
                    await sendWhatsApp(phone, `🔧 **תקלה נשלחה לטכנאי**\n\n"${problemDescription}"\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n🆔 מספר קריאה: ${serviceNumber}`);
                }
            } else {
                // אין תקלה בהמתנה - חזור לתפריט
                await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 60 שניות**\n❌ לא נמצאה תקלה לעיבוד\n🔄 חזרה לתפריט הראשי\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`);
                
                memory.updateStage(phone, 'menu', customer);
            }
            
        } else if (stage === 'damage_confirmation') {
            // 🔧 חדש: אם יש נזק בהמתנה - אשר אותו אוטומטית
            const damageData = conversation?.data?.pendingDamage;
            
            if (damageData && (damageData.description || damageData.unitNumber)) {
                const serviceNumber = await getNextServiceNumber();
                const description = damageData.description || 'נזק';
                const unitNumber = damageData.unitNumber || 'לא צוין';
                
                await sendWhatsApp(phone, `⏰ **המשך אוטומטי לאחר 60 שניות**\n✅ **דיווח נזק נשלח אוטומטית!**\n\nיחידה ${unitNumber} - ${description}\n\n🔍 מעביר לטכנאי\n⏰ יצור קשר תוך 2-4 שעות\n🆔 מספר קריאה: ${serviceNumber}`);
                
                const allFiles = conversation?.data?.tempFiles?.map(f => f.path) || [];
                
                await sendEmail(customer, 'damage', `נזק ביחידה ${unitNumber} - ${description}`, {
                    serviceNumber: serviceNumber,
                    problemDescription: `נזק ביחידה ${unitNumber} - ${description}`,
                    attachments: allFiles
                });
                await sendCustomerConfirmationEmail(customer, 'damage', serviceNumber, `נזק ביחידה ${unitNumber} - ${description}`);
                
                memory.updateStage(phone, 'completed', customer, {
                    autoFinished: true,
                    lastIssue: `נזק ביחידה ${unitNumber}`
                });
            } else {
                // אין נזק מלא - חזור לתפריט
                await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 60 שניות**\n❌ פרטי נזק לא שלמים\n🔄 חזרה לתפריט הראשי\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`);
                
                memory.updateStage(phone, 'menu', customer);
            }
            
        } else {
            // ברירת מחדל - חזור לתפריט
            await sendWhatsApp(phone, `⏰ **סיום אוטומטי לאחר 60 שניות**\n🔄 חזרה לתפריט הראשי\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`);
            
            memory.updateStage(phone, 'menu', customer);
        }
        
    } catch (error) {
        log('ERROR', '❌ שגיאה בהמשך אוטומטי:', error.message);
        memory.updateStage(phone, 'menu', customer);
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
        log('INFO', '🔍 מחפש פתרון במסד תקלות...');
        
        if (!serviceFailureDB || !Array.isArray(serviceFailureDB) || serviceFailureDB.length === 0) {
            log('ERROR', '❌ מסד התקלות ריק');
            return {
                found: false,
                response: '🔧 **שגיאה במערכת**\n\n📧 שלחתי לטכנאי\n⏰ יצור קשר תוך 2-4 שעות\n📞 039792365'
            };
        }

        let bestMatch = null;
        let matchMethod = '';

        // שיטה 1: נסה עם OpenAI אם זמין
        if (process.env.OPENAI_API_KEY?.startsWith('sk-') && process.env.OPENAI_ASSISTANT_ID) {
            try {
                // תחילה נסה עם Assistant המתקדם
                const assistantResult = await handleProblemWithAssistant(problemDescription, customer);
                if (assistantResult && assistantResult.found) {
                    log('INFO', '✅ Assistant מצא פתרון');
                    return assistantResult;
                }
            } catch (assistantError) {
                log('WARN', '⚠️ Assistant נכשל, ממשיך לשיטה הבאה');
            }

            // אם Assistant נכשל, נסה עם ChatGPT רגיל
            try {
            const fullScenarios = serviceFailureDB.map((scenario, index) => 
                `${index + 1}. תרחיש: "${scenario.תרחיש}"
   פתרון: ${scenario.שלבים}
   הערות: ${scenario.הערות || 'אין'}`
            ).join('\n\n');
            
            const prompt = `אתה טכנאי מומחה למערכות בקרת חניה של שיידט את בכמן.

תיאור הבעיה: "${problemDescription}"

תרחישי פתרון זמינים:
${fullScenarios}

הוראות:
1. חפש את התרחיש המתאים ביותר לבעיה המתוארת
2. אם נמצא תרחיש מתאים (דמיון 70%+) - החזר את מספר התרחיש (1-${serviceFailureDB.length})
3. אם אין תרחיש מתאים - החזר 0

החזר רק מספר אחד (0-${serviceFailureDB.length}):`;
            
            const completion = await Promise.race([
                openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 10,
                    temperature: 0.1
                }),
                new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('OpenAI timeout')), 6000)
                )
            ]);
            
            const aiResponse = completion.choices[0].message.content.trim();
            const scenarioNumber = parseInt(aiResponse);
            
            log('INFO', `🤖 OpenAI החזיר: "${aiResponse}" -> תרחיש מספר: ${scenarioNumber}`);
            
            if (scenarioNumber > 0 && scenarioNumber <= serviceFailureDB.length) {
                    bestMatch = serviceFailureDB[scenarioNumber - 1];
                    matchMethod = 'OpenAI';
                }
        } catch (aiError) {
                log('WARN', `⚠️ OpenAI נכשל: ${aiError.message}`);
            }
        }

        // שיטה 2: חיפוש מילות מפתח אם OpenAI לא מצא
        if (!bestMatch) {
        const problem = problemDescription.toLowerCase();
        
            // מיפוי מורחב של מילות מפתח
            const keywordGroups = [
                {
                    keywords: ['לא דולקת', 'לא עובד', 'כבוי', 'מת', 'חשמל', 'לא מגיב', 'נתיך', 'לא פועל', 'לא נדלק', 'כבה', 'נכבה'],
                    scenarioPattern: 'דולקת'
                },
                {
                    keywords: ['מחסום לא עולה', 'מחסום תקוע', 'לא עולה', 'לא נפתח', 'חסום', 'מחסום', 'תקוע', 'לא יורד'],
                    scenarioPattern: 'מחסום'
                },
                {
                    keywords: ['לא מדפיס', 'נייר', 'גליל', 'מדפסת', 'כרטיס לא יוצא', 'קבלה', 'לא מוציא', 'הדפסה'],
                    scenarioPattern: 'מדפיס'
                },
                {
                    keywords: ['אשראי', 'כרטיס אשראי', 'תשלום', 'חיוב', 'visa', 'mastercard', 'מסוף', 'לא מחייב', 'דחה'],
                    scenarioPattern: 'אשראי'
                },
                {
                    keywords: ['מסך', 'תצוגה', 'מסך שחור', 'כהה', 'לא מציג', 'תצוגה כהה', 'מסך כבוי', 'צג'],
                    scenarioPattern: 'מסך'
                },
                {
                    keywords: ['לא פעילה', 'דולקת אבל לא עובד', 'לא מגיב למכונית', 'תקשורת', 'דולקת אבל'],
                    scenarioPattern: 'פעילה'
                },
                {
                    keywords: ['לא מוציאה קבלות', 'קבלה', 'ביציאה', 'לא מוציא קבלות'],
                    scenarioPattern: 'קבלות'
                }
            ];
            
        let bestScore = 0;
        
            for (const group of keywordGroups) {
            let score = 0;
                let matchedKeywords = [];
            
                for (const keyword of group.keywords) {
                if (problem.includes(keyword)) {
                        score += keyword.length * 2;
                        matchedKeywords.push(keyword);
                    }
                }
                
                if (score > bestScore && score >= 8) {
                    // חפש תרחיש מתאים במסד
                    const foundScenario = serviceFailureDB.find(scenario => 
                        scenario.תרחיש && scenario.תרחיש.toLowerCase().includes(group.scenarioPattern)
                    );
                    
                    if (foundScenario) {
                bestScore = score;
                        bestMatch = foundScenario;
                        matchMethod = 'Keywords';
                        log('DEBUG', `✅ נמצאה התאמה: "${foundScenario.תרחיש}" (ציון: ${score}, מילים: ${matchedKeywords.join(', ')})`);
                    }
                }
            }
        }

        // החזרת תוצאה
        if (bestMatch) {
            let solution = `🔧 **פתרון לתקלה: ${bestMatch.תרחיש}**\n\n📋 **שלבי הפתרון:**\n${bestMatch.שלבים}`;
            
            if (bestMatch.הערות && bestMatch.הערות.trim() !== '') {
                solution += `\n\n💡 **הערות חשובות:**\n${bestMatch.הערות}`;
            }
            
            solution += `\n\n❓ **האם הפתרון עזר?**\n✅ כתוב "כן" אם הבעיה נפתרה\n❌ כתוב "לא" אם עדיין יש בעיה`;
            
            log('INFO', `✅ נמצא פתרון בשיטת ${matchMethod}: ${bestMatch.תרחיש}`);
            return { 
                found: true, 
                response: solution, 
                scenario: bestMatch,
                source: matchMethod.toLowerCase()
            };
        }
        
        // אם לא נמצא פתרון
        log('INFO', '⚠️ לא נמצא פתרון מתאים במדריך');
        return {
            found: false,
            response: '🔧 **לא נמצא פתרון מתאים במדריך**\n\n📧 מעביר את התקלה לטכנאי מומחה\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה\n\n📞 **לבירורים דחופים:** 039792365'
        };
        
    } catch (error) {
        log('ERROR', `❌ שגיאה כללית בחיפוש פתרון: ${error.message}`);
        return {
            found: false,
            response: '🔧 **שגיאה במערכת**\n\n📧 שלחתי את הפנייה לטכנאי\n⏰ יצור קשר תוך 2-4 שעות\n📞 039792365'
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

// 🔧 תיקון מעבד הודעות ברמה 10 - החלפה מלאה של ResponseHandler
class ResponseHandler {
    constructor(memory, customers) {
        this.memory = memory;
        this.customers = customers;
    }
    
    // 🔧 פונקציה מרכזית משופרת עם טיפול נכון בברכות ומידע ראשוני
    async generateResponse(message, phone, customer = null, hasFile = false, fileType = '', downloadedFiles = []) {
        // שלב 1: עיבוד ברכות ותוכן
        const { greeting, content } = this.extractGreetingAndContent(message);
        const greetingResponse = greeting ? this.createGreetingResponse(greeting) : '';
        
        // שלב 2: עיבוד מידע ראשוני
        let initialInfo = null;
        if (content && content.length > 10 && (!customer || !this.memory.getConversation(phone, customer))) {
            initialInfo = this.extractInitialInfo(content);
            log('DEBUG', `📋 מידע ראשוני: ${JSON.stringify(initialInfo)}`);
        }
        
        const conversation = this.memory.getConversation(phone, customer);
        
        log('INFO', `🎯 מעבד: "${message}" ${greeting ? `[ברכה: "${greeting}"]` : ''} - שלב: ${conversation ? conversation.stage : 'אין'}`);
        
        // ביטול טיימר אוטומטי
        autoFinishManager.clearTimer(phone);
        
        // שלב 3: זיהוי לקוח או טיפול לפי שלב
        if (!customer) {
            return await this.handleCustomerIdentification(message, phone, conversation, greetingResponse, content, initialInfo);
        }
        
        return await this.handleByStage(message, phone, customer, conversation, hasFile, fileType, downloadedFiles, greetingResponse);
    }

    // 🔧 זיהוי ברכות - כעת בתוך המחלקה
    extractGreetingAndContent(message) {
        const greetings = [
            'בוקר טוב', 'ערב טוב', 'לילה טוב', 'צהריים טובים',
            'שלום', 'שלום לך', 'היי', 'הלו', 'אהלן', 'מה שלום',
            'good morning', 'good evening', 'hello', 'hi'
        ];
        
        const msg = message.trim();
        let greeting = '';
        let content = msg;
        
        for (const greet of greetings) {
            const pattern = new RegExp(`^${greet}[,\\s]*`, 'i');
            if (pattern.test(msg)) {
                greeting = greet;
                content = msg.replace(pattern, '').trim();
                log('DEBUG', `🎈 זוהתה ברכה: "${greeting}" - תוכן: "${content}"`);
                break;
            }
        }
        
        return { greeting, content: content || msg };
    }

    // 🔧 יצירת ברכת תשובה מתאימה - כעת בתוך המחלקה
    createGreetingResponse(greeting) {
        const timeOfDay = new Date().toLocaleString('he-IL', { 
            timeZone: 'Asia/Jerusalem',
            hour: 'numeric'
        });
        const hour = parseInt(timeOfDay);
        
        const greetingMap = {
            'בוקר טוב': 'בוקר טוב',
            'ערב טוב': 'ערב טוב', 
            'לילה טוב': 'לילה טוב',
            'צהריים טובים': 'צהריים טובים',
            'שלום': 'שלום',
            'שלום לך': 'שלום',
            'היי': 'היי',
            'הלו': 'שלום',
            'אהלן': 'אהלן',
            'מה שלום': 'שלום',
            'good morning': 'בוקר טוב',
            'good evening': 'ערב טוב',
            'hello': 'שלום',
            'hi': 'היי'
        };
        
        let response = greetingMap[greeting.toLowerCase()] || 'שלום';
        
        // התאמה לפי שעה אם זה ברכה כללית
        if (greeting.toLowerCase() === 'שלום' || greeting.toLowerCase() === 'היי') {
            if (hour >= 6 && hour < 12) response = 'בוקר טוב';
            else if (hour >= 12 && hour < 17) response = 'צהריים טובים';
            else if (hour >= 17 && hour < 22) response = 'ערב טוב';
            else response = 'שלום';
        }
        
        return response;
    }

    // 🔧 שימור מידע מההודעה הראשונה - כעת בתוך המחלקה
    extractInitialInfo(content) {
        if (!content || content.length < 10) return null;
        
        const info = {
            hasProblem: false,
            hasUnitNumber: false,
            hasOrder: false,
            hasDamage: false,
            problemKeywords: [],
            unitInfo: null,
            fullContent: content
        };
        
        // זיהוי מילות מפתח לבעיות
        const problemKeywords = [
            'בעיה', 'תקלה', 'לא עובד', 'לא דולק', 'לא מגיב', 'תקוע', 'שבור',
            'לא מדפיס', 'לא עולה', 'לא יורד', 'נתקע', 'כשל', 'פגום', 'קולט'
        ];
        
        const orderKeywords = ['הזמנה', 'להזמין', 'מחיר', 'הצעה', 'לקנות', 'כרטיסים', 'נייר'];
        const damageKeywords = ['נזק', 'שבור', 'נשבר', 'פגום', 'פגע', 'תאונה'];
        
        // בדיקת בעיות
        for (const keyword of problemKeywords) {
            if (content.toLowerCase().includes(keyword)) {
                info.hasProblem = true;
                info.problemKeywords.push(keyword);
            }
        }
        
        // בדיקת הזמנות
        info.hasOrder = orderKeywords.some(keyword => content.toLowerCase().includes(keyword));
        
        // בדיקת נזקים
        info.hasDamage = damageKeywords.some(keyword => content.toLowerCase().includes(keyword));
        
        // בדיקת מספר יחידה
        const unitCheck = this.validateUnitNumber(content);
        if (unitCheck.found) {
            info.hasUnitNumber = true;
            info.unitInfo = unitCheck;
        }
        
        log('DEBUG', `📋 מידע ראשוני: בעיה=${info.hasProblem}, יחידה=${info.hasUnitNumber}, הזמנה=${info.hasOrder}, נזק=${info.hasDamage}`);
        
        return info;
    }

    // 🔧 ולידציה של מספר יחידה - כעת בתוך המחלקה
    validateUnitNumber(message) {
        const patterns = [
            /יחידה\s*(\d{1,4})/gi,
            /מחסום\s*(\d{1,4})/gi,
            /מספר\s*(\d{1,4})/gi,
            /\b(\d{1,4})\b/g
        ];
        
        let foundNumbers = [];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(message)) !== null) {
                const num = match[1];
                if (num.length <= 4) {
                    foundNumbers.push({
                        number: num,
                        isValid: num.length === 3,
                        formatted: num.padStart(3, '0')
                    });
                }
            }
        }
        
        if (foundNumbers.length === 0) {
            return { found: false, isValid: false, number: null, formatted: null };
        }
        
        const firstNumber = foundNumbers[0];
        
        log('DEBUG', `🔢 מספר יחידה: ${firstNumber.number} - תקין: ${firstNumber.isValid} - מעוצב: ${firstNumber.formatted}`);
        
        return {
            found: true,
            isValid: firstNumber.isValid,
            number: firstNumber.number,
            formatted: firstNumber.formatted
        };
    }

    // 🔧 טיפול בזיהוי לקוח עם ברכות ומידע ראשוני
    async handleCustomerIdentification(message, phone, conversation, greetingResponse = '', content = null, initialInfo = null) {
        const msg = message.toLowerCase().trim();
        
        log('DEBUG', `🔍 זיהוי לקוח - הודעה: "${message}"`);
        
        // אפשרות אורח
        if (msg === '1' || msg === 'לקוח חדש' || msg === 'אינני לקוח' || msg === 'guest') {
            this.memory.updateStage(phone, 'guest_details', null, { isGuest: true });
            
            let response = greetingResponse ? `${greetingResponse}! ` : '';
            response += `👋 **ברוכים הבאים ללקוחות חדשים!**\n\nכדי לטפל בפנייתך אני צריכה פרטים:\n\n📝 **אנא כתוב הודעה אחת עם:**\n• שמך המלא\n• מספר טלפון\n• כתובת מייל\n• שם החניון/אתר\n• תיאור הבעיה או הבקשה\n\n**דוגמה:**\nדרור פרינץ\n0545484210\nDror@sbparking.co.il\nחניון עזריאלי\nמבקש הצעת מחיר\n\n📞 039792365`;
            
            return { response, stage: 'guest_details' };
        }
        
        // טיפול באיסוף פרטי אורח
        if (conversation?.stage === 'guest_details' && conversation?.data?.isGuest) {
            if (message && message.trim().length > 20) {
                const serviceNumber = await getNextServiceNumber();
                this.memory.updateStage(phone, 'completed', null);
                
                await sendGuestEmail(message, phone, serviceNumber);
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
                return {
                    response: `📝 **אנא שלח פרטים מפורטים יותר:**\n\n• שמך המלא\n• מספר טלפון\n• כתובת מייל\n• שם החניון/אתר\n• תיאור הבעיה או הבקשה\n\n📞 039792365`,
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
                
                // שמירת מידע ראשוני אם קיים
                if (initialInfo && (initialInfo.hasProblem || initialInfo.hasOrder || initialInfo.hasDamage)) {
                    this.memory.updateStage(phone, 'menu', customer, { initialInfo: initialInfo });
                }
                
                let response = greetingResponse ? `${greetingResponse} ` : 'שלום ';
                response += `${customer.name} מחניון ${customer.site} 👋 - אני הדר, הבוט של שיידט\n\nזיהיתי אותך!`;
                
                // אם יש מידע ראשוני - הצע ישירות
                if (initialInfo) {
                    if (initialInfo.hasProblem) {
                        response += `\n\n🔧 **זיהיתי שיש לך תקלה!**\nהאם תרצה לדווח על התקלה? (כן/לא)`;
                    } else if (initialInfo.hasOrder) {
                        response += `\n\n💰 **זיהיתי בקשה להזמנה!**\nהאם תרצה להזמין משהו? (כן/לא)`;
                    } else if (initialInfo.hasDamage) {
                        response += `\n\n🚨 **זיהיתי דיווח נזק!**\nהאם תרצה לדווח על נזק? (כן/לא)`;
                    }
                }
                
                response += `\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`;
                
                return { response, stage: 'menu', customer: customer };
            } else {
                this.memory.updateStage(phone, 'confirming_identity', null, {
                    tentativeCustomer: identification.customer,
                    initialInfo: initialInfo
                });
                
                let response = greetingResponse ? `${greetingResponse}! ` : 'שלום! ';
                response += `👋 - אני הדר, הבוט של שיידט\n\nהאם אתה ${identification.customer.name} מחניון ${identification.customer.site}?\n\n✅ כתוב "כן" לאישור\n❌ או כתוב שם החניון הנכון\n❓ **אם אינך לקוח קיים - כתוב 1**\n\n📞 039792365`;
                
                return { response, stage: 'confirming_identity', tentativeCustomer: identification.customer };
            }
        }
        
        // אישור זהות
        if (conversation?.stage === 'confirming_identity' && conversation.data?.tentativeCustomer) {
            if (message.toLowerCase().includes('כן') || 
                message.toLowerCase().includes('נכון') || 
                message.toLowerCase().includes('תקין') ||
                message.toLowerCase().includes('yes')) {
                
                const customer = conversation.data.tentativeCustomer;
                const savedInitialInfo = conversation.data.initialInfo;
                
                this.memory.updateStage(phone, 'menu', customer, { 
                    initialInfo: savedInitialInfo,
                    tentativeCustomer: null 
                });
                
                let response = `מעולה! שלום ${customer.name} מחניון ${customer.site} 👋`;
                
                // אם יש מידע ראשוני שמור - הצע ישירות
                if (savedInitialInfo) {
                    if (savedInitialInfo.hasProblem) {
                        response += `\n\n🔧 **זיהיתי שיש לך תקלה!**\nהאם תרצה לדווח על התקלה? (כן/לא)`;
                    } else if (savedInitialInfo.hasOrder) {
                        response += `\n\n💰 **זיהיתי בקשה להזמנה!**\nהאם תרצה להזמין משהו? (כן/לא)`;
                    } else if (savedInitialInfo.hasDamage) {
                        response += `\n\n🚨 **זיהיתי דיווח נזק!**\nהאם תרצה לדווח על נזק? (כן/לא)`;
                    }
                }
                
                response += `\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`;
                
                return { response, stage: 'menu', customer: customer };
            } else {
                // נסה זיהוי מחדש
                this.memory.updateStage(phone, 'identifying', null, { tentativeCustomer: null });
                
                const newIdentification = findCustomerByName(message);
                if (newIdentification && newIdentification.confidence === 'high') {
                    const customer = newIdentification.customer;
                    this.memory.updateStage(phone, 'menu', customer);
                    
                    let response = `מעולה! שלום ${customer.name} מחניון ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`;
                    
                    return { response, stage: 'menu', customer: customer };
                }
                
                return {
                    response: `לא זיהיתי את החניון.\n\nאנא כתוב את שם החניון הנכון:\n\nדוגמאות:\n• "תפארת העיר"\n• "שניידר"\n• "אינפיניטי"\n• "עזריאלי"\n\n❓ **במידה ואינך לקוח לחץ 1**\n\n📞 039792365`,
                    stage: 'identifying'
                };
            }
        }
        
        // ברירת מחדל
        return {
            response: `${greetingResponse ? greetingResponse + '! ' : ''}לא זיהיתי את החניון.\n\nאנא כתוב את שם החניון:\n\nדוגמאות:\n• "תפארת העיר"\n• "שניידר"\n• "אינפיניטי"\n• "עזריאלי"\n\n❓ **במידה ואינך לקוח לחץ 1**\n\n📞 039792365`,
            stage: 'identifying'
        };
    }

    // 🔧 טיפול לפי שלב עם ברכות
    async handleByStage(message, phone, customer, conversation, hasFile, fileType, downloadedFiles, greetingResponse = '') {
        const msg = message.toLowerCase().trim();
        let currentStage = conversation ? conversation.stage : 'menu';
        
        // 🔧 תיקון: טיפול במצב completed עם בדיקות בטיחות
        if (currentStage === 'completed') {
            const wasAutoFinished = conversation?.data?.autoFinished;
            const lastIssue = conversation?.data?.lastIssue;
            const lastServiceNumber = conversation?.data?.lastServiceNumber;
            
            if (wasAutoFinished && lastIssue) {
                log('DEBUG', `🔄 טיפול במצב completed עם אזכור תקלה: "${lastIssue}"`);
                
                // זה תגובה לסיום אוטומטי של תקלה
                if (msg.includes('לא') || msg.includes('לא עזר') || msg.includes('עדיין')) {
                    // הפתרון לא עזר - שלח טכנאי
                    this.memory.updateStage(phone, 'technician_escalated', customer);
                    
                    return {
                        response: `📝 **הבנתי שהפתרון לא עזר**\n\n"${lastIssue}"\n\n🔧 **מעביר לטכנאי מומחה**\n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה\n\n🆔 מספר קריאה: ${lastServiceNumber}\n\n📞 039792365`,
                        stage: 'technician_escalated',
                        customer: customer,
                        sendTechnicianEmail: true,
                        serviceNumber: lastServiceNumber,
                        problemDescription: `${lastIssue} - הפתרון הראשוני לא עזר`,
                        resolved: false
                    };
                    
                } else if (msg.includes('כן') || msg.includes('עזר') || msg.includes('תודה')) {
                    // הפתרון עזר
                    this.memory.updateStage(phone, 'menu', customer);
                    
                    return {
                        response: `🎉 **מעולה! שמח שהפתרון עזר!**\n\n🔄 **חזרה לתפריט:**\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
                        stage: 'menu',
                        customer: customer,
                        sendSummaryEmail: true,
                        serviceNumber: lastServiceNumber,
                        problemDescription: lastIssue,
                        resolved: true
                    };
                    
                } else if (msg === '1' || msg.includes('תקלה')) {
                    // רוצה לדווח תקלה חדשה
                    this.memory.updateStage(phone, 'problem_description', customer);
                    
                    let response = greetingResponse ? `${greetingResponse} ` : '';
                    response += `${customer.name} 👋\n\n🔧 **תיאור התקלה החדשה:**\n\nאנא כתוב תיאור קצר של התקלה + מספר יחידה (3 ספרות)\n\n📷 **אפשר לצרף:** תמונה או סרטון\n\nדוגמאות:\n• "היחידה 101 לא דולקת"\n• "מחסום 205 לא עולה"\n• "יחידה 350 לא מדפיס כרטיסים"\n\nהמתן מספר שניות לתשובה🤞`;
                    
                    return { response, stage: 'problem_description', customer: customer };
                }
            }
            
            // אם זה מצב completed רגיל או לא מזוהה - חזור לתפריט
            log('DEBUG', `🔄 מצב completed רגיל - עובר לתפריט`);
            this.memory.updateStage(phone, 'menu', customer);
            currentStage = 'menu';
        }
        
        // תפריט ראשי
        if (currentStage === 'menu' || !currentStage) {
            const savedInfo = conversation?.data?.initialInfo;
            
            // בדיקה אם הלקוח ענה על הצעה שזוהתה מראש
            if (savedInfo && (msg.includes('כן') || msg.includes('נכון'))) {
                if (savedInfo.hasProblem) {
                    return await this.handleInitialProblem(savedInfo, phone, customer, greetingResponse);
                } else if (savedInfo.hasOrder) {
                    return await this.handleInitialOrder(savedInfo, phone, customer, greetingResponse);
                } else if (savedInfo.hasDamage) {
                    return await this.handleInitialDamage(savedInfo, phone, customer, greetingResponse);
                }
            } else if (savedInfo && (msg.includes('לא') || msg.includes('לא נכון'))) {
                // נקה את המידע הראשוני ותציג תפריט רגיל
                this.memory.updateStage(phone, 'menu', customer, { initialInfo: null });
            }
            
            // טיפול בבחירות תפריט
            if (msg === '1' || msg.includes('תקלה')) {
                this.memory.updateStage(phone, 'problem_description', customer);
                
                let response = greetingResponse ? `${greetingResponse} ` : '';
                response += `${customer.name} 👋\n\n🔧 **תיאור התקלה:**\n\nאנא כתוב תיאור קצר של התקלה + מספר יחידה (3 ספרות)\n\n📷 **אפשר לצרף:** תמונה או סרטון\n\nדוגמאות:\n• "היחידה 101 לא דולקת"\n• "מחסום 205 לא עולה"\n• "יחידה 350 לא מדפיס כרטיסים"\n\nהמתן מספר שניות לתשובה🤞`;
                
                return { response, stage: 'problem_description', customer: customer };
            }
            
            if (msg === '2' || msg.includes('נזק')) {
                this.memory.updateStage(phone, 'damage_photo', customer);
                
                let response = greetingResponse ? `${greetingResponse} ` : '';
                response += `${customer.name} 👋 - אני הדר, הבוט של שיידט\n\n📷 **דיווח נזק:**\n\nאנא שלח תמונות/סרטונים/מסמכים של הנזק + מספר היחידה\n\n📎 **ניתן לשלוח עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, Word, Excel\n\nדוגמה: תמונות + "יחידה 101"\n\n📞 039792365`;
                
                return { response, stage: 'damage_photo', customer: customer };
            }
            
            if (msg === '3' || msg.includes('מחיר')) {
                this.memory.updateStage(phone, 'order_request', customer);
                
                let response = greetingResponse ? `${greetingResponse} ` : '';
                response += `${customer.name} 👋 - אני הדר, הבוט של שיידט\n\n💰 **הצעת מחיר / הזמנה**\n\nמה אתה מבקש להזמין?\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel, סרטונים\n\nדוגמאות:\n• "20,000 כרטיסים"\n• "3 גלילים נייר" + תמונה\n• "זרוע חלופית" + PDF מפרט\n\n📞 039792365`;
                
                return { response, stage: 'order_request', customer: customer };
            }
            
            if (msg === '4' || msg.includes('הדרכה')) {
                this.memory.updateStage(phone, 'training_request', customer);
                
                let response = greetingResponse ? `${greetingResponse} ` : '';
                response += `${customer.name} 👋 - אני הדר, הבוט של שיידט\n\n📚 **הדרכה**\n\nבאיזה נושא אתה זקוק להדרכה?\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, מסמכים\n\nדוגמאות:\n• "הפעלת המערכת" + תמונת מסך\n• "החלפת נייר"\n• "טיפול בתקלות"\n\nהמתן מספר שניות לתשובה🤞`;
                
                return { response, stage: 'training_request', customer: customer };
            }
            
            if (msg === '5' || msg.includes('משרד')) {
                this.memory.updateStage(phone, 'general_office_request', customer);
                
                let response = greetingResponse ? `${greetingResponse} ` : '';
                response += `${customer.name} 👋 - אני הדר, הבוט של שיידט\n\n🏢 **פנייה למשרד כללי**\n\nאנא תאר את בקשתך או הנושא שברצונך לטפל בו\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel, מסמכים\n\nדוגמאות:\n• "עדכון פרטי התקשרות"\n• "בקשה להדרכה מורחבת"\n• "בעיה בחיוב" + קובץ PDF\n\n📞 039792365`;
                
                return { response, stage: 'general_office_request', customer: customer };
            }
            
            // ברירת מחדל - תפריט רגיל עם ברכה
            this.memory.updateStage(phone, 'menu', customer);
            
            let response = greetingResponse ? `${greetingResponse} ` : 'שלום ';
            response += `${customer.name} מחניון ${customer.site} 👋 - אני הדר, הבוט של שיידט\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`;
            
            return { response, stage: 'menu', customer: customer };
        }
        
        // שאר השלבים נשארים כמו שהם
        if (currentStage === 'problem_description') {
            return await this.handleProblemDescription(message, phone, customer, hasFile, downloadedFiles);
        }
    
        if (currentStage === 'problem_confirmation') {
            return await this.handleProblemDescription(message, phone, customer, hasFile, downloadedFiles);
        }
        
        if (currentStage === 'damage_photo') {
            return await this.handleDamageReport(message, phone, customer, hasFile, fileType, downloadedFiles);
        }
        
        if (currentStage === 'damage_confirmation') {
            return await this.handleDamageReport(message, phone, customer, hasFile, fileType, downloadedFiles);
        }
    
        if (currentStage === 'order_request') {
            return await this.handleOrderRequest(message, phone, customer, hasFile, downloadedFiles);
        }
        
        if (currentStage === 'order_confirmation') {
            return await this.handleOrderRequest(message, phone, customer, hasFile, downloadedFiles);
        }
    
        if (currentStage === 'waiting_feedback') {
            return await this.handleFeedback(message, phone, customer, conversation);
        }
        
        if (currentStage === 'training_request') {
            return await this.handleTrainingRequest(message, phone, customer, hasFile, downloadedFiles);
        }
        
        if (currentStage === 'training_confirmation') {
            return await this.handleTrainingRequest(message, phone, customer, hasFile, downloadedFiles);
        }
    
        if (currentStage === 'general_office_request') {
            return await this.handleGeneralOfficeRequest(message, phone, customer, hasFile, downloadedFiles);
        }
        
        if (currentStage === 'office_confirmation') {
            return await this.handleGeneralOfficeRequest(message, phone, customer, hasFile, downloadedFiles);
        }
    
        if (currentStage === 'waiting_training_feedback') {
            return await this.handleTrainingFeedback(message, phone, customer, conversation);
        }
        
        // 🔧 שלב technician_escalated
        if (currentStage === 'technician_escalated') {
            // הטכנאי כבר בדרך - הצע תפריט חדש
            this.memory.updateStage(phone, 'menu', customer);
            return {
                response: `✅ **הטכנאי כבר בדרך אליך**\n\nאיך אוכל לעזור בעוד?\n1️⃣ דיווח תקלה נוספת\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
                stage: 'menu',
                customer: customer
            };
        }
        
        // ברירת מחדל - חזור לתפריט
        log('DEBUG', `🔄 לא מזוהה שלב ${currentStage} - חוזר לתפריט`);
        this.memory.updateStage(phone, 'menu', customer);
        return {
            response: `לא הבנתי את הבקשה.\n\nחזרה לתפריט הראשי:\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
            stage: 'menu',
            customer: customer
        };
    }
    // 🔧 פונקציות עזר לטיפול במידע ראשוני
    async handleInitialProblem(savedInfo, phone, customer, greetingResponse) {
        this.memory.updateStage(phone, 'problem_description_with_info', customer, {
            savedProblemInfo: savedInfo
        });
        
        let response = greetingResponse ? `${greetingResponse} ` : '';
        response += `${customer.name} 👋\n\n🔧 **מצוין! בואו נטפל בתקלה:**\n"${savedInfo.fullContent}"`;
        
        if (savedInfo.hasUnitNumber && savedInfo.unitInfo.isValid) {
            response += `\n\n✅ יחידה ${savedInfo.unitInfo.formatted} - מספר תקין\n\nהאם זה נכון או שיש תקלה אחרת?\n\n✅ כתוב "נכון" לאישור\n❌ או תאר תקלה אחרת\n\nהמתן מספר שניות לתשובה🤞`;
        } else if (savedInfo.hasUnitNumber && !savedInfo.unitInfo.isValid) {
            response += `\n\n⚠️ מספר יחידה לא מדויק: ${savedInfo.unitInfo.number}\n\nאנא ציין מספר יחידה תקין (3 ספרות):\nדוגמאות: 007, 101, 205, 350\n\nאו כתוב "ללא יחידה" אם אין מספר ספציפי\n\nהמתן מספר שניות לתשובה🤞`;
        } else {
            response += `\n\n❓ באיזה יחידה הבעיה? (מספר 3 ספרות)\nדוגמאות: 101, 205, 350\n\nאו כתוב "ללא יחידה" אם אין מספר ספציפי\n\nהמתן מספר שניות לתשובה🤞`;
        }
        
        return {
            response: response,
            stage: 'problem_description_with_info',
            customer: customer
        };
    }

    async handleInitialOrder(savedInfo, phone, customer, greetingResponse) {
        this.memory.updateStage(phone, 'order_request', customer, { initialInfo: savedInfo });
        
        let response = greetingResponse ? `${greetingResponse} ` : '';
        response += `${customer.name} 👋\n\n💰 **מצוין! בואו נטפל בהזמנה:**\n"${savedInfo.fullContent}"\n\nמה אתה מבקש להזמין?\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel, סרטונים\n\n📞 039792365`;
        
        return {
            response: response,
            stage: 'order_request',
            customer: customer
        };
    }

    async handleInitialDamage(savedInfo, phone, customer, greetingResponse) {
        this.memory.updateStage(phone, 'damage_photo', customer, { initialInfo: savedInfo });
        
        let response = greetingResponse ? `${greetingResponse} ` : '';
        response += `${customer.name} 👋\n\n🚨 **מצוין! בואו נטפל בדיווח הנזק:**\n"${savedInfo.fullContent}"\n\nאנא שלח תמונות/סרטונים של הנזק + מספר היחידה\n\n📎 **ניתן לשלוח עד 4 קבצים**\n\n📞 039792365`;
        
        return {
            response: response,
            stage: 'damage_photo',
            customer: customer
        };
    }

    async handleProblemDescription(message, phone, customer, hasFile, downloadedFiles) {
        const msg = message.toLowerCase().trim();
        const conversation = this.memory.getConversation(phone, customer);
        
        // 🔧 חדש: טיפול באישור תקלה
        if (msg === 'אישור' || msg === 'לאישור' || msg === 'אשר') {
                const problemDescription = conversation?.data?.pendingProblem;
                
            if (!problemDescription) {
                return {
                    response: `❌ **לא נמצאה תקלה לאישור**\n\nאנא תאר את התקלה\n\n📞 039792365`,
                    stage: 'problem_description',
                    customer: customer
                };
            }
            
            // עבד את התקלה שנשמרה
                const serviceNumber = await getNextServiceNumber();
                
                this.memory.updateStage(phone, 'processing_problem', customer, {
                    serviceNumber: serviceNumber,
                    problemDescription: problemDescription,
                    attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                });
                
                let solution;
                if (process.env.OPENAI_ASSISTANT_ID) {
                    solution = await handleProblemWithAssistant(problemDescription, customer);
                } else {
                    solution = await findSolution(problemDescription, customer);
                }
                
                if (solution.found) {
                    this.memory.updateStage(phone, 'waiting_feedback', customer, {
                        serviceNumber: serviceNumber,
                        problemDescription: problemDescription,
                        solution: solution.response,
                        attachments: conversation?.data?.tempFiles?.map(f => f.path) || [],
                        threadId: solution.threadId || null,
                        source: solution.source || 'database'
                    });
                    
                    autoFinishManager.startTimer(phone, customer, 'waiting_feedback', handleAutoFinish);
        
                    let responseMessage = `📋 **תקלה אושרה ומעובדת**\n\n"${problemDescription}"\n\n${solution.response}\n\n🆔 מספר קריאה: ${serviceNumber}`;
                    
                    return {
                        response: responseMessage,
                        stage: 'waiting_feedback',
                        customer: customer,
                        serviceNumber: serviceNumber
                    };
                } else {
                    this.memory.updateStage(phone, 'completed', customer);
                    
                    return {
                        response: `📋 **תקלה אושרה ונשלחה לטכנאי**\n\n"${problemDescription}"\n\n🔧 מעביר לטכנאי מומחה\n⏰ יצור קשר תוך 2-4 שעות\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
                        stage: 'completed',
                        customer: customer,
                        serviceNumber: serviceNumber,
                        sendTechnicianEmail: true,
                        problemDescription: problemDescription,
                        attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                    };
                }
            }
    
        // 🔧 טיפול בתוספות לתקלה קיימת
        if (conversation?.stage === 'problem_confirmation' && conversation?.data?.pendingProblem) {
            const existingProblem = conversation.data.pendingProblem;
            const updatedProblem = `${existingProblem}\n+ ${message}`;
            
            this.memory.updateStage(phone, 'problem_confirmation', customer, {
                ...conversation.data,
                pendingProblem: updatedProblem
            });
            
            autoFinishManager.startTimer(phone, customer, 'problem_confirmation', handleAutoFinish);
            
            return {
                response: `📋 **תיאור התקלה עודכן:**\n\n"${updatedProblem}"\n\n✅ **כתוב "אישור" לעיבוד התקלה**\n➕ **או כתוב תוספות נוספות**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'problem_confirmation',
                customer: customer
            };
        }
    
        // טיפול בקבצים
        if (hasFile && downloadedFiles && downloadedFiles.length > 0) {
            const updatedFiles = [...(conversation?.data?.tempFiles || []), { 
                path: downloadedFiles[0], 
                type: getFileType(downloadedFiles[0]) 
            }];
            
            this.memory.updateStage(phone, 'problem_description', customer, { 
                ...conversation?.data, 
                tempFiles: updatedFiles 
            });
            
            autoFinishManager.startTimer(phone, customer, 'problem_description', handleAutoFinish);
            
            return {
                response: `✅ **קובץ התקבל!**\n\nתאר את התקלה + מספר יחידה\n\n📷 **אפשר לצרף עוד קבצים**\n\nדוגמאות:\n• "היחידה 101 לא דולקת"\n• "מחסום 205 לא עולה"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'problem_description',
                customer: customer
            };
        }
        
        // 🔧 טיפול בתיאור תקלה - עם מסך אישור
        if (message && message.trim().length >= 10) {
            
            // שמירת התקלה ומעבר למסך אישור
            this.memory.updateStage(phone, 'problem_confirmation', customer, {
                ...conversation?.data,
                pendingProblem: message
            });
            
            autoFinishManager.startTimer(phone, customer, 'problem_confirmation', handleAutoFinish);
            
            const attachedFiles = conversation?.data?.tempFiles || [];
            let filesText = '';
            if (attachedFiles.length > 0) {
                filesText = `\n\n📎 **קבצים מצורפים:** ${attachedFiles.map(f => f.type).join(', ')} (${attachedFiles.length})`;
            }
            
            return {
                response: `📋 **הבנתי את התקלה:**\n\n"${message}"${filesText}\n\n✅ **כתוב "אישור" לעיבוד התקלה**\n➕ **או כתוב תוספות/שינויים**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'problem_confirmation',
                customer: customer
            };
        }
        
        // ברירת מחדל
        autoFinishManager.startTimer(phone, customer, 'problem_description', handleAutoFinish);
        
        return {
            response: `🔧 **תיאור התקלה:**\n\nאנא כתוב תיאור קצר של התקלה + מספר יחידה (3 ספרות)\n\n📷 **אפשר לצרף:** תמונה או סרטון\n\nדוגמאות:\n• "היחידה 101 לא דולקת"\n• "מחסום 205 לא עולה"\n• "יחידה 350 לא מדפיס כרטיסים"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
            stage: 'problem_description',
            customer: customer
        };
    }

    // 🔧 handleDamageReport
    async handleDamageReport(message, phone, customer, hasFile, fileType, downloadedFiles) {
        const msg = message.toLowerCase().trim();
        const conversation = this.memory.getConversation(phone, customer);
        
        // בדיקת בקשה לחזור לתפריט
        if (this.isMenuRequest(message)) {
            this.memory.updateStage(phone, 'menu', customer);
            autoFinishManager.clearTimer(phone);
            return {
                response: `🔄 **חזרה לתפריט הראשי**\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
                stage: 'menu',
                customer: customer
            };
        }
        
        // 🔧 חדש: טיפול באישור נזק
        if (msg === 'אישור' || msg === 'לאישור' || msg === 'אשר') {
                const damageData = conversation?.data?.pendingDamage;
            
            if (!damageData || !damageData.description || !damageData.unitNumber) {
                return {
                    response: `❌ **לא נמצא דיווח נזק לאישור**\n\nאנא שלח תמונות/סרטונים + מספר יחידה\n\n📞 039792365`,
                    stage: 'damage_photo',
                    customer: customer
                };
            }
                
                autoFinishManager.clearTimer(phone);
                const serviceNumber = await getNextServiceNumber();
                this.memory.updateStage(phone, 'completed', customer);
                
                const allFiles = conversation?.data?.tempFiles?.map(f => f.path) || [];
                
                return {
                    response: `✅ **דיווח נזק נשלח בהצלחה!**\n\nיחידה ${damageData.unitNumber} - ${damageData.description}\n\n🔍 מעביר לטכנאי\n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
                    stage: 'completed',
                    customer: customer,
                    serviceNumber: serviceNumber,
                    sendDamageEmail: true,
                    problemDescription: `נזק ביחידה ${damageData.unitNumber} - ${damageData.description}`,
                    attachments: allFiles
                };
            }
        
        // 🔧 טיפול בתוספות לנזק קיים
        if (conversation?.stage === 'damage_confirmation' && conversation?.data?.pendingDamage) {
            const existingDamage = conversation.data.pendingDamage;
            
            // בדיקה אם זה מספר יחידה או תיאור נוסף
            const unitMatch = message.match(/(?:יחידה\s*)?(?:מחסום\s*)?(?:חמסון\s*)?(?:מספר\s*)?(\d{1,3})/i);
            
            if (unitMatch && !existingDamage.unitNumber) {
                // נמצא מספר יחידה
                existingDamage.unitNumber = unitMatch[1];
                existingDamage.description = existingDamage.description || 'נזק';
            } else {
                // תיאור נוסף
                existingDamage.description = existingDamage.description ? 
                    `${existingDamage.description}\n+ ${message}` : message;
            }
            
            this.memory.updateStage(phone, 'damage_confirmation', customer, {
                ...conversation.data,
                pendingDamage: existingDamage
            });
            
            autoFinishManager.startTimer(phone, customer, 'damage_confirmation', handleAutoFinish);
            
            const hasUnit = existingDamage.unitNumber ? `יחידה ${existingDamage.unitNumber}` : 'יחידה: לא הוגדר';
            const hasFiles = conversation?.data?.tempFiles?.length || 0;
            
            return {
                response: `📋 **דיווח נזק עודכן:**\n\n${hasUnit}\n"${existingDamage.description}"\n📎 קבצים: ${hasFiles}\n\n✅ **כתוב "אישור" לשליחת הדיווח**\n➕ **או כתוב תוספות נוספות**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'damage_confirmation',
                customer: customer
            };
        }
        
        // חיפוש מספר יחידה
        let unitNumber = null;
        const unitMatch = message.match(/(?:יחידה\s*)?(?:מחסום\s*)?(?:חמסון\s*)?(?:מספר\s*)?(\d{1,3})/i);
        if (unitMatch) {
            unitNumber = unitMatch[1];
            log('DEBUG', `🎯 זוהה מספר יחידה: ${unitNumber} מתוך הודעה: "${message}"`);
        }
        
        // חיפוש בהודעות קודמות אם לא נמצא
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
        
        // קבצים זמניים מהזיכרון
        const tempFiles = conversation?.data?.tempFiles || [];
        const allFiles = [...(downloadedFiles || []), ...tempFiles.map(f => f.path)];
        
        // 🔧 בדיקה אם יש גם קובץ וגם מספר יחידה - הצע אישור
        if ((hasFile || allFiles.length > 0) && unitNumber) {
            log('INFO', '✅ יש גם קובץ וגם מספר יחידה - מציע אישור');
            
            // שמור את כל הנתונים ועבור למסך אישור
            this.memory.updateStage(phone, 'damage_confirmation', customer, {
                ...conversation?.data,
                pendingDamage: {
                    unitNumber: unitNumber,
                    description: message,
                    hasFiles: true
                }
            });
            
            autoFinishManager.startTimer(phone, customer, 'damage_confirmation', handleAutoFinish);
            
            const filesDescription = allFiles.length > 1 ? `${allFiles.length} קבצים` : fileType || 'קובץ';
            
            return {
                response: `📋 **הבנתי את דיווח הנזק:**\n\nיחידה ${unitNumber}\n"${message}"\n📎 ${filesDescription}\n\n✅ **כתוב "אישור" לשליחת הדיווח**\n➕ **או כתוב תוספות/שינויים**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'damage_confirmation',
                customer: customer
            };
        }
        
        // בדיקת מילות סיום (שמור התנהגות קיימת)
        const hasFinishingWord = message.toLowerCase().includes('סיום') || 
                               message.toLowerCase().includes('לסיים') || 
                               message.toLowerCase().includes('להגיש');
        
        if (hasFinishingWord) {
            // התנהגות ישנה לסיום מיידי
            if (!allFiles || allFiles.length === 0) {
                autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
                return {
                    response: `📷 **לא ניתן לסיים - חסרים קבצים**\n\nכדי לדווח על נזק אני צריכה לפחות:\n• תמונה/סרטון אחד של הנזק\n• מספר היחידה\n\nאנא שלח תמונות/סרטונים עם מספר היחידה\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                    stage: 'damage_photo',
                    customer: customer
                };
            }
            
            if (!unitNumber) {
                autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
                return {
                    response: `📷 **אנא כתוב מספר היחידה**\n\nקיבלתי ${allFiles.length} קבצים ✅\n\nעכשיו אני צריכה את מספר היחידה\n\nדוגמה: "יחידה 101" או "202" או "מחסום 150"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                    stage: 'damage_photo',
                    customer: customer
                };
            }
            
            // אם יש הכל - סיים ישירות (התנהגות ישנה)
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
        
        // טיפול בקבצים
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
            
            // אם יש גם מספר יחידה - הצע אישור
            if (unitNumber) {
                this.memory.updateStage(phone, 'damage_confirmation', customer, {
                    ...conversation?.data,
                    tempFiles: updatedFiles,
                    pendingDamage: {
                        unitNumber: unitNumber,
                        description: message,
                        hasFiles: true
                    }
                });
                
                autoFinishManager.startTimer(phone, customer, 'damage_confirmation', handleAutoFinish);
                
                return {
                    response: `📋 **הבנתי את דיווח הנזק:**\n\nיחידה ${unitNumber}\n"${message}"\n📎 ${fileType}\n\n✅ **כתוב "אישור" לשליחת הדיווח**\n➕ **או כתוב תוספות/שינויים**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                    stage: 'damage_confirmation',
                    customer: customer
                };
            }
            
            autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
                    
                    return {
                response: `✅ **${fileType} התקבל!**\n\nעכשיו אני צריכה את מספר היחידה\n\nדוגמה: "יחידה 101" או "מחסום 208"\n\n✏️ **לאישור:** כתוב מספר יחידה + "אישור"\n✏️ **לסיום מיידי:** כתוב מספר יחידה + "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'damage_photo',
                customer: customer
            };
        }
        
        // אם יש מספר יחידה בלבד עם תיאור
        if (unitNumber && message.trim().length > 3) {
            // שמור ועבור למסך אישור
            this.memory.updateStage(phone, 'damage_confirmation', customer, {
                ...conversation?.data,
                pendingDamage: {
                    unitNumber: unitNumber,
                    description: message,
                    hasFiles: tempFiles.length > 0
                }
            });
            
            autoFinishManager.startTimer(phone, customer, 'damage_confirmation', handleAutoFinish);
            
            const filesText = tempFiles.length > 0 ? `\n📎 קבצים: ${tempFiles.length}` : '';
            
            return {
                response: `📋 **הבנתי את דיווח הנזק:**\n\nיחידה ${unitNumber}\n"${message}"${filesText}\n\n✅ **כתוב "אישור" לשליחת הדיווח**\n➕ **או כתוב תוספות/שינויים**\n📎 **או שלח עוד תמונות/סרטונים**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'damage_confirmation',
                customer: customer
            };
        }
        
        // אם יש רק מספר יחידה
        if (unitNumber) {
            autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
            
            return {
                response: `📝 **מספר יחידה נרשם: ${unitNumber}**\n\nעכשיו שלח תמונות/סרטונים של הנזק\n\n📎 **ניתן לשלוח עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, Word, Excel\n\n✏️ **לאישור:** כתוב תיאור הנזק + "אישור"\n✏️ **לסיום מיידי:** כתוב "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'damage_photo',
                customer: customer
            };
        }
        
        // ברירת מחדל - הנחיות
        autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
        
        return {
            response: `📷 **דיווח נזק - הנחיות**\n\nאני צריכה:\n• תמונות/סרטונים של הנזק\n• מספר היחידה + תיאור קצר\n\n📎 **ניתן לשלוח עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, Word, Excel\n\nדוגמה: תמונות + "יחידה 101 נזק למחסום"\n\n✏️ **לאישור:** כתוב כל הפרטים + "אישור"\n✏️ **לסיום מיידי:** כתוב "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
            stage: 'damage_photo',
            customer: customer
        };
    }

    // 🔧 handleOrderRequest
// 🔧 פונקציה גנרית לטיפול בבקשות - מפחיתה כפילויות
    async handleGenericRequest(message, phone, customer, hasFile, downloadedFiles, config) {
        const {
            requestType,        // 'order', 'training', 'damage', 'office'
            stage,             // שלב נוכחי
            confirmationStage, // שלב אישור
            emailType,         // סוג המייל לשליחה
            icons,             // אייקונים לתצוגה
            labels,            // תוויות טקסט
            defaultResponse,   // תגובת ברירת מחדל
            exampleTexts,      // דוגמאות
            minLength = 5,     // אורך מינימלי
            requiresUnit = false, // האם דורש מספר יחידה
            specialHandler = null // טיפול מיוחד
        } = config;

    const msg = message.toLowerCase().trim();
    const conversation = this.memory.getConversation(phone, customer);
        const pendingKey = `pending${requestType.charAt(0).toUpperCase() + requestType.slice(1)}`;
    
        // בדיקת חזרה לתפריט
    if (this.isMenuRequest(message)) {
        this.memory.updateStage(phone, 'menu', customer);
        autoFinishManager.clearTimer(phone);
        return {
            response: `🔄 **חזרה לתפריט הראשי**\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
            stage: 'menu',
            customer: customer
        };
    }

        // טיפול באישור
    if (msg === 'אישור' || msg === 'לאישור' || msg === 'אשר') {
            const pendingData = conversation?.data?.[pendingKey];
        
            if (!pendingData) {
            return {
                    response: `❌ **לא נמצאה ${labels.requestName} לאישור**\n\n${labels.requestPrompt}\n\n📞 039792365`,
                    stage: stage,
                customer: customer
            };
        }
        
        autoFinishManager.clearTimer(phone);
        const serviceNumber = await getNextServiceNumber();
            
            // טיפול מיוחד אם נדרש (למשל הדרכה עם Assistant)
            let specialResult = null;
            if (specialHandler) {
                specialResult = await specialHandler(pendingData, customer);
            }
            
            // החלטה על התגובה בהתאם לסוג
            if (specialResult && specialResult.success) {
                // טיפול מיוחד הצליח (כמו הדרכה מיידית)
                this.memory.updateStage(phone, `waiting_${requestType}_feedback`, customer, {
                        serviceNumber: serviceNumber,
                    [`${requestType}Request`]: pendingData,
                    [`${requestType}Content`]: specialResult.content,
                        attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                });
                
                autoFinishManager.startTimer(phone, customer, `waiting_${requestType}_feedback`, handleAutoFinish);
                
                let response = `${icons.main} **${labels.approved}:**\n\n${specialResult.content}`;
                response += `\n\n🆔 מספר קריאה: ${serviceNumber}`;
                response += `\n\n❓ **${labels.feedbackQuestion}** (כן/לא)`;
                response += `\n\n⏰ **סיום אוטומטי בעוד 60 שניות**`;
                
                const result = {
                    response: response,
                    stage: `waiting_${requestType}_feedback`,
                    customer: customer,
                    serviceNumber: serviceNumber
                };
                
                // הוסף שדה לשליחת מייל מיידי אם התוכן ארוך מדי
                if (response.length > 4000) {
                    result[`send${requestType.charAt(0).toUpperCase() + requestType.slice(1)}EmailImmediate`] = true;
                    result[`${requestType}Request`] = pendingData;
                    result[`${requestType}Content`] = specialResult.content;
                    result.attachments = conversation?.data?.tempFiles?.map(f => f.path) || [];
                }
                
                return result;
                } else {
                // טיפול רגיל - שליחה למייל
                    this.memory.updateStage(phone, 'completed', customer);
                    
                const emailData = {
                    response: `✅ **${labels.sentSuccess}**\n\n${icons.doc} **${labels.detailsLabel}:** ${pendingData}\n\n${icons.email} ${labels.emailMessage}\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
                        stage: 'completed',
                        customer: customer,
                        serviceNumber: serviceNumber,
                        attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                    };
                
                // הוסף את השדה הנכון לשליחת מייל
                emailData[`send${emailType}Email`] = true;
                
                // הוסף את הפרטים בשם הנכון
                if (requestType === 'order') {
                    emailData.orderDetails = pendingData;
                } else if (requestType === 'training') {
                    emailData.trainingRequest = pendingData;
                } else if (requestType === 'office') {
                    emailData.officeRequestDetails = pendingData;
                }
                
                return emailData;
            }
        }

        // טיפול בתוספות לבקשה קיימת
        if (conversation?.stage === confirmationStage && conversation?.data?.[pendingKey]) {
            const existingRequest = conversation.data[pendingKey];
            const updatedRequest = `${existingRequest}\n+ ${message}`;
            
            this.memory.updateStage(phone, confirmationStage, customer, {
                ...conversation.data,
                [pendingKey]: updatedRequest
            });
            
            autoFinishManager.startTimer(phone, customer, confirmationStage, handleAutoFinish);
        
        return {
                response: `${icons.doc} **${labels.requestName} עודכנה:**\n\n"${updatedRequest}"\n\n✅ **כתוב "אישור" ${labels.toSend}**\n➕ **או כתוב תוספות נוספות**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: confirmationStage,
                customer: customer
        };
    }

    // טיפול בקבצים
    if (hasFile && downloadedFiles && downloadedFiles.length > 0) {
            const updatedFiles = [...(conversation?.data?.tempFiles || []), { 
                path: downloadedFiles[0], 
                type: getFileType(downloadedFiles[0]) 
            }];
            
            this.memory.updateStage(phone, stage, customer, { 
                ...conversation?.data, 
                tempFiles: updatedFiles 
            });
            
            autoFinishManager.startTimer(phone, customer, stage, handleAutoFinish);
        
        return {
                response: `✅ **קובץ התקבל!**\n\n${labels.requestPrompt}\n\n📎 **אפשר לצרף עוד קבצים**\n\n${exampleTexts}\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: stage,
            customer: customer
        };
    }
    
        // טיפול בטקסט בקשה - עם מסך אישור
        if (message && message.trim().length >= minLength && 
            !message.toLowerCase().includes(requestType) && 
            !message.match(/^[1-5]$/)) {
            
            // שמירת הבקשה ומעבר למסך אישור
            this.memory.updateStage(phone, confirmationStage, customer, {
            ...conversation?.data,
                [pendingKey]: message
        });
        
            autoFinishManager.startTimer(phone, customer, confirmationStage, handleAutoFinish);
        
        const attachedFiles = conversation?.data?.tempFiles || [];
        let filesText = '';
        if (attachedFiles.length > 0) {
            filesText = `\n\n📎 **קבצים מצורפים:** ${attachedFiles.map(f => f.type).join(', ')} (${attachedFiles.length})`;
        }
        
        return {
                response: `${icons.main} **${labels.understood}:**\n\n"${message}"${filesText}\n\n✅ **כתוב "אישור" ${labels.toSend}**\n➕ **או כתוב תוספות/שינויים**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: confirmationStage,
            customer: customer
        };
    }
    
    // ברירת מחדל
        autoFinishManager.startTimer(phone, customer, stage, handleAutoFinish);
    
    return {
            response: defaultResponse,
            stage: stage,
        customer: customer
    };
}

    async handleOrderRequest(message, phone, customer, hasFile, downloadedFiles) {
        return await this.handleGenericRequest(message, phone, customer, hasFile, downloadedFiles, {
            requestType: 'order',
            stage: 'order_request',
            confirmationStage: 'order_confirmation',
            emailType: 'Order',
            icons: {
                main: '💰',
                doc: '📋',
                email: '📧'
            },
            labels: {
                requestName: 'הזמנה',
                requestPrompt: 'אנא כתוב מה אתה מבקש להזמין',
                toSend: 'לשליחת ההזמנה',
                understood: 'הבנתי שאתה מבקש להזמין',
                sentSuccess: 'הזמנה נשלחה בהצלחה!',
                detailsLabel: 'מבוקש',
                emailMessage: 'נכין הצעת מחיר ונשלח תוך 24 שעות',
                approved: 'הזמנה אושרה ונשלחה',
                feedbackQuestion: 'האם ההזמנה ברורה?'
            },
            defaultResponse: `💰 **הצעת מחיר / הזמנה**\n\nמה אתה מבקש להזמין?\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel\n\nדוגמאות:\n• "2000 כרטיסים"\n• "3 גלילים נייר" + תמונה\n• "זרוע חלופית" + PDF מפרט\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
            exampleTexts: 'דוגמאות:\n• "2000 כרטיסים"\n• "3 גלילים נייר"'
        });
    }
    // handleTrainingRequest 
    async handleTrainingRequest(message, phone, customer, hasFile, downloadedFiles) {
        const config = {
            stageName: 'training_request',
            confirmationStage: 'training_confirmation',
            feedbackStage: 'waiting_training_feedback',
            pendingField: 'pendingTraining',
            messageMinLength: 5,
            excludeWords: ['הדרכה', '4'],
            fileResponse: `✅ **קובץ התקבל!**\n\nכתוב על איזה נושא אתה זקוק להדרכה\n\n📎 **אפשר לצרף עוד קבצים**\n\nדוגמאות:\n• "הפעלת המערכת"\n• "החלפת נייר"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
            confirmationResponse: (message, filesText) => `📚 **הבנתי את בקשת ההדרכה:**\n\n"${message}"${filesText}\n\n✅ **כתוב "אישור" לעיבוד ההדרכה**\n➕ **או כתוב תוספות/שינויים**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
            updateResponse: (updatedMessage) => `📚 **בקשת הדרכה עודכנה:**\n\n"${updatedMessage}"\n\n✅ **כתוב "אישור" לעיבוד ההדרכה**\n➕ **או כתוב תוספות נוספות**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
            emptyRequestResponse: `❌ **לא נמצאה בקשת הדרכה לאישור**\n\nאנא כתוב על איזה נושא אתה זקוק להדרכה\n\n📞 039792365`,
            defaultResponse: `📚 **הדרכה**\n\nבאיזה נושא אתה זקוק להדרכה?\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, סרטונים, PDF, מסמכים\n\nדוגמאות:\n• "הפעלת המערכת" + תמונת מסך\n• "החלפת נייר"\n• "טיפול בתקלות"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
            handleApproval: async (conversation, customer, phone) => {
                const trainingRequest = conversation?.data?.pendingTraining;
                const serviceNumber = await getNextServiceNumber();
                
                let trainingContent = null;
                if (process.env.OPENAI_ASSISTANT_ID) {
                    trainingContent = await handleTrainingWithAssistant(trainingRequest, customer);
                }
                
                if (trainingContent && trainingContent.success) {
                    this.memory.updateStage(phone, 'waiting_training_feedback', customer, {
                        serviceNumber: serviceNumber,
                        trainingRequest: trainingRequest,
                        trainingContent: trainingContent.content,
                        attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                    });
                    
                    autoFinishManager.startTimer(phone, customer, 'waiting_training_feedback', handleAutoFinish);
                    
                    let immediateResponse = `📚 **הדרכה אושרה ומעובדת:**\n\n${trainingContent.content}`;
                    
                    let needsEmail = false;
                    if (immediateResponse.length > 4000) {
                        const shortContent = trainingContent.content.substring(0, 3500) + "...\n\n📧 **החומר המלא נשלח למייל**";
                        immediateResponse = `📚 **הדרכה אושרה ומעובדת:**\n\n${shortContent}`;
                        needsEmail = true;
                    }
                    
                    immediateResponse += `\n\n🆔 מספר קריאה: ${serviceNumber}`;
                    immediateResponse += `\n\n❓ **האם ההדרכה עזרה לך?** (כן/לא)`;
                    immediateResponse += `\n\n⏰ **סיום אוטומטי בעוד 60 שניות**`;
                    
                    return {
                        response: immediateResponse,
                        stage: 'waiting_training_feedback',
                        customer: customer,
                        serviceNumber: serviceNumber,
                        sendTrainingEmailImmediate: needsEmail,
                        trainingRequest: trainingRequest,
                        trainingContent: trainingContent.content,
                        attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                    };
                } else {
                    this.memory.updateStage(phone, 'completed', customer);
                    
                    return {
                        response: `📚 **בקשת הדרכה אושרה ונשלחה!**\n\n📋 **נושא:** "${trainingRequest}"\n\n📧 אשלח חומר הדרכה מפורט למייל\n⏰ תוך 24 שעות\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
                        stage: 'completed',
                        customer: customer,
                        serviceNumber: serviceNumber,
                        sendTrainingEmail: true,
                        trainingRequest: trainingRequest,
                        attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
                    };
                }
            }
        };
        
        return this.handleGenericRequest(message, phone, customer, hasFile, downloadedFiles, config);
    }
    // 🔧 תיקון משוב הדרכה - ללא שאלה כפולה
async handleTrainingFeedback(message, phone, customer, conversation) {
    const msg = message.toLowerCase().trim();
    const data = conversation.data;
    
    // 🔧 ביטול טיימר
    autoFinishManager.clearTimer(phone);
    
    if (msg.includes('כן') || msg.includes('ברור') || msg.includes('תודה') || msg.includes('עזר')) {
        this.memory.updateStage(phone, 'menu', customer);
        
        return {
            response: `🎉 **מעולה! שמח שההדרכה עזרה!**\n\n🔄 **חזרה לתפריט:**\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
            stage: 'menu',
                        customer: customer,
            sendTrainingEmailFinal: true,
            serviceNumber: data.serviceNumber,
            trainingRequest: data.trainingRequest, // 🔧 נושא נכון
            trainingContent: data.trainingContent,
            resolved: true
        };
    } else if (msg.includes('לא') || msg.includes('לא עזר') || msg.includes('לא ברור')) {
        this.memory.updateStage(phone, 'menu', customer);
        
        return {
            response: `📚 **אשלח הדרכה מפורטת למייל**\n\n⏰ תוך 24 שעות תקבל חומר הדרכה מורחב\n\n🔄 **חזרה לתפריט:**\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
            stage: 'menu',
            customer: customer,
            sendTrainingEmailExpanded: true,
            serviceNumber: data.serviceNumber,
            trainingRequest: data.trainingRequest, // 🔧 נושא נכון
            trainingContent: data.trainingContent,
            resolved: false
                    };
                } else {
        // 🔧 החזר טיימר אם לא הבין
        autoFinishManager.startTimer(phone, customer, 'waiting_training_feedback', handleAutoFinish);
        
        return {
            response: `❓ **האם ההדרכה עזרה לך?**\n\n✅ כתוב "כן" אם זה עזר\n❌ כתוב "לא" אם צריך הדרכה מורחבת\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
            stage: 'waiting_training_feedback',
            customer: customer
        };
    }
}

async handleFeedback(message, phone, customer, conversation) {
    const msg = message.toLowerCase().trim();
    const data = conversation.data;
    
    // ביטול טיימר
    autoFinishManager.clearTimer(phone);
    
    // בדיקה אם זה תשובה חיובית
    if (msg.includes('כן') || msg.includes('תודה') || msg.includes('עזר') || 
        msg.includes('פתר') || msg.includes('עבד') || msg.includes('הצליח') ||
        msg.includes('בסדר') || msg.includes('טוב') || msg.includes('מעולה')) {
        
        this.memory.updateStage(phone, 'menu', customer);
        
        return {
            response: `🎉 **מעולה! שמח שהפתרון עזר!**\n\n🔄 **חזרה לתפריט:**\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
            stage: 'menu',
            customer: customer,
            sendSummaryEmail: true,
            serviceNumber: data.serviceNumber,
            problemDescription: data.problemDescription,
            solution: data.solution,
            resolved: true
        };
    }
    
    // בדיקה אם זה תשובה שלילית ברורה
    if (msg.includes('לא עזר') || msg.includes('לא עבד') || msg.includes('לא פתר') ||
        msg.includes('לא הצליח') || msg.includes('עדיין') || msg === 'לא') {
        
                    this.memory.updateStage(phone, 'completed', customer);
                    
                    return {
            response: `🔧 **מעביר לטכנאי מומחה**\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה\n\n🆔 מספר קריאה: ${data.serviceNumber}\n\n📞 039792365`,
                        stage: 'completed',
                        customer: customer,
            sendTechnicianEmail: true,
            serviceNumber: data.serviceNumber,
            problemDescription: data.problemDescription,
            additionalInfo: message,
            solution: data.solution,
            resolved: false,
            attachments: data.attachments
        };
    }
    
    // 🔧 חדש: אם זה לא "כן" או "לא" אלא מידע נוסף על התקלה
    if (message.length > 3) {
        log('INFO', `📝 לקוח הוסיף מידע נוסף: "${message}"`);
        
        this.memory.updateStage(phone, 'completed', customer);
        
        // עדכן את תיאור הבעיה עם המידע החדש
        const fullProblemDescription = `${data.problemDescription}\n\nמידע נוסף מהלקוח: ${message}`;
        
        return {
            response: `📝 **קיבלתי את המידע הנוסף!**\n\n"${message}"\n\n🔧 מעביר לטכנאי מומחה עם כל הפרטים\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות בשעות העבודה\n\n🆔 מספר קריאה: ${data.serviceNumber}\n\n📞 039792365`,
            stage: 'completed',
            customer: customer,
            sendTechnicianEmail: true,
            serviceNumber: data.serviceNumber,
            problemDescription: fullProblemDescription,
            solution: data.solution,
            resolved: false,
            attachments: data.attachments,
            additionalInfo: message
        };
    }
    
    // אם זה משהו לא ברור - בקש הבהרה
    autoFinishManager.startTimer(phone, customer, 'waiting_feedback', handleAutoFinish);
    
    return {
        response: `❓ **האם הפתרון עזר לפתור את הבעיה?**\n\n✅ כתוב "כן" אם הבעיה נפתרה\n❌ כתוב "לא" אם עדיין יש בעיה\n📝 או תאר מה עדיין לא עובד\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
        stage: 'waiting_feedback',
        customer: customer
    };
}

isFinishingWord(message) {
    const msg = message.toLowerCase().trim();
    
    // רשימת מילות סיום מורחבת
    const finishingWords = [
        'סיום', 'לסיים', 'להגיש', 'לשלוח', 'סיימתי', 
        'זהו', 'תם', 'הסתיים', 'בסוך', 'finish', 'done', 'end',
        'תודה', 'תודה רבה', 'די', 'מספיק', 'הכל'
    ];
    
    // בדיקה אם המילה קיימת בהודעה
    const containsFinishingWord = finishingWords.some(word => 
        msg.includes(word) || msg.startsWith(word) || msg.endsWith(word)
    );
    
    if (containsFinishingWord) {
        log('INFO', `✅ זוהתה מילת סיום בהודעה: "${message}"`);
        return true;
    }
    
    return false;
}

    // 🔧  handleGeneralOfficeRequest
    async handleGeneralOfficeRequest(message, phone, customer, hasFile, downloadedFiles) {
        const msg = message.toLowerCase().trim();
        const conversation = this.memory.getConversation(phone, customer);
        
        if (this.isMenuRequest(message)) {
            this.memory.updateStage(phone, 'menu', customer);
            autoFinishManager.clearTimer(phone);
            return {
                response: `🔄 **חזרה לתפריט הראשי**\n\nאיך אוכל לעזור?\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`,
                stage: 'menu',
                customer: customer
            };
        }
        
        // 🔧 חדש: טיפול באישור פנייה למשרד
        if (msg === 'אישור' || msg === 'לאישור' || msg === 'אשר') {
            const officeRequest = conversation?.data?.pendingOfficeRequest;
            
            if (!officeRequest) {
                return {
                    response: `❌ **לא נמצאה פנייה לאישור**\n\nאנא כתוב את נושא הפנייה\n\n📞 039792365`,
                    stage: 'general_office_request',
                    customer: customer
                };
            }
            
            autoFinishManager.clearTimer(phone);
            const serviceNumber = await getNextServiceNumber();
            this.memory.updateStage(phone, 'completed', customer);
            
            return {
                response: `✅ **פנייה למשרד נשלחה בהצלחה!**\n\n📋 **נושא:** ${officeRequest}\n\n📧 המשרד יטפל בפנייתך ויחזור אליך תוך 24-48 שעות\n\n🆔 מספר קריאה: ${serviceNumber}\n\n📞 039792365`,
                stage: 'completed',
                customer: customer,
                serviceNumber: serviceNumber,
                sendGeneralOfficeEmail: true,
                officeRequestDetails: officeRequest,
                attachments: conversation?.data?.tempFiles?.map(f => f.path) || []
            };
        }
        
        // 🔧 טיפול בתוספות לפנייה קיימת
        if (conversation?.stage === 'office_confirmation' && conversation?.data?.pendingOfficeRequest) {
            const existingRequest = conversation.data.pendingOfficeRequest;
            const updatedRequest = `${existingRequest}\n+ ${message}`;
            
            this.memory.updateStage(phone, 'office_confirmation', customer, {
                ...conversation.data,
                pendingOfficeRequest: updatedRequest
            });
            
            autoFinishManager.startTimer(phone, customer, 'office_confirmation', handleAutoFinish);
            
            return {
                response: `🏢 **פנייה למשרד עודכנה:**\n\n"${updatedRequest}"\n\n✅ **כתוב "אישור" לשליחת הפנייה**\n➕ **או כתוב תוספות נוספות**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'office_confirmation',
                customer: customer
            };
        }
        
        // טיפול בקבצים
        if (hasFile && downloadedFiles && downloadedFiles.length > 0) {
            const updatedFiles = [...(conversation?.data?.tempFiles || []), { 
                path: downloadedFiles[0], 
                type: getFileType(downloadedFiles[0]) 
            }];
            
            this.memory.updateStage(phone, 'general_office_request', customer, { 
                ...conversation?.data, 
                tempFiles: updatedFiles 
            });
            
            autoFinishManager.startTimer(phone, customer, 'general_office_request', handleAutoFinish);
            
            return {
                response: `✅ **קובץ התקבל!**\n\nכתוב את נושא הפנייה למשרד\n\n📎 **אפשר לצרף עוד קבצים**\n\nדוגמאות:\n• "עדכון פרטי התקשרות"\n• "בקשה להדרכה מורחבת"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'general_office_request',
                customer: customer
            };
        }
        
        // 🔧 טיפול בפנייה למשרד - עם מסך אישור
        if (message && message.trim().length >= 5 && 
            !message.toLowerCase().includes('משרד') &&
            !message.toLowerCase().includes('5')) {
            
            // שמירת הפנייה ומעבר למסך אישור
            this.memory.updateStage(phone, 'office_confirmation', customer, {
                ...conversation?.data,
                pendingOfficeRequest: message
            });
            
            autoFinishManager.startTimer(phone, customer, 'office_confirmation', handleAutoFinish);
            
            const attachedFiles = conversation?.data?.tempFiles || [];
            let filesText = '';
            if (attachedFiles.length > 0) {
                filesText = `\n\n📎 **קבצים מצורפים:** ${attachedFiles.map(f => f.type).join(', ')} (${attachedFiles.length})`;
            }
            
            return {
                response: `🏢 **הבנתי את הפנייה למשרד:**\n\n"${message}"${filesText}\n\n✅ **כתוב "אישור" לשליחת הפנייה**\n➕ **או כתוב תוספות/שינויים**\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
                stage: 'office_confirmation',
                customer: customer
            };
        }
        
        // ברירת מחדל
        autoFinishManager.startTimer(phone, customer, 'general_office_request', handleAutoFinish);
        
        return {
            response: `🏢 **פנייה למשרד כללי**\n\nאנא תאר את בקשתך או הנושא שברצונך לטפל בו\n\n📎 **ניתן לצרף עד 4 קבצים**\n🗂️ **סוגי קבצים:** תמונות, PDF, Word, Excel, מסמכים\n\nדוגמאות:\n• "עדכון פרטי התקשרות"\n• "בקשה להדרכה מורחבת"\n• "בעיה בחיוב" + קובץ PDF\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`,
            stage: 'general_office_request',
            customer: customer
        };
    }
} 
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

class ResponseHandlerExtension {
    static isMenuRequest(message) {
        const msg = message.toLowerCase().trim();
        const menuWords = ['תפריט', 'חזרה', 'ביטול', 'menu', 'cancel'];
        return menuWords.some(word => msg.includes(word));
    }
}

// הוסף את השיטה למחלקה הקיימת
ResponseHandler.prototype.isMenuRequest = ResponseHandlerExtension.isMenuRequest;

const responseHandler = new ResponseHandler(memory, customers);

// שליחת WhatsApp
async function sendWhatsApp(phone, message) {
    const instanceId = '7105253183';
    const token = '2fec0da532cc4f1c9cb5b1cdc561d2e36baff9a76bce407889';
    const url = `https://7105.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`;
    
    try {
        // בדיקה שהטלפון והמסר תקינים
        if (!phone || !message) {
            log('ERROR', '❌ טלפון או מסר ריקים');
            return null;
        }
        
        log('DEBUG', `📤 שולח ל-${phone}: ${message.substring(0, 50)}...`);
        
        const response = await axios.post(url, {
            chatId: `${phone}@c.us`,
            message: message
        }, {
            timeout: 8000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.data && response.data.idMessage) {
            log('INFO', `✅ WhatsApp נשלח בהצלחה: ${response.data.idMessage}`);
        } else {
            log('INFO', `✅ WhatsApp נשלח: ${response.data ? 'הצלחה' : 'כשל'}`);
        }
        
        return response.data;
        
    } catch (error) {
        log('ERROR', '❌ שגיאת WhatsApp:', error.response?.data?.error || error.message);
        
        // אל תזרוק שגיאה - פשוט החזר null
        return null;
    }
}

// מזהה קבוצת WhatsApp לתקלות דחופות
const GROUP_CHAT_ID = '972545484210-1354702417@g.us'; // קבוצת שיידט את בכמן ישראל

// שליחת WhatsApp לקבוצה - תיקון מלא
async function sendWhatsAppToGroup(message) {
    const instanceId = '7105253183';
    const token = '2fec0da532cc4f1c9cb5b1cdc561d2e36baff9a76bce407889';
    const url = `https://7105.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`;
    
    try {
        log('DEBUG', `📱 שולח לקבוצה: ${GROUP_CHAT_ID}`);
        
        const response = await axios.post(url, {
            chatId: GROUP_CHAT_ID,
            message: message
        }, {
            timeout: 10000, // 10 שניות
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.data && response.data.idMessage) {
            log('INFO', `✅ הודעה נשלחה לקבוצה: ${response.data.idMessage}`);
        } else {
            log('INFO', `✅ הודעה נשלחה לקבוצה: ${response.data ? 'הצלחה' : 'תשובה ריקה'}`);
        }
        
        return response.data;
    } catch (error) {
        log('ERROR', `❌ שגיאת שליחה לקבוצה: ${error.response?.data?.error || error.message}`);
        // 🔧 תיקון חשוב: לא לזרוק שגיאה - רק להחזיר null
        return null;
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
async function sendEmail(customer, type, details, extraData = {}, phoneUsed = null) {
    try {
        const serviceNumber = extraData.serviceNumber || getNextServiceNumber();
        
// רשימת טלפונים עם הטלפון שפנה
let phoneList = '';
if (phoneUsed) {
    phoneList += `<p><strong>📱 טלפון שפנה:</strong> ${phoneUsed}</p>`;
    phoneList += `<br>`;
}

const allPhones = [customer.phone, customer.phone1, customer.phone2, customer.phone3, customer.phone4]
    .filter(phone => phone && phone.trim() !== '')
    .map((phone, index) => {
        const label = index === 0 ? 'טלפון ראשי' : `טלפון ${index}`;
        return `<p><strong>${label}:</strong> ${phone}</p>`;
    })
    .join('');

phoneList += allPhones;        
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
            emailRecipients.push('Dror@sbparking.co.il');
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
                    `📞 **טלפון שפנה:** ${phone}\n` +
                    `📞 **טלפון ראשי:** ${customer.phone}\n` +
                    `🆔 **מספר קריאה:** ${extraData.serviceNumber || 'לא זמין'}\n\n` +
                    `🔧 **תיאור התקלה:**\n${problemText}\n\n` +
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
        emailRecipients = ['Dror@sbparking.co.il', 'office@SBcloud.co.il'];
        break;
    case 'damage':
        emailRecipients = ['Dror@sbparking.co.il', 'office@SBcloud.co.il'];
        break;
    case 'training':
        emailRecipients = ['Dror@sbparking.co.il'];
        break;
    case 'general_office':
        emailRecipients = ['Dror@sbparking.co.il', 'office@SBcloud.co.il'];
        break;
    default:
        emailRecipients = ['Dror@sbparking.co.il'];
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
// בדיקה מוגברת להודעות קבוצה
if (req.body.senderData && req.body.senderData.sender) {
    const sender = req.body.senderData.sender;
    
    // בדיקות מרובות לקבוצות
// 🔧 בדיקות מרובות לקבוצות - מורחב
if (sender.includes('@g.us') || 
    sender.includes('-') || 
    sender.match(/^\d+-\d+@/) ||
    sender.match(/\d{10,15}-\d{10,15}@g\.us$/)) {
    
    log('INFO', `🚫 מתעלם מהודעה מקבוצה: ${sender}`);
    return res.status(200).json({ status: 'OK - group message ignored' });
}

// 🔧 בדיקה נוספת במקום אחר במבנה הנתונים
if (req.body.messageData && req.body.messageData.chatId) {
    const chatId = req.body.messageData.chatId;
    
    if (chatId.includes('@g.us') || 
        chatId.includes('-') || 
        chatId.match(/^\d+-\d+@/) ||
        chatId.match(/\d{10,15}-\d{10,15}@g\.us$/)) {
        
        log('INFO', `🚫 מתעלם מהודעה מקבוצה (chatId): ${chatId}`);
        return res.status(200).json({ status: 'OK - group message ignored' });
    }
}

// 🔧 בדיקה נוספת של ID הקבוצה הספציפית
const GROUP_CHAT_ID = '972545484210-1354702417@g.us'; // קבוצת שיידט את בכמן ישראל

if (req.body.senderData && req.body.senderData.chatId === GROUP_CHAT_ID) {
    log('INFO', `🚫 מתעלם מהודעה מקבוצת שיידט הספציפית`);
    return res.status(200).json({ status: 'OK - company group ignored' });
}
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
} else if (messageData.extendedTextMessageData && messageData.extendedTextMessageData.text) {
    // הודעת טקסט מורחבת (עם קישורים וכו')
    messageText = messageData.extendedTextMessageData.text.trim();
    log('DEBUG', `📝 טקסט מורחב: "${messageText}"`);
} else if (messageData.imageMessageData) {
    // תמונה ישירה
    hasFile = true;
    fileType = 'תמונה';
    messageText = messageData.imageMessageData.caption || 'שלח תמונה';
    log('DEBUG', `📸 תמונה: "${messageText}"`);
} else if (messageData.videoMessageData) {
    // סרטון ישיר
    hasFile = true;
    fileType = 'סרטון';
    messageText = messageData.videoMessageData.caption || 'שלח סרטון';
    log('DEBUG', `🎥 סרטון: "${messageText}"`);
} else {
    // נסה לחלץ טקסט מכל מקום אפשרי
    const possibleTexts = [
        messageData.text,
        messageData.message,
        messageData.body,
        messageData.content
    ];
    
    messageText = possibleTexts.find(text => text && typeof text === 'string' && text.trim() !== '') || 'שלום';
    
    if (messageText === 'שלום') {
        log('WARN', '⚠️ לא נמצא טקסט - משתמש בברירת מחדל, messageData:', JSON.stringify(messageData, null, 2));
    } else {
        log('DEBUG', `🔧 טקסט משוחזר: "${messageText}"`);
    }
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

// 🔧 תיקון מלא לטיפול בקבצים - 
if (hasFile && messageData.fileMessageData && messageData.fileMessageData.downloadUrl) {
    const conversation = memory.getConversation(phone, customer);
    
    // התעלם מקבצים במצב waiting_feedback
    if (conversation?.stage === 'waiting_feedback') {
        log('INFO', `⚠️ מתעלם מקובץ - כבר במצב המתנה למשוב`);
        return res.status(200).json({ status: 'OK - ignoring file after solution' });
    }
    if (conversation?.stage === 'completed') {
        log('INFO', `⚠️ מתעלם מקובץ - הדיווח כבר הושלם`);
        await sendWhatsApp(phone, `✅ **הדיווח הקודם הושלם בהצלחה**\n\nאם ברצונך לדווח על נזק נוסף:\n🔄 כתוב "תפריט" ובחר "2" שוב\n\n📞 039792365`);
        return res.status(200).json({ status: 'OK - report already completed' });
    }
    
    // 🔧 תיקון קריטי: אם אין שלב מוגדר או לקוח - הצג תפריט
    if (!conversation?.stage || !customer) {
        await sendWhatsApp(phone, `📎 **קיבלתי קובץ**\n\nאבל אני צריכה לדעת איך לעזור לך:\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`);
        return res.status(200).json({ status: 'OK - file received but no stage' });
    }
    
    // 🔧 חדש: טיפול מיוחד לכל שלב
    const existingFiles = conversation?.data?.tempFiles || [];
    
// בדיקה שלא חורגים מ-4 קבצים בסה"כ
if (existingFiles.length >= 4) {
    await sendWhatsApp(phone, `⚠️ **הגבלת קבצים**\n\nניתן לשלוח עד 4 קבצים בלבד בפנייה אחת.\n\nכתוב "סיום" כדי לסיים עם הקבצים הקיימים\n\nאו שלח "תפריט" לחזרה לתפריט הראשי\n\n🟡 רשום סיום לשליחת המייל`);
    return res.status(200).json({ status: 'OK - file limit reached' });
}

const originalFileName = messageData.fileMessageData.fileName || `file_${Date.now()}.file`;
const filePath = await downloadWhatsAppFile(messageData.fileMessageData.downloadUrl, originalFileName);    

if (filePath) {
    downloadedFiles.push(filePath);
    
    // 🔧 תיקון: הגדרת fileType מתוך הקובץ
    const detectedFileType = getFileType(originalFileName, messageData.fileMessageData.mimeType);
    
    log('INFO', `✅ ${detectedFileType} הורד: ${path.basename(filePath)}`);
    
    // 🔧 תיקון: שמירת הקובץ בזיכרון הזמני
    const updatedFiles = [...existingFiles, { 
        path: filePath, 
        type: detectedFileType, 
        name: path.basename(filePath) 
    }];
    
    memory.updateStage(phone, conversation?.stage || 'identifying', customer, { 
        ...conversation?.data, 
        tempFiles: updatedFiles 
    });

    log('INFO', `📁 זיכרון עודכן: ${updatedFiles.length} קבצים`);
    
    // תקלות - עבד מיד עם הקובץ
    if (conversation?.stage === 'problem_description') {
        const result = await responseHandler.generateResponse(
            messageText, 
            phone, 
            customer, 
            hasFile, 
            detectedFileType, 
            [filePath]
        );
        
        await sendWhatsApp(phone, result.response);
        memory.addMessage(phone, result.response, 'hadar', result.customer);
        
        // שליחת מיילים לפי הצורך
        if (result.sendTechnicianEmail) {
            await sendEmail(result.customer, 'technician', messageText, {
                serviceNumber: result.serviceNumber,
                problemDescription: result.problemDescription,
                solution: result.solution,
                resolved: result.resolved,
                attachments: result.attachments
            }, phone);
            await sendCustomerConfirmationEmail(result.customer, 'technician', result.serviceNumber, result.problemDescription);
        }
        return res.status(200).json({ status: 'OK - problem processed with file' });
    }
        
// 🔧 תיקון: נזקים - בדיקה מיוחדת למספר יחידה בטקסט
if (conversation?.stage === 'damage_photo') {
            
    // 🚫 התעלם משמות קבצים
    if (messageText.includes('.jpg') || messageText.includes('.png') || 
        messageText.includes('.pdf') || messageText.includes('.mp4') ||
        messageText.includes('.jpeg') || messageText.includes('.gif') ||
        (messageText.includes('-') && messageText.length > 20)) {
        
        log('INFO', `📎 זוהה שם קובץ: ${messageText} - ממתין למספר יחידה`);
        
        // זה שם קובץ - רק שמור ותבקש מספר יחידה
        autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
        
        await sendWhatsApp(phone, `✅ **${detectedFileType} התקבל!** (${updatedFiles.length}/4)\n\n📝 **עכשיו כתוב מספר היחידה:**\nדוגמה: "יחידה 101" או "מחסום 208"\n\n✏️ **לסיום:** כתוב מספר יחידה + "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`);
        return res.status(200).json({ status: 'OK - damage file received, waiting for unit number' });
    }
    
    // 🔧 רק אם זה לא שם קובץ - תמשיך לחפש מספר יחידה
    const unitMatch = messageText.match(/(?:יחידה\s*)?(?:מחסום\s*)?(?:חמסון\s*)?(?:מספר\s*)?(\d{1,3})/i);
    if (unitMatch) {
        log('INFO', `🎯 מצאתי מספר יחידה: ${unitMatch[1]} - מעבד מיד עם ${updatedFiles.length} קבצים`);
        
        const allFilePaths = updatedFiles.map(f => f.path);
        
        const result = await responseHandler.generateResponse(
            messageText, 
            phone, 
            customer, 
            hasFile, 
            detectedFileType, 
            allFilePaths
        );
        
        await sendWhatsApp(phone, result.response);
        memory.addMessage(phone, result.response, 'hadar', result.customer);
        
        if (result.sendDamageEmail) {
            await sendEmail(result.customer, 'damage', result.problemDescription, {
                serviceNumber: result.serviceNumber,
                problemDescription: result.problemDescription,
                attachments: allFilePaths
            });
            await sendCustomerConfirmationEmail(result.customer, 'damage', result.serviceNumber, result.problemDescription);
        }
        
        memory.updateStage(phone, 'completed', customer, { tempFiles: [] });
        return res.status(200).json({ status: 'OK - damage processed with all files' });
    }
            
            // אם אין מספר יחידה - הנחיות עם טיימר
            autoFinishManager.startTimer(phone, customer, 'damage_photo', handleAutoFinish);
            
            await sendWhatsApp(phone, `✅ **${fileType} התקבל!** (${updatedFiles.length}/4)\n\n📝 **עכשיו כתוב מספר היחידה:**\nדוגמה: "יחידה 101" או "מחסום 208"\n\n✏️ **לסיום:** כתוב מספר יחידה + "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`);
            return res.status(200).json({ status: 'OK - damage file received, waiting for unit number' });
        }
        
        // 🔧 חדש: הצעת מחיר - אם יש טקסט עם הקובץ
        if (conversation?.stage === 'order_request') {
            autoFinishManager.startTimer(phone, customer, 'order_request', handleAutoFinish);
            
            if (messageText && messageText.length > 10 && 
                !messageText.includes('.jpg') && !messageText.includes('.png')) {
                // יש טקסט הזמנה עם הקובץ
                await sendWhatsApp(phone, `✅ **${fileType} התקבל!** (${updatedFiles.length}/4)\n\n📋 **הזמנה נרשמה:** "${messageText}"\n\n📎 שלח עוד קבצים או כתוב "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`);
            } else {
                // רק קובץ בלי טקסט
                await sendWhatsApp(phone, `✅ **${fileType} התקבל!** (${updatedFiles.length}/4)\n\n📝 **עכשיו כתוב מה אתה מבקש להזמין:**\nדוגמה: "20,000 כרטיסים"\n\n📎 שלח עוד קבצים או כתוב "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`);
            }
            return res.status(200).json({ status: 'OK - order file received' });
        }
        
        // 🔧 חדש: הדרכה
        if (conversation?.stage === 'training_request') {
            autoFinishManager.startTimer(phone, customer, 'training_request', handleAutoFinish);
            
            if (messageText && messageText.length > 10 && 
                !messageText.includes('.jpg') && !messageText.includes('.png')) {
                await sendWhatsApp(phone, `✅ **${fileType} התקבל!** (${updatedFiles.length}/4)\n\n📚 **נושא הדרכה נרשם:** "${messageText}"\n\n📎 שלח עוד קבצים או כתוב "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`);
            } else {
                await sendWhatsApp(phone, `✅ **${fileType} התקבל!** (${updatedFiles.length}/4)\n\n📝 **עכשיו כתוב על איזה נושא אתה זקוק להדרכה:**\nדוגמה: "הפעלת המערכת"\n\n📎 שלח עוד קבצים או כתוב "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`);
            }
            return res.status(200).json({ status: 'OK - training file received' });
        }
        
        // 🔧 חדש: משרד כללי
        if (conversation?.stage === 'general_office_request') {
            autoFinishManager.startTimer(phone, customer, 'general_office_request', handleAutoFinish);
            
            if (messageText && messageText.length > 10 && 
                !messageText.includes('.jpg') && !messageText.includes('.png')) {
                await sendWhatsApp(phone, `✅ **${fileType} התקבל!** (${updatedFiles.length}/4)\n\n🏢 **נושא פנייה נרשם:** "${messageText}"\n\n📎 שלח עוד קבצים או כתוב "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`);
            } else {
                await sendWhatsApp(phone, `✅ **${fileType} התקבל!** (${updatedFiles.length}/4)\n\n📝 **עכשיו כתוב את נושא הפנייה:**\nדוגמה: "עדכון פרטי התקשרות"\n\n📎 שלח עוד קבצים או כתוב "סיום"\n\n⏰ **סיום אוטומטי בעוד 60 שניות**\n\n📞 039792365`);
            }
            return res.status(200).json({ status: 'OK - office file received' });
        }
        
        // ברירת מחדל - אם השלב לא מוכר
        await sendWhatsApp(phone, `✅ **${fileType} התקבל!**\n\nאבל אני צריכה לדעת איך לעזור לך:\n\n1️⃣ דיווח תקלה\n2️⃣ דיווח נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n5️⃣ משרד כללי\n\n📞 039792365`);
        return res.status(200).json({ status: 'OK - file received but unknown stage' });
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
            }, phone);
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
            // 🔧 חדש: הוסף מייל ללקוח
            await sendCustomerConfirmationEmail(result.customer, 'training', result.serviceNumber, result.trainingRequest);
        }
        
        // 🔧 חדש: גם בהדרכה סופית
        if (result.sendTrainingEmailFinal) {
            log('INFO', `📧 שולח מייל הדרכה סופי ללקוח ${result.customer.name}`);
            await sendEmail(result.customer, 'training', result.trainingRequest, {
                serviceNumber: result.serviceNumber,
                trainingRequest: result.trainingRequest,
                trainingContent: result.trainingContent,
                resolved: result.resolved,
                attachments: result.attachments
            });
            // 🔧 חדש: הוסף מייל ללקוח
            await sendCustomerConfirmationEmail(result.customer, 'training', result.serviceNumber, result.trainingRequest);
        }

        res.status(200).json({ status: 'OK' });
        
    } catch (error) {
        log('ERROR', '❌ שגיאה כללית:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// פונקציה להורדת קבצים מ-WhatsApp - יחידה ופשוטה
async function downloadWhatsAppFile(downloadUrl, fileName) {
    try {
        log('INFO', `📥 מוריד קובץ: ${fileName}`);
        
        const response = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream'
        });
        
        // וידוא תיקיית uploads
        const uploadsDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        const filePath = path.join(uploadsDir, fileName);
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                log('INFO', `✅ קובץ הורד: ${fileName}`);
                resolve(filePath);
            });
            writer.on('error', (error) => {
                log('ERROR', `❌ שגיאה: ${error.message}`);
                reject(error);
            });
        });
        
    } catch (error) {
        log('ERROR', `❌ הורדה נכשלה: ${error.message}`);
        return null;
    }
}

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
