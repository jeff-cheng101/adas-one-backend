import update from 'immutability-helper';
import fs from 'fs';

import { getLtmServerClient } from './request';
import { getF5ServiceByContractNoAndDomainName } from './f5_waf_setting';

const PARTITION = 'Common';

export function changeNodeIpName(nodeIp: string) {
    return nodeIp.replace(/\.\.\d+$/, '');
}

export async function createWafSettingService(wafParams: any) {
    let setting = null;
    const data = parsePorts(wafParams);
    let wafTerminatedParams = null;
    try {
        // setting = decodeSetting(data);
        await wafActive(data); 
    } catch (e) {
        throw e;
    }
    return { setting };
};

export async function updateWafSettingService(wafParams: any) {
    let setting = null;
    const data = parsePorts(wafParams);
    try {
        let oldSetting = await getF5ServiceByContractNoAndDomainName(data.contractNo, data.domainName);
        oldSetting = oldSetting ? decodeSetting(oldSetting) : null;
        await wafUpdateActive({ ...data, oldSetting: oldSetting }); 
    } catch (e) {
        throw e;
    }
    return { setting };
};

export async function wafActive(params: any) {

    const startTime = new Date().getTime();
    console.log('wafActive start: ', new Date(startTime));
    console.log(params);
    const { contractNo: hnNo, domainName, nodeIp, ports, sslPorts, redirectHttpsPorts, certPath, keyPath, chainPath, pfxPath, passphrase } = params;
    const virtualServerIp = '202.39.33.192';
    const setting = { ...params, virtualServerIp };
    
    const ltmClient = await getLtmServerClient();
    const profileName = `clientssl-${hnNo}-VS${virtualServerIp}-${domainName}`;
    const serverProfileName = `serverssl-${hnNo}-VS${virtualServerIp}-${domainName}`;
    try {
        await prepareClientCert(ltmClient, certPath, keyPath, pfxPath, chainPath, passphrase, `${hnNo}-VS${virtualServerIp}`, domainName, profileName);
        await prepareServerCert(ltmClient, certPath, keyPath, pfxPath, `${hnNo}-VS${virtualServerIp}`, domainName, serverProfileName);

        const ltmFullNodeName = `${changeNodeIpName(nodeIp)}`;
        const ltmFullPoolName = `pool_${hnNo}_VS${virtualServerIp}_${domainName}`;
        await saveNode(ltmClient, {
            name: `${ltmFullNodeName}`,
            address: `${changeNodeIpName(nodeIp)}`,
        });
        for (let i=0; i<ports.length; i++) {
            const servicePort = ports[i];
            const sslPort = sslPorts[i];
            await savePool(ltmClient, {
                name: `${ltmFullPoolName}_${servicePort}`,
                minActiveMembers: 1,
                monitor: `/Common/tcp`
            });
            const ip = ltmFullNodeName.split(':')[0].replace('', '');
            await savePoolMember(ltmClient, `${ltmFullPoolName}_${servicePort}`, {
                autopopulate: "enabled",
                activeName: `/Common/${ltmFullNodeName}:${servicePort}`,
            });
            const ltmVirtualServerName = `vs_${hnNo}_VS${virtualServerIp}`;
            await saveVirtualServer(ltmClient, {
                ...{
                    name: `${ltmVirtualServerName}_${servicePort}`,
                    destination: `${virtualServerIp}:${servicePort}`,
                    mask: '255.255.255.255',
                    pool: `/Common/${ltmFullPoolName}_${servicePort}`,
                    securityLogProfiles: [
                        `log_to_bde`,
                        `Log illegal requests`,
                    ],
                    profilesReference: {
                        items: [
                            {
                                context: 'all',
                                name: 'http'
                            },
                            {
                                context: 'all',
                                name: 'tcp'
                            },
                            {
                                context: 'all',
                                name: "websecurity"
                            },
                            ...(sslPort ? [
                                {
                                    context: "clientside",
                                    name: `clientssl-${hnNo}-VS${virtualServerIp}-default-sni`
                                },
                                {
                                    context: "clientside",
                                    name: `${profileName}`
                                },
                                {
                                    context: "serverside",
                                    name: `serverssl-${hnNo}-VS${virtualServerIp}-default-sni`
                                },
                                {
                                    context: "serverside",
                                    name: `${serverProfileName}`
                                },
                            ] : []),
                        ]
                    },
                    sourceAddressTranslation: {
                        type: "automap",
                    },
                },
            });
        }
        const ltmPoolForwardPolicyRuleName = `rule_${domainName}`;
        const ltmPoolForwardPolicyName = `policy_${hnNo}_VS${virtualServerIp}`;
        for (const servicePort of ports) {
            const ltmPoolForwardPolicyFullName = `${ltmPoolForwardPolicyName}_${servicePort}`;
            await saveLtmPolicy(ltmClient, {
                name: ltmPoolForwardPolicyFullName,
                ruleName: ltmPoolForwardPolicyRuleName,
                hosts: [domainName],
                poolName: `/${PARTITION}/${ltmFullPoolName}_${servicePort}`,
                policyName: '/Common/AWAF_template_Sample_Chtsecurity',
                templatePolicyName: '/Common/AWAF_template_Sample_Chtsecurity',
            } );

            const ltmVirtualServerName = `vs_${hnNo}_VS${virtualServerIp}`;
            await updateVirtualServer(ltmClient, `${ltmVirtualServerName}_${servicePort}`, {
                policiesReference: {
                    items: [
                        {
                            name: ltmPoolForwardPolicyFullName
                        }
                    ]
                }
            });
        }
        return setting;
    } catch (e) {
        await wafTerminate(params)
        throw e;
    }
}

