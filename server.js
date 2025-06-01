// קובץ: server.js
require('dotenv').config(); // טוען משתני סביבה
const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const app = express();

// הגדרות בסיסיות
app.use(express.json());
app.use(express.static('public')); // לקבצים סטטיים

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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('רק תמונות מותרות'));
        }
    }
});

// עמוד הבית - טופס פשוט לבדיקה
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>בדיקת אימייל</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 50px; }
                input, textarea, button { 
                    width: 100%; 
                    padding: 10px; 
                    margin: 10px 0; 
                    box-sizing: border-box;
                }
                button { background: #4CAF50; color: white; border: none; cursor: pointer; }
                button:hover { background: #45a049; }
            </style>
        </head>
        <body>
            <h1>בדיקת שליחת אימייל עם תמונות</h1>
            
            <form action="/send-email" method="POST" enctype="multipart/form-data">
                <label>כתובת אימייל של הנמען:</label>
                <input type="email" name="to" required placeholder="example@gmail.com">
                
                <label>נושא:</label>
                <input type="text" name="subject" required placeholder="נושא האימייל">
                
                <label>הודעה:</label>
                <textarea name="message" rows="5" required placeholder="כתוב כאן את ההודעה..."></textarea>
                
                <label>תמונות (אופציונלי):</label>
                <input type="file" name="images" multiple accept="image/*">
                
                <button type="submit">שלח אימייל</button>
            </form>
            
            <div id="result"></div>
            
            <script>
                // הוספת feedback חזותי
                document.querySelector('form').addEventListener('submit', function() {
                    document.getElementById('result').innerHTML = '<p style="color: blue;">שולח אימייל...</p>';
                });
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
        
        // הכנת תוכן HTML
        let htmlContent = `
            <div dir="rtl" style="font-family: Arial, sans-serif;">
                <p>${message.replace(/\n/g, '<br>')}</p>
        `;
        
        // הכנת קבצים מצורפים
        const attachments = [];
        
        if (req.files && req.files.length > 0) {
            console.log(`📎 מצרף ${req.files.length} תמונות`);
            
            htmlContent += '<br><h3>תמונות מצורפות:</h3>';
            
            req.files.forEach((file, index) => {
                const cid = `image${index + 1}`;
                
                // הוספה לקבצים מצורפים
                attachments.push({
                    filename: file.originalname || `image_${index + 1}.jpg`,
                    content: file.buffer,
                    cid: cid
                });
                
                // הוספה ל-HTML
                htmlContent += `<p><img src="cid:${cid}" style="max-width: 400px; height: auto;" alt="תמונה ${index + 1}"></p>`;
            });
        }
        
        htmlContent += '</div>';
        
        // הגדרות האימייל
        const mailOptions = {
            from: process.env.EMAIL_USER || 'Report@sbparking.co.il',
            to: to,
            subject: subject,
            html: htmlContent,
            attachments: attachments
        };
        
        // שליחת האימייל
        const result = await transporter.sendMail(mailOptions);
        
        console.log('✅ אימייל נשלח בהצלחה:', result.messageId);
        
        res.send(`
            <div dir="rtl" style="font-family: Arial; margin: 50px;">
                <h2 style="color: green;">✅ האימייל נשלח בהצלחה!</h2>
                <p><strong>נמען:</strong> ${to}</p>
                <p><strong>נושא:</strong> ${subject}</p>
                <p><strong>מספר תמונות:</strong> ${req.files ? req.files.length : 0}</p>
                <p><strong>Message ID:</strong> ${result.messageId}</p>
                <br>
                <a href="/">← חזור לשליחת אימייל נוסף</a>
            </div>
        `);
        
    } catch (error) {
        console.error('❌ שגיאה בשליחת אימייל:', error);
        
        res.status(500).send(`
            <div dir="rtl" style="font-family: Arial; margin: 50px;">
                <h2 style="color: red;">❌ שגיאה בשליחת האימייל</h2>
                <p><strong>שגיאה:</strong> ${error.message}</p>
                <p>בדוק את הגדרות האימייל והרשת</p>
                <br>
                <a href="/">← חזור לנסות שוב</a>
            </div>
        `);
    }
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

// הפעלת השרת
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 השרת פועל על פורט:', PORT);
    console.log('🌐 פתח בדפדפן: http://localhost:' + PORT);
    console.log('📧 שרת אימייל: smtp.012.net.il');
});

// בדיקת חיבור בהפעלה
transporter.verify()
    .then(() => {
        console.log('✅ חיבור לשרת אימייל תקין');
    })
    .catch((error) => {
        console.error('❌ בעיה בחיבור לשרת אימייל:', error.message);
    });
// WhatsApp Bot Integration
app.post('/webhook/whatsapp', async (req, res) => {
    try {
        console.log('הודעה מוואטסאפ:', req.body);
        
        const message = req.body;
        if (message.body && message.author) {
            const phoneNumber = message.author.replace('@c.us', '');
            const messageText = message.body;
            
            // תגובה פשוטה
            const response = `שלום! קיבלתי את ההודעה שלך: "${messageText}". אני בוט לשירות לקוחות.`;
            
            // שליחת תגובה
            await sendWhatsAppMessage(phoneNumber, response);
        }
        
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('שגיאה:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

async function sendWhatsAppMessage(phoneNumber, message) {
    const axios = require('axios');
    
    const url = `https://7105.api.greenapi.com/waInstance7105253183/sendMessage/2fec0da532cc4f1c9cb5b1cdc561d2e36baff9a76bce407889`;
    
    try {
        await axios.post(url, {
            chatId: `${phoneNumber}@c.us`,
            message: message
        });
        console.log('הודעה נשלחה בוואטסאפ');
    } catch (error) {
        console.error('שגיאה בשליחת וואטסאפ:', error);
    }
}
