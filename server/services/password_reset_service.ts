import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import Users from '../dao/users';
import Logs from '../dao/logs';
import ContractUsers from  '../dao/contract_users';
import config from '../config/config';
import { createError } from '../middleware/errorHandler';
import { resetUserPassword } from '../services/user_service';

// 生成安全的重設令牌
export const generateResetToken = (): string => {
    return crypto.randomBytes(32).toString('hex');
};

// 檢查用戶是否可以重設密碼（防止濫用）
export const canResetPassword = async (email: string): Promise<boolean> => {
    const user = await Users.findOne({ 
        raw: true, 
        where: { email } 
    });
    
    if (!user) return false;
    
    // 檢查最後重設時間，防止1小時內重複重設
    if ((user as any).lastPasswordReset) {
        const lastReset = new Date((user as any).lastPasswordReset);
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        if (lastReset > oneHourAgo) {
            return false;
        }
    }
    
    return true;
};

// 發送密碼重設郵件
export const sendPasswordResetEmail = async (email: string): Promise<{ success: boolean; message: string }> => {
    try {
        // 1. 檢查用戶是否存在
        const user = await Users.findOne({ 
            where: { email } 
        });
        
        if (!user) {
            // 為了安全，不暴露用戶是否存在
            return { 
                success: true, 
                message: '如果該信箱存在於系統中，您將收到密碼重設連結'
            };
        }
        
        // 2. 檢查是否可以重設密碼
        const canReset = await canResetPassword(email);
        if (!canReset) {
            throw createError('密碼重設請求過於頻繁，請稍後再試', 429);
        }
        
        // 3. 生成重設令牌
        const resetToken = generateResetToken();
        const resetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15分鐘後過期
        
        // 4. 更新用戶記錄
        await Users.update({
            resetPasswordToken: resetToken,
            resetPasswordExpires: resetExpires
        }, {
            where: { email }
        });
        
        // 5. 發送郵件
        const resetUrl = `${config.frontendUrl || 'https://localhost:3000'}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
        
        await sendResetEmail(email, (user as any).name || (user as any).userId, resetUrl);
        
        return { 
            success: true, 
            message: '密碼重設連結已發送至您的信箱，請在15分鐘內完成重設'
        };
        
    } catch (error: any) {
        console.error('密碼重設郵件發送失敗:', error);
        throw error;
    }
};

// 郵件發送函數
const sendResetEmail = async (email: string, userName: string, resetUrl: string): Promise<void> => {
    const transporter = nodemailer.createTransport({
        host: config.mailInfo.host || 'msa.hinet.net',        // SMTP 伺服器位址
        port: parseInt(config.mailInfo.port || '25'),         // SMTP 埠號 (25/587/465)
        secure: config.mailInfo.secure === 'false',           // true for 465, false for 587/25
        auth: config.mailInfo.user ? {
            user: config.mailInfo.user,                       // SMTP 使用者名稱
            pass: config.mailInfo.pass                        // SMTP 密碼
        } : undefined,                                         // 如果不需要認證則設為 undefined
        // 額外 Relay 設定
        tls: {
            rejectUnauthorized: config.mailInfo.rejectUnauthorized !== 'false' // 預設 true
        },
        connectionTimeout: 60000,                             // 連線逾時 (毫秒)
        greetingTimeout: 30000,                               // 問候逾時 (毫秒)
        socketTimeout: 60000                                  // Socket 逾時 (毫秒)
    })
    
    const mailOptions = {
        from: `"ADAS One 系統" <system@twister5.com.tw>`,
        to: email,
        subject: '🔐 ADAS One - 密碼重設請求',
        html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
                <div style="background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    
                    <!-- 標頭 -->
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #2c3e50; margin: 0; font-size: 24px;">🔐 密碼重設請求</h1>
                        <p style="color: #7f8c8d; margin: 10px 0 0 0;">ADAS One 安全管理系統</p>
                    </div>
                    
                    <!-- 問候語 -->
                    <div style="margin-bottom: 25px;">
                        <p style="color: #2c3e50; font-size: 16px; margin: 0;">親愛的 <strong>${userName}</strong>，</p>
                    </div>
                    
                    <!-- 主要內容 -->
                    <div style="margin-bottom: 30px;">
                        <p style="color: #34495e; line-height: 1.6; margin-bottom: 15px;">
                            我們收到了您的密碼重設請求。如果這是您本人的操作，請點擊下方按鈕重設您的密碼：
                        </p>
                        
                        <div style="text-align: center; margin: 25px 0;">
                            <a href="${resetUrl}" 
                               style="display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
                                🔑 重設密碼
                            </a>
                        </div>
                        
                        <p style="color: #7f8c8d; font-size: 14px; margin-top: 20px;">
                            或複製以下連結到瀏覽器：<br>
                            <span style="background: #ecf0f1; padding: 8px; border-radius: 4px; word-break: break-all; display: block; margin-top: 8px;">${resetUrl}</span>
                        </p>
                    </div>
                    
                    <!-- 安全提醒 -->
                    <div style="background: #fff3cd; border: 1px solid #ffeeba; border-radius: 6px; padding: 15px; margin-bottom: 25px;">
                        <h3 style="color: #856404; margin: 0 0 10px 0; font-size: 16px;">⚠️ 安全提醒</h3>
                        <ul style="color: #856404; margin: 0; padding-left: 20px; font-size: 14px;">
                            <li>此連結將在 <strong>15分鐘</strong> 後自動失效</li>
                            <li>如果不是您本人的操作，請忽略此郵件</li>
                            <li>請勿將此連結分享給他人</li>
                            <li>建議使用強密碼：至少8位，包含大小寫字母、數字和特殊符號</li>
                        </ul>
                    </div>
                    
                    <!-- 需要幫助 -->
                    <div style="border-top: 1px solid #ecf0f1; padding-top: 20px; text-align: center;">
                        <p style="color: #7f8c8d; font-size: 14px; margin: 0;">
                            如有疑問，請聯繫系統管理員<br>
                            <strong>ADAS One 技術支援團隊</strong>
                        </p>
                    </div>
                    
                </div>
                
                <!-- 頁腳 -->
                <div style="text-align: center; margin-top: 20px;">
                    <p style="color: #95a5a6; font-size: 12px; margin: 0;">
                        此郵件由系統自動發送，請勿直接回覆<br>
                        © ${new Date().getFullYear()} ADAS One. All rights reserved.
                    </p>
                </div>
            </div>
        `
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`✅ 密碼重設郵件已發送至: ${email}`);
};

