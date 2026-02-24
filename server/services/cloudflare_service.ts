import FormData from 'form-data';
import { getCloudflareClient } from './request';
import config from '../config/config';
import { ignore404 } from '../middleware/request_handler_util';
import { getActivatedZones, getGeolocationList } from './cloudflare_setting';
import { parseRuleExpression, parseCdnRuleExpression } from '../middleware/cloudflare_expression';

//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       取的 Zone 內容        */
export async function getCloudflareAllZones() {
    try {
        let cfClient = await getCloudflareClient();
        const cloudflareZones = await cfClient.get(`/zones`);
        if (cloudflareZones && cloudflareZones.data) {
            if (cloudflareZones.data.result.length > 0) {
                return cloudflareZones.data.result.map((item: any) => item.name);
            } else {
                return [];
            }
        } else {
            throw Error('Failed to get Cloudflare Zone List');
        }
    } catch (error: any) {
        console.error('Failed to get Cloudflare Zone:', error.response?.data || error.message);
        throw Error(error);
    }
}

export async function getCloudflareZones(zones: any) {
    try {
        let cfClient = await getCloudflareClient();
        const cloudflareZones = await cfClient.get(`/zones`);
        if (cloudflareZones && cloudflareZones.data) {
            if (cloudflareZones.data.result.length > 0) {
                const contractZones = cloudflareZones.data.result.filter((item: any) => zones.includes(item.name));
                for (let zone of contractZones) {
                    const today = new Date();
                    const yesterday = new Date(today);
                    yesterday.setDate(today.getDate() - 1);
                    const yesterdayDateStr = yesterday.toISOString().slice(0, 10);
                    const query = `
                        query {
                            viewer {
                                zones(filter: { zoneTag: "${zone.id}" }) {
                                    httpRequests1dGroups(
                                        limit: 1,
                                        filter: { date_gt: "${yesterdayDateStr}" }
                                    ) {
                                        dimensions { date }
                                        sum { bytes }
                                    }
                                }
                            }
                        }
                    `;

                    const zoneData = await cfClient.post(`/graphql`, { query });
                    if (zoneData.data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups && zoneData.data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups.length > 0) {
                        const bytes = zoneData.data.data.viewer.zones[0].httpRequests1dGroups[0].sum.bytes;
                        zone.bytes = bytes;
                    } else {
                        zone.bytes = 0;
                    }
                }
                return contractZones;
            } else {
                return [];
            }
        } else {
            throw Error('Failed to get Cloudflare Zone List');
        }
    } catch (error: any) {
        console.error('Failed to get Cloudflare Zone:', error.response?.data || error.message);
        throw Error(error);
    }
}

export async function getCloudflareDnsByZones(zones: any) {
    try {
        let cfClient = await getCloudflareClient();
        let dnsRecordList: any[] = [];
        for (let zone of zones) {
            const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
            if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
                const zoneId = cloudflareZone.data.result[0].id;
                const dnsList = await cfClient.get(`/zones/${zoneId}/dns_records`);
                if (dnsList && dnsList.data && dnsList.data.result.length > 0) {
                    let dnsData = dnsList.data.result.map((record: any) => ({
                        ...record,
                        zone: zone
                    }));
                    dnsRecordList = [...dnsRecordList, ...dnsData];
                }
            }
        }
        return dnsRecordList;
    } catch (error: any) {
        console.error('Failed to get Cloudflare DNS by zones:', error.response?.data || error.message);
        throw Error(error);
    }
}

//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       建立Zone及預設規則集        */
export async function zoneService(type: string, zoneName: string, dnsSetupMethod?: string) {
    let cfClient = await getCloudflareClient();
    if (type === 'create') {
        try {
            const zone = await cfClient.get(`/zones?name=${zoneName}`);
            if (zone && zone.data && zone.data.result.length === 0) {
                // 1. 建立Zone
                const createResponse = await cfClient.post('/zones', {
                    name: `${zoneName}`,
                    type: 'full',
                    account: {
                        id: config.cloudflare.accountId || 'e1ab85903e4701fa311b5270c16665f6'
                    }
                })
                if (createResponse && createResponse.data && createResponse.data.result) {
                    const zoneId = createResponse.data.result.id;
                    console.log(`Zone created with ID: ${zoneId}`);
                    
                    // 2. 更改為 Enterprise 方案
                    try {
                        await cfClient.post(`/zones/${zoneId}/subscription`, {
                            rate_plan: {
                                id: "enterprise",
                            }
                        }).then(async () => {
                            // 2.1 更改為 partial 方案
                            await cfClient.patch(`/zones/${zoneId}`, { type: 'partial' });
                        })
                        console.log('New zone upgraded to Enterprise plan.');

                        // 3. 部署 Enterprise WAF 規則集
                        try {
                            const entrypoint = await cfClient.get(`/zones/${zoneId}/rulesets/phases/http_request_firewall_managed/entrypoint`);
                            await deployEnterpriseWafRulesets(zoneId, cfClient);
                        } catch (entrypointError) {
                            await cfClient.post(`/zones/${zoneId}/rulesets`, {
                                name: 'default',
                                description: '',
                                kind: 'zone',
                                phase: 'http_request_firewall_managed'
                            })
                            await deployEnterpriseWafRulesets(zoneId, cfClient);
                        } 

                        // 4. 部署 DNS 記錄 (快速掃描)
                        if (dnsSetupMethod === 'quick_scan') {
                            await scanDnsRecords(zoneId, cfClient);
                        }
                    } catch (upgradeError: any) {
                        console.log(upgradeError)
                        throw new Error(`Failed to upgrade to Enterprise plan: ${upgradeError.response?.data?.errors[0].message || upgradeError.message}`);
                    }
                    return createResponse.data.result;
                }
            } else {
                console.log(`Zone ${zoneName} already exists`);
                const existingZoneId = zone.data.result[0].id;
                
                // 2. 更改為 Enterprise 方案
                try {
                    const upgradeResponse = await cfClient.post(`/zones/${existingZoneId}/subscription`, {
                        rate_plan: {
                            id: "enterprise",
                        }
                    });
                    console.log('Existing zone upgraded to Enterprise plan:', upgradeResponse.data);
                    
                    // 2.1 更改為 partial 方案
                    await cfClient.patch(`/zones/${existingZoneId}`, { type: 'partial' });
                    
                    // 升級成功後，自動部署 Enterprise WAF 規則集和安全設定
                    try {
                        const entrypoint = await cfClient.get(`/zones/${existingZoneId}/rulesets/phases/http_request_firewall_managed/entrypoint`);
                        console.log(entrypoint)
                        await deployEnterpriseWafRulesets(existingZoneId, cfClient);
                    } catch (entrypointError) {
                        await cfClient.post(`/zones/${existingZoneId}/rulesets`, {
                            name: 'default',
                            description: '',
                            kind: 'zone',
                            phase: 'http_request_firewall_managed'
                        })
                        await deployEnterpriseWafRulesets(existingZoneId, cfClient);
                    }
                } catch (upgradeError: any) {
                    throw new Error(`Failed to upgrade to Enterprise plan: ${upgradeError.response?.data?.errors[0].message || upgradeError.message}`);
                }
                return zone.data.result[0];
            }
        } catch (error: any) {
            if (error.response && error.response.data && error.response.data.errors && error.response.data.errors.length > 0) {
                throw new Error(error.response.data.errors[0].message);
            } else {
                throw new Error(error);
            }
        }
    }
    else if (type === 'delete') {
        try {
            const zone = await cfClient.get(`/zones?name=${zoneName}`);
            if (zone && zone.data && zone.data.result.length > 0) {
                const zoneId = zone.data.result[0].id;
                // 1. 刪除 DNS Records
                const dnsRecords = await cfClient.get(`/zones/${zoneId}/dns_records`);
                if (dnsRecords && dnsRecords.data && dnsRecords.data.result.length > 0) {
                    for (let dnsRecord of dnsRecords.data.result) {
                        await cfClient.delete(`/zones/${zoneId}/dns_records/${dnsRecord.id}`);
                    }
                }
                // 2. 刪除 WAF 規則集
                const wafRulesets = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (wafRulesets && wafRulesets.data && wafRulesets.data.result.length > 0) {
                    let ruleset = wafRulesets.data.result.find((item: any) => item.source === 'firewall_custom');
                    ruleset && await cfClient.delete(`/zones/${zoneId}/rulesets/${ruleset.id}`);
                    let ddosL7Rule = wafRulesets.data.result.find((item: any) => item.name === "ddos_l7");
                    ddosL7Rule && await cfClient.delete(`/zones/${zoneId}/rulesets/${ddosL7Rule.id}`);
                }
                // 3. 刪除 Cache Rule
                const cacheRule = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (cacheRule && cacheRule.data && cacheRule.data.result.length > 0) {
                    let ruleset = cacheRule.data.result.find((item: any) => item.phase === 'http_request_cache_settings');
                    ruleset && await cfClient.delete(`/zones/${zoneId}/rulesets/${ruleset.id}`);
                }
                // 4. 降級為 Free 方案
                await cfClient.post(`/zones/${zoneId}/subscription`, {
                    rate_plan: {
                        id: "free",
                    }
                })
                // 4. 刪除 Zone(等待 5 秒後刪除)
                await new Promise(resolve => setTimeout(resolve, 5000));
                try {
                    await cfClient.delete(`/zones/${zoneId}`);
                    console.log(`Zone ${zoneId} deleted successfully`);
                } catch (err: any) {
                    const zone2 = await cfClient.get(`/zones?name=${zoneName}`);
                    if (zone2 && zone2.data && zone2.data.result.length > 0) {
                        const zoneId2 = zone2.data.result[0].id;
                        await cfClient.delete(`/zones/${zoneId2}`);
                        console.log(`Zone ${zoneId2} deleted successfully`);
                    } else {
                        console.log(`Zone ${zoneId} already deleted (Invalid zone identifier)`);
                    }
                }
            }
        } catch (error: any) {
            console.log('Delete Zone failed:');
            console.log(error)
            if (error.response && error.response.data && error.response.data.errors && error.response.data.errors.length > 0) {
                throw new Error(error.response.data.errors[0].message);
            } else {
                throw new Error(error);
            }
        }
    }
}

// 部署 Enterprise WAF 規則集
async function deployEnterpriseWafRulesets(zoneId: string, cfClient: any) {  
    try {
        // 1. 部署 Cloudflare OWASP 核心規則集
        await deployOwaspCoreRuleset(zoneId, cfClient);
        // 2. 部署 Cloudflare 受控規則集
        await deployManagedRuleset(zoneId, cfClient);
        // 3. 部署 Firewall 自訂規則集
        await deployFirewallCustomRuleset(zoneId, cfClient);
        // 4. 部署 快取規則集
        await deployCacheRuleset(zoneId, cfClient);
        // 5. 部署 DDoS 覆寫規則集
        await deployDDoSOverrideRuleset(zoneId, cfClient);
        // 6. 部署 Logpush
        await deployLogpush(zoneId, cfClient);
        
        console.log('Enterprise WAF rulesets deployed successfully');
    } catch (error: any) {
        console.error('Failed to deploy Enterprise WAF rulesets:', error.response?.data || error.message);
    }
}

