import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class Reports extends Sequelize.Model {}
Reports.init(definition({
    type: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    name: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    contractNo: {
        type: Sequelize.STRING(20),
        allowNull: true,
    },
    dashboardIds: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
    },
    to: {
        type: Sequelize.STRING(2000),
        allowNull: true,
    },
    cc: {
        type: Sequelize.STRING(2000),
        allowNull: true,
    },
    bcc: {
        type: Sequelize.STRING(2000),
        allowNull: true,
    },
    subject: {
        type: Sequelize.STRING(200),
        allowNull: true,
    },
    text: {
        type: Sequelize.STRING(6000),
        allowNull: true,
    },
    customDate: {
        type: Sequelize.DATE,
        allowNull: true,
    },
    lastSent: {
        type: Sequelize.DATE,
        allowNull: true,
    },
    status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'active',
    },
}), options({
    sequelize: MariaDB,
    tableName: 'reports'
}));

export default Reports;