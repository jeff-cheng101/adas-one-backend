import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class Users extends Sequelize.Model {}
Users.init(definition({
    userId: {
        type: Sequelize.STRING(50),
        allowNull: false,
        validate: {
            is: {
                args: /[a-zA-Z0-9._@]/,
                msg: '帳號須為大小寫英文 "." "_" "@" 或數字',
            },
            len: {
                args: [2, 50],
                msg: '帳號長度須超過2個字但不超過50個字',
            },
        },
    },
    password: {
        type: Sequelize.STRING(200),
        allowNull: true,
    },
    email: {
        type: Sequelize.STRING(200),
        allowNull: true,
    },
    company: {
        type: Sequelize.STRING(200),
        allowNull: true,
    },
    name: {
        type: Sequelize.STRING(200),
        allowNull: true,
    },
    phone: {
        type: Sequelize.STRING(200),
        allowNull: true,
    },
    role: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    resetPasswordToken: {
        type: Sequelize.STRING(255),
        allowNull: true,
    },
    resetPasswordExpires: {
        type: Sequelize.DATE,
        allowNull: true,
    },
    lastPasswordReset: {
        type: Sequelize.DATE,
        allowNull: true,
    },

}), options({
    sequelize: MariaDB,
    tableName: 'users'
}));

export default Users;