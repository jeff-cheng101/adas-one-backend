import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class Contracts extends Sequelize.Model {}
Contracts.init(definition({
    contractNo: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    plan: {
        type: Sequelize.TEXT('long'),
        allowNull: false,
    },
    company: {
        type: Sequelize.STRING(200),
        allowNull: true,
    },
    start_date: {
        type: Sequelize.DATE,
        allowNull: true,
    },
    end_date: {
        type: Sequelize.DATE,
        allowNull: true,
    },
    status: {
        type: Sequelize.STRING(20),
        allowNull: true,
    },
    serviceCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },

}), options({
    sequelize: MariaDB,
    tableName: 'contracts'
}));

export default Contracts;