// 部署 OWASP 核心規則集
async function deployOwaspCoreRuleset(zoneId: string, cfClient: any) {
    try {
        console.log('Deploying OWASP Core Ruleset...');

        // 1: 讀取entrypoint ID
        const entrypoint = await cfClient.get(`/zones/${zoneId}/rulesets/phases/http_request_firewall_managed/entrypoint`);
        const entrypointId = entrypoint && entrypoint.data && entrypoint.data.result && entrypoint.data.result.id || '';
        // 2: 讀取 OWASP 核心規則集
        const owaspRuleset = await cfClient.get(`/zones/${zoneId}/rulesets`);
        if (owaspRuleset && owaspRuleset.data && owaspRuleset.data.result) {
            try {
                const owaspCoreRuleset = owaspRuleset.data.result.find((ruleset: any) => ruleset.name === "Cloudflare OWASP Core Ruleset");
                if (owaspCoreRuleset) {
                    // 3: 更新 OWASP 核心規則集上entrypoint
                    const owaspCoreRulesetId = owaspCoreRuleset.id;
                    const owaspRulesetResp = await cfClient.get(`/zones/${zoneId}/rulesets/${owaspCoreRulesetId}`);
                    const owaspRulesetRules = owaspRulesetResp && owaspRulesetResp.data && owaspRulesetResp.data.result && owaspRulesetResp.data.result.rules || [];
                    const owaspRulesetActionRules = owaspRulesetRules
                        .filter((rule: any) => rule.action === "block" || rule.action === "log")
                        .map((rule: any) => ({
                            action: 'log',
                            enabled: rule.enabled,
                            id: rule.id
                        }));
                    const deployResponse = await cfClient.post(`/zones/${zoneId}/rulesets/${entrypointId}/rules`, {
                        action: "execute",
                        action_parameters: {
                            id: `${owaspCoreRulesetId}`,
                            overrides: {
                                rules: owaspRulesetActionRules
                            }
                        },
                        expression: "true",
                        enabled: true
                    });
                    console.log('OWASP Core Ruleset deployed successfully:', deployResponse.data);
                } 
            } catch (deployError) {
                console.log('OWASP Core Ruleset deployment failed...');
            }
        }
    } catch (error: any) {
        console.error('Failed to deploy OWASP Core Ruleset:', error.response?.data || error.message);
    }
}

// 部署 Cloudflare 受控規則集
async function deployManagedRuleset(zoneId: string, cfClient: any) {
    try {
        console.log('Deploying Cloudflare Managed Ruleset...');

        // 1: 讀取entrypoint ID
        const entrypoint = await cfClient.get(`/zones/${zoneId}/rulesets/phases/http_request_firewall_managed/entrypoint`);
        const entrypointId = entrypoint && entrypoint.data && entrypoint.data.result && entrypoint.data.result.id || '';
        // 2: 讀取 Cloudflare 受控規則集
        const managedRuleset = await cfClient.get(`/zones/${zoneId}/rulesets`);
        if (managedRuleset && managedRuleset.data && managedRuleset.data.result) {
            try {
                const cloudflareManagedRuleset = managedRuleset.data.result.find((ruleset: any) => ruleset.name === "Cloudflare Managed Ruleset");
                if (cloudflareManagedRuleset) {
                    // 3: 更新 Cloudflare 受控規則集上entrypoint
                    const managedRulesetId = cloudflareManagedRuleset.id;
                    const managedRulesetResp = await cfClient.get(`/zones/${zoneId}/rulesets/${managedRulesetId}`);
                    const owaspRulesetRules = managedRulesetResp && managedRulesetResp.data && managedRulesetResp.data.result && managedRulesetResp.data.result.rules || [];
                    const managedRulesetActionRules = owaspRulesetRules
                        .filter((rule: any) => rule.action === "block" || rule.action === "log")
                        .map((rule: any) => ({
                            action: 'log',
                            enabled: rule.enabled,
                            id: rule.id
                        }));
                    const deployResponse = await cfClient.post(`/zones/${zoneId}/rulesets/${entrypointId}/rules`, {
                        action: "execute",
                        action_parameters: {
                            id: `${managedRulesetId}`,
                            overrides: {
                                rules: managedRulesetActionRules
                            }
                        },
                        expression: "true",
                        enabled: true
                    });
                    console.log('Cloudflare Managed Ruleset deployed successfully:', deployResponse.data);
                } 
            } catch (deployError: any) {
                console.log(deployError.response?.data)
                console.log('Cloudflare Managed Ruleset deployment failed...');
            }
        }
    } catch (error: any) {
        console.error('Failed to deploy Cloudflare Managed Ruleset:', error.response?.data || error.message);
    }
}

// 部署 自訂規則集
async function deployFirewallCustomRuleset(zoneId: string, cfClient: any) {
    try {
        console.log('Deploying Cloudflare Firewall Custom Ruleset...');

        // 1: 讀取 Firewall 自訂規則集
        const customRuleset = await cfClient.get(`/zones/${zoneId}/rulesets`);
        if (customRuleset && customRuleset.data && customRuleset.data.result) {
            try {
                const firewallCustomRuleset = customRuleset.data.result.find((ruleset: any) => ruleset.source === "firewall_custom");
                // 2: Firewall 自訂規則集不存在，建立規則集
                if (!firewallCustomRuleset) {
                    const deployResponse = await cfClient.post(`/zones/${zoneId}/rulesets`, {
                        name: 'firewall_custom',
                        description: 'Custom firewall Ruleset',
                        kind: 'zone',
                        phase: 'http_request_firewall_custom'
                    })
                    console.log('Cloudflare Firewall Custom Ruleset deployed successfully:', deployResponse.data);
                    return deployResponse.data.result.id;
                } else {
                    console.log('Cloudflare Firewall Custom Ruleset already exists...');
                }
            } catch (deployError: any) {
                console.log('Cloudflare Firewall Custom Ruleset deployment failed...', deployError.data);
            }
        }
    } catch (error: any) {
        console.error('Failed to deploy Cloudflare Firewall Custom Ruleset:', error.response?.data || error.message);
    }
}

// 部署 DDoS 覆寫規則集
async function deployDDoSOverrideRuleset(zoneId: string, cfClient: any) {
    try {
        console.log('Deploying DDoS Override Ruleset...');

        // 1: 讀取 Firewall 自訂規則集
        const ddosRuleset = await cfClient.get(`/zones/${zoneId}/rulesets`);
        if (ddosRuleset && ddosRuleset.data && ddosRuleset.data.result) {
            try {
                const ddosOverrideRuleset = ddosRuleset.data.result.find((ruleset: any) => ruleset.name === "ddos_l7");
                // 2: DDoS L7 規則集不存在，建立規則集
                if (!ddosOverrideRuleset) {
                    const deployResponse = await cfClient.post(`/zones/${zoneId}/rulesets`, {
                        name: 'ddos_l7',
                        description: 'Custom DDoS Override Ruleset',
                        kind: 'zone',
                        phase: 'ddos_l7',
                    })

                    const ddosL7RuleId = deployResponse.data.result.id;
                    // 3. 建立 DDoS L7 Override 規則
                    await cfClient.post(`/zones/${zoneId}/rulesets/${ddosL7RuleId}/rules`, {
                        description: "default_rule",
                        action: "execute",
                        enabled: true,
                        expression: "true",
                        action_parameters: {
                            id: '4d21379b4f9f4bb088e0729962c8b3cf',
                            overrides: {
                                sensitivity_level: 'default'
                            }
                        }
                    });
                    console.log('Cloudflare DDoS Override Ruleset deployed successfully:', deployResponse.data);
                    return deployResponse.data.result.id;
                } else {
                    console.log('Cloudflare DDoS Override Ruleset already exists...');
                }
            } catch (deployError: any) {
                if (deployError.response && deployError.response.data && deployError.response.data.errors && deployError.response.data.errors.length > 0) {
                    console.log('Cloudflare DDoS Override Ruleset deployment failed...', deployError.response.data.errors[0].message);
                } else {
                    console.log('Cloudflare DDoS Override Ruleset deployment failed...', deployError);
                }
            }
        }
    } catch (error: any) {
        console.error('Failed to deploy Cloudflare DDoS Override Ruleset:', error.response?.data || error.message);
    }
}

// 部署 快取規則集
async function deployCacheRuleset(zoneId: string, cfClient: any) {
    try {
        console.log('Deploying Cloudflare Cache Ruleset...');

        // 1: 讀取 Cache 規則集
        const cacheRuleset = await cfClient.get(`/zones/${zoneId}/rulesets`);
        if (cacheRuleset && cacheRuleset.data && cacheRuleset.data.result) {
            try {
                const cachePurgeRuleset = cacheRuleset.data.result.find((ruleset: any) => ruleset.phase === "http_request_cache_settings");
                // 3: Cache 規則集不存在，建立規則集
                if (!cachePurgeRuleset) {
                    const deployResponse = await cfClient.post(`/zones/${zoneId}/rulesets`, {
                        name: 'cache_purge',
                        description: 'Custom Cache Purge Ruleset',
                        kind: 'zone',
                        phase: 'http_request_cache_settings'
                    })
                    console.log('Cloudflare Cache Purge Ruleset deployed successfully:', deployResponse.data);
                    return deployResponse.data.result.id;
                } else {
                    console.log('Cloudflare Cache Purge Ruleset already exists...');
                }
            } catch (deployError: any) {
                console.log('Cloudflare Cache Purge Ruleset deployment failed...', deployError.data);
            }
        }
    } catch (error: any) {
        console.error('Failed to deploy Cloudflare Cache Purge Ruleset:', error.response?.data || error.message);
    }
}

