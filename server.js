require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

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
        console.log('📥 מוריד קובץ מוואטסאפ:', fileName);
        
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
                console.log('✅ קובץ נשמר:', filePath);
                resolve(filePath);
            });
            writer.on('error', reject);
        });
        
    } catch (error) {
        console.error('❌ שגיאה בהורדת קובץ:', error.message);
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
    console.log(`📊 נטענו ${customers.length} לקוחות`);
} catch (error) {
    console.error('❌ שגיאה בטעינת לקוחות:', error.message);
    customers = [{ id: 555, name: "דרור פרינץ", site: "חניון רימון", phone: "0545-484210", address: "רימון 8 רמת אפעל", email: "Dror@sbparking.co.il" }];
}

// טעינת מסד נתוני תקלות - תיקון מלא
let serviceFailureDB = [];

try {
    const fileContent = fs.readFileSync('./Service failure scenarios.json', 'utf8');
    serviceFailureDB = JSON.parse(fileContent);
    
    // וידוא שזה מערך
    if (!Array.isArray(serviceFailureDB)) {
        console.error('❌ קובץ התקלות אינו מערך');
        serviceFailureDB = [];
    }
    
    console.log(`📋 מסד תקלות נטען בהצלחה - ${serviceFailureDB.length} תרחישים`);
} catch (error) {
    console.error('❌ שגיאה בטעינת מסד תקלות:', error.message);
    console.log('🔧 יוצר קובץ תקלות דוגמה...');
    
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
        console.log('✅ קובץ תקלות דוגמה נוצר');
    } catch (writeError) {
        console.error('❌ שגיאה ביצירת קובץ דוגמה:', writeError.message);
    }
}

// טעינת מסדי הדרכה
let trainingDB = {};