export async function wafUpdateActive(params: any) {
    const startTime = new Date().getTime();
    console.log('wafUpdateActive start: ', new Date(startTime));
    console.log(params);
    const { contractNo: hnNo, domainName, nodeIp, ports, sslPorts, redirectHttpsPorts, certPath, keyPath, chainPath, pfxPath, passphrase, oldSetting } = params;
    const virtualServerIp = '202.39.33.192';
    const setting = { ...params, virtualServerIp };
    
    const ltmClient = await getLtmServerClient();
    const profileName = `clientssl-${hnNo}-VS${virtualServerIp}-${domainName}`;
    const serverProfileName = `serverssl-${hnNo}-VS${virtualServerIp}-${domainName}`;
    const ltmVirtualServerName = `vs_${hnNo}_VS${virtualServerIp}`;

    try {
        if (certPath && keyPath || pfxPath) {
            await removeSslProfilesFromVs(ltmClient, ltmVirtualServerName, profileName, serverProfileName);
            await ltmClient.delete(`/mgmt/tm/ltm/profile/client-ssl/${profileName}`)
            const rs = await ltmClient.get(`/mgmt/tm/sys/file/ssl-cert?$select=name`);
            for (let item of (rs.data.items || [])) {
                const isMatched = item.name.indexOf(`${hnNo}-VS${virtualServerIp}-${domainName}`) > -1
                if (isMatched) {
                    try {
                        await ltmClient.delete(`/mgmt/tm/sys/crypto/cert/${item.name}`);
                    } catch (err) {
                        skipError(err);
                    }
                }
            }

            const rs2 = await ltmClient.get(`/mgmt/tm/sys/file/ssl-key?$select=name`);
            for (let item of (rs2.data.items || [])) {
                const isMatched = item.name.indexOf(`${hnNo}-VS${virtualServerIp}-${domainName}`) > -1
                if (isMatched) {
                    try {
                        await ltmClient.delete(`/mgmt/tm/sys/crypto/key/${item.name}`);
                    } catch (err) {
                        skipError(err);
                    }
                }
            }
        }
        await prepareClientCert(ltmClient, certPath, keyPath, pfxPath, chainPath, passphrase, `${hnNo}-VS${virtualServerIp}`, domainName, profileName);
        await prepareServerCert(ltmClient, certPath, keyPath, pfxPath, `${hnNo}-VS${virtualServerIp}`, domainName, serverProfileName);

        const ltmFullNodeName = `${changeNodeIpName(nodeIp)}`;
        const ltmFullPoolName = `pool_${hnNo}_VS${virtualServerIp}_${domainName}`;
        await saveNode(ltmClient, {
            name: `${ltmFullNodeName}`,
            address: `${changeNodeIpName(nodeIp)}`,
        });
        for (let i=0; i<ports.length; i++) {
            const servicePort = ports[i];
            const sslPort = sslPorts[i];
            await savePool(ltmClient, {
                name: `${ltmFullPoolName}_${servicePort}`,
                minActiveMembers: 1,
                monitor: `/Common/tcp`
            });
            const ip = ltmFullNodeName.split(':')[0].replace('', '');
            await savePoolMember(ltmClient, `${ltmFullPoolName}_${servicePort}`, {
                autopopulate: "enabled",
                activeName: `/Common/${ltmFullNodeName}:${servicePort}`,
            });
            
            await saveVirtualServer(ltmClient, {
                ...{
                    name: `${ltmVirtualServerName}_${servicePort}`,
                    destination: `${virtualServerIp}:${servicePort}`,
                    mask: '255.255.255.255',
                    pool: `/Common/${ltmFullPoolName}_${servicePort}`,
                    securityLogProfiles: [
                        `log_to_bde`,
                        `Log illegal requests`,
                    ],
                    profilesReference: {
                        items: [
                            {
                                context: 'all',
                                name: 'http'
                            },
                            {
                                context: 'all',
                                name: 'tcp'
                            },
                            {
                                context: 'all',
                                name: "websecurity"
                            },
                            ...(sslPort ? [
                                {
                                    context: "clientside",
                                    name: `clientssl-${hnNo}-VS${virtualServerIp}-default-sni`
                                },
                                {
                                    context: "clientside",
                                    name: `${profileName}`
                                },
                                {
                                    context: "serverside",
                                    name: `serverssl-${hnNo}-VS${virtualServerIp}-default-sni`
                                },
                                {
                                    context: "serverside",
                                    name: `${serverProfileName}`
                                },
                            ] : []),
                        ]
                    },
                    sourceAddressTranslation: {
                        type: "automap",
                    },
                },
            });
        }
        const ltmPoolForwardPolicyRuleName = `rule_${domainName}`;
        const ltmPoolForwardPolicyName = `policy_${hnNo}_VS${virtualServerIp}`;
        for (const servicePort of ports) {
            const ltmPoolForwardPolicyFullName = `${ltmPoolForwardPolicyName}_${servicePort}`;
            await saveLtmPolicy(ltmClient, {
                name: ltmPoolForwardPolicyFullName,
                ruleName: ltmPoolForwardPolicyRuleName,
                hosts: [domainName],
                poolName: `/${PARTITION}/${ltmFullPoolName}_${servicePort}`,
                policyName: '/Common/AWAF_template_Sample_Chtsecurity',
                templatePolicyName: '/Common/AWAF_template_Sample_Chtsecurity',
            } );
            try {
                await ltmClient.delete(`/mgmt/tm/ltm/policy/~${PARTITION}~Drafts~${ltmPoolForwardPolicyName}_${servicePort}.template`);
            } catch (error) {
                skipError(error);
            }

            const ltmVirtualServerName = `vs_${hnNo}_VS${virtualServerIp}`;
            await updateVirtualServer(ltmClient, `${ltmVirtualServerName}_${servicePort}`, {
                policiesReference: {
                    items: [
                        {
                            name: ltmPoolForwardPolicyFullName
                        }
                    ]
                }
            });
        }

        const { nodeIp: oldNodeIp, ports: oldPorts, sslPorts: oldSslPorts } = oldSetting;
        if (oldNodeIp !== nodeIp) {
            for (let servicePort of ports) {
                try {
                    const rs = await ltmClient.get(`/mgmt/tm/ltm/pool/${ltmFullPoolName}_${servicePort}/members`);
                    if (rs.data.items.length > 0) {
                        for (let item of rs.data.items) {
                            if (item.name !== `${ltmFullNodeName}:${servicePort}`) {
                                await ltmClient.delete(`/mgmt/tm/ltm/pool/${ltmFullPoolName}_${servicePort}/members/${item.name}`);
                            }
                        }
                    }
    
                    const ltmFullOldNodeName = `${changeNodeIpName(oldNodeIp)}`;
                    await ltmClient.delete(`/mgmt/tm/ltm/node/${ltmFullOldNodeName}`);
                } catch (error) {
                    skipError(error);
                }
            }
        }
        let oldPortsArray = oldPorts.map((port: any) => parseInt(port));
        const excludedPorts = oldPortsArray.filter((port: any) => !ports.includes(port));

        for (const excludedPort of excludedPorts) {
            try {
                try {
                    const ltmOldVirtualServerName = `vs_${hnNo}_VS${virtualServerIp}`;
                    await ltmClient.delete(`/mgmt/tm/ltm/virtual/${ltmOldVirtualServerName}_${excludedPort}`);
                } catch (e1) {
                    skipError(e1);
                }
                try {
                    const ltmOldPoolForwardPolicyName = `policy_${hnNo}_VS${virtualServerIp}`;
                    await ltmClient.delete(`/mgmt/tm/ltm/policy/${ltmOldPoolForwardPolicyName}_${excludedPort}`);
                    await ltmClient.delete(`/mgmt/tm/ltm/policy/${ltmOldPoolForwardPolicyName}_${excludedPort}.template`);
                } catch (e2) {
                    skipError(e2);
                }

                try {
                    const ltmFullOldPoolName = `pool_${hnNo}_VS${virtualServerIp}_${domainName}`;
                    await ltmClient.delete(`/mgmt/tm/ltm/pool/${ltmFullOldPoolName}_${excludedPort}`);
                } catch (e3) {
                    skipError(e3);
                }

            } catch (error) {
                skipError(error);
            }
        }
        return setting;
    } catch (e) {
        throw e;
    }
}

