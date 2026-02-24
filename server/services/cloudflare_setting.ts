import Sequelize from 'sequelize';
import CloudflareZones from '../dao/cloudflare_zones';
import CloudflareDns from '../dao/cloudflare_dns';
import Geolocation from '../dao/geolocation';
import { logAction } from './log_service';

const Op = Sequelize.Op;

export const getActivatedZones = async () => {
    return await CloudflareZones.findAll({
        where: {
            terminatedDate: null,
        },
    });
}
export const getActivatedZonesByContractNo = async (contractNo: string) => {
    const zones = await CloudflareZones.findAll({
        where: {
            contractNo,
            terminatedDate: null,
        },
    });
    return zones;
}

export const getActivatedZoneByZoneNameAndContractNo = async (zoneName: string, contractNo: string) => {
    return await CloudflareZones.findOne({
        where: {
            zone: zoneName,
            contractNo,
            terminatedDate: null,
        },
    });
}

export const createZoneSetting = async (data: any) => {
    let setting = await getActivatedZoneByZoneNameAndContractNo(data.zone, data.contractNo);
    if (!setting) {
        setting = await CloudflareZones.create(data);
    }
    return setting;
}

export const deleteZoneSetting = async (data: any) => {
    const setting: any = await getActivatedZoneByZoneNameAndContractNo(data.zone, data.contractNo);
    if (setting && !setting.terminatedDate) {
        setting.terminatedDate = new Date();
        await setting.save();
    }
    const dnsRecords = await CloudflareDns.findAll({
        where: {
            zone: data.zone,
            contractNo: data.contractNo,
        },
    });
    for (const dnsRecord of dnsRecords as any[]) {
        dnsRecord.terminatedDate = new Date();
        await dnsRecord.save();
    }
    return setting;
}

export const getActivatedDnsRecordByContractNo = async (contractNo: string) => {
    const dnsRecords = await CloudflareDns.findAll({
        where: {
            contractNo,
            terminatedDate: null,
        },
    });
    return dnsRecords;
}

export const getActivatedDnsRecordByDnsRecord = async (dnsRecord: string) => {
    return await CloudflareDns.findOne({
        where: {
            domainName: dnsRecord,
            terminatedDate: null
        },
    });
}

export const createDnsRecordSetting = async (data: any) => {
    const { name, type, content, zone, contractNo, proxied, ttl } = data;
    let setting = await getActivatedDnsRecordByDnsRecord(name);
    if (!setting) {
        const record = { domainName: name, type, content, zone, contractNo, proxied, ttl }
        setting = await CloudflareDns.create(record);
    }
    return setting;
}

export const updateDnsRecordSetting = async (data: any) => {
    const { name, type, content, proxied, ttl, originalName } = data;
    let setting: any = await getActivatedDnsRecordByDnsRecord(originalName);
    if (setting) {
        setting.domainName = name;
        setting.type = type;
        setting.content = content;
        setting.proxied = proxied;
        setting.ttl = ttl;
        await setting.save();
    }
    return setting;
}

export const updateDnsRecordWafSetting = async (data: any) => {
    const { subdomains, blackIpList, whiteIpList, countryList, userId } = data;
    for (const subdomain of subdomains) {
        const { name } = subdomain;
        if (blackIpList) {
            let setting: any = await getActivatedDnsRecordByDnsRecord(name);
            if (setting) {
                setting.blackIp = JSON.stringify(blackIpList);
                await setting.save();
            }
            await logAction({ 
                action: 'update',
                userId,
                track: { zone: setting.zone, name: setting.name, type: 'blackIp', value: JSON.stringify(blackIpList) },
                contractNo: setting.contractNo,
                status: 'success'
            });
        }
        if (whiteIpList) {
            let setting: any = await getActivatedDnsRecordByDnsRecord(name);
            if (setting) {
                setting.whiteIp = JSON.stringify(whiteIpList);
                await setting.save();
            }
            await logAction({ 
                action: 'update',
                userId,
                track: { zone: setting.zone, name: setting.name, type: 'whiteIp', value: JSON.stringify(whiteIpList) },
                contractNo: setting.contractNo,
                status: 'success'
            });
        }
        if (countryList) {
            let setting: any = await getActivatedDnsRecordByDnsRecord(name);
            const geolocations = countryList.map((item: any) => item.country);
            if (setting) {
                setting.blockGeolocation = JSON.stringify(geolocations);
                setting.geolocationType = data.countryAccessMode === 'block' ? 'block' : 'allow';
                await setting.save();
            }
            await logAction({ 
                action: 'update',
                userId,
                track: { zone: setting.zone, name: setting.name, type: 'country', value: JSON.stringify(geolocations) },
                contractNo: setting.contractNo,
                status: 'success'
            });
        }
    }
}

export const updateDnsCdnCacheSetting = async (data: any) => {
    const { name, contractNo, cdnCache } = data;
    const { browser_ttl, edge_ttl, cache } = cdnCache;
    const setting: any = await getActivatedDnsRecordByDnsRecord(name);
    if (setting) {
        setting.browserTtlMode = browser_ttl.mode;
        setting.browserTtlDefault = browser_ttl.default;
        setting.edgeTtlMode = edge_ttl.mode;
        setting.edgeTtlDefault = edge_ttl.default;
        setting.cacheOn = cache;
        await setting.save();
    }
    return setting;
}

export const deleteDnsRecordSetting = async (data: any) => {
    const { name, zone, contractNo } = data;
    const setting: any = await getActivatedDnsRecordByDnsRecord(name);
    if (setting) {
        setting.terminatedDate = new Date();
        await setting.save();
    }
    return setting;
}

export const getGeolocationList = async () => {
    return await Geolocation.findAll();
}

export const updateZoneWafSetting = async (data: any) => {
    const { zone, sensitivityLevel } = data;
    const setting: any = await getActivatedZoneByZoneNameAndContractNo(zone, data.contractNo);
    if (setting) {
        setting.sensitivityLevel = sensitivityLevel === '3' ? 'default'
        : sensitivityLevel === '2' ? 'medium'
        : sensitivityLevel === '1' ? 'low'
        : 'default';
        await setting.save();
    }
    return setting;
}