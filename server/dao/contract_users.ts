import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class ContractUsers extends Sequelize.Model {}
ContractUsers.init(definition({
    contractNo: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    userId: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    email: {
        type: Sequelize.STRING(200),
        allowNull: false,
    },
}), options({
    sequelize: MariaDB,
    tableName: 'contract_users'
}));

export default ContractUsers;