async function deployLogpush(zoneId: string, cfClient: any) {
    try {
        const logPushResp = await cfClient.get(`/zones/${zoneId}/logpush/jobs`);
        if (logPushResp && logPushResp.data && logPushResp.data.result) {
            const existingLogPush = logPushResp.data.result.filter((item: any) => item.name === 'across');
            if (existingLogPush && existingLogPush.length > 0) {
                const logPushs = existingLogPush.map((item: any) => item.dataset);
                if (!logPushs.includes('dns_logs')) {
                    await cfClient.post(`/zones/${zoneId}/logpush/jobs`, {
                        name: 'across',
                        dataset: 'dns_logs',
                        frequency: 'high',
                        enabled: true,
                        output_options: {
                            field_names: ['ColoCode', 'EDNSSubnet', 'EDNSSubnetLength', 'QueryName', 'QueryType', 'ResponseCached', 'ResponseCode', 'SourceIP', 'Timestamp'],
                            timestamp_format: 'rfc3339'
                        },
                        destination_conf: config.logpushDestination || "https://across-candor.twister5.cf/api/logs",
                    });
                } else if (!logPushs.includes('firewall_events')) {
                    await cfClient.post(`/zones/${zoneId}/logpush/jobs`, {
                        name: 'across',
                        dataset: 'firewall_events',
                        frequency: 'high',
                        enabled: true,
                        output_options: {
                            field_names: [
                                'Action', 'ClientASN', 'ClientASNDescription', 'ClientCountry', 'ClientIP', 'ClientIPClass', 'ClientRefererHost', 'ClientRefererPath', 'ClientRefererQuery', 
                                'ClientRefererScheme', 'ClientRequestHost', 'ClientRequestMethod', 'ClientRequestPath', 'ClientRequestProtocol', 'ClientRequestQuery', 
                                'ClientRequestScheme', 'ClientRequestUserAgent', 'ContentScanObjResults', 'ContentScanObjSizes', 'ContentScanObjTypes', 'Datetime', 
                                'Description', 'EdgeColoCode', 'EdgeResponseStatus', 'Kind', 'LeakedCredentialCheckResult', 'MatchIndex', 'Metadata', 'OriginResponseStatus', 
                                'OriginatorRayID', 'RayID', 'Ref', 'RuleID', 'Source'
                            ],
                            timestamp_format: 'rfc3339'
                        },
                        destination_conf: config.logpushDestination || "https://across-candor.twister5.cf/api/logs",
                    });
                } else if (!logPushs.includes('http_requests')) {
                    await cfClient.post(`/zones/${zoneId}/logpush/jobs`, {
                        name: 'across',
                        dataset: 'http_requests',
                        frequency: 'high',
                        enabled: true,
                        output_options: {
                            field_names: [
                                "CacheCacheStatus", "CacheReserveUsed", "CacheResponseBytes", "CacheResponseStatus", "CacheTieredFill", "ClientASN", "ClientCity",
                                "ClientCountry", "ClientDeviceType", "ClientIP", "ClientIPClass", "ClientLatitude", "ClientLongitude", "ClientMTLSAuthCertFingerprint",
                                "ClientMTLSAuthStatus", "ClientRegionCode", "ClientRequestBytes", "ClientRequestHost", "ClientRequestMethod", "ClientRequestPath",
                                "ClientRequestProtocol", "ClientRequestReferer", "ClientRequestScheme", "ClientRequestSource", "ClientRequestURI", "ClientRequestUserAgent",
                                "ClientSSLCipher", "ClientSSLProtocol", "ClientSrcPort", "ClientTCPRTTMs", "ClientXRequestedWith", "ContentScanObjResults",
                                "ContentScanObjSizes", "ContentScanObjTypes", "Cookies", "EdgeCFConnectingO2O", "EdgeColoCode", "EdgeColoID", "EdgeEndTimestamp",
                                "EdgePathingOp", "EdgePathingSrc", "EdgePathingStatus", "EdgeRequestHost",  "EdgeResponseBodyBytes", "EdgeResponseBytes", "EdgeResponseCompressionRatio",
                                "EdgeResponseContentType", "EdgeResponseStatus", "EdgeServerIP", "EdgeStartTimestamp", "EdgeTimeToFirstByteMs", "LeakedCredentialCheckResult",
                                "OriginDNSResponseTimeMs", "OriginIP", "OriginRequestHeaderSendDurationMs", "OriginResponseBytes", "OriginResponseDurationMs", "OriginResponseHTTPExpires",
                                "OriginResponseHTTPLastModified", "OriginResponseHeaderReceiveDurationMs", "OriginResponseStatus", "OriginResponseTime", "OriginSSLProtocol",
                                "OriginTCPHandshakeDurationMs", "OriginTLSHandshakeDurationMs", "ParentRayID", "RayID", "RequestHeaders", "ResponseHeaders", "SecurityAction",
                                "SecurityActions", "SecurityRuleDescription", "SecurityRuleID", "SecurityRuleIDs", "SecuritySources", "SmartRouteColoID", "UpperTierColoID",
                                "VerifiedBotCategory", "WAFAttackScore", "WAFFlags", "WAFMatchedVar", "WAFRCEAttackScore", "WAFSQLiAttackScore", "WAFXSSAttackScore",
                                "WorkerCPUTime", "WorkerScriptName", "WorkerStatus", "WorkerSubrequest", "WorkerSubrequestCount", "WorkerWallTimeUs", "ZoneName"
                            ],
                            timestamp_format: 'rfc3339'
                        },
                        destination_conf: config.logpushDestination || "https://across-candor.twister5.cf/api/logs",
                    });
                }
            } else {
                await cfClient.post(`/zones/${zoneId}/logpush/jobs`, {
                    name: 'across',
                    dataset: 'dns_logs',
                    frequency: 'high',
                    enabled: true,
                    output_options: {
                        field_names: ['ColoCode', 'EDNSSubnet', 'EDNSSubnetLength', 'QueryName', 'QueryType', 'ResponseCached', 'ResponseCode', 'SourceIP', 'Timestamp'],
                        timestamp_format: 'rfc3339'
                    },
                    destination_conf: config.logpushDestination || "https://across-candor.twister5.cf/api/logs",
                });
                await cfClient.post(`/zones/${zoneId}/logpush/jobs`, {
                    name: 'across',
                    dataset: 'firewall_events',
                    frequency: 'high',
                    enabled: true,
                    output_options: {
                        field_names: [
                            'Action', 'ClientASN', 'ClientASNDescription', 'ClientCountry', 'ClientIP', 'ClientIPClass', 'ClientRefererHost', 'ClientRefererPath', 'ClientRefererQuery', 
                            'ClientRefererScheme', 'ClientRequestHost', 'ClientRequestMethod', 'ClientRequestPath', 'ClientRequestProtocol', 'ClientRequestQuery', 
                            'ClientRequestScheme', 'ClientRequestUserAgent', 'ContentScanObjResults', 'ContentScanObjSizes', 'ContentScanObjTypes', 'Datetime', 
                            'Description', 'EdgeColoCode', 'EdgeResponseStatus', 'Kind', 'LeakedCredentialCheckResult', 'MatchIndex', 'Metadata', 'OriginResponseStatus', 
                            'OriginatorRayID', 'RayID', 'Ref', 'RuleID', 'Source'
                        ],
                        timestamp_format: 'rfc3339'
                    },
                    destination_conf: config.logpushDestination || "https://across-candor.twister5.cf/api/logs",
                });
                await cfClient.post(`/zones/${zoneId}/logpush/jobs`, {
                    name: 'across',
                    dataset: 'http_requests',
                    frequency: 'high',
                    enabled: true,
                    output_options: {
                        field_names: [
                            "CacheCacheStatus", "CacheReserveUsed", "CacheResponseBytes", "CacheResponseStatus", "CacheTieredFill", "ClientASN", "ClientCity",
                            "ClientCountry", "ClientDeviceType", "ClientIP", "ClientIPClass", "ClientLatitude", "ClientLongitude", "ClientMTLSAuthCertFingerprint",
                            "ClientMTLSAuthStatus", "ClientRegionCode", "ClientRequestBytes", "ClientRequestHost", "ClientRequestMethod", "ClientRequestPath",
                            "ClientRequestProtocol", "ClientRequestReferer", "ClientRequestScheme", "ClientRequestSource", "ClientRequestURI", "ClientRequestUserAgent",
                            "ClientSSLCipher", "ClientSSLProtocol", "ClientSrcPort", "ClientTCPRTTMs", "ClientXRequestedWith", "ContentScanObjResults",
                            "ContentScanObjSizes", "ContentScanObjTypes", "Cookies", "EdgeCFConnectingO2O", "EdgeColoCode", "EdgeColoID", "EdgeEndTimestamp",
                            "EdgePathingOp", "EdgePathingSrc", "EdgePathingStatus", "EdgeRequestHost",  "EdgeResponseBodyBytes", "EdgeResponseBytes", "EdgeResponseCompressionRatio",
                            "EdgeResponseContentType", "EdgeResponseStatus", "EdgeServerIP", "EdgeStartTimestamp", "EdgeTimeToFirstByteMs", "LeakedCredentialCheckResult",
                            "OriginDNSResponseTimeMs", "OriginIP", "OriginRequestHeaderSendDurationMs", "OriginResponseBytes", "OriginResponseDurationMs", "OriginResponseHTTPExpires",
                            "OriginResponseHTTPLastModified", "OriginResponseHeaderReceiveDurationMs", "OriginResponseStatus", "OriginResponseTime", "OriginSSLProtocol",
                            "OriginTCPHandshakeDurationMs", "OriginTLSHandshakeDurationMs", "ParentRayID", "RayID", "RequestHeaders", "ResponseHeaders", "SecurityAction",
                            "SecurityActions", "SecurityRuleDescription", "SecurityRuleID", "SecurityRuleIDs", "SecuritySources", "SmartRouteColoID", "UpperTierColoID",
                            "VerifiedBotCategory", "WAFAttackScore", "WAFFlags", "WAFMatchedVar", "WAFRCEAttackScore", "WAFSQLiAttackScore", "WAFXSSAttackScore",
                            "WorkerCPUTime", "WorkerScriptName", "WorkerStatus", "WorkerSubrequest", "WorkerSubrequestCount", "WorkerWallTimeUs", "ZoneName"
                        ],
                        timestamp_format: 'rfc3339'
                    },
                    destination_conf: config.logpushDestination || "https://across-candor.twister5.cf/api/logs",
                });
            }
        }
    } catch (error: any) {
        console.error('Failed to deploy Cloudflare Logpush:', error.response?.data || error.message);
    }
}


