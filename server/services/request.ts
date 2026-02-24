const axios = require('axios');
const https = require('https');
import { GraphQLClient } from 'graphql-request';
import { Client } from '@elastic/elasticsearch'

import config from '../config/config';

const logFn = (instance: any) => {
    instance.interceptors.request.use((config: any) => {
        console.log(`request: ${config.baseURL}${config.url}, [${config.method.toUpperCase()}], ${config.data ? `data: ${JSON.stringify(config.data)}` : ``}`);
        return config;
    })
    instance.interceptors.response.use((response: any) => {
        if (response.status == 200 || response.status == 201) {
            console.log(`response: ${response.config.baseURL}${response.config.url}, [${response.config.method.toUpperCase()}], ${response.config.data ? `data: ${response.config.data}` : ``}`);
        } else {
            // 避免打印包含循環引用的響應對象
            console.log(`response error: ${response.config.baseURL}${response.config.url}, status: ${response.status}`);
        }
        return response;
    })
};

const CLOUDFLARE_API_TOKEN = config.cloudflare.apiToken || 'AHEvkS6pCXrGQjdghPgDqzuQ--BLaZnRK-jOPxOn';

export const getCloudflareClient = async() => {
    const client = axios.create({
        baseURL: 'https://api.cloudflare.com/client/v4',
        httpsAgent: new https.Agent({
            rejectUnauthorized: false
        }),
        headers: {
            Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    })
    logFn(client)
    return client;
};

export const getLtmServerClient = async () => {
    if (config.axios.ltmServer) {
        let client = config.axios.ltmServer;
        const serverClient = axios.create({
            baseURL: client.baseURL,
            timeout: client.timeout,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            }),
            auth: {
                username: client.username,
                password: client.password
            },
            headers: {
                'Content-Type': 'application/json'
            }
        })
        logFn(serverClient);
        return serverClient;
    } else {
        return null;
    }
}

export const getCatoClient = async () => {
    return new GraphQLClient(config.cato.graphqlEndpoint, {
        headers: {
            'x-api-key': `${config.cato.apiToken}`,
            'Content-Type': 'application/json',
        },
    });
}

export const esClient = new Client({
    node: config.database.elasticsearch.host || 'http://localhost:9200',
    auth: config.database.elasticsearch.apiKey 
      ? { apiKey: config.database.elasticsearch.apiKey }
      : config.database.elasticsearch.username && config.database.elasticsearch.password
      ? {
          username: config.database.elasticsearch.username,
          password: config.database.elasticsearch.password
        }
      : undefined,
    tls: {
      rejectUnauthorized: false
    }
})