export const parsePorts = (data: any) => {
    const ports: any[] = [], sslPorts: any[] = [], redirectHttpsPorts: any[] = [];
    if (data.ports && Array.isArray(data.ports)) {
        data.ports.forEach((port: any, i: number) => {
            if (port && port.length !== 0) {
                ports.push(parseInt(port));
                sslPorts.push((data.sslPorts && data.sslPorts[i]) || false);
                redirectHttpsPorts.push(parseInt((data.redirectHttpsPorts && data.redirectHttpsPorts[i]) || 0));
            }
        });
    }
    return { ...data, ports, sslPorts, redirectHttpsPorts };
}

export const decodeSetting = (data: any) => {
    if (!data) return ;
    return update(data, {
        // nodeIp: {
        //     $set: data.nodeIp && !data.nodeIp.includes('..') && data.nodeIp.includes('[') ? JSON.parse(data.nodeIp) : [`${data.nodeIp ? data.nodeIp.replace(/\.\.\d+$/, '') : ''}`]
        // },
        ports: { 
            $set: data.ports && typeof data.ports === 'string' && data.ports.includes('[') ? JSON.parse(data.ports) : []
        },
        sslPorts: { 
            $set: data.sslPorts && typeof data.sslPorts === 'string' && data.sslPorts.includes('[') ? JSON.parse(data.sslPorts) : []
        },
        redirectHttpsPorts: {
            $set: data.redirectHttpsPorts && typeof data.redirectHttpsPorts === 'string' && data.redirectHttpsPorts.includes('[') ? JSON.parse(data.redirectHttpsPorts) : []
        },
    });
}

export async function prepareClientCert(client: any, certPath: string, keyPath: string, pfxPath: string, chainPath: string, passphrase: string, fixName: string, domainName: string, profileName: string) {
    const sniProfileName = `clientssl-${fixName}-default-sni`;

    if (certPath && keyPath) {
        await saveKey(client, { name: `${fixName}-${domainName}.key`, data: fs.readFileSync(keyPath).toString(), password: passphrase });
        await saveCert(client, { name: `${fixName}-${domainName}.crt`, data: fs.readFileSync(certPath).toString() });
    } else if (pfxPath) {
        await savePfx(client, { name: `${fixName}-${domainName}`, data: fs.readFileSync(pfxPath), password: passphrase });
    }

    if (certPath && keyPath || pfxPath) {
        if (chainPath) await saveChain(client, { name: `${fixName}-${domainName}.chain.crt`, data: fs.readFileSync(chainPath).toString() });
    }

    if (certPath && keyPath || pfxPath) {
        await prepareDefaultClientCert(client, fixName);
        let profileParams: any = {
            parentName: sniProfileName,
            sniDefault: "false",
            name: `${profileName}`,
            cert: `/Common/${fixName}-${domainName}.crt`,
            key: `/Common/${fixName}-${domainName}.key`,
            serverName: domainName,
        };

        if ((certPath && keyPath || pfxPath) && chainPath) profileParams.chain = `/Common/${fixName}-${domainName}.chain.crt`;
        if (passphrase) profileParams.passphrase = passphrase;
        await saveProfile(client, profileParams);
    }
}