//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       建立DNS、更新DNS、刪除DNS        */
export async function dnsRecordService(type: 'create' | 'update' | 'delete', data: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { zone: zoneName, name: dnsRecord, content, type: dnsType, proxied, ttl, originalName, comment, tags, id } = data;
        const zone = await cfClient.get(`/zones?name=${zoneName}`);
        if (zone && zone.data && zone.data.result.length > 0) {
            const zoneId = zone.data.result[0].id;
            let dns: any = null;
            if (originalName) dns = await cfClient.get(`/zones/${zoneId}/dns_records?name=${originalName}`);
            else dns = await cfClient.get(`/zones/${zoneId}/dns_records?name=${dnsRecord}`);
            if (type === 'create') {
                if (dns && dns.data && dns.data.result && dns.data.result.length === 0) {
                    const resp = await cfClient.post(`/zones/${zoneId}/dns_records`, {
                        name: `${dnsRecord}`,
                        type: dnsType,
                        content: `${content}`,
                        proxied,
                        ttl,
                        comment: comment || '',
                        tags: tags && tags.length > 0 ? tags : []
                    })
                    return resp.data.result;
                } else {
                    console.log(`dnsRecord: ${dnsRecord} already exists`);
                    return dns.data.result[0]; // 返回已存在的記錄
                }
            } else if (type === 'update') {
                if (dns && dns.data && dns.data.result.length > 0) {
                    const dnsId = dns.data.result.find((item: any) => item.id === id)?.id;
                    const resp = await cfClient.patch(`/zones/${zoneId}/dns_records/${dnsId}`, {
                        name: `${dnsRecord}`,
                        type: dnsType,
                        content: `${content}`,
                        proxied,
                        ttl,
                        comment: comment || '',
                        tags: tags && tags.length > 0 ? tags : []
                    });
                    return resp.data.result;
                } else {
                    return dns.data.result;
                }
            } else if (type === 'delete') {
                if (dns && dns.data && dns.data.result.length > 0) {
                    const dnsId = dns.data.result.find((item: any) => item.id === id)?.id;
                    const resp = await cfClient.delete(`/zones/${zoneId}/dns_records/${dnsId}`);
                    // 刪除 WAF 規則集
                    const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                    if (ruleList && ruleList.data && ruleList.data.result) {
                        let ruleset = ruleList.data.result.find((item: any) => item.source === 'firewall_custom');
                        let ruleId = ruleset ? ruleset.id : '';
                        const firewallResp = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleId}`);
                        if (firewallResp && firewallResp.data && firewallResp.data.result) {
                            const rules = firewallResp.data.result.rules || [];
                            const domainNameRules = rules.filter((item: any) => item.description && (item.description === `black_ip_${dnsRecord}` || item.description === `white_ip_${dnsRecord}` || item.description === `country_${dnsRecord}`));
                            for (let rule of domainNameRules) {
                                await cfClient.delete(`/zones/${zoneId}/rulesets/${ruleId}/rules/${rule.id}`);
                            }
                        }

                        let cacheRuleset = ruleList.data.result.find((item: any) => item.phase === 'http_request_cache_settings');
                        const cacheRuleId = cacheRuleset.id;
                        let cacheRuleResp = await cfClient.get(`/zones/${zoneId}/rulesets/${cacheRuleId}`);
                        if (cacheRuleResp && cacheRuleResp.data && cacheRuleResp.data.result) {
                            let cacheRule = cacheRuleResp.data.result.rules?.find((item: any) => item.description === `cache_${dnsRecord}`);
                            if (cacheRule) {
                                await cfClient.delete(`/zones/${zoneId}/rulesets/${cacheRuleId}/rules/${cacheRule.id}`);
                            }
                        }
                    }
                    
                    return resp.data.result;
                } else {
                    return dns.data.result;
                }
            }
        }
    } catch (error: any) {
        console.log(error.response?.data || error.message);
        if (error.response && error.response.data && error.response.data.errors && error.response.data.errors.length > 0) {
            throw new Error(error.response.data.errors[0].message);
        } else {
            throw new Error('DNS record operation failed');
        }
    }
}

//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       Export and Import DNS Records        */
export async function exportZoneSubdomains(zones: any) {
    try {
        let exportResults: { zone: string; content: string }[] = [];
        let cfClient = await getCloudflareClient();
        for (let zone of zones as any[]) {
            const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
            if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
                const zoneId = cloudflareZone.data.result[0].id;
                const dnsExport = await cfClient.get(`/zones/${zoneId}/dns_records/export`);
                if (dnsExport && dnsExport.data) {
                    exportResults.push({
                        zone: zone,
                        content: dnsExport.data
                    });
                }
            }
        }
        return exportResults;
    } catch (error: any) {
        throw new Error(error.response.data?.errors[0]?.message)
    }
}

export async function importZoneSubdomains(data: any) {
    try {
        const { zone, content, proxied } = data;
        let cfClient = await getCloudflareClient();
        const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
        if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
            const zoneId = cloudflareZone.data.result[0].id;
            const formData = new FormData();
            formData.append('file', Buffer.from(content), {
                filename: 'dns_records.txt',
                contentType: 'text/plain'
            });
            formData.append('proxied', proxied ? 'true' : 'false');
            
            const resp = await cfClient.post(`/zones/${zoneId}/dns_records/import`, formData, {
                headers: {
                    ...formData.getHeaders()
                }
            });
            return resp.data;
        }
    } catch (error: any) {
        console.log(error)
        throw new Error(error.response.data?.errors[0]?.message)
    }
}

//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       Scan DNS Records When Create Zone        */
export async function scanDnsRecords(zoneId: string, cfClient: any) {
    try {
        const dnsTrigger = await cfClient.post(`/zones/${zoneId}/dns_records/scan/trigger`);
        if (dnsTrigger && dnsTrigger.data && dnsTrigger.data.success) {
            const dnsScan = await cfClient.post(`/zones/${zoneId}/dns_records/scan`);
        }
    } catch (error: any) {
        throw new Error(error.response.data?.errors[0]?.message)
    }
}


//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       SSL        */
export async function getCloudflareCertificateByZones(zones: any) {
    let cfClient = await getCloudflareClient();
    let certificates: any[] = [];
    for (let zone of zones) {
        const zoneResp = await cfClient.get(`/zones?name=${zone}`);
        if (zoneResp && zoneResp.data && zoneResp.data.result.length > 0) {
            const zoneId = zoneResp.data.result[0].id;
            const certificateList = await cfClient.get(`/zones/${zoneId}/ssl/certificate_packs`);
            if (certificateList && certificateList.data && certificateList.data.result.length > 0) {
                certificates = certificateList.data.result.map((item: any) => ({ ...item, zone: zone }))
            }
        }
    }
    return certificates;
}

export async function uploadCustomCertificate(data: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { certificate, privateKey, combinationMethod, legacyClientSupport, zone } = data;
        console.log(data)
        const zoneResp = await cfClient.get(`/zones?name=${zone}`);
        if (zoneResp && zoneResp.data && zoneResp.data.result.length > 0) {
            const zoneId = zoneResp.data.result[0].id;
            const resp = await cfClient.post(`/zones/${zoneId}/custom_certificates`, {
                certificate: certificate,
                private_key: privateKey,
                bundle_method: combinationMethod,
                type: legacyClientSupport,
            });
            return resp.data.result;
        }
    } catch (error: any) {
        console.error('Failed to upload custom certificate:', error.response?.data || error.message);
        throw new Error(error.response.data?.errors[0]?.message)
    }
}

export async function deleteCustomCertificate(data: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { zone, certificateId } = data;
        const zoneResp = await cfClient.get(`/zones?name=${zone}`);
        if (zoneResp && zoneResp.data && zoneResp.data.result.length > 0) {
            const zoneId = zoneResp.data.result[0].id;
            const resp = await cfClient.delete(`/zones/${zoneId}/custom_certificates/${certificateId}`);
            return resp.data.result;
        }
    } catch (error: any) {
        console.error('Failed to delete custom certificate:', error.response?.data || error.message);
        throw new Error(error.response.data?.errors[0]?.message)
    }
}


//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       解析 Cloudflare Expression 字符串        */
async function parseCloudflareExpression(expression: string, type: 'ip' | 'country', action?: string) {
    try {
        // 解析 host 部分
        const hostMatch = expression.match(/http\.host eq "([^"]+)"/);
        const host = hostMatch ? hostMatch[1] : '';

        // 解析 IP 地址部分
        if (type === 'ip') {
            const ipMatch = expression.match(/ip\.src in \{([^}]+)\}/);
            const ips = ipMatch ? ipMatch[1].trim().split(/\s+/) : [];
            
            return {
                name: host,
                ip: ips
            };
        } else if (type === 'country') {
            const countryMatch = expression.match(/ip\.src\.country in \{([^}]+)\}/);
            const countries = countryMatch ? countryMatch[1].trim().split(/\s+/).map(code => code.replace(/"/g, '')) : [];

            const geolocationList = await getGeolocationList();
            const countryList = geolocationList.map((item: any) => { return { name: item.name, code: item.code } });
            let newCountryList = [];
            for (let country of countries) {
                const countryName = countryList.find((item: any) => item.code === country)?.name;
                if (countryName) {
                    newCountryList.push({ code: country, name: countryName, accessMode: action  });
                }
            }

            return {
                name: host,
                country: newCountryList
            };
        }
        
        return { name: '' };
    } catch (error) {
        console.error('Error parsing Cloudflare expression:', error);
        return { name: '' };
    }
}

//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       取得黑名單、白名單、國別阻擋現有設定        */
export async function getWafPolicySettings(zones: any) {
    try {
        let cfClient = await getCloudflareClient();
        let blackIpList: any = {};
        let whiteIpList: any = {};
        let countryList: any = {};
        for (let zone of zones) {
            const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
            if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
                const zoneId = cloudflareZone.data.result[0].id;
                
                const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (ruleList && ruleList.data && ruleList.data.result) {
                    let ruleset = ruleList.data.result.find((item: any) => item.source === 'firewall_custom');
                    let ruleId = ruleset ? ruleset.id : '';
                    const firewallResp = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleId}`);
                    if (firewallResp && firewallResp.data && firewallResp.data.result) {
                        const rules = firewallResp.data.result.rules || [];
                        
                        // 取得黑名單
                        const blackListRules = rules.filter((item: any) => item.description && item.description.includes('black_ip_'));
                        for (let rule of blackListRules) {
                            const parsedRule = await parseCloudflareExpression(rule.expression, 'ip');
                            if (parsedRule && parsedRule.name && parsedRule.ip && parsedRule.ip.length > 0) {
                                blackIpList[parsedRule.name] = parsedRule.ip;
                            }
                        }

                        // 取得白名單
                        const whiteListRules = rules.filter((item: any) => item.description && item.description.includes('white_ip_'));
                        for (let rule of whiteListRules) {
                            const parsedRule = await parseCloudflareExpression(rule.expression, 'ip');
                            if (parsedRule && parsedRule.name && parsedRule.ip && parsedRule.ip.length > 0) {
                                whiteIpList[parsedRule.name] = parsedRule.ip;
                            }
                        }

                        // 取得國別阻擋
                        const countryRules = rules.filter((item: any) => item.description && item.description.includes('country_'));
                        for (let rule of countryRules) {
                            const parsedRule = await parseCloudflareExpression(rule.expression, 'country', rule.expression.includes('not') ? 'allow' : 'block');
                            if (parsedRule && parsedRule.name && parsedRule.country && parsedRule.country.length > 0) {
                                countryList[parsedRule.name] = parsedRule.country;
                            }
                        }
                    }
                }
            }
        }
        return { blackIpList, whiteIpList, countryList };
    } catch (error: any) {
        console.error('Failed to get WAF policy settings by zones:', error.response?.data || error.message);
        throw Error(error);
    }
}