try {
    if (fs.existsSync('./Parking operation 1.docx')) {
        trainingDB.parking = fs.readFileSync('./Parking operation 1.docx', 'utf8');
        console.log('📚 מדריך חניונים נטען');
    }
    if (fs.existsSync('./Scheidt system operation.pdf')) {
        trainingDB.scheidt = fs.readFileSync('./Scheidt system operation.pdf', 'utf8');
        console.log('📚 מדריך שיידט נטען');
    }
    if (fs.existsSync('./דוגמאות נוספות.txt')) {
        trainingDB.examples = fs.readFileSync('./דוגמאות נוספות.txt', 'utf8');
        console.log('📚 דוגמאות נטענו');
    }
    
    const loadedFiles = Object.keys(trainingDB).length;
    console.log(`📚 ${loadedFiles} מסדי הדרכה נטענו מתוך 3`);
} catch (error) {
    console.error('❌ שגיאה בטעינת הדרכות:', error.message);
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

const transporter = nodemailer.createTransporter({
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
        console.log(`✅ לקוח מזוהה: ${customer.name} מ${customer.site}`);
        return customer;
    }
    
    console.log(`⚠️ לקוח לא מזוהה: ${phone}`);
    return null;
}

// זיהוי לקוח אינטראקטיבי
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

// OpenAI לפתרון תקלות - תיקון מלא
async function getAISolution(problemDescription, customer) {
    try {
        console.log('🔍 מחפש פתרון במסד התקלות...');
        
        const problem = problemDescription.toLowerCase();
        let foundSolution = null;
        let foundScenario = null;
        
        // בדיקה שהמסד טעון
        if (!serviceFailureDB || !Array.isArray(serviceFailureDB) || serviceFailureDB.length === 0) {
        console.error('❌ מסד התקלות ריק או לא טעון');
        return '🔧 **בעיה במאגר התקלות**\n\n📧 מעבירה מייל לשירות\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף בלבד:** 039792365';
        }
        
        console.log(`📋 בודק ${serviceFailureDB.length} תרחישי תקלות...`);
        
        // חיפוש במאגר התקלות
        for (const scenario of serviceFailureDB) {
            if (!scenario.תרחיש || !scenario.שלבים) {
                console.log('⚠️ תרחיש פגום - מדלג');
                continue;
            }
            
            const scenarioText = scenario.תרחיש.toLowerCase();
            console.log(`🔍 בודק תרחיש: ${scenario.תרחיש}`);
            
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
                console.log(`✅ נמצא פתרון לתקלה: ${scenario.תרחיש} (התאמות: ${matchCount})`);
                break;
            }
        }
        
        // אם נמצא פתרון במאגר - נסה לשפר עם OpenAI
        if (foundSolution && foundScenario) {
            console.log('🤖 מנסה לשפר את הפתרון עם OpenAI...');
            
            try {
                // בדיקה שיש מפתח API
                if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('fake') || process.env.OPENAI_API_KEY.includes('כאן')) {
                    console.log('⚠️ אין מפתח OpenAI תקין - מחזיר פתרון מהמאגר');
	return `${foundSolution}\n\n📧 **אם הפתרון לא עזר:** אעביר מייל לשירות\n\n❓ **האם הפתרון עזר?** (כן/לא)`;
                }
                
                const aiPrompt = `אתה טכנאי מומחה במערכות חניונים של שיידט. 

לקוח מ${customer.site} דיווח על התקלה: "${problemDescription}"

מצאתי פתרון במאגר:
תרחיש: ${foundScenario.תרחיש}
שלבים: ${foundScenario.שלבים}
הערות: ${foundScenario.הערות || 'אין'}

אנא שפר את הפתרון:
1. הסבר בפשטות את השלבים
2. הוסף טיפים מעשיים
3. הזהר מפני טעויות נפוצות
4. כתוב בעברית, קצר ומובן

התחל עם "🔧 פתרון מומלץ:" והשאר קצר (עד 150 מילים).`;
                
                const aiResponse = await openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [{ role: "user", content: aiPrompt }],
                    max_tokens: 300,
                    temperature: 0.3,
                });
                
                const aiSolution = aiResponse.choices[0].message.content;
                console.log('✅ OpenAI שיפר את הפתרון');

	return `${aiSolution}\n\n📧 **אם הפתרון לא עזר:** אעביר מייל לשירות\n\n❓ **האם הפתרון עזר?** (כן/לא)`;
                
            } catch (aiError) {
                console.error('⚠️ שגיאה ב-OpenAI:', aiError.message);
                console.log('📋 מחזיר פתרון מהמאגר בלבד');
	return `${foundSolution}\n\n📧 **אם הפתרון לא עזר:** אעביר מייל לשירות\n\n❓ **האם הפתרון עזר?** (כן/לא)`;
            }
        }
        
        // אם לא נמצא במאגר - נסה OpenAI לבד
        console.log('🤖 לא נמצא במאגר, מנסה OpenAI לבד...');
        
        try {
            if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('fake') || process.env.OPENAI_API_KEY.includes('כאן')) {
                console.log('⚠️ אין מפתח OpenAI - מעביר לטכנאי');
	return '🔧 **לא נמצא פתרון מיידי**\n\n📧 מעבירה מייל לשירות\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף בלבד:** 039792365';
            }
            
            const aiPrompt = `אתה טכנאי מומחה במערכות חניונים של שיידט. 

לקוח מ${customer.site} דיווח על התקלה: "${problemDescription}"

אם אתה מכיר פתרון מדויק לתקלה זו במערכות שיידט, תן פתרון קצר ומעשי בעברית.
אם לא בטוח או לא מכיר - כתוב "לא נמצא פתרון מיידי".

התחל עם "🔧 פתרון אפשרי:" והשאר קצר (עד 100 מילים).`;
            
            const aiResponse = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: aiPrompt }],
                max_tokens: 200,
                temperature: 0.2,
            });
            
            const aiSolution = aiResponse.choices[0].message.content;
            
            if (!aiSolution.includes('לא נמצא פתרון מיידי')) {
                console.log('✅ OpenAI מצא פתרון');
	return `${aiSolution}\n\n📧 **אם הפתרון לא עזר:** אעביר מייל לשירות\n\n❓ **האם הפתרון עזר?** (כן/לא)`;            }
            
        } catch (aiError) {
            console.error('⚠️ שגיאה ב-OpenAI:', aiError.message);
        }
        
        console.log('⚠️ לא נמצא פתרון - מעביר לטכנאי');
        return '🔧 **לא נמצא פתרון מיידי**\n\n📧 מעבירה מייל לשירות\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף בלבד:** 039792365';
        
    } catch (error) {
        console.error('❌ שגיאה כללית בחיפוש פתרון:', error.message);
       return '🔧 **בעיה זמנית במערכת**\n\n📧 מעבירה מייל לשירות\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n\n📞 **דחוף בלבד:** 039792365';
    }
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
            response: `שלום ${customer.name} 👋\n\n🔧 **תיאור התקלה:**\n\nאנא כתוב תיאור קצר של התקלה כולל סוג היחידה ומספר\n\nדוגמאות:\n• "היחידה לא דולקת"\n• "מחסום לא עולה"\n• "לא מדפיס כרטיסים"\n\n📞 039792365`, 
            stage: 'problem_description' 
        };
    }
    
    if (msg === '2' || msg.includes('נזק')) {
        return { 
            response: `שלום ${customer.name} 👋\n\n📷 **דיווח נזק:**\n\nאנא צלם את הנזק ושלח תמונה + מספר היחידה\n\nדוגמה: תמונה + "יחידה 101"\n\n📞 039792365`, 
            stage: 'damage_photo' 
        };
    }
    
    if (msg === '3' || msg.includes('מחיר')) {
        return { 
            response: `שלום ${customer.name} 👋\n\n💰 **הצעת מחיר / הזמנה**\n\nמה אתה מבקש להזמין?\n\nדוגמאות:\n• "20,000 כרטיסים"\n• "3 גלילים נייר"\n• "זרוע חלופית"\n\n📞 039792365`, 
            stage: 'order_request' 
        };
    }
    
    if (msg === '4' || msg.includes('הדרכה')) {
        return { 
            response: `שלום ${customer.name} 👋\n\n📚 **הדרכה**\n\nבאיזה נושא אתה זקוק להדרכה?\n\nדוגמאות:\n• "הפעלת המערכת"\n• "החלפת נייר"\n• "טיפול בתקלות"\n\n📞 039792365`, 
            stage: 'training_request' 
        };
    }
    
    // עיבוד הזמנה
    if (context?.stage === 'order_request') {
        return { 
            response: `📋 **קיבלתי את בקשת ההזמנה!**\n\n"${message}"\n\n📧 אשלח הצעת מחיר מפורטת למייל\n⏰ תוך 24 שעות\n\n📞 039792365`, 
            stage: 'order_completed',
            sendOrderEmail: true,
            orderDetails: message
        };
    }
    
    // עיבוד בקשת הדרכה
    if (context?.stage === 'training_request') {
        console.log(`🔍 מחפש הדרכה עבור: ${message}`);
        
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
            trainingContent: trainingContent
        };
    }
    
    // עיבוד תיאור הבעיה
    if (context?.stage === 'problem_description') {
        const currentServiceNumber = getNextServiceNumber();
        
        return { 
            response: `📋 **קיבלתי את התיאור**\n\n"${message}"\n\n🔍 מחפש פתרון במאגר התקלות...\n⏳ רגע אחד...\n\n🆔 מספר קריאה: ${currentServiceNumber}\n\n📞 039792365`, 
            stage: 'processing_with_ai',
            serviceNumber: currentServiceNumber,
            problemDescription: message
        };
    }
    
    // משוב על פתרון
    if (context?.stage === 'waiting_feedback') {
        if (msg.includes('כן') || msg.includes('נפתר') || msg.includes('תודה') || (msg.includes('עזר') && !msg.includes('לא עזר'))) {
            return { 
                response: `🎉 **מעולה! הבעיה נפתרה!**\n\nשמח לשמוע שהפתרון עזר!\n\nיום טוב! 😊\n\n📞 039792365`, 
                stage: 'resolved', 
                sendSummary: true,
                serviceNumber: context.serviceNumber,
                problemDescription: context.problemDescription,
                solution: context.aiSolution,
                resolved: true
            };
        } else if (msg.includes('לא') || msg.includes('לא עזר') || msg.includes('לא עובד')) {
            return { 
                response: `🔧 **מבין שהפתרון לא עזר**\n\n📋 מעבירה את הפניה לטכנאי מומחה\n\n⏰ טכנאי יצור קשר תוך 2-4 שעות\n📞 039792365\n\n🆔 מספר קריאה: ${context.serviceNumber}`, 
                stage: 'technician_dispatched', 
                sendTechnician: true,
                serviceNumber: context.serviceNumber,
                problemDescription: context.problemDescription,
                solution: context.aiSolution,
                resolved: false
            };
        } else {
            return {
                response: `❓ **האם הפתרון עזר?**\n\n✅ כתוב "כן" אם הבעיה נפתרה\n❌ כתוב "לא" אם עדיין יש בעיה\n\n📞 039792365`,
                stage: 'waiting_feedback'
            };
        }
    }
    
    // ברירת מחדל
    return { 
        response: `שלום ${customer.name} מחניון ${customer.site} 👋\n\nאיך אוכל לעזור?\n1️⃣ תקלה\n2️⃣ נזק\n3️⃣ הצעת מחיר\n4️⃣ הדרכה\n\n📞 039792365`, 
        stage: 'menu' 
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
            console.log(`📎 מצרף ${extraData.attachments.length} קבצים למייל`);
        }
        
        await transporter.sendMail(mailOptions);
        console.log(`📧 מייל נשלח: ${type} - ${customer.name} - ${serviceNumber}${extraData.attachments ? ` עם ${extraData.attachments.length} תמונות` : ''}`);
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
                console.log(`📁 קובץ: ${messageData.fileMessageData.fileName}`);
            }
            
            console.log(`📞 הודעה מ-${phone} (${customerName}): ${messageText}`);
            
            let customer = findCustomer(phone, messageText);
            const context = customer ? memory.get(phone, customer) : memory.get(phone);
            
            console.log(`🔍 לקוח: ${customer ? customer.name + ' מ' + customer.site : 'לא מזוהה'}`);
            console.log(`📊 Context stage: ${context?.stage || 'אין'}`);
            
            let result = generateResponse(messageText, customer, context, phone);
            
            if (result.customer && !customer) {
                customer = result.customer;
                console.log(`🆕 לקוח חדש מזוהה: ${customer.name} מ${customer.site}`);
            }
            
            memory.add(phone, messageText, 'customer', customer);
            
            // עיבוד מיוחד לתקלות עם AI
            if (result.stage === 'processing_with_ai' && result.problemDescription) {
                console.log('🔍 מחפש פתרון לתקלה...');
                
                try {
                    const solution = await getAISolution(result.problemDescription, customer);
                    
                    const finalResponse = `${solution}\n\n🆔 מספר קריאה: ${result.serviceNumber}`;
                    
                    await sendWhatsApp(phone, finalResponse);
                    memory.add(phone, finalResponse, 'hadar', customer);
                    memory.updateStage(phone, 'waiting_feedback', customer);
                    
                    // שמור את המידע לזיכרון
                    const contextAfter = memory.get(phone, customer);
                    if (contextAfter) {
                        contextAfter.serviceNumber = result.serviceNumber;
                        contextAfter.problemDescription = result.problemDescription;
                        contextAfter.aiSolution = solution;
                    }
                    
                    console.log(`✅ פתרון נשלח ללקוח ${customer.name} - ${result.serviceNumber}`);
                    return res.status(200).json({ status: 'OK' });
                } catch (error) {
                    console.error('❌ שגיאה בחיפוש פתרון:', error);
                    await sendWhatsApp(phone, `⚠️ יש בעיה זמנית במערכת\n\nאנא התקשר ישירות: 📞 039792365\n\n🆔 מספר קריאה: ${result.serviceNumber}`);
                    return res.status(200).json({ status: 'OK' });
                }
            }
            
            // בדיקה מיוחדת לקבצים עם יחידה
            if (hasFile && customer && context?.stage === 'damage_photo') {
                const unitMatch = messageText.match(/(\d{3})|יחידה\s*(\d{1,3})/);
                if (unitMatch) {
                    const unit = unitMatch[1] || unitMatch[2];
                    const currentServiceNumber = getNextServiceNumber();
                    
                    console.log(`📁 נזק ביחידה ${unit} - תמונה התקבלה מ${customer.name}`);
                    
                    // הורדת התמונה מוואטסאפ
                    let downloadedFiles = [];
                    if (messageData.fileMessageData && messageData.fileMessageData.downloadUrl) {
                        const timestamp = Date.now();
                        const fileName = `damage_${customer.id}_${unit}_${timestamp}.jpg`;
                        
                        const filePath = await downloadWhatsAppFile(messageData.fileMessageData.downloadUrl, fileName);
                        if (filePath) {
                            downloadedFiles.push(filePath);
                            console.log(`✅ תמונה הורדה: ${fileName}`);
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
                    
                    console.log(`✅ נזק יחידה ${unit} - מייל עם תמונה נשלח - ${currentServiceNumber}`);
                    return res.status(200).json({ status: 'OK' });
                } else {
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
            } else if (finalResult.sendTrainingEmail) {
                console.log(`📧 שולח מייל הדרכה ללקוח ${customer.name}`);
                await sendEmail(customer, 'training', finalResult.trainingRequest, {
                    serviceNumber: getNextServiceNumber(),
                    trainingRequest: finalResult.trainingRequest,
                    trainingContent: finalResult.trainingContent
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
    console.log('📋 מסד תקלות:', serviceFailureDB.length, 'תרחישים');
    console.log('📚 מסדי הדרכה:', Object.keys(trainingDB).length, 'קבצים');
    console.log('🤖 OpenAI:', process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('fake') && !process.env.OPENAI_API_KEY.includes('כאן') ? '✅ פעיל' : '❌ צריך מפתח');
    console.log('🔢 מספרי קריאה: HSC-' + (globalServiceCounter + 1) + '+');
    console.log('📧 מיילים: סיכום מלא בכל קריאה');
    console.log('✅ מערכת מושלמת מוכנה!');
});

module.exports = app;