export async function prepareDefaultClientCert(client: any, fixName: string, options?: any) {
    const { sniDefault } = options || { sniDefault: 'true' };
    const profileName = `clientssl-${fixName}-default-sni`;
    const profileRs = await getProfile(client, `${profileName}`);
    if (!profileRs.data){
        let profileParams = {
            name        : `${profileName}`,
            cert        : `/${PARTITION}/default.crt`,
            key         : `/${PARTITION}/default.key`,
            sniDefault  : sniDefault,
            serverName  : ''
        }
        const defaultProfile = await saveProfile(client, profileParams);
        return defaultProfile.data;
    }
    return profileRs.data;
}

export async function getProfile(f5Axios: any, name: string) {
    try {
        return await f5Axios.get(`/mgmt/tm/ltm/profile/client-ssl/${escapePathValue(name)}?expandSubcollections=true`);
    } catch (err) {
        return await ignore404(err);
    }
}

export async function saveCert(f5Axios: any, { name, data }:any) {
    const buffer = Buffer.from(data, 'utf8');
    const contentRange = `0-${buffer.length - 1}/${buffer.length}`;
    const rs = await f5Axios.post(`/mgmt/shared/file-transfer/bulk/uploads/${name}`, buffer, {
        headers: { 'Content-Range': contentRange }
    });
    return await f5Axios.post(`/mgmt/tm/sys/crypto/cert`, {
        command: 'install',
        name,
        'from-local-file': rs.data.localFilePath
    });
}

export async function saveKey(f5Axios: any, { name, data, password = '' }:any) {
    const isEncrypted = data.indexOf('Proc-Type: 4,ENCRYPTED') > -1;
    if (isEncrypted && password.length == 0) {
        throw 'SSL Import Error: Must input password'
    }
    const buffer = Buffer.from(data, 'utf8');
    const contentRange = `0-${buffer.length - 1}/${buffer.length}`;
    const rs = await f5Axios.post(`/mgmt/shared/file-transfer/bulk/uploads/${name}`, buffer, {
        headers: { 'Content-Range': contentRange }
    });
    try {
        return await f5Axios.post(`/mgmt/tm/sys/crypto/key`, {
            command: 'install',
            name,
            'from-local-file': rs.data.localFilePath,
            passphrase: password
        });
    } catch (e: any) {
        if ((e.response.data.message).indexOf('Passphrase specified, but key') > -1) {
            try {
                return await f5Axios.post(`/mgmt/tm/sys/crypto/key`, {
                    command: 'install',
                    name,
                    'from-local-file': rs.data.localFilePath,
                });
            } catch (e2: any) {
                throw `SSL Import Error: ${e2.response.data.message}`;
            }
        } else {
            if (e.response.data.message.indexOf('Unable to verify key') > -1 && e.response.data.message.indexOf('is protected by provided passphrase.') > -1) {
                throw `SSL Import Error: Passphrase is incorrect`
            } else {
                throw `SSL Import Error: ${e.response.data.message}`
            }
        }
    }
}

export async function savePfx(f5Axios: any, { name, data, password }:any) {
    const length = Buffer.byteLength(data, 'utf8');
    let rs: any = { data: '' };
    try {
        const contentRange = `0-${length - 1}/${length}`;
        rs = await f5Axios.post(`/mgmt/shared/file-transfer/bulk/uploads/${name}`, data, {
            headers: { 'Content-Range': contentRange , 'Content-Type': 'application/octet-stream'}
        });
    } catch (e) {
        console.log(e);
        throw e;
    }
    try {
        return await f5Axios.post(`/mgmt/tm/sys/crypto/pkcs12`, {
            ...{
                command: 'install',
                name,
                'from-local-file': rs.data.localFilePath,
            },
            ...(password ? {
                keyPassphrase: password,
                keySecurityType: 'password',
                passphrase: password

            } : {})
        });    
    } catch (e: any) {
        throw e?.response?.data || e?.message || e;
    }
}

export async function saveChain(f5Axios: any, { name, data }:any) {
    return await saveCert(f5Axios, { name, data });
}

