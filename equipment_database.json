// קובץ: server.js
require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const axios = require('axios');
const app = express();

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
            <title>מערכת שירות לקוחות SB Parking</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 50px; background: #f5f5f5; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; }
                h1 { color: #2c3e50; text-align: center; }
                input, textarea, button { 
                    width: 100%; 
                    padding: 12px; 
                    margin: 10px 0; 
                    box-sizing: border-box;
                    border: 2px solid #ddd;
                    border-radius: 5px;
                }
                button { 
                    background: #3498db; 
                    color: white; 
                    border: none; 
                    cursor: pointer;
                    font-size: 16px;
                }
                button:hover { background: #2980b9; }
                .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
                .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
                .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚗 SB Parking - מערכת שירות לקוחות</h1>
                <p><strong>מערכת פעילה:</strong></p>
                <ul>
                    <li>✅ שירות אימייל</li>
                    <li>✅ WhatsApp Bot</li>
                    <li>✅ תמיכה בתמונות</li>
                </ul>
                
                <h2>שליחת אימייל ללקוח</h2>
                <form action="/send-email" method="POST" enctype="multipart/form-data">
                    <label>כתובת אימייל:</label>
                    <input type="email" name="to" required placeholder="customer@example.com">
                    
                    <label>נושא:</label>
                    <input type="text" name="subject" required placeholder="נושא האימייל">
                    
                    <label>הודעה:</label>
                    <textarea name="message" rows="5" required placeholder="כתוב כאן את ההודעה ללקוח..."></textarea>
                    
                    <label>תמונות (אופציונלי):</label>
                    <input type="file" name="images" multiple accept="image/*">
                    
                    <button type="submit">שלח אימייל</button>
                </form>
                
                <h2>מידע טכני</h2>
                <p><strong>WhatsApp Webhook:</strong> <code>/webhook/whatsapp</code></p>
                <p><strong>מספר מחובר:</strong> 972545484210</p>
                <p><strong>שרת אימייל:</strong> smtp.012.net.il</p>
            </div>
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
                <h2 style="color: #2c3e50;">SB Parking - שירות לקוחות</h2>
                <p>${message.replace(/\n/g, '<br>')}</p>
        `;
        
        const attachments = [];
        
        if (req.files && req.files.length > 0) {
            console.log(`📎 מצרף ${req.files.length} תמונות`);
            htmlContent += '<br><h3>תמונות מצורפות:</h3>';
            
            req.files.forEach((file, index) => {
                const cid = `image${index + 1}`;
                attachments.push({
                    filename: file.originalname || `image_${index + 1}.jpg`,
                    content: file.buffer,
                    cid: cid
                });
                htmlContent += `<p><img src="cid:${cid}" style="max-width: 400px; height: auto;" alt="תמונה ${index + 1}"></p>`;
            });
        }
        
        htmlContent += '<br><p style="color: #7f8c8d; font-size: 12px;">הודעה זו נשלחה ממערכת SB Parking</p></div>';
        
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
            <div dir="rtl" style="font-family: Arial; margin: 50px;">
                <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px;">
                    <h2 style="color: green;">✅ האימייל נשלח בהצלחה!</h2>
                    <p><strong>נמען:</strong> ${to}</p>
                    <p><strong>נושא:</strong> ${subject}</p>
                    <p><strong>מספר תמונות:</strong> ${req.files ? req.files.length : 0}</p>
                    <p><strong>Message ID:</strong> ${result.messageId}</p>
                    <br>
                    <a href="/" style="background: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">← חזור למערכת</a>
                </div>
            </div>
        `);
        
    } catch (error) {
        console.error('❌ שגיאה בשליחת אימייל:', error);
        res.status(500).send(`
            <div dir="rtl" style="font-family: Arial; margin: 50px;">
                <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px;">
                    <h2 style="color: red;">❌ שגיאה בשליחת האימייל</h2>
                    <p><strong>שגיאה:</strong> ${error.message}</p>
                    <br>
                    <a href="/" style="background: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">← חזור לנסות שוב</a>
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
            
            // יצירת תגובה עם AI
            const response = await generateAIResponse(messageText, senderData.senderName || 'לקוח');
            
            // שליחת תגובה
            await sendWhatsAppMessage(phoneNumber, response);
            
            // שליחת אימייל התראה למנהל
try {
    await transporter.sendMail({
        from: process.env.EMAIL_USER || 'Report@sbparking.co.il',
        to: 'Dror@sbparking.co.il', // הכתובת הנכונה של המנהל
        subject: `הודעה חדשה מ-WhatsApp: ${phoneNumber}`,
        html: `
            <div dir="rtl">
                <h2>הודעה חדשה מוואטסאפ - SB Parking</h2>
                <p><strong>מספר שולח:</strong> ${phoneNumber}</p>
                <p><strong>שם:</strong> ${senderData.senderName || 'לא זמין'}</p>
                <p><strong>הודעה:</strong> ${messageText}</p>
                <p><strong>זמן:</strong> ${new Date().toLocaleString('he-IL')}</p>
                <hr>
                <p style="color: #666; font-size: 12px;">הודעה זו נשלחה אוטומטית ממערכת שירות הלקוחות</p>
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

// פונקציה לשליחת הודעות WhatsApp
async function sendWhatsAppMessage(phoneNumber, message) {
    const instanceId = process.env.WHATSAPP_INSTANCE || '7105253183';
    const token = process.env.WHATSAPP_TOKEN || '2fec0da532cc4f1c9cb5b1cdc561d2e36baff9a76bce407889';
    const url = `https://7105.api.greenapi.com/waInstance${instanceId}/sendMessage/${token}`;
    
    try {
        const response = await axios.post(url, {
            chatId: `${phoneNumber}@c.us`,
            message: message  // פשוט string, לא אובייקט!
        });
        console.log('✅ הודעת WhatsApp נשלחה:', response.data);
        return response.data;
    } catch (error) {
        console.error('❌ שגיאה בשליחת WhatsApp:', error.response?.data || error.message);
        throw error;
    }
}

// בדיקת webhook (GET request)
app.get('/webhook/whatsapp', (req, res) => {
    res.json({ 
        message: 'WhatsApp Webhook is working!', 
        timestamp: new Date().toISOString(),
        instance: '7105253183'
    });
});

// בדיקת חיבור לשרת אימייל
app.get('/test-connection', async (req, res) => {
    try {
        await transporter.verify();
        res.json({
            success: true,
            message: '✅ החיבור לשרת האימייל עובד!',
            server: 'smtp.012.net.il'
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
    console.log('📱 WhatsApp Instance: 7105253183');
});

// בדיקת חיבור בהפעלה
transporter.verify()
    .then(() => {
        console.log('✅ חיבור לשרת אימייל תקין');
    })
    .catch((error) => {
        console.error('❌ בעיה בחיבור לשרת אימייל:', error.message);
    });
