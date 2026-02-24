import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class Plans extends Sequelize.Model {}
Plans.init(definition({
    plan_code: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    name: {
        type: Sequelize.STRING(100),
        allowNull: true,
    },
    description: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
    },
    price: {
        type: Sequelize.INTEGER,
        allowNull: true
    },

}), options({
    sequelize: MariaDB,
    tableName: 'plans'
}));

export default Plans;