export function escapePathValue(path: string) {
    return path.replace(/\//g, '~');
}


export async function saveProfile(f5Axios: any, { name, cert, chain, key, passphrase, sniDefault, serverName = '', parentName }:any) {
    let params: any = {};
    try {
        await f5Axios.get(`/mgmt/tm/sys/file/ssl-cert/${escapePathValue(cert)}`);
        params['cert'] = cert;
    } catch (err) {
        console.log(err);
        await ignore404(err, async() => {
            try {
                await f5Axios.get(`/mgmt/tm/sys/file/ssl-cert/${escapePathValue(cert.replace('.crt', ''))}`);
                params['cert'] = cert.replace('.crt', '');
            } catch (err2) {
                await ignore404(err2);
            }
        });
    }

    try {
        await f5Axios.get(`/mgmt/tm/sys/file/ssl-key/${escapePathValue(key)}`);
        params['key'] = key;
    } catch (err) {
        await ignore404(err, async() => {
            try {
                await f5Axios.get(`/mgmt/tm/sys/file/ssl-key/${escapePathValue(key.replace('.key', ''))}`);
                params['key'] = key.replace('.key', '');
            } catch (err2) {
                await ignore404(err2);
            }
        });
    }

    if (chain) {
        try {
            await f5Axios.get(`/mgmt/tm/sys/file/ssl-cert/${escapePathValue(chain)}`);
            params['chain'] = chain;
        } catch (err) {
            await ignore404(err);
        }
    }

    if (passphrase) params['passphrase'] = passphrase;
    if (sniDefault) params['sniDefault'] = sniDefault;

    try {
        await f5Axios.get(`/mgmt/tm/ltm/profile/client-ssl/${name}`);
        if (Object.keys(params).length > 0) {
            params = { ...params, serverName, parentName };
            return await f5Axios.patch(`/mgmt/tm/ltm/profile/client-ssl/${name}`, params);
        } else {
            return defaultResponse;
        }
    } catch (err) {
        try {
            return await ignore404(err, async () => {
                try {
                    params = { ...params, serverName, parentName };
                    return await f5Axios.post(`/mgmt/tm/ltm/profile/client-ssl`, {...{
                        name,
                    }, ...params})
                } catch (e2: any) {
                    throw e2
                }
            });
    
        } catch (e3: any) {
            throw e3.response.data
        }
    }
}


export async function prepareServerCert(client: any, certPath: string, keyPath: string, pfxPath: string, fixName: string, domainName: string, serverProfileName: string) {
    const sniProfileName = `serverssl-${fixName}-default-sni`;

    if (certPath && keyPath || pfxPath) {
        await prepareDefaultServerCert(client, fixName);

        let serverProfileParams = {
            parentName: sniProfileName,
            sniDefault: "false",
            name: `${serverProfileName}`,
            serverName: domainName,
        }

        await saveServerProfile(client, serverProfileParams);
    }
}

export async function prepareDefaultServerCert(client: any, fixName: string, options?: any) {
    const  { sniDefault } = options || { sniDefault : 'true' };
    const profileName = `serverssl-${fixName}-default-sni`;
    const profileRs = await getServerProfile(client, `${profileName}`);
    if (!profileRs.data){
        let profileParams = {
            name        : `${profileName}`,
            sniDefault  : sniDefault
        }
        const defaultProfile = await saveServerProfile(client, profileParams);
        return defaultProfile.data;
    }
    return profileRs.data;
}

export async function getServerProfile(f5Axios: any, name: string) {
    try {
        return await f5Axios.get(`/mgmt/tm/ltm/profile/server-ssl/${escapePathValue(name)}?expandSubcollections=true`);
    } catch (err) {
        return await ignore404(err);
    }
}

export async function saveServerProfile(f5Axios: any, { name, sniDefault, serverName = '', parentName }: any) {
    let params: any = {};
    if (sniDefault) params['sniDefault'] = sniDefault;
    if (parentName) {
        try {
            await f5Axios.get(`/mgmt/tm/ltm/profile/server-ssl/${parentName}`);
        } catch (err) {
            await ignore404(err, async () => {
                return await f5Axios.post(`/mgmt/tm/ltm/profile/server-ssl`, { name: parentName })
            });
        }
    }
    try {
        await f5Axios.get(`/mgmt/tm/ltm/profile/server-ssl/${name}`);
        if (Object.keys(params).length > 0) {
            params = { ...params, serverName };
            return await f5Axios.patch(`/mgmt/tm/ltm/profile/server-ssl/${name}`, params);
        } else {
            return defaultResponse;
        }
    } catch (err) {
        try {
            return await ignore404(err, async () => {
                try {
                    params = { ...params, serverName };
                    if (parentName) {
                        params = { ...params, defaultsFrom: parentName };
                    }
                    return await f5Axios.post(`/mgmt/tm/ltm/profile/server-ssl`, {...{
                        name,
                    }, ...params})
                } catch (e2) {
                    throw e2
                }
            });
    
        } catch (e3: any) {
            throw e3?.response?.data || e3
        }
    }
}

export const defaultResponse = {
    status: 200,
    data: ''
};
export async function ignore404(err: any, fn?: any) { 
    if (err.response) {
        if (err.response.data && err.response.data.code == 404) {
            if (fn) {
                return await fn();
            } else { 
                return defaultResponse;
            }
        } else { 
            // 避免循環引用，只提取必要的錯誤信息
            const errorMessage = err.response.data?.message || err.response.data?.error || 'Unknown error';
            throw new Error(errorMessage);
        }
    } else {
        throw err;
    }
}
export function skipError(err: any) { 
    if (err.response && err.response.data.code != 404) {
        console.log(err.response.data);
        console.log('SKIP !');
    }   
}

export async function saveNode(f5Axios: any, { name, address }: any) {
    try {
        return await f5Axios.get(`/mgmt/tm/ltm/node/${name}`);
    } catch (err) {
        return await ignore404(err, async () => {

            if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\.\.\d{1,5})?$/.test(address)) {
                await f5Axios.post(`/mgmt/tm/ltm/node`, { name, address });
            } else {
                await f5Axios.post(`/mgmt/tm/ltm/node`, { name, fqdn : {
                    autopopulate: "enabled",
                    tmName: address
                } });
            }

        });
    }
}

export async function savePool(f5Axios: any, { name, monitor = `/Common/tcp`, minActiveMembers = 0 }: any) {
    try {
        return await f5Axios.get(`/mgmt/tm/ltm/pool/${name}`);
    } catch (err) {
        return await ignore404(err, async () => await f5Axios.post(`/mgmt/tm/ltm/pool/`, {...{
            name,
            minActiveMembers,
        }, ...( monitor ? { monitor }: {})}));
    }
}

