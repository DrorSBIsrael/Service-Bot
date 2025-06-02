// קובץ: server.js
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const axios = require('axios');
const app = express();

// טעינת מסד נתוני לקוחות מקובץ חיצוני
const fs = require('fs');

let customers = [];
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
    
    console.log(`✅ נטענו ${customers.length} לקוחות מהקובץ`);
} catch (error) {
    console.error('❌ שגיאה בטעינת קובץ הלקוחות:', error.message);
    // רשימה בסיסית כגיבוי
    customers = [
        { id: 555, name: "דרור פרינץ", site: "חניון רימון", phone: "0545-484210", address: "רימון 8 רמת אפעל", email: "Dror@sbparking.co.il" }
    ];
}

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

// עמוד הבית - טופס אימייל
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>מערכת שירות לקוחות - שיידט את בכמן</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
                .container { max-width: 700px; margin: 0 auto; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
                h1 { color: #2c3e50; text-align: center; margin-bottom: 30px; }
                .company-header { text-align: center; background: #3498db; color: white; padding: 20px; border-radius: 10px; margin-bottom: 30px; }
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
            </style>
        </head>
        <body>
            <div class="container">
                <div class="company-header">
                    <h1>🚗 שיידט את בכמן</h1>
                    <p>מערכת ניהול חניות ושירות לקוחות מתקדמת</p>
                </div>
                
                <div class="stats">
                    <div class="stat">
                        <h3>✅ שירות אימייל</h3>
                        <small>smtp.012.net.il</small>
                    </div>
                    <div class="stat">
                        <h3>📱 WhatsApp Bot</h3>
                        <small>AI מתקדם</small>
                    </div>
                    <div class="stat">
                        <h3>👥 לקוחות רשומים</h3>
                        <small>${customers.length} אתרים</small>
                    </div>
                </div>
                
                <div class="quick-actions">
                    <a href="#email-form" class="quick-btn">📧 שליחת אימייל</a>
                    <a href="#customer-search" class="quick-btn">🔍 חיפוש לקוח</a>
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
                    <p><strong>לקוחות במערכת:</strong> ${customers.length} אתרי חניה</p>
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
                                <small>📞 \${c.phone} | 📧 \${c.email}</small>
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

// API לשליחת אימייל עם תמונות
app.post('/send-email', upload.array('images', 5), async (req, res) => {
    try {
        console.log('📧 מתחיל לשלוח אימייל...');
        
        const { to, subject, message } = req.body;
        
        let htmlContent = `
            <div dir="rtl" style="font-family: Arial, sans-serif;">
                <div style="background: linear-gradient(45deg, #3498db, #2980b9); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                    <h2 style="margin: 0;">🚗 שיידט את בכמן</h2>
                    <p style="margin: 5px 0 0 0;">מערכת ניהול חניות ושירות לקוחות</p>
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
                        📞 לפניות: Report@sbparking.co.il | 🌐 מערכת ניהול חניות מתקדמת
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
                        <p><strong>📎 תמונות:</strong> ${req.files ? req.files.length : 0}</p>
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

// WhatsApp Webhook - קבלת הודעות
app.post('/webhook/whatsapp', async (req, res) => {
    try {
        console.log('📩 WhatsApp Webhook received:', JSON.stringify(req.body, null, 2));
        
        // רק הודעות נכנסות - לא סטטוסים
        if (req.body.typeWebhook === 'incomingMessageReceived') {
            const messageData = req.body.messageData;
            const senderData = req.body.senderData;
            
            const phoneNumber = senderData.sender.replace('@c.us', '');
            const messageText = messageData.textMessageData?.textMessage || 'הודעה ללא טקסט';
            
            console.log(`📱 הודעה מ-${phoneNumber}: ${messageText}`);
            
            // חיפוש לקוח במסד הנתונים
            const customer = findCustomerByPhone(phoneNumber);
            
            // יצירת תגובה עם AI
            const response = await generateAIResponse(messageText, senderData.senderName || 'לקוח', customer);
            
            // שליחת תגובה
            await sendWhatsAppMessage(phoneNumber, response);
            
            // שליחת אימייל התראה למנהל
            try {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER || 'Report@sbparking.co.il',
                    to: 'Dror@sbparking.co.il',
                    subject: `הודעה חדשה מ-WhatsApp: ${customer ? customer.name : phoneNumber}`,
                    html: `
                        <div dir="rtl" style="font-family: Arial, sans-serif;">
                            <div style="background: linear-gradient(45deg, #3498db, #2980b9); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                                <h2 style="margin: 0;">📱 הודעה חדשה מוואטסאפ</h2>
                                <p style="margin: 5px 0 0 0;">שיידט את בכמן - מערכת שירות לקוחות</p>
                            </div>
                            <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                                <h3 style="color: #2c3e50; margin-top: 0;">פרטי השולח:</h3>
                                <p><strong>📞 מספר:</strong> ${phoneNumber}</p>
                                <p><strong>👤 שם:</strong> ${senderData.senderName || 'לא זמין'}</p>
                                ${customer ? `
                                <div style="background: #d4edda; padding: 15px; border-radius: 8px; border-right: 4px solid #28a745;">
                                    <h4 style="color: #155724; margin-top: 0;">✅ לקוח מזוהה במערכת:</h4>
                                    <p><strong>שם:</strong> ${customer.name}</p>
                                    <p><strong>אתר:</strong> ${customer.site}</p>
                                    <p><strong>אימייל:</strong> ${customer.email}</p>
                                    <p><strong>כתובת:</strong> ${customer.address}</p>
                                </div>
                                ` : `
                                <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-right: 4px solid #ffc107;">
                                    <p style="color: #856404; margin: 0;"><strong>⚠️ לקוח לא מזוהה במערכת</strong></p>
                                </div>
                                `}
                            </div>
                            <div style="background: white; padding: 20px; border-radius: 10px; border-right: 4px solid #3498db;">
                                <h3 style="color: #2c3e50; margin-top: 0;">💬 ההודעה:</h3>
                                <p style="font-size: 16px; line-height: 1.5;">"${messageText}"</p>
                            </div>
                            <div style="margin-top: 20px; padding: 15px; background: #ecf0f1; border-radius: 8px; text-align: center;">
                                <p style="color: #7f8c8d; font-size: 12px; margin: 0;">
                                    ⏰ זמן: ${new Date().toLocaleString('he-IL')}<br>
                                    🤖 הודעה זו נשלחה אוטומטית ממערכת שיידט את בכמן
                                </p>
                            </div>
                        </div>
                    `
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

// פונקציה לחיפוש לקוח לפי מספר טלפון
function findCustomerByPhone(phoneNumber) {
    // ניקוי מספר הטלפון מתווים מיותרים
    const cleanPhone = phoneNumber.replace(/[^\d]/g, '');
    
    return customers.find(customer => {
        const customerPhone = customer.phone.replace(/[^\d]/g, '');
        // בדיקה גם עם וגם בלי קידומת ארץ
        return customerPhone === cleanPhone || 
               customerPhone === cleanPhone.substring(3) || 
               ('972' + customerPhone) === cleanPhone;
    });
}

// פונקציית AI לתגובות חכמות
async function generateAIResponse(message, customerName, customerData = null) {
    try {
        const systemPrompt = `אתה נציג שירות לקוחות של "שיידט את בכמן" - חברת ניהול חניות מתקדמת בישראל.

תפקידך:
- לעזור ללקוחות בנושאי חניות, תשלומים, הפרות ותחזוקה
- לתת מידע מדויק ומועיל על מערכות חניה
- להיות מקצועי אך חם ונעים
- לענות תמיד בעברית בלבד
- אם אתה לא יודע משהו - תבקש מהלקוח לחכות לנציג אנושי

${customerData ? `
מידע על הלקוח:
- שם: ${customerData.name}
- אתר: ${customerData.site}
- אימייל: ${customerData.email}
- כתובת: ${customerData.address}
` : 'הלקוח לא מזוהה במערכת - בקש פרטים אם נדרש.'}

כללי תגובה:
- התחל תמיד בברכה אישית
- היה קצר ולעניין (עד 3 משפטים)
- הוסף אימוג'י רלבנטי
- אם זה נושא מורכב - הבטח שנציג יחזור
- הזכר את שם החברה "שיידט את בכמן" בצורה טבעית
- אם הלקוח מזוהה - התייחס לאתר החניה שלו`;

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
            max_tokens: 150,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('❌ שגיאה ב-OpenAI:', error.message);
        // תגובת fallback אם ה-AI לא עובד
        const greeting = customerData ? 
            `שלום ${customerData.name} מ${customerData.site}! 👋` :
            `שלום ${customerName}! 👋`;
            
        return `${greeting}\n\nקיבלתי את ההודעה שלך ואעביר אותה לנציג המתאים.\nנחזור אליך בהקדם!\n\n🚗 שיידט את בכמן - כאן בשבילך`;
    }
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

// בדיקת webhook (GET request)
app.get('/webhook/whatsapp', (req, res) => {
    res.json({ 
        message: 'WhatsApp Webhook is working!', 
        timestamp: new Date().toISOString(),
        instance: '7105253183',
        company: 'שיידט את בכמן'
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
            company: 'שיידט את בכמן'
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

// עמוד סטטיסטיקות ולקוחות
app.get('/dashboard', (req, res) => {
    const totalCustomers = customers.length;
    const uniqueCities = [...new Set(customers.map(c => c.address.split(',')[0]).filter(c => c))].length;
    const customersWithEmail = customers.filter(c => c.email).length;
    
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
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📊 דשבורד ניהול - שיידט את בכמן</h1>
                    <p>מעקב ובקרה על מערכת ניהול החניות</p>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <h3>👥 סה"כ לקוחות</h3>
                        <div class="stat-number">${totalCustomers}</div>
                        <p>אתרי חניה פעילים</p>
                    </div>
                    <div class="stat-card">
                        <h3>🏢 ערים</h3>
                        <div class="stat-number">${uniqueCities}</div>
                        <p>ערים עם אתרי חניה</p>
                    </div>
                    <div class="stat-card">
                        <h3>📧 עם אימייל</h3>
                        <div class="stat-number">${customersWithEmail}</div>
                        <p>לקוחות עם כתובת אימייל</p>
                    </div>
                    <div class="stat-card">
                        <h3>📱 WhatsApp</h3>
                        <div class="stat-number">פעיל</div>
                        <p>בוט AI מתקדם</p>
                    </div>
                </div>
                
                <div class="customers-table">
                    <div class="table-header">
                        <h2>📋 רשימת לקוחות</h2>
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
                
                <a href="/" class="back-btn">← חזור למערכת הראשית</a>
            </div>
        </body>
        </html>
    `);
});

// הפעלת השרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 השרת פועל על פורט:', PORT);
    console.log('🌐 פתח בדפדפן: http://localhost:' + PORT);
    console.log('📧 שרת אימייל: smtp.012.net.il');
    console.log('📱 WhatsApp Instance: 7105253183');
    console.log('🏢 חברה: שיידט את בכמן');
    console.log(`👥 לקוחות במערכת: ${customers.length}`);
});

// בדיקת חיבור בהפעלה
transporter.verify()
    .then(() => {
        console.log('✅ חיבור לשרת אימייל תקין');
    })
    .catch((error) => {
        console.error('❌ בעיה בחיבור לשרת אימייל:', error.message);
    });
