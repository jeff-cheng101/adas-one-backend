import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class CloudflareZones extends Sequelize.Model {}
CloudflareZones.init(definition({
    zone: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    contractNo: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    sensitivityLevel: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'default',
    },
    terminatedDate: {
        type: Sequelize.DATE,
        allowNull: true,
    },
}), options({
    sequelize: MariaDB,
    tableName: 'cloudflare_zones'
}));

export default CloudflareZones;