export async function savePoolMember(f5Axios:any, poolName:string, { activeName, autopopulate, priorityGroup = 0 }:any) {// test
    let rs = await f5Axios.get(`/mgmt/tm/ltm/pool/${poolName}/members`);
    try {
        rs = await f5Axios.get(`/mgmt/tm/ltm/pool/${poolName}/members/${escapePathValue(activeName)}`);
        await f5Axios.patch(`/mgmt/tm/ltm/pool/${poolName}/members/${escapePathValue(activeName)}`, { priorityGroup });
    } catch (err) {
        rs = await ignore404(err, async () => await f5Axios.post(`/mgmt/tm/ltm/pool/${poolName}/members/`, {
            ...{ name: activeName, priorityGroup: priorityGroup },
            ...(autopopulate ? { fqdn : { autopopulate }}: {})
        }));
    }
    return rs;
}

export async function saveVirtualServer(f5Axios: any, { name, destination, description, mask, pool, securityLogProfiles, profilesReference, sourceAddressTranslation, policiesReference, fwEnforcedPolicy, vlans, rules }: any) {
    try {
        const rs = await f5Axios.get(`/mgmt/tm/ltm/virtual/${name}`);
        return await f5Axios.patch(`/mgmt/tm/ltm/virtual/${rs.data.name}`, {
            destination, description, mask, pool, securityLogProfiles, profilesReference, sourceAddressTranslation, 
            policiesReference, fwEnforcedPolicy, 
            ...(rules ? { rules } : { rules : rs.data.rules }),
            ...( vlans ? {
                vlansEnabled : true,
                vlans
            } : {
                vlansDisabled : true,
                vlans: []
            } ),
            enabled: true,
        });
    } catch (err) {
        return await ignore404(err, async () => await f5Axios.post(`/mgmt/tm/ltm/virtual/`, {
            name, destination, description, mask, pool, securityLogProfiles, profilesReference, sourceAddressTranslation,
            policiesReference, fwEnforcedPolicy,
            ...(rules ? { rules } : {}),
            ...( vlans ? {
                vlansEnabled : true,
                vlans
            } : {
                vlansDisabled : true,
                vlans: []
            } ),
            enabled: true,
        }));
    }
}

export async function updateVirtualServer(f5Axios: any, name: string, { fwEnforcedPolicy, description, policiesReference, enable = true, rules }: any) {
    try {
        const rs = await f5Axios.get(`/mgmt/tm/ltm/virtual/${name}`);
        return await f5Axios.patch(`/mgmt/tm/ltm/virtual/${rs.data.name}`, {
            ...(rules ? { rules } : { rules : rs.data.rules }),
            ...(fwEnforcedPolicy ? { fwEnforcedPolicy }: {}),
            ...(description !== undefined ? { description }: {}),
            ...(policiesReference ? { policiesReference }: {}),
            ...(enable ? { enabled: true } : { disabled: true })
        });
    } catch (err) {
        return await ignore404(err);
    }
}

