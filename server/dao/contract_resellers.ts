import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class ContractResellers extends Sequelize.Model {}
ContractResellers.init(definition({
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
    start_date: {
        type: Sequelize.DATE,
        allowNull: true,
    },
    end_date: {
        type: Sequelize.DATE,
        allowNull: true,
    },
}), options({
    sequelize: MariaDB,
    tableName: 'contract_resellers'
}));

export default ContractResellers;