//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       黑名單IP        */
export async function createBlackListIp(settings: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { blackIpList, subdomains } = settings;
        for (let subdomain of subdomains) {
            const zone = subdomain.zone
            const zoneResp = await cfClient.get(`/zones?name=${zone}`);
            if (zoneResp && zoneResp.data && zoneResp.data.result.length > 0) {
                const zoneId = zoneResp.data.result[0].id;
                
                const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (ruleList && ruleList.data && ruleList.data.result.length > 0) {
                    let ruleset = ruleList.data.result.find((item: any) => item.source === 'firewall_custom');
                    let ruleId = ruleset ? ruleset.id : '';
                    if (!ruleset) {
                        ruleId = await deployFirewallCustomRuleset(zoneId, cfClient);
                    }
                    const rules = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleId}`);
                    if (rules && rules.data && rules.data.result) {
                        const domainName = subdomain.name;
                        let expressionBlackList = '';
                        if (blackIpList.length > 0) {
                            const ipList = blackIpList.join(' ');
                            expressionBlackList = `(ip.src in {${ipList}} and http.host eq "${domainName}")`;
                        }
                        const blackIpRule = (rules.data.result.rules || []).filter((item: any) => item.description === `black_ip_${domainName}`);
                        const whiteIpRule = (rules.data.result.rules || []).filter((item: any) => item.description.includes(`white_ip_`));
                        if (expressionBlackList !== '') {
                            if (blackIpRule.length > 0) {
                                const blackIpRuleId = blackIpRule[0].id;
                                await cfClient.patch(`/zones/${zoneId}/rulesets/${ruleId}/rules/${blackIpRuleId}`, { 
                                    description: `black_ip_${domainName}`,
                                    action: 'block',
                                    expression: expressionBlackList,
                                    enabled: true,
                                });
                            } else {
                                await cfClient.post(`/zones/${zoneId}/rulesets/${ruleId}/rules`, { 
                                    description: `black_ip_${domainName}`,
                                    action: 'block',
                                    expression: expressionBlackList,
                                    enabled: true,
                                    ...(whiteIpRule && whiteIpRule.length > 0 ? {
                                        position: {
                                            after: whiteIpRule[whiteIpRule.length - 1].id
                                        }
                                    } : {})
                                });
                            }
                        } else {
                            if (blackIpRule.length > 0) {
                                const blackIpRuleId = blackIpRule[0].id;
                                await cfClient.delete(`/zones/${zoneId}/rulesets/${ruleId}/rules/${blackIpRuleId}`);
                            }
                        }
                    }
                }
                
            }
        }

    } catch (error: any) {
        throw new Error(error.response.data?.errors[0]?.message)
    }
}


//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       白名單IP        */
export async function createWhiteListIp(settings: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { whiteIpList, subdomains } = settings;
        for (let subdomain of subdomains) {
            const zone = subdomain.zone;
            const zoneResp = await cfClient.get(`/zones?name=${zone}`);
            if (zoneResp && zoneResp.data && zoneResp.data.result.length > 0) {
                const zoneId = zoneResp.data.result[0].id;
                
                const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (ruleList && ruleList.data && ruleList.data.result.length > 0) {
                    let ruleset = ruleList.data.result.find((item: any) => item.source === 'firewall_custom');
                    let ruleId = ruleset ? ruleset.id : '';
                    if (!ruleset) {
                        ruleId = await deployFirewallCustomRuleset(zoneId, cfClient);
                    }
                    const rules = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleId}`);
                    if (rules && rules.data && rules.data.result) {
                        const domainName = subdomain.name;
                        let expressionWhiteList = '';
                        if (whiteIpList.length > 0) {
                            const ipList = whiteIpList.join(' ');
                            expressionWhiteList = `(ip.src in {${ipList}} and http.host eq "${domainName}")`;
                        }

                        const whiteIpRule = (rules.data.result.rules || []).filter((item: any) => item.description === `white_ip_${domainName}`);
                        const blackIpRule = (rules.data.result.rules || []).filter((item: any) => item.description.includes(`black_ip_`));
                        if (expressionWhiteList !== '') {
                            if (whiteIpRule.length > 0) {
                                const whiteIpRuleId = whiteIpRule[0].id;
                                await cfClient.patch(`/zones/${zoneId}/rulesets/${ruleId}/rules/${whiteIpRuleId}`, { 
                                    description: `white_ip_${domainName}`,
                                    action: 'skip',
                                    action_parameters: {
                                        phases: [
                                            'http_request_firewall_managed'
                                        ],
                                        ruleset: 'current'
                                    },
                                    expression: expressionWhiteList,
                                    enabled: true,
                                    logging: {
                                        enabled: true
                                    },
                                });
                            } else {
                                await cfClient.post(`/zones/${zoneId}/rulesets/${ruleId}/rules`, { 
                                    description: `white_ip_${domainName}`,
                                    action: 'skip',
                                    action_parameters: {
                                        phases: [
                                            'http_request_firewall_managed'
                                        ],
                                        ruleset: 'current'
                                    },
                                    expression: expressionWhiteList,
                                    enabled: true,
                                    logging: {
                                        enabled: true
                                    },
                                    ...(blackIpRule && blackIpRule.length > 0 ? {
                                        position: {
                                            before: blackIpRule[0].id
                                        }
                                    } : {})
                                });
                            }
                        } else {
                            if (whiteIpRule.length > 0) {
                                const whiteIpRuleId = whiteIpRule[0].id;
                                await cfClient.delete(`/zones/${zoneId}/rulesets/${ruleId}/rules/${whiteIpRuleId}`);
                            }
                        }
                    }
                }
                
            }
        }

    } catch (error: any) {
        throw new Error(error.response.data?.errors[0]?.message)
    }
}


//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       國別阻檔        */
export async function createGeolocationList(settings: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { countryList, countryAccessMode, subdomains } = settings;
        for (let subdomain of subdomains) {
            const zone = subdomain.zone;
            const zoneResp = await cfClient.get(`/zones?name=${zone}`);
            if (zoneResp && zoneResp.data && zoneResp.data.result.length > 0) {
                const zoneId = zoneResp.data.result[0].id;
                
                const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (ruleList && ruleList.data && ruleList.data.result.length > 0) {
                    let ruleset = ruleList.data.result.find((item: any) => item.source === 'firewall_custom');
                    let ruleId = ruleset ? ruleset.id : '';
                    if (!ruleset) {
                        ruleId = await deployFirewallCustomRuleset(zoneId, cfClient);
                    }
                    const rules = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleId}`);
                    if (rules && rules.data && rules.data.result) {
                        const domainName = subdomain.name;
                        let expressionList = '';
                        if (countryList.length > 0) {
                            let geoCodes = countryList.map((item: any) => { return `"${item.code}"` }).join(' ');
                            if (countryAccessMode === 'block') {
                                expressionList = `(ip.src.country in {${geoCodes}} and http.host eq "${domainName}" )`;
                            } else {
                                expressionList = `(not ip.src.country in {${geoCodes}} and http.host eq "${domainName}" )`;
                            }
                        }

                        const countryRule = (rules.data.result.rules || []).filter((item: any) => item.description === `country_${domainName}`);
                        const blackIpRule = (rules.data.result.rules || []).filter((item: any) => item.description.includes(`black_ip_`));
                        if (expressionList !== '') {
                            if (countryRule.length > 0) {
                                const countryRuleId = countryRule[0].id;
                                await cfClient.patch(`/zones/${zoneId}/rulesets/${ruleId}/rules/${countryRuleId}`, { 
                                    description: `country_${domainName}`,
                                    action: 'block',
                                    expression: expressionList,
                                    enabled: true,
                                });
                            } else {
                                await cfClient.post(`/zones/${zoneId}/rulesets/${ruleId}/rules`, { 
                                    description: `country_${domainName}`,
                                    action: 'block',
                                    expression: expressionList,
                                    enabled: true,
                                    ...(blackIpRule && blackIpRule.length > 0 ? {
                                        position: {
                                            after: blackIpRule[blackIpRule.length - 1].id
                                        }
                                    } : {})
                                });
                            }
                        } else {
                            if (countryRule.length > 0) {
                                const countryRuleId = countryRule[0].id;
                                await cfClient.delete(`/zones/${zoneId}/rulesets/${ruleId}/rules/${countryRuleId}`);
                            }
                        }
                    }
                }
            }
        }

    } catch (error: any) {
        throw new Error(error.response.data?.errors[0]?.message)
    }
}



export async function getCloudflareDDoSSensitivity(zones: any) {
    try {
        let cfClient = await getCloudflareClient();
        let ddosL7RuleList = [];
        for (let zone of zones) {
            const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
            if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
                const zoneId = cloudflareZone.data.result[0].id;
                const rulesets = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (rulesets && rulesets.data && rulesets.data.result.length > 0) {
                    // rule in ruleset
                    let ddosL7Rule = rulesets.data.result.find((item: any) => item.name === "ddos_l7");
                    if (!ddosL7Rule) {
                        await deployDDoSOverrideRuleset(zoneId, cfClient);
                        const newRulesets = await cfClient.get(`/zones/${zoneId}/rulesets`);
                        ddosL7Rule = newRulesets?.data?.result?.find((item: any) => item.name === "ddos_l7");
                    }
                    const ddosL7RuleId = ddosL7Rule.id;
                    // 取得 DDoS L7 Override 規則
                    let ddosL7RuleResp = await cfClient.get(`/zones/${zoneId}/rulesets/${ddosL7RuleId}`);
                    console.log(ddosL7RuleResp)
                    let ddosL7RuleOverride = ddosL7RuleResp.data.result.rules.find((item: any) => item.description === "default_rule");
                    console.log(ddosL7RuleOverride)
                    if (!ddosL7RuleOverride) {
                        await cfClient.post(`/zones/${zoneId}/rulesets/${ddosL7RuleId}/rules`, {
                            description: 'default_rule',
                            action: 'execute',
                            action_parameters: {
                                id: '4d21379b4f9f4bb088e0729962c8b3cf',
                                overrides: {
                                    sensitivity_level: 'default'
                                }
                            },
                            enabled: true,
                            expression: 'true'
                        });
                        ddosL7RuleResp = await cfClient.get(`/zones/${zoneId}/rulesets/${ddosL7RuleId}`);
                        ddosL7RuleOverride = ddosL7RuleResp.data.result.rules.find((item: any) => item.description === "default_rule");
                    }
                    
                    const sensitivityLevel = ddosL7RuleOverride.action_parameters?.overrides?.sensitivity_level;
                    ddosL7RuleList.push({
                        name: zone,
                        sensitivityLevel: sensitivityLevel === 'default' ? '3'
                        : sensitivityLevel === 'medium' ? '2'
                        : sensitivityLevel === 'low' ? '1'
                        : '3'
                    });
                }
            }
        }
        return ddosL7RuleList;
    } catch (error: any) {
        throw new Error(error.response.data?.errors[0]?.message)
    }
}

export async function updateDDoSSensitivity(data: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { zone, sensitivityLevel } = data;
        const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
        if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
            const zoneId = cloudflareZone.data.result[0].id;
            const rulesets = await cfClient.get(`/zones/${zoneId}/rulesets`);
            if (rulesets && rulesets.data && rulesets.data.result.length > 0) {
                let ddosL7Rule = rulesets.data.result.find((item: any) => item.name === "ddos_l7");
                if (ddosL7Rule) {
                    const ddosL7RuleId = ddosL7Rule.id;
                    const ddosL7RuleResp = await cfClient.get(`/zones/${zoneId}/rulesets/${ddosL7RuleId}`);
                    if (ddosL7RuleResp && ddosL7RuleResp.data && ddosL7RuleResp.data.result && ddosL7RuleResp.data.result.rules && ddosL7RuleResp.data.result.rules.length > 0) {
                        const ddosL7OverrideRuleId = ddosL7RuleResp.data.result.rules.find((item: any) => item.description === "default_rule")?.id;
                        const resp = await cfClient.patch(`/zones/${zoneId}/rulesets/${ddosL7RuleId}/rules/${ddosL7OverrideRuleId}`, {
                            description: "default_rule",
                            action: "execute",
                            enabled: true,
                            expression: "true",
                            action_parameters: {
                                id: '4d21379b4f9f4bb088e0729962c8b3cf',
                                overrides: {
                                    sensitivity_level: sensitivityLevel === '3' ? 'default'
                                    : sensitivityLevel === '2' ? 'medium'
                                    : sensitivityLevel === '1' ? 'low'
                                    : 'default'
                                }
                            }
                        });
                        return resp.data;
                    } else {
                        const resp = await cfClient.post(`/zones/${zoneId}/rulesets/${ddosL7RuleId}/rules`, {
                            description: "default_rule",
                            action: "execute",
                            enabled: true,
                            expression: "true",
                            action_parameters: {
                                id: '4d21379b4f9f4bb088e0729962c8b3cf',
                                overrides: {
                                    sensitivity_level: sensitivityLevel === '3' ? 'default'
                                    : sensitivityLevel === '2' ? 'medium'
                                    : sensitivityLevel === '1' ? 'low'
                                    : 'default'
                                }
                            }
                        });
                        return resp.data;
                    }
                }
            }
        }
    } catch (error: any) {
        throw new Error(error.response.data?.errors[0]?.message)
    }
}

export async function getCdnCacheByDomains(zones: any) {
    try {
        let cfClient = await getCloudflareClient();
        const dnsList = await getCloudflareDnsByZones(zones);
        let cdnRuleList = [];
        
        // 1. 使用簡單的 Map 來快取已經抓取過的 zoneId 和 rulesetData
        const zoneCache = new Map();
        const rulesetCache = new Map();

        for (let domain of dnsList) {
            if (domain.type !== 'CNAME' && domain.type !== 'AAAA' && domain.type !== 'A') continue;
            const zoneName = domain.zone;
            const domainName = domain.name;

            // 2. 檢查快取，避免重複請求 /zones
            let zoneId = zoneCache.get(zoneName);
            if (!zoneId) {
                const cloudflareZone = await cfClient.get(`/zones?name=${zoneName}`);
                if (cloudflareZone?.data?.result?.[0]) {
                    zoneId = cloudflareZone.data.result[0].id;
                    zoneCache.set(zoneName, zoneId);
                }
            }

            if (zoneId) {
                // 3. 檢查快取，避免重複請求 /rulesets 和詳情
                let rulesetData = rulesetCache.get(zoneId);
                if (!rulesetData) {
                    const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                    let ruleset = ruleList?.data?.result?.find((item: any) => item.phase === 'http_request_cache_settings');
                    
                    if (!ruleset) {
                        await deployCacheRuleset(zoneId, cfClient);
                        const newRuleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                        ruleset = newRuleList?.data?.result?.find((item: any) => item.phase === 'http_request_cache_settings');
                    }

                    if (ruleset) {
                        const cacheRuleResp = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleset.id}`);
                        rulesetData = cacheRuleResp.data.result;
                        rulesetCache.set(zoneId, rulesetData);
                    }
                }

                // 4. 從快取的 rulesetData 中找尋當前 domain 的規則
                if (rulesetData) {
                    let cacheRule = rulesetData.rules?.find((item: any) => item.description === `cache_${domainName}`);
                    if (!cacheRule) {
                        cdnRuleList.push({
                            name: domainName,
                            zone: zoneName,
                            cdnCache: { /* 預設值 */ }
                        });
                    } else {
                        const conditions = parseCdnRuleExpression(cacheRule.expression);
                        cdnRuleList.push({
                            name: domainName,
                            zone: zoneName,
                            cdnCache: {
                                browser_ttl: cacheRule.action_parameters?.browser_ttl,
                                cache: cacheRule.action_parameters?.cache === true ? 'true' : 'false',
                                edge_ttl: cacheRule.action_parameters?.edge_ttl,
                                conditions: conditions
                            }
                        });
                    }
                }
            }
        }
        return cdnRuleList;
    } catch (error: any) {
        throw new Error(error.response?.data?.errors?.[0]?.message || error.message);
    }
}


