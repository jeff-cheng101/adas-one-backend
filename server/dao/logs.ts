import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class Logs extends Sequelize.Model {}
Logs.init(definition({
    userId: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    contractNo: {
        type: Sequelize.STRING(20),
        allowNull: true,
    },
    action: {
        type: Sequelize.STRING(20),
        allowNull: true,
    },
    status: {
        type: Sequelize.STRING(20),
        allowNull: true,
    },
    track: {
        type: Sequelize.TEXT('long'),
        allowNull: true
    },

}), options({
    sequelize: MariaDB,
    tableName: 'logs'
}));

export default Logs;