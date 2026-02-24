import { Redis } from "./connection"

export const setRedis = async (key: string, value: any, expiresIn?: number | null) => {
    const data = JSON.stringify(value);
    const resp = await new Promise((resolve, reject) => {
        console.log(`Redis set ${key} => ${data}`);
        Redis.set(key, data)
            .then(val => {
                if (expiresIn)
                    setRedisExpiration(key, expiresIn);
                resolve(val);
            })
            .catch(err => reject(err));
    });
    return resp;
}

export const getRedis = async (key: string) => {
    const resp = new Promise((resolve, reject) => {
        Redis.get(key)
            .then(val => {
                const data = JSON.parse(val || '{}');
                resolve(data)
            })
            .catch(err => reject(err));
    });

    return resp;
}

export const removeRedis = async (key: string) => {
    console.log(`Redis remove ${key}`);
    await setRedisExpiration(key, 0);
}

export const setRedisExpiration = async (key: string, expiresIn: number) => {
    if (parseInt(expiresIn.toString()) == expiresIn) {
        console.log(`Redis expire ${key} => ${expiresIn}`);
        await Redis.expire(key, expiresIn);
    }
    else {
        throw new Error('Expiration seconds must be an integer.');
    }
}

export const redisExpireForFifthSecond = async (key: string) => {
    await Redis.expire(key, 50);
}