import { Sequelize } from 'sequelize';
import IORedis from 'ioredis';
import cls from 'cls-hooked';
import config from '../../config/config';

const namespace = cls.createNamespace('mariadb-transaction');
Sequelize.useCLS(namespace);

const { mariaDB, redis: redisConf } = config.database;
const { host, database, username, password, dialect, port } = mariaDB;
const { host: redisHost, port: redisPort } = redisConf;

export const MariaDB = new Sequelize(database, username, password, {
    host,
    port: port || 3306,
    dialect,
    pool: {
        max: 40,
        min: 0,
        idle: 10000
    },
    logging: function(message: string, modelInfo?: any) {
        console.log(message);
        if (message.indexOf(': UPDATE') > -1 && modelInfo?.bind) {
            console.log(modelInfo.bind);
        }
        else if (message.indexOf(': INSERT') > -1 && modelInfo?.bind) {
            console.log(modelInfo.bind);
        }
        else if (message.indexOf(': DELETE') > -1 && modelInfo?.bind) {
            console.log(modelInfo.bind);
        }
    }
});

export const Redis = new IORedis({
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: 1,
});