//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       Cache Purge        */
export async function updateCachePurgeRuleset(data: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { name: domainName, zone: zoneName, cdnCache } = data;
        const { browser_ttl, edge_ttl, cache, conditions } = cdnCache;
        const zone = await cfClient.get(`/zones?name=${zoneName}`);
        if (zone && zone.data && zone.data.result.length > 0) {
            const zoneId = zone.data.result[0].id;
            const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
            if (ruleList && ruleList.data && ruleList.data.result.length > 0) {
                let ruleset = ruleList.data.result.find((item: any) => item.phase === 'http_request_cache_settings');
                if (!ruleset) {
                    await deployCacheRuleset(zoneId, cfClient);
                    const newRuleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                    ruleset = newRuleList.data.result.find((item: any) => item.phase === 'http_request_cache_settings');
                }
                const cacheRuleId = ruleset.id;
                // 取得 Cache 規則
                let cacheRuleResp = await cfClient.get(`/zones/${zoneId}/rulesets/${cacheRuleId}`);
                let cacheRule = cacheRuleResp.data.result.rules?.find((item: any) => item.description === `cache_${domainName}`);

                // 處理 cache condition
                const buildConditionExpr = (condition: any): string => {
                    if (condition.field === 'full_uri') {
                        if (condition.operator === 'wildcard') {
                            return `http.request.full_uri wildcard r"${condition.value}"`;
                        } else if (condition.operator === 'not_contains') {
                            return `not http.request.full_uri contains "${condition.value}"`;
                        } else if (condition.operator === 'starts_with') {
                            return `starts_with(http.request.full_uri, "${condition.value}")`;
                        } else if (condition.operator === 'ends_with') {
                            return `ends_with(http.request.full_uri, "${condition.value}")`;
                        } else {
                            return `http.request.full_uri ${condition.operator} "${condition.value}"`;
                        }
                    } else {
                        if (condition.operator === 'in') {
                            const values = condition.value.split(',').map((v: string) => v.trim());
                            return `http.request.uri.path.extension in {"${values.join('" "')}"}`;
                        } else if (condition.operator === 'not_in') {
                            const values = condition.value.split(',').map((v: string) => v.trim());
                            return `not http.request.uri.path.extension in {"${values.join('" "')}"}`;
                        } else {
                            return `http.request.uri.path.extension ${condition.operator} "${condition.value}"`;
                        }
                    }
                };
                let expression = '';
                if (conditions.length > 0) {
                    // 按順序將條件分組: 遇到 or 就開始新群組，and 則加入當前群組
                    // 例如: A and B or C and D => [(A, B), (C, D)]
                    const groups: any[][] = [];
                    let currentGroup: any[] = [];

                    for (let condition of conditions) {
                        if (condition.logicalOperator === 'or') {
                            // or 開始新群組，先把當前群組存起來
                            if (currentGroup.length > 0) {
                                groups.push(currentGroup);
                            }
                            currentGroup = [condition];
                        } else {
                            // 第一個條件或 and 條件，加入當前群組
                            currentGroup.push(condition);
                        }
                    }
                    // 最後一個群組
                    if (currentGroup.length > 0) {
                        groups.push(currentGroup);
                    }
                    
                    const groupExpressions = groups.map(group => {
                        const groupExpr = group.map(cond => buildConditionExpr(cond)).join(' and ');
                        return `(${groupExpr} and http.host eq "${domainName}")`;
                    });
                    
                    expression = groupExpressions.join(' or ');
                }
                
                // cache rule exist
                if (cacheRule) {
                    const cacheRuleId2 = cacheRule.id;
                    const resp = await cfClient.patch(`/zones/${zoneId}/rulesets/${cacheRuleId}/rules/${cacheRuleId2}`, {
                        description: `cache_${domainName}`,
                        action: 'set_cache_settings',
                        action_parameters: {
                            cache: cache === 'true' || cache === true ? true : false,
                            ...(cache === 'true' || cache === true ? {
                                browser_ttl: {
                                    mode: browser_ttl.mode,
                                    ...(browser_ttl.mode === 'override_origin' ? {
                                        default: Number(browser_ttl.default)
                                    } : {})
                                },
                                edge_ttl: {
                                    mode: edge_ttl.mode,
                                    ...(edge_ttl.mode === 'override_origin' ? {
                                        default: Number(edge_ttl.default)
                                    } : {})
                                },
                            } : {})
                        },
                        enabled: true,
                        expression: conditions.length > 0 ? expression : `(http.host eq "${domainName}")`
                    });
                    return resp.data;
                } else {
                    const resp = await cfClient.post(`/zones/${zoneId}/rulesets/${cacheRuleId}/rules`, {
                        description: `cache_${domainName}`,
                        action: 'set_cache_settings',
                        action_parameters: {
                            cache: cache === 'true' || cache === true ? true : false,
                            ...(cache === 'true' || cache === true ? {
                                browser_ttl: {
                                    mode: browser_ttl.mode,
                                    ...(browser_ttl.mode === 'override_origin' ? {
                                        default: Number(browser_ttl.default)
                                    } : {})
                                },
                                edge_ttl: {
                                    mode: edge_ttl.mode,
                                    ...(edge_ttl.mode === 'override_origin' ? {
                                        default: Number(edge_ttl.default)
                                    } : {})
                                },
                            } : {})
                        },
                        enabled: true,
                        expression: conditions.length > 0 ? expression : `(http.host eq "${domainName}")`
                    });
                    return resp.data;
                }
            }
        }
    } catch (error: any) {
        console.log(error.response.data)
        throw new Error(error.response.data?.errors[0]?.message)
    }
}

export async function purgeCdnCache(data: any) {
    try {
        console.log('aaaaaaaa')
        console.log('aaaaaaaa')
        console.log('aaaaaaaa')
        console.log('aaaaaaaa')
        console.log('aaaaaaaa')
        console.log(data);
        let cfClient = await getCloudflareClient();
        const { zone: zoneName, purge_everything, files, hosts } = data;
        const zone = await cfClient.get(`/zones?name=${zoneName}`);
        if (zone && zone.data && zone.data.result.length > 0) {
            const zoneId = zone.data.result[0].id;
            let resp: any = null;
            if (purge_everything) {
                // purge everything
                resp = await cfClient.post(`/zones/${zoneId}/purge_cache`, {
                    purge_everything: true
                });
            } else {
                // purge by URL
                if (files && files.length > 0) {
                    resp = await cfClient.post(`/zones/${zoneId}/purge_cache`, {
                        files: files
                    });
                } else if (hosts && hosts.length > 0) {
                    resp = await cfClient.post(`/zones/${zoneId}/purge_cache`, {
                        hosts: hosts
                    });
                } else {
                    throw new Error('No files or hosts provided');
                }
            }
            if (resp && resp.data && resp.data.success) {
                return resp.data;
            } else {
                throw new Error(resp.data?.errors[0]?.message || 'Failed to purge cache');
            }
        }
    } catch (error: any) {
        console.log('bbbbbbbb')
        console.log(error)
        throw new Error(error.response.data?.errors[0]?.message)
    }
}

export async function getContractTrafficRequest(zones: any[], startDate: string, endDate: string) {
    try {
        let cfClient = await getCloudflareClient();
        const request: any = {};
        
        for (let zone of zones) {
            const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
            if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
                const zoneId = cloudflareZone.data.result[0].id;
                const query = `
                    query {
                        viewer {
                            zones(filter: { zoneTag: "${zoneId}" }) {
                                httpRequests1dGroups(
                                    limit: 31,
                                    filter: { date_gt: "${startDate}", date_lt: "${endDate}" }
                                ) {
                                    dimensions { date }
                                    sum { requests bytes cachedBytes threats }
                                }
                            }
                        }
                    }
                `;

                const zoneData = await cfClient.post(`/graphql`, { query });
                
                if (zoneData.data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups) {
                    const groups = zoneData.data.data.viewer.zones[0].httpRequests1dGroups;
                    
                    // 計算當月總流量
                    let monthlyTotal = {
                        requests: 0,
                        bytes: 0,
                        cachedBytes: 0,
                        threats: 0,
                        days: 0
                    };
                    
                    groups.forEach((group: any) => {
                        monthlyTotal.requests += group.sum.requests || 0;
                        monthlyTotal.bytes += group.sum.bytes || 0;
                        monthlyTotal.cachedBytes += group.sum.cachedBytes || 0;
                        monthlyTotal.threats += group.sum.threats || 0;
                        monthlyTotal.days += 1;
                    });
                    
                    console.log(`${zone} 當月總計:`, monthlyTotal);
                    
                    request[zone] = monthlyTotal;
                }
            }
        }

        return request;
    } catch (error: any) {
        throw new Error(error.response.data?.errors[0]?.message)
    }
}

