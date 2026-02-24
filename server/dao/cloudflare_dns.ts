import Sequelize from 'sequelize';
import { MariaDB } from './database/connection';
import { definition, options } from './default_model';

export class CloudflareDns extends Sequelize.Model {}
CloudflareDns.init(definition({
    contractNo: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    recordId: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    domainName: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    content: {
        type: Sequelize.TEXT('long'),
        allowNull: false,
    },
    type: {
        type: Sequelize.STRING(20),
        allowNull: false,
    },
    proxied: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    ttl: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 1,
    },
    zone: {
        type: Sequelize.STRING(100),
        allowNull: false,
    },
    comment: {
        type: Sequelize.STRING(100),
        allowNull: true,
    },
    tags: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
    },
    action: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'pass',
    },
    blackIp: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
    },
    whiteIp: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
    },
    blockGeolocation: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
    },
    cacheOn: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
    },
    browserTtlMode: {
        type: Sequelize.STRING(50),
        allowNull: true,
    },
    browserTtlDefault: {
        type: Sequelize.INTEGER,
        allowNull: true,
    },
    edgeTtlMode: {
        type: Sequelize.STRING(50),
        allowNull: true,
    },
    edgeTtlDefault: {
        type: Sequelize.INTEGER,
        allowNull: true,
    },
    terminatedDate: {
        type: Sequelize.DATE,
        allowNull: true,
    },
}), options({
    sequelize: MariaDB,
    tableName: 'cloudflare_dns'
}));

export default CloudflareDns;