// 驗證重設令牌並重設密碼
export const resetPassword = async (token: string, email: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    try {
        // 1. 查找用戶和驗證令牌
        const user = await Users.findOne({
            where: { 
                email,
                resetPasswordToken: token
            }
        });
        
        if (!user) {
            throw createError('無效的重設令牌或信箱地址', 400);
        }
        
        // 2. 檢查令牌是否過期
        if (!(user as any).resetPasswordExpires || new Date() > new Date((user as any).resetPasswordExpires)) {
            throw createError('重設令牌已過期，請重新申請密碼重設', 400);
        }
        
        // 3. 驗證新密碼強度
        if (!isStrongPassword(newPassword)) {
            throw createError('密碼強度不足：至少8位，包含大小寫字母、數字和特殊符號', 400);
        }
        
        // 4. 加密新密碼
        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        
        // 5. 更新密碼並清除重設令牌
        const newUser = await resetUserPassword({ email, hashedPassword });
        const contractUser: any = await ContractUsers.findOne({ where: { email }});

        await Logs.create({
            userId: newUser ? newUser.userId : email,
            contractNo: contractUser ? contractUser.contractNo : 'system',
            action: 'resetPassword',
            status: 'success',
            track: JSON.stringify({
                email,
                userId: newUser ? newUser.userId : '',
            })
        });
                
        return { 
            success: true, 
            message: '密碼重設成功，請使用新密碼登入'
        };
        
    } catch (error: any) {
        console.error('密碼重設失敗:', error);
        throw error;
    }
};

// 密碼強度驗證
const isStrongPassword = (password: string): boolean => {
    // 至少8位，包含大小寫字母、數字和特殊符號
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    
    return password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
};

// 清理過期的重設令牌（定時任務用）
export const cleanupExpiredResetTokens = async (): Promise<void> => {
    try {
        const result = await Users.update({
            resetPasswordToken: null,
            resetPasswordExpires: null
        }, {
            where: {
                resetPasswordExpires: {
                    [require('sequelize').Op.lt]: new Date()
                }
            }
        });
        
        console.log(`🧹 已清理 ${result[0]} 個過期的密碼重設令牌`);
    } catch (error) {
        console.error('清理過期重設令牌失敗:', error);
    }
};
