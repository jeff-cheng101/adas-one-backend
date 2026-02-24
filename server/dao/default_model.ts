import Sequelize from 'sequelize';
import cls from 'cls-hooked';

export function definition(definition: any) {
    return Object.assign({
        id: {
            type: Sequelize.BIGINT,
            allowNull: true,
            autoIncrement: true,
            primaryKey: true,
        },
        creator: {
            type: Sequelize.STRING(50),
            allowNull: true,
            validate: {
                len: {
                    args: [0, 50],
                    msg: '資料建立人員帳號不超過50個字',
                },
            },
        },
        updator: {
            type: Sequelize.STRING(50),
            allowNull: true,
            validate: {
                len: {
                    args: [0, 50],
                    msg: '資料異動人員帳號不超過50個字',
                },
            },
        },
        deleter: {
            type: Sequelize.STRING(50),
            allowNull: true,
            validate: {
                len: {
                    args: [0, 50],
                    msg: '資料刪除人員帳號不超過50個字',
                },
            },
        },
    }, definition);
}

function generateSign() {
    const namespace = cls.getNamespace('mariadb-transaction');
    if (!namespace) return '';
    const loginUser = namespace.get('loginUser');
    if (!loginUser) return '';
    const { user, maintainer } = loginUser;
    if (!!user && !!maintainer) {
        return `${user.userId}:${maintainer.userId}`;
    }
    else if (user) {
        return `${user.userId}`;
    }
    else if (maintainer) {
        return `${maintainer.userId}`;
    }
    else {
        return '';
    }
}

export function options(options: any) {
    return Object.assign({
        freezeTableName: true,
        timestamps: true,
        paranoid: false,
        hooks: {
            beforeCreate: function (instance: any, options: any) {
                const sign = generateSign()
                if (sign) {
                    instance.creator = sign;
                    instance.updator = sign;
                }
            },
            beforeUpdate: function (instance: any, options: any) {
                const sign = generateSign()
                if (sign) {
                    instance.updator = sign;
                }
            },
            beforeDestroy: function (instance: any, options: any) {
                const sign = generateSign()
                if (sign) {
                    instance.deleter = sign;
                }
            }
        }
    }, options);
}