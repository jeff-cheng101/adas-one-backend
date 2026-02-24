import nodemailer from 'nodemailer'
import Ticket from "../dao/ticket";
import config from '../config/config';

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

export const getAllTicketNos = async () => {
    return await Ticket.findAll({ raw: true, attributes: ['ticket_no'] });
}

export const sendTicketMailToOps = async (ticketData: any) => {
    const { ticket_no, subject, description, severity, contact_name, account, incident_date, last_action_date } = ticketData;
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
        subject: 'ACROSS - 工單建立 - ' + ticket_no,
        html: `
            <p>案件編號：${escapeHtml(ticket_no)}</p>
            <p>聯絡人：${escapeHtml(contact_name)}</p>
            <p>主題：${escapeHtml(subject)}</p>
            <p>嚴重層級：${escapeHtml(severity)}</p>
            <p>建立日期：${escapeHtml(incident_date)}</p>
            <p>描述：</p>
            <p>${description ? escapeHtml(description).replace(/\n/g, '<br>') : ''}</p>
        `
    }
    const info = await transporter.sendMail(mailOptions)
    console.log(info)
    return info;
}

export const createTicket = async (data: any) => {
    const ticket = await Ticket.findOne({ raw: true, where: { ticket_no: data.ticket_no } });
    if (!ticket) {
        const newTicketData = {
            ticket_no: data.ticket_no,
            subject: data.subject,
            description: data.description,
            severity: data.severity.charAt(0).toUpperCase() + data.severity.slice(1),
            status: 'PENDING',
            contact_name: data.contact_name,
            account: data.account,
            incident_date: data.incident_date,
            last_action_date: data.last_action_date,
            last_action_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
        }
        const newTicket = await Ticket.create(newTicketData);
        return newTicket;
    }
    return ticket;
}

export const getTicketsByUser = async (email: string) => {
    return await Ticket.findAll({ raw: true, where: { account: email }, order: [['created_at', 'DESC']] });
}

export const getTicketsById = async (id: string) => {
    return await Ticket.findOne({ raw: true, where: { id: id } });
}