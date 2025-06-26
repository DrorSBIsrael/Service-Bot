// FileHandler.js - מחלקה מאוחדת לטיפול בקבצים
const axios = require('axios');

class FileHandler {
    constructor() {
        this.uploadsDir = './uploads';
        this.maxFileSize = 50 * 1024 * 1024; // 50MB
        this.allowedTypes = [
            'image/', 'video/', 'application/pdf',
            'application/msword', 'application/vnd.openxmlformats',
            'text/plain'
        ];
        
        // יצירת תיקיית uploads אם לא קיימת
        this.ensureUploadsDir();
    }
    
    ensureUploadsDir() {
        const fs = require('fs');
        if (!fs.existsSync(this.uploadsDir)) {
            fs.mkdirSync(this.uploadsDir, { recursive: true });
        }
    }
    
    // פונקציה מאוחדת לזיהוי סוג קובץ
    identifyFile(fileName = '', mimeType = '') {
        const name = fileName.toLowerCase();
        
        // זיהוי לפי mimeType קודם
        if (mimeType) {
            if (mimeType.startsWith('image/')) return { type: 'תמונה', ext: this.getImageExt(mimeType) };
            if (mimeType.startsWith('video/')) return { type: 'סרטון', ext: this.getVideoExt(mimeType) };
            if (mimeType.includes('pdf')) return { type: 'PDF', ext: '.pdf' };
            if (mimeType.includes('msword') || mimeType.includes('wordprocessingml')) {
                return { type: 'מסמך Word', ext: mimeType.includes('wordprocessingml') ? '.docx' : '.doc' };
            }
            if (mimeType.includes('excel') || mimeType.includes('spreadsheetml')) {
                return { type: 'קובץ Excel', ext: mimeType.includes('spreadsheetml') ? '.xlsx' : '.xls' };
            }
        }
        
        // זיהוי לפי שם קובץ כגיבוי
        if (name.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/)) return { type: 'תמונה', ext: name.substring(name.lastIndexOf('.')) };
        if (name.match(/\.(mp4|avi|mov|wmv|mkv)$/)) return { type: 'סרטון', ext: name.substring(name.lastIndexOf('.')) };
        if (name.endsWith('.pdf')) return { type: 'PDF', ext: '.pdf' };
        
        return { type: 'קובץ', ext: '.file' };
    }
    
    getImageExt(mimeType) {
        if (mimeType.includes('jpeg')) return '.jpg';
        if (mimeType.includes('png')) return '.png';
        if (mimeType.includes('gif')) return '.gif';
        if (mimeType.includes('webp')) return '.webp';
        return '.jpg';
    }
    
    getVideoExt(mimeType) {
        if (mimeType.includes('mp4')) return '.mp4';
        if (mimeType.includes('avi')) return '.avi';
        if (mimeType.includes('quicktime')) return '.mov';
        return '.mp4';
    }
    
    // בדיקת תקינות קובץ
    validateFile(fileName, mimeType, fileSize = 0) {
        const errors = [];
        
        // בדיקת גודל
        if (fileSize > this.maxFileSize) {
            errors.push(`קובץ גדול מדי (מקסימום ${this.maxFileSize / 1024 / 1024}MB)`);
        }
        
        // בדיקת סוג קובץ
        const isAllowed = this.allowedTypes.some(type => 
            mimeType.startsWith(type) || mimeType.includes(type)
        );
        
        if (!isAllowed) {
            errors.push('סוג קובץ לא נתמך');
        }
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
    
    // יצירת שם קובץ ייחודי
    generateFileName(customerId, fileInfo) {
        const timestamp = Date.now();
        const { ext } = fileInfo;
        return `file_${customerId || 'unknown'}_${timestamp}${ext}`;
    }
    
    // הורדת קובץ מוואטסאפ
    async downloadFromWhatsApp(fileUrl, fileName) {
        try {
            console.log(`📥 מוריד קובץ: ${fileName}`);
            
            const response = await axios({
                method: 'GET',
                url: fileUrl,
                responseType: 'stream',
                timeout: 30000 // 30 שניות timeout
            });
            
            const fs = require('fs');
            const path = require('path');
            
            const filePath = path.join(this.uploadsDir, fileName);
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    console.log(`✅ קובץ נשמר: ${filePath}`);
                    resolve(filePath);
                });
                writer.on('error', reject);
            });
            
        } catch (error) {
            console.error('❌ שגיאה בהורדת קובץ:', error.message);
            return null;
        }
    }
    
    // פונקציה מאוחדת לטיפול בקובץ מוואטסאפ
    async processWhatsAppFile(fileData, customerId = null) {
        const { fileName, mimeType, downloadUrl } = fileData;
        
        // זיהוי סוג קובץ
        const fileInfo = this.identifyFile(fileName, mimeType);
        
        // בדיקת תקינות
        const validation = this.validateFile(fileName, mimeType);
        if (!validation.valid) {
            throw new Error(`קובץ לא תקין: ${validation.errors.join(', ')}`);
        }
        
        // יצירת שם קובץ ייחודי
        const uniqueFileName = this.generateFileName(customerId, fileInfo);
        
        // הורדת הקובץ
        const filePath = await this.downloadFromWhatsApp(downloadUrl, uniqueFileName);
        
        if (!filePath) {
            throw new Error('נכשל בהורדת הקובץ');
        }
        
        return {
            path: filePath,
            type: fileInfo.type,
            originalName: fileName,
            uniqueName: uniqueFileName
        };
    }
    
    // ניקוי קבצים ישנים (להפעיל מדי פעם)
    cleanOldFiles(maxAgeHours = 24) {
        const fs = require('fs');
        const path = require('path');
        
        try {
            const files = fs.readdirSync(this.uploadsDir);
            const now = Date.now();
            const maxAge = maxAgeHours * 60 * 60 * 1000;
            
            let deletedCount = 0;
            
            files.forEach(file => {
                const filePath = path.join(this.uploadsDir, file);
                const stats = fs.statSync(filePath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            });
            
            console.log(`🧹 נוקו ${deletedCount} קבצים ישנים`);
            
        } catch (error) {
            console.error('❌ שגיאה בניקוי קבצים:', error.message);
        }
    }
}
