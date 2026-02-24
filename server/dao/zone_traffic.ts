import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class ZoneTraffic extends Sequelize.Model {}
ZoneTraffic.init(definition({
    zone: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    requests: {
        type: Sequelize.INTEGER,
        allowNull: true,
    },
    bytes: {
        type: Sequelize.INTEGER,
        allowNull: true,
    },
    startDate: {
        type: Sequelize.DATE,
        allowNull: false
    },
    endDate: {
        type: Sequelize.DATE,
        allowNull: false
    },

}), options({
    sequelize: MariaDB,
    tableName: 'zone_traffic'
}));

export default ZoneTraffic;