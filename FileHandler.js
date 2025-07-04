// FileHandler.js - גרסה מתוקנת לשרת
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class FileHandler {
    constructor() {
        this.uploadsDir = './uploads';
        this.maxFileSize = 50 * 1024 * 1024; // 50MB
        
        // יצירת תיקיית uploads אם לא קיימת
        this.ensureUploadsDir();
    }
    
    ensureUploadsDir() {
        if (!fs.existsSync(this.uploadsDir)) {
            fs.mkdirSync(this.uploadsDir, { recursive: true });
        }
    }
    
    // זיהוי סוג קובץ
    identifyFile(fileName = '', mimeType = '') {
        // תמונות
        if (mimeType?.startsWith('image/') || fileName.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i)) {
            return { type: 'תמונה', ext: this.getImageExt(mimeType, fileName) };
        }
        
        // סרטונים
        if (mimeType?.startsWith('video/') || fileName.match(/\.(mp4|avi|mov|wmv|mkv)$/i)) {
            return { type: 'סרטון', ext: this.getVideoExt(mimeType, fileName) };
        }
        
        // PDF
        if (mimeType?.includes('pdf') || fileName.endsWith('.pdf')) {
            return { type: 'PDF', ext: '.pdf' };
        }
        
        // Word
        if (mimeType?.includes('msword') || mimeType?.includes('wordprocessingml') || 
            fileName.match(/\.(doc|docx)$/i)) {
            return { type: 'מסמך Word', ext: mimeType?.includes('wordprocessingml') ? '.docx' : '.doc' };
        }
        
        return { type: 'קובץ', ext: '.file' };
    }
    
    getImageExt(mimeType, fileName) {
        if (mimeType?.includes('jpeg')) return '.jpg';
        if (mimeType?.includes('png')) return '.png';
        if (mimeType?.includes('gif')) return '.gif';
        if (fileName) {
            const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) return ext;
        }
        return '.jpg';
    }
    
    getVideoExt(mimeType, fileName) {
        if (mimeType?.includes('mp4')) return '.mp4';
        if (mimeType?.includes('avi')) return '.avi';
        if (mimeType?.includes('quicktime')) return '.mov';
        if (fileName) {
            const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
            if (['.mp4', '.avi', '.mov', '.wmv', '.mkv'].includes(ext)) return ext;
        }
        return '.mp4';
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
            const response = await axios({
                method: 'GET',
                url: fileUrl,
                responseType: 'stream',
                timeout: 30000
            });
            
            const filePath = path.join(this.uploadsDir, fileName);
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    resolve(filePath);
                });
                writer.on('error', reject);
            });
            
        } catch (error) {
            return null;
        }
    }
    
    // טיפול מלא בקובץ מוואטסאפ
    async processWhatsAppFile(fileData, customerId = null) {
        const { fileName, mimeType, downloadUrl } = fileData;
        
        // זיהוי סוג קובץ
        const fileInfo = this.identifyFile(fileName, mimeType);
        
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
}

module.exports = FileHandler;
