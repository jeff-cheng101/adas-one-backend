import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class F5WafSettings extends Sequelize.Model {}
F5WafSettings.init(definition({
    contractNo: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    domainName: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    virtualServerIp: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    nodeIp: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    ports: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    sslPorts: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    terminatedDate: {
        type: Sequelize.DATE,
        allowNull: true,
    },
}), options({
    sequelize: MariaDB,
    tableName: 'f5_waf_settings'
}));

export default F5WafSettings;