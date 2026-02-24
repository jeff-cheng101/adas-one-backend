import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class Ticket extends Sequelize.Model {}
Ticket.init(definition({
    ticket_no: {
        type: Sequelize.STRING(30),
        allowNull: false,
        comment: '案件編號',
    },
    subject: {
      type: Sequelize.STRING(255),
      allowNull: false,
      comment: '主題，例如：我的db被鎖住',
    },
    description: {
      type: Sequelize.TEXT('long'),
      allowNull: false,
      comment: '詳細描述內容',
    },
    severity: {
      type: Sequelize.ENUM('LOW','MEDIUM','HIGH','CRITICAL'),
      allowNull: false,
      comment: '嚴重層級'
    },
    status: {
      type: Sequelize.ENUM('PENDING','IN_PROGRESS','RESOLVED','CLOSED'),
      allowNull: false,
      defaultValue: 'PENDING',
      comment: '工單目前狀態',
    },
    contact_name: {
      type: Sequelize.STRING(100),
      allowNull: false,
      comment: '聯絡人名稱，例如 an',
    },
    account: {
      type: Sequelize.STRING(200),
      allowNull: false,
      comment: '登入的帳號，例如 an@gmail.com',
    },
    incident_date: {
      type: Sequelize.DATEONLY,
      allowNull: false,
      comment: '產生日（只有日期）',
    },
    last_action_date: {
      type: Sequelize.DATEONLY,
      comment: '更動日：最後處理日期（例如轉為處理中那一天）',
    },
    last_action_at: {
      type: Sequelize.DATE,
      comment: '更動時間：最後處理時間（精確到秒）',
    },
    created_at: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW,
      comment: '資料建立時間（工單建立時間／案件日期）',
    },
    updated_at: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.NOW,
      onUpdate: Sequelize.NOW,
      comment: '資料庫列最後變更時間（技術層，含維運修改）',
    },
}), options({
    sequelize: MariaDB,
    tableName: 'ticket',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
}));

export default Ticket;