export async function getContractTrafficRequestByDays(zones: any[], days: number, startDate: string, endDate: string) {
    try {
        let cfClient = await getCloudflareClient();
        const request = [];
        
        for (let zone of zones) {
            const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
            if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
                const zoneId = cloudflareZone.data.result[0].id;

                const query = `
                    query {
                        viewer {
                            zones(filter: { zoneTag: "${zoneId}" }) {
                                httpRequests1dGroups(
                                    limit: ${days},
                                    filter: { date_gt: "${startDate}", date_lt: "${endDate}" }
                                ) {
                                    dimensions { date }
                                    sum { requests bytes }
                                }
                            }
                        }
                    }
                `;

                const zoneData = await cfClient.post(`/graphql`, { query });
                
                if (zoneData.data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups) {
                    const groups = zoneData.data.data.viewer.zones[0].httpRequests1dGroups;
                    
                    // 計算當月總流量
                    let monthlyTotal = {
                        requests: 0,
                        bytes: 0,
                        days: 0,
                        zone: zone
                    };
                    
                    groups.forEach((group: any) => {
                        monthlyTotal.requests += group.sum.requests || 0;
                        monthlyTotal.bytes += group.sum.bytes || 0;
                        monthlyTotal.days += 1;
                    });
                    request.push(monthlyTotal);
                }
            }
        }

        return request;
    } catch (error: any) {
        throw new Error(error.response.data?.errors[0]?.message)
    }
}

export async function checkCloudflareLogPush() {
    try {
        let cfClient = await getCloudflareClient();
        const zones = await getActivatedZones();
        let zoneNames = zones.map((item: any) => item.zone);
        for (let zone of zoneNames as any[]) {
            const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
            if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
                const zoneId = cloudflareZone.data.result[0].id;
                const logPushResp = await cfClient.get(`/zones/${zoneId}/logpush/jobs`);
                if (logPushResp && logPushResp.data && logPushResp.data.result.length > 0) {
                    const logPushs = logPushResp.data.result.filter((item: any) => item.enabled === false);
                    console.log(`${zone} logpush is disabled: ${logPushs.join(', ')}`)
                    for (let logPush of logPushs) {
                        await cfClient.put(`/zones/${zoneId}/logpush/jobs/${logPush.id}`, {
                            enabled: true
                        });
                    }
                }
            }
        }
    } catch (error: any) {
        console.log(error.response.data)
        throw new Error(error.response.data?.errors[0]?.message)
    }
}

//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       解析 Cloudflare Expression 字符串        */
async function parseCloudflareBotExpression(expression: string, type: 'known' | 'verified', action?: string) {
    try {
        // 解析 host 部分
        const hostMatch = expression.match(/http\.host eq "([^"]+)"/);
        const host = hostMatch ? hostMatch[1] : '';

        // 解析 is or not
        if (type === 'known') {
            return {
                name: host,
                value: expression.includes('not cf.client.bot') ? false : true,
            };
        } else if (type === 'verified') {
            let operatorType = '';
            let value: string[] = [];
            // 情境1: not ... in {...}
            // ex: (not cf.verified_bot_category in {"Search Engine Crawler" "Monitoring & Analytics"})
            const notInMatch = expression.match(/not\s+cf\.verified_bot_category\s+in\s+\{([^}]+)\}/);
            if (notInMatch) {
                operatorType = 'not in';
                const valuesStr = notInMatch[1];
                value = valuesStr.match(/"([^"]+)"/g)?.map(v => v.replace(/"/g, '')) || [];
            } else {
                // 情境3: in {...}
                // ex: (cf.verified_bot_category in {"Search Engine Crawler" "Monitoring & Analytics"})
                const inMatch = expression.match(/cf\.verified_bot_category\s+in\s+\{([^}]+)\}/);
                if (inMatch) {
                    operatorType = 'in';
                    const valuesStr = inMatch[1];
                    value = valuesStr.match(/"([^"]+)"/g)?.map(v => v.replace(/"/g, '')) || [];
                } 
                // 情境1 & 2: eq 或 ne (單一值)
                // ex: (cf.verified_bot_category eq "Search Engine Crawler")
                // ex: (cf.verified_bot_category ne "Search Engine Crawler")
                else {
                    const singleMatch = expression.match(/cf\.verified_bot_category\s+(eq|ne)\s+"([^"]+)"/);
                    if (singleMatch) {
                        operatorType = singleMatch[1]; 
                        value = [singleMatch[2]];
                    }
                }
            }

            return {
                name: host,
                type: operatorType,
                value: value
            };
        }
        
        return { name: '' };
    } catch (error) {
        console.error('Error parsing Cloudflare Bot expression:', error);
        return { name: '' };
    }
}

//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       取得 Known Bot / Verified Bot Category 設定        */
export async function getBotPolicySettings(zones: any) {
    try {
        let cfClient = await getCloudflareClient();
        let knownBotList: any = {};
        let verifiedCategoryList: any = {};
        for (let zone of zones) {
            const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
            if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
                const zoneId = cloudflareZone.data.result[0].id;
                
                const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (ruleList && ruleList.data && ruleList.data.result) {
                    let ruleset = ruleList.data.result.find((item: any) => item.source === 'firewall_custom');
                    let ruleId = ruleset ? ruleset.id : '';
                    const firewallResp = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleId}`);
                    if (firewallResp && firewallResp.data && firewallResp.data.result) {
                        const rules = firewallResp.data.result.rules || [];
                        
                        // 取得 Known Bot
                        const knownBotRules = rules.filter((item: any) => item.description && item.description.includes('known_bot_'));
                        for (let rule of knownBotRules) {
                            const parsedRule = await parseCloudflareBotExpression(rule.expression, 'known');
                            if (parsedRule && parsedRule.name) {
                                knownBotList[parsedRule.name] = {
                                    type: parsedRule.type,
                                    value: parsedRule.value,
                                    action: rule.action
                                };
                            }
                        }
                        // 取得 Verified Bot Category
                        const verifiedCategoryRules = rules.filter((item: any) => item.description && item.description.includes('verified_bot_'));
                        for (let rule of verifiedCategoryRules) {
                            const parsedRule = await parseCloudflareBotExpression(rule.expression, 'verified');
                            console.log(parsedRule)
                            if (parsedRule && parsedRule.name && parsedRule.type && parsedRule.value) {
                                verifiedCategoryList[parsedRule.name] = {
                                    type: parsedRule.type,
                                    value: parsedRule.value,
                                    action: rule.action
                                };
                            }
                        }
                    }
                }
            }
        }
        return { knownBotList, verifiedCategoryList };
    } catch (error: any) {
        console.error('Failed to get Bot policy settings by zones:', error.response?.data || error.message);
        throw Error(error);
    }
}

// //＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
// /*       已知的機器人 （position最下面）        */
export async function createKnownBotRule(data: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { knownBotRule, subdomains } = data;
        for (let subdomain of subdomains) {
            const zone = subdomain.zone;
            const zoneResp = await cfClient.get(`/zones?name=${zone}`);
            if (zoneResp && zoneResp.data && zoneResp.data.result.length > 0) {
                const zoneId = zoneResp.data.result[0].id;
                const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (ruleList && ruleList.data && ruleList.data.result.length > 0) {
                    let ruleset = ruleList.data.result.find((item: any) => item.source === 'firewall_custom');
                    let ruleId = ruleset ? ruleset.id : '';
                    if (!ruleset) {
                        ruleId = await deployFirewallCustomRuleset(zoneId, cfClient);
                    }
                    const rules = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleId}`);
                    if (rules && rules.data && rules.data.result) {
                        const domainName = subdomain.name;
                        let expressionKnownBot = '';
                        if (knownBotRule) {
                            if (knownBotRule.value) {
                                expressionKnownBot = `(cf.client.bot and http.host eq "${domainName}")`;
                            } else {
                                expressionKnownBot = `(not cf.client.bot and http.host eq "${domainName}")`;
                            }
                        } 
                        const existRule = (rules.data.result.rules || []).filter((item: any) => item.description === `known_bot_${domainName}`);
                        if (expressionKnownBot !== '') {
                            if (existRule.length > 0) {
                                const existRuleId = existRule[0].id;
                                await cfClient.patch(`/zones/${zoneId}/rulesets/${ruleId}/rules/${existRuleId}`, { 
                                    description: `known_bot_${domainName}`,
                                    action: knownBotRule.action,
                                    expression: expressionKnownBot,
                                    enabled: true,
                                    ...(knownBotRule.action === 'skip' ? {
                                        action_parameters: {
                                            phases: [
                                                'http_request_firewall_managed'
                                            ],
                                            ruleset: 'current'
                                        },
                                    } : null)
                                });
                            } else {
                                await cfClient.post(`/zones/${zoneId}/rulesets/${ruleId}/rules`, { 
                                    description: `known_bot_${domainName}`,
                                    action: knownBotRule.action,
                                    expression: expressionKnownBot,
                                    enabled: true,
                                    ...(knownBotRule.action === 'skip' ? {
                                        action_parameters: {
                                            phases: [
                                                'http_request_firewall_managed'
                                            ],
                                            ruleset: 'current'
                                        },
                                    } : null)
                                });
                            }
                        } else {
                            if (existRule.length > 0) {
                                const existRuleId = existRule[0].id;
                                await cfClient.delete(`/zones/${zoneId}/rulesets/${ruleId}/rules/${existRuleId}`);
                            }
                        }
                    }
                }
            }
        }
    } catch (error: any) {
        console.error('Failed to get Bot policy settings by zones:', error.response?.data || error.message);
        throw Error(error);
    }
}

