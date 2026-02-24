import nodemailer from 'nodemailer'
import config from '../config/config'

// HTML转义函数
const escapeHtml = (text: string): string => {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

export const sendContactMail = async (emailForm: any) => {
    const { name, email, phone, company, position, inquiryType, requirements } = emailForm;
    const transporter = nodemailer.createTransport({
        host: config.mailInfo.host || 'msa.hinet.net',
        port: parseInt(config.mailInfo.port || '25'),
        secure: config.mailInfo.secure === 'false',
        auth: config.mailInfo.user ? {
            user: config.mailInfo.user,
            pass: config.mailInfo.pass
        } : undefined,
        tls: {
            rejectUnauthorized: config.mailInfo.rejectUnauthorized !== 'false'
        },
        connectionTimeout: 60000,
        greetingTimeout: 30000,
        socketTimeout: 60000
    })
    const mailOptions = {
        from: config.mailInfo.from || 'system@twister5.com.tw',
        to: config.mailInfo.contactMail || 'info@twister5.com.tw',
        subject: 'ADAS One - 聯絡表單',
        html: `
            <p>姓名：${escapeHtml(name)}</p>
            <p>Email：${escapeHtml(email)}</p>
            <p>聯絡電話：${escapeHtml(phone)}</p>
            <p>公司名稱：${escapeHtml(company)}</p>
            <p>職稱：${escapeHtml(position)}</p>
            <p>諮詢項目：${inquiryType === 'technical' ? '技術服務' : '產品諮詢'}</p>
            <p>需求說明：</p>
            <p>${requirements ? escapeHtml(requirements).replace(/\n/g, '<br>') : ''}</p>
        `
    }
    const info = await transporter.sendMail(mailOptions)
    return info;
}