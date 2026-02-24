import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class CatoSettings extends Sequelize.Model {}
CatoSettings.init(definition({
    contractNo: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    name: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    connectionType: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    siteType: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    description: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    nativeNetworkRange: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    vlan: {
        type: Sequelize.INTEGER,
        allowNull: false,
    },
    country: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    countryCode: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    city: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    terminatedDate: {
        type: Sequelize.DATE,
        allowNull: true,
    },
}), options({
    sequelize: MariaDB,
    tableName: 'cato_settings'
}));

export default CatoSettings;