// //＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
// /*       已驗證的機器人 （position最下面）        */
export async function createVerifiedBotRule(data: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { verifiedBotRule, subdomains } = data;
        for (let subdomain of subdomains) {
            const zone = subdomain.zone;
            const zoneResp = await cfClient.get(`/zones?name=${zone}`);
            if (zoneResp && zoneResp.data && zoneResp.data.result.length > 0) {
                const zoneId = zoneResp.data.result[0].id;
                const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (ruleList && ruleList.data && ruleList.data.result.length > 0) {
                    let ruleset = ruleList.data.result.find((item: any) => item.source === 'firewall_custom');
                    let ruleId = ruleset ? ruleset.id : '';
                    if (!ruleset) {
                        ruleId = await deployFirewallCustomRuleset(zoneId, cfClient);
                    }
                    const rules = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleId}`);
                    if (rules && rules.data && rules.data.result) {
                        const domainName = subdomain.name;
                        let expressionVerifiedBot = '';
                        if (verifiedBotRule) {
                            if (verifiedBotRule.value.length > 0) {
                                if (verifiedBotRule.type === 'eq') {
                                    expressionVerifiedBot = `(cf.verified_bot_category eq "${verifiedBotRule.value[0]}" and http.host eq "${domainName}")`;
                                } else if (verifiedBotRule.type === 'ne') {
                                    expressionVerifiedBot = `(cf.verified_bot_category ne "${verifiedBotRule.value[0]}" and http.host eq "${domainName}")`;
                                } else if (verifiedBotRule.type === 'in') {
                                    expressionVerifiedBot = `(cf.verified_bot_category in {${verifiedBotRule.value.map((item: any) => `"${item}"`).join(' ')}} and http.host eq "${domainName}")`;
                                } else if (verifiedBotRule.type === 'not in') {
                                    expressionVerifiedBot = `(not cf.verified_bot_category in {${verifiedBotRule.value.map((item: any) => `"${item}"`).join(' ')}} and http.host eq "${domainName}")`;
                                }
                            }
                        } 
                        const existRule = (rules.data.result.rules || []).filter((item: any) => item.description === `verified_bot_${domainName}`);
                        if (expressionVerifiedBot !== '') {
                            if (existRule.length > 0) {
                                const existRuleId = existRule[0].id;
                                await cfClient.patch(`/zones/${zoneId}/rulesets/${ruleId}/rules/${existRuleId}`, { 
                                    description: `verified_bot_${domainName}`,
                                    action: verifiedBotRule.action,
                                    expression: expressionVerifiedBot,
                                    enabled: true,
                                    ...(verifiedBotRule.action === 'skip' ? {
                                        action_parameters: {
                                            phases: [
                                                'http_request_firewall_managed'
                                            ],
                                            ruleset: 'current'
                                        },
                                    } : null)
                                });
                            } else {
                                await cfClient.post(`/zones/${zoneId}/rulesets/${ruleId}/rules`, { 
                                    description: `verified_bot_${domainName}`,
                                    action: verifiedBotRule.action,
                                    expression: expressionVerifiedBot,
                                    enabled: true,
                                    ...(verifiedBotRule.action === 'skip' ? {
                                        action_parameters: {
                                            phases: [
                                                'http_request_firewall_managed'
                                            ],
                                            ruleset: 'current'
                                        },
                                    } : null)
                                });
                            }
                        } else {
                            if (existRule.length > 0) {
                                const existRuleId = existRule[0].id;
                                await cfClient.delete(`/zones/${zoneId}/rulesets/${ruleId}/rules/${existRuleId}`);
                            }
                        }
                    }
                }
            }
        }
    } catch (error: any) {
        console.error('Failed to get Bot policy settings by zones:', error.response?.data || error.message);
        throw Error(error);
    }
}

//＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
/*       取得 自訂規則 設定        */
export async function getCustomPolicySettings(zones: any) {
    try {
        let cfClient = await getCloudflareClient();
        let customPolicyList: { [domainName: string]: { action: string, conditions: any[] }[] } = {};
        
        for (let zone of zones) {
            const cloudflareZone = await cfClient.get(`/zones?name=${zone}`);
            if (cloudflareZone && cloudflareZone.data && cloudflareZone.data.result.length > 0) {
                const zoneId = cloudflareZone.data.result[0].id;
                
                const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (ruleList && ruleList.data && ruleList.data.result) {
                    let ruleset = ruleList.data.result.find((item: any) => item.source === 'firewall_custom');
                    let ruleId = ruleset ? ruleset.id : '';
                    const firewallResp = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleId}`);
                    if (firewallResp && firewallResp.data && firewallResp.data.result) {
                        const rules = firewallResp.data.result.rules || [];
                        
                        // 取得自訂規則 (user_agent_, header_, request.full_uri_ 等)
                        const customRules = rules.filter((item: any) => {
                            if (!item.description) return false;
                            return item.description.includes('user_agent_') || 
                                   item.description.includes('header_') || 
                                   item.description.includes('full_uri_');
                        });
                        
                        for (let rule of customRules) {
                            const domainName = rule.description
                                .replace('user_agent_', '')
                                .replace('header_', '')
                                .replace('full_uri_', '');
                            
                            if (domainName) {
                                // 使用新的解析函數
                                const parsedRule = parseRuleExpression(rule.expression, rule.action);
                                
                                if (!customPolicyList[domainName]) {
                                    customPolicyList[domainName] = [];
                                }
                                customPolicyList[domainName].push(parsedRule);
                            }
                        }
                    }
                }
            }
        }
        return { customPolicyList };
    } catch (error: any) {
        console.error('Failed to get custom policy settings:', error.response?.data || error.message);
        throw Error(error);
    }
}

// //＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃＃
// /*       自訂規則       */
export async function createCustomPolicy(data: any) {
    try {
        let cfClient = await getCloudflareClient();
        const { customRuleList, subdomains } = data;
        for (let subdomain of subdomains) {
            const zone = subdomain.zone;
            const zoneResp = await cfClient.get(`/zones?name=${zone}`);
            if (zoneResp && zoneResp.data && zoneResp.data.result.length > 0) {
                const zoneId = zoneResp.data.result[0].id;
                const ruleList = await cfClient.get(`/zones/${zoneId}/rulesets`);
                if (ruleList && ruleList.data && ruleList.data.result.length > 0) {
                    let ruleset = ruleList.data.result.find((item: any) => item.source === 'firewall_custom');
                    let ruleId = ruleset ? ruleset.id : '';
                    if (!ruleset) {
                        ruleId = await deployFirewallCustomRuleset(zoneId, cfClient);
                    }
                    const rules = await cfClient.get(`/zones/${zoneId}/rulesets/${ruleId}`);
                    if (rules && rules.data && rules.data.result) {
                        const domainName = subdomain.name;

                        const buildConditionExpr = (condition: any): string => {
                            if (condition.field === 'header') {
                                if (condition.operator === 'eq') {
                                    return `any(http.request.headers["${condition.name}"][*] eq "${condition.value}")`;
                                } else if (condition.operator === 'ne') {
                                    return `all(http.request.headers["${condition.name}"][*] ne "${condition.value}")`;
                                } else if (condition.operator === 'contains') {
                                    return `any(http.request.headers["${condition.name}"][*] contains "${condition.value}")`;
                                } else if (condition.operator === 'not_contains') {
                                    return `not any(http.request.headers["${condition.name}"][*] contains "${condition.value}")`;
                                }
                            } else if (condition.field === 'full_uri') {
                                if (condition.operator === 'wildcard') {
                                    return `http.request.full_uri wildcard r"${condition.value}"`;
                                } else if (condition.operator === 'not_contains') {
                                    return `not http.request.full_uri contains "${condition.value}"`;
                                } else if (condition.operator === 'starts_with') {
                                    return `starts_with(http.request.full_uri, "${condition.value}")`;
                                } else if (condition.operator === 'ends_with') {
                                    return `ends_with(http.request.full_uri, "${condition.value}")`;
                                } else {
                                    return `http.request.full_uri ${condition.operator} "${condition.value}"`;
                                }
                            } else {
                                if (condition.operator === 'wildcard') {
                                    return `http.${condition.field} wildcard r"${condition.value}"`;
                                } else if (condition.operator === 'not_contains') {
                                    return `not http.${condition.field} contains "${condition.value}"`;
                                } else if (condition.operator === 'starts_with') {
                                    return `starts_with(http.${condition.field}, "${condition.value}")`;
                                } else if (condition.operator === 'ends_with') {
                                    return `ends_with(http.${condition.field}, "${condition.value}")`;
                                } else {
                                    return `http.${condition.field} ${condition.operator} "${condition.value}"`;
                                }
                            }
                            return '';
                        };
                        if (customRuleList.length > 0) {
                            // 紀錄本次更新中所有的規則類型
                            const updatedFields = customRuleList.map((rule: any) => rule.conditions[0]?.field).filter(Boolean);

                            for (let customRule of customRuleList) {
                                let expressionCustomRule = '';
                                if (customRule.conditions.length > 0) {
                                    // 按順序將條件分組: 遇到 or 就開始新群組，and 則加入當前群組
                                    // 例如: A and B or C and D => [(A, B), (C, D)]
                                    const groups: any[][] = [];
                                    let currentGroup: any[] = [];
                                    
                                    for (let i = 0; i < customRule.conditions.length; i++) {
                                        const condition = customRule.conditions[i];
                                        if (condition.logicalOperator === 'or') {
                                            // or 開始新群組，先把當前群組存起來
                                            if (currentGroup.length > 0) {
                                                groups.push(currentGroup);
                                            }
                                            currentGroup = [condition];
                                        } else {
                                            // 第一個條件或 and 條件，加入當前群組
                                            currentGroup.push(condition);
                                        }
                                    }
                                    // 最後一個群組
                                    if (currentGroup.length > 0) {
                                        groups.push(currentGroup);
                                    }
                                    
                                    // 組合各群組的 expression
                                    const groupExpressions = groups.map(group => {
                                        const groupExpr = group.map(cond => buildConditionExpr(cond)).join(' and ');
                                        return `(${groupExpr} and http.host eq "${domainName}")`;
                                    });
                                    
                                    expressionCustomRule = groupExpressions.join(' or ');
                                }

                                const existRule = (rules.data.result.rules || []).filter((item: any) => item.description === `${customRule.conditions[0].field}_${domainName}`);
                                if (existRule.length > 0) {
                                    const existRuleId = existRule[0].id;
                                    await cfClient.patch(`/zones/${zoneId}/rulesets/${ruleId}/rules/${existRuleId}`, { 
                                        description: `${customRule.conditions[0].field}_${domainName}`,
                                        action: customRule.action,
                                        expression: expressionCustomRule,
                                        enabled: true,
                                        ...(customRule.action === 'skip' ? {
                                            action_parameters: {
                                                phases: [
                                                    'http_request_firewall_managed'
                                                ],
                                                ruleset: 'current'
                                            },
                                        } : null)
                                    });
                                } else {
                                    await cfClient.post(`/zones/${zoneId}/rulesets/${ruleId}/rules`, { 
                                        description: `${customRule.conditions[0].field}_${domainName}`,
                                        action: customRule.action,
                                        expression: expressionCustomRule,
                                        enabled: true,
                                        ...(customRule.action === 'skip' ? {
                                            action_parameters: {
                                                phases: [
                                                    'http_request_firewall_managed'
                                                ],
                                                ruleset: 'current'
                                            },
                                        } : null)
                                    });
                                }
                            }

                            // 檢查並刪除不再 customRuleList 中的現有規則
                            const allPossibleFields = ['user_agent', 'header', 'full_uri'];
                            for (let field of allPossibleFields) {
                                if (!updatedFields.includes(field)) {
                                    const existRule = (rules.data.result.rules || []).filter((item: any) => item.description === `${field}_${domainName}`);
                                    if (existRule.length > 0) {
                                        const existRuleId = existRule[0].id;
                                        await cfClient.delete(`/zones/${zoneId}/rulesets/${ruleId}/rules/${existRuleId}`);
                                    }
                                }
                            }
                        } else {
                            for (let field of ['user_agent', 'header', 'full_uri']) {
                                const existRule = (rules.data.result.rules || []).filter((item: any) => item.description === `${field}_${domainName}`);
                                if (existRule.length > 0) {
                                    const existRuleId = existRule[0].id;
                                    await cfClient.delete(`/zones/${zoneId}/rulesets/${ruleId}/rules/${existRuleId}`);
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (error: any) {
        console.error('Failed to create custom policy:', error.response?.data || error.message);
        throw Error(error);
    }
}