export async function createLtmDraftPolicy(f5Axios: any, { name }: any) {
    const commonDrafts = `~${PARTITION}~Drafts~${name}`;
    const commonDraftsTemplate = `~${PARTITION}~Drafts~${name}.template`;
    const draftName = `/${PARTITION}/Drafts/${name}`;
    const draftTemplateName = `/${PARTITION}/Drafts/${name}.template`;
    const policyMain = await getLtmPolicy(f5Axios, name);
    if (policyMain.data) {  //create-draft
        try {
            await f5Axios.get(`/mgmt/tm/ltm/policy/${commonDrafts}`);
            await f5Axios.delete(`/mgmt/tm/ltm/policy/${commonDrafts}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) { }
        await f5Axios.patch(`/mgmt/tm/ltm/policy/${name}?options=create-draft`, {});
        try {
            await f5Axios.get(`/mgmt/tm/ltm/policy/${commonDraftsTemplate}`);
            await f5Axios.delete(`/mgmt/tm/ltm/policy/${commonDraftsTemplate}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) { }        
        await f5Axios.post(`/mgmt/tm/ltm/policy/?options=copy-from,${draftName}`, { name: draftTemplateName });
    } else {
        try {
            await f5Axios.get(`/mgmt/tm/ltm/policy/${commonDrafts}`);
            await f5Axios.delete(`/mgmt/tm/ltm/policy/${commonDrafts}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) { }
        try {
            await f5Axios.get(`/mgmt/tm/ltm/policy/${commonDraftsTemplate}`);
            await f5Axios.post(`/mgmt/tm/ltm/policy/?options=copy-from,${draftTemplateName}`, { name: draftName });
        } catch (e) {
            await f5Axios.post(`/mgmt/tm/ltm/policy/`, { name: draftName, strategy: 'first-match' });
        }
    }

}

export async function publishLtmDraftPolicy(f5Axios: any, { name }: any) {
    try {
        return await f5Axios.post(`/mgmt/tm/ltm/policy`, {command: "publish", name: `Drafts/${name}`});
    } catch (err) {
        console.log(`publish draft error ===>`, err);
        return await ignore404(err);
    }
}

export async function saveLtmDraftPolicyRule(f5Axios: any, name: string, ruleName: string, { ordinal, conditionsReference, actionsReference }: any) {
    try {
        return await f5Axios.post(`/mgmt/tm/ltm/policy/~${PARTITION}~Drafts~${name}/rules/`, {...{
                name: ruleName,
                conditionsReference,
                actionsReference
            },
            ...(ordinal ? {
                ordinal
            }:{})
        });
    } catch (err) {
        console.log(`save draft error ===>`, err);
        return await ignore404(err);
    }
}

export async function saveLtmPolicy(f5Axios: any, { name, ruleName, hosts, poolName, policyName, templatePolicyName }:any, f5version=13) {
    try {
        //create draft
        await createLtmDraftPolicy(f5Axios, {name});
        //delete rule if exists
        await deleteLtmDraftPolicyRule(f5Axios, name, ruleName);
        await deleteLtmDraftPolicyRule(f5Axios, name, 'default');
        
        const rules = await getLtmPolicyRules(f5Axios, name);
        const policyRules = rules && rules.data.items ? rules.data.items.filter((rule: any) => rule.name !== 'default' && rule.name !== ruleName) : [];
        const ruleOrdinals = policyRules.map((p: any) => p.ordinal);
        const ruleLen = ruleOrdinals && ruleOrdinals.length > 0 ? Number(Math.max.apply(Math, ruleOrdinals)) : 0;

        if (templatePolicyName) {
            
            await saveLtmDraftPolicyRule(f5Axios, name, 'default', {
                ordinal: ruleLen + 2,
                actionsReference : {
                    items: [
                        {
                            name    : "0",
                            asm     : true,
                            enable  : true,
                            policy  : '/Common/www.twister5.com.tw',
                            request : true
                        },
                        {
                            name     : "1",
                            http     : true,
                            disable  : true,
                            request  : true
                        }    
                    ]
                }
            });  
        }
        //save rule
        await saveLtmDraftPolicyRule(f5Axios, name, ruleName, {
            ordinal: ruleLen + 1,
            conditionsReference : {
                items: [
                    {
                        name    : "0",
                        equals  : true,
                        host    : true,
                        httpHost: true,
                        request : true,
                        values  : [...hosts]
                    }
                ]
            },
            actionsReference : {
                items: [
                    {
                        name    : "0",
                        forward : true,
                        pool    : poolName,
                        request : true
                    },
                    {
                        name    : "1",
                        asm     : true,
                        enable  : true,
                        policy  : '/Common/www.twister5.com.tw',
                        request : true
                    }
                ]
            }
        });
        //draft published
        return await publishLtmDraftPolicy(f5Axios, { name });
    } catch (err) {
        console.log(`saveLtmPolicy.err: `, err);
        return await ignore404(err);
    }
}

export async function deleteLtmDraftPolicyRule(f5Axios: any, name: string, ruleName: string) {
    try {
        const rs = await f5Axios.get(`/mgmt/tm/ltm/policy/~${PARTITION}~Drafts~${name}/rules/${ruleName}`);
        if (rs.data) {
            await f5Axios.delete(`/mgmt/tm/ltm/policy/~${PARTITION}~Drafts~${name}/rules/${ruleName}`);
        }
    } catch (err) {
        return await ignore404(err);
    }
}

export async function getLtmPolicyRules(f5Axios: any, name: string) {
    try {
        return await f5Axios.get(`/mgmt/tm/ltm/policy/${name}/rules/`);
    } catch (err) {
        return await ignore404(err);
    }
}

export async function getLtmPolicy(f5Axios: any, name: string) {
    try {
        return await f5Axios.get(`/mgmt/tm/ltm/policy/${name}?expandSubcollections=true`);
    } catch (err) {
        return await ignore404(err);
    }
}

export async function getSslCert(f5Axios: any, cert: string) {
    try {
        return await f5Axios.get(`/mgmt/tm/sys/file/ssl-cert/${escapePathValue(cert)}?$select=name,issuer,subject,createTime,lastUpdateTime,expirationString,isBundle`);
    } catch (err) {
        return await ignore404(err);
    }
}

export async function getCertChainInfo(contractNo: any, domainName: string, virtualServerIp: string) {
    const ltmClient = await getLtmServerClient();
    let sslCertChainInfo: any = {};
    let certName = '';
    let keyName = '';
    let chainName = '';
    let isNew = false;

    try {
        const sslCertResp = await getSslCert(ltmClient, `${contractNo}-VS${virtualServerIp}-${domainName}.crt`);
        if (sslCertResp.data) {
            sslCertChainInfo['cert'] = sslCertResp.data;
        } else {
            const sslCertResp2 = await getSslCert(ltmClient, `${contractNo}-VS${virtualServerIp}-${domainName}`);
            if (sslCertResp2.data) {
                sslCertChainInfo['cert'] = sslCertResp2.data;
            }
        }
    } catch (e: any) {
        console.log(`${contractNo}-VS${virtualServerIp}-${domainName}.crt not exists : ${e.message}`);
    }
    return sslCertChainInfo;
}



export async function deleteWafSettingService(contractNo: string, domainName: string) {
    let setting = null;
    try {
        let setting = await getF5ServiceByContractNoAndDomainName(contractNo, domainName);
        setting = decodeSetting(setting);
        await wafTerminate(setting); 
    } catch (e) {
        throw e;
    }
    return { setting };
}

export async function wafTerminate(params: any) {

    const startTime = new Date().getTime();
    console.log('wafTerminate start: ', new Date(startTime));
    console.log(params);
    const { contractNo: hnNo, domainName, nodeIp, ports } = params;
    const virtualServerIp = '202.39.33.192';
    
    const ltmClient = await getLtmServerClient();
    const profileName = `clientssl-${hnNo}-VS${virtualServerIp}-${domainName}`;
    const serverProfileName = `serverssl-${hnNo}-VS${virtualServerIp}-${domainName}`;
    try {
        for (const servicePort of ports) {
            try {
                const ltmVirtualServerName = `vs_${hnNo}_VS${virtualServerIp}_${servicePort}`;
                await ltmClient.delete(`/mgmt/tm/ltm/virtual/${ltmVirtualServerName}`);
            } catch (err) {
                skipError(err);
            }

            try {
                const ltmPoolForwardPolicyName = `policy_${hnNo}_VS${virtualServerIp}`;
                await ltmClient.delete(`/mgmt/tm/ltm/policy/${ltmPoolForwardPolicyName}_${servicePort}`);
                await ltmClient.delete(`/mgmt/tm/ltm/policy/~${PARTITION}~Drafts~${ltmPoolForwardPolicyName}_${servicePort}.template`);
            } catch (err2) {
                skipError(err2);
            }

            try {
                const ltmFullPoolName = `pool_${hnNo}_VS${virtualServerIp}_${domainName}`;
                await ltmClient.delete(`/mgmt/tm/ltm/pool/${ltmFullPoolName}_${servicePort}`);
            } catch (err3) {
                skipError(err3);
            }
        }

        try {
            const ltmFullNodeName = `${changeNodeIpName(nodeIp)}`;
            await ltmClient.delete(`/mgmt/tm/ltm/node/${ltmFullNodeName}`);
        } catch (err4) {
            skipError(err4);
        }
        
        try {
            await ltmClient.delete(`/mgmt/tm/ltm/profile/client-ssl/${profileName}`);
            await ltmClient.delete(`/mgmt/tm/ltm/profile/server-ssl/${serverProfileName}`);
        } catch (err5) {
            skipError(err5);
        }

        const rs = await ltmClient.get(`/mgmt/tm/sys/file/ssl-cert?$select=name`);
        for (let item of (rs.data.items || [])) {
            const isMatched = item.name.indexOf(`${hnNo}-VS${virtualServerIp}-${domainName}`) > -1
            if (isMatched) {
                try {
                    await ltmClient.delete(`/mgmt/tm/sys/crypto/cert/${item.name}`);
                } catch (err) {
                    skipError(err);
                }
            }
        }

        const rs2 = await ltmClient.get(`/mgmt/tm/sys/file/ssl-key?$select=name`);
        for (let item of (rs2.data.items || [])) {
            const isMatched = item.name.indexOf(`${hnNo}-VS${virtualServerIp}-${domainName}`) > -1
            if (isMatched) {
                try {
                    await ltmClient.delete(`/mgmt/tm/sys/crypto/key/${item.name}`);
                } catch (err) {
                    skipError(err);
                }
            }
        }
    } catch (e) {
        throw e;
    }
}

export async function removeSslProfilesFromVs(client: any, virtualServerName: string, profileName: string, serverProfileName: string) {
    const vssLtmRs = await getVirtualServersByKeyword(client, `${virtualServerName}`);
    for (let vss of vssLtmRs) {
        if (!vss.profilesReference || !vss.profilesReference.items) continue;
        const clientsslProfiles = vss.profilesReference.items.filter((item: any) => item.context === "clientside" && item.name === profileName );
        const serversslProfiles = vss.profilesReference.items.filter((item: any) => item.context === "serverside" && item.name === serverProfileName );
        if (clientsslProfiles.length || serversslProfiles.length) {
            const vsName = vss.name;
            const otherProfiles = vss.profilesReference.items.filter((item: any) => item.name !== profileName && item.name !== serverProfileName );
            await updateMatchedVirtualServer(client, vsName, {
                profilesReference : {
                    items : [...otherProfiles]
                }
            });
        }
    }
};

export async function getVirtualServersByKeyword(f5Axios: any, keyword: string) {
    if (keyword.length < 10) {
        throw new Error('Length of keyword is too short');
    }
    const rs = await f5Axios.get(`/mgmt/tm/ltm/virtual?$select=name`);
    const items = ((rs.data && rs.data.items) || []).filter((item: any) => item.name.indexOf(keyword) > -1);
    const items2 = [];
    for (let i = 0, length = items.length; i < length; i++) {
        const rs2 = await getVirtualServer(f5Axios, items[i].name);
        if (rs2.data) {
            items2.push(rs2.data);
        }
    }
    return items2;
}
export async function getVirtualServer(f5Axios: any, name: string) {
    try {
        return await f5Axios.get(`/mgmt/tm/ltm/virtual/${name}?expandSubcollections=true`);
    } catch (err) {
        return await ignore404(err);
    }
}
export async function updateMatchedVirtualServer(f5Axios: any, keyword: string, { description, profilesReference, policiesReference, rules }: any) {
    if (keyword.length < 10) {
        throw new Error('Length of keyword is too short');
    }
    const rs = await f5Axios.get(`/mgmt/tm/ltm/virtual?$select=name`);
    for (let item of (rs.data.items || [])) {
        const isMatched = keyword.endsWith('$') ? item.name.endsWith(keyword.replace(/\$$/, '')) : item.name.indexOf(keyword) > -1;
        if (isMatched) {
            try {
                const rs2 = await getVirtualServer(f5Axios, item.name);
                const item2 = rs2.data;
                let reference = {};
                if (profilesReference) {
                    reference = { ...reference, profilesReference};
                }
                if (description) {
                    reference = { ...reference, description};
                }
                if (policiesReference) {
                    reference = { ...reference, policiesReference};
                }
                if (rules) {
                    reference = { ...reference, rules };
                }
                if (item2.rules && item2.rules.length > 0) { 
                    reference = { ...reference, rules: [...(item2.rules.filter((rule: any) => rule.indexOf(`/domain_forward_rule`) == -1 && rule.indexOf(`/block_list_rule`) == -1))]}
                }
                if (Object.keys(reference).length){
                    await f5Axios.patch(`/mgmt/tm/ltm/virtual/${item2.name}`, reference );
                }
            } catch (err) {
                await ignore404(err);
            }
        }
    }
    return defaultResponse;
}
