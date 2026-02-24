import { GraphQLClient } from 'graphql-request';
import config from '../config/config';
import { getCatoClient } from './request';

export async function getCatoSitesService() {
    try {        
        const variables = {
            accountID: config.cato.accountId,
        };

        const graphqlClient = await getCatoClient();
        const rs = await graphqlClient.request(
            `query accountSnapshot($accountID:ID!) {
                accountSnapshot(accountID:$accountID) {
                    sites {
                        id
                        info { 
                            name
                            address
                            connType
                            description
                            cityName
                            countryCode
                            countryName
                            countryStateName
                            address
                            creationTime
                        }
                        connectivityStatus
                    }
                }
            }`, variables);
        
        if (rs.accountSnapshot.sites.length > 0) {
            return rs.accountSnapshot.sites;
        } else {
            return [];
        }
    } catch (error) {
        console.error(error);
        throw error;
    }
};


export async function createCatoSiteService(data: any) {
    try {        
        const input = {
            name: data.name,
            connectionType: data.connectionType || 'SOCKET_ESX1500',
            siteType: data.siteType || 'BRANCH',
            description: data.description || '',
            nativeNetworkRange: data.nativeNetworkRange,
            vlan: parseInt(data.vlan) || 0,
            siteLocation: {
                countryCode: data.countryCode || 'TW',
                timezone: data.timezone || 'Asia/Taipei',
                city: data.city || 'Taipei'
            }
        };
        console.log(input)

        const variables = {
            accountId: config.cato.accountId,
            input: input
        };

        const graphqlClient = await getCatoClient();
        const rs = await graphqlClient.request(
            `mutation addSocketSite($accountId:ID!, $input:AddSocketSiteInput!){
                site(accountId:$accountId) {
                    addSocketSite(input:$input) {
                        siteId
                    }
                }
            }`, variables);
        
        console.log('Cato site created successfully:', rs);
        return rs;
        
    } catch (error) {
        console.error('Error creating Cato site:', error);
        throw error;
    }
};

export async function deleteCatoSite(name: string) {
    try {        
        const sites = await getCatoSitesService()
        const site = sites.find((site: any) => site.info.name === name)
        if (site) {
            const variables = {
                accountId: config.cato.accountId,
                siteId: site.id
            };
            const graphqlClient = await getCatoClient();
            const rs = await graphqlClient.request(
                `mutation removeSite($accountId:ID!, $siteId:ID!){
                    site(accountId:$accountId) {
                        removeSite(siteId:$siteId) {
                            siteId
                        }
                    }
                }`, variables);
            
            console.log('Cato site created successfully:', rs);
            return rs;
        }
    } catch (error) {
        console.error('Error creating Cato site:', error);
        throw error;
    }
}