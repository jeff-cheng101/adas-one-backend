import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class Geolocation extends Sequelize.Model {}
Geolocation.init(definition({
    country: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    code: {
        type: Sequelize.STRING(10),
        allowNull: false,
    },
    name: {
        type: Sequelize.STRING(100),
        allowNull: true,
    },
    opsOnlyForDisallowed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
}), options({
    sequelize: MariaDB,
    tableName: 'geolocation'
}));

export default Geolocation;