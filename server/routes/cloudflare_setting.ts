import express from 'express';
import { Request, Response, NextFunction } from 'express';

import { expressSession, wafSettingAuthorizer } from '../middleware/route_middleware_util';
import { asyncHandler, dbTransactionHandler } from '../middleware/request_handler_util';

import { 
    getCloudflareZones, 
    getCloudflareAllZones,
    getCloudflareDnsByZones, 
    zoneService, 
    dnsRecordService, 
    createBlackListIp, 
    createWhiteListIp, 
    createGeolocationList, 
    getCloudflareCertificateByZones,
    uploadCustomCertificate,
    deleteCustomCertificate,
    getWafPolicySettings, 
    getCloudflareDDoSSensitivity, 
    updateDDoSSensitivity,
    getCdnCacheByDomains,
    updateCachePurgeRuleset,
} from '../services/cloudflare_service';
import {
    getActivatedZonesByContractNo,
    createZoneSetting,
    deleteZoneSetting,
    createDnsRecordSetting,
    updateDnsRecordSetting,
    updateDnsRecordWafSetting,
    deleteDnsRecordSetting,
    getGeolocationList,
    updateZoneWafSetting,
    updateDnsCdnCacheSetting
} from '../services/cloudflare_setting';
import { logAction } from '../services/log_service';

const router = express.Router();
router.use([expressSession()]);

router.get('/zones/:contractNo', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    const zones = await getCloudflareAllZones();
    const zoneList = await getCloudflareZones(zones);
    return zoneList;
}))

router.get('/dns/:contractNo', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    const data = await getActivatedZonesByContractNo(contractNo);
    const zones = data.map((item: any) => item.zone);
    const dnsRecords = await getCloudflareDnsByZones(zones);
    return dnsRecords;
}))

router.post('/', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    try {
        const result = await zoneService('create', data.zone);
        const setting: any = await createZoneSetting(data);
        await logAction({ 
            action: 'create',
            track: { id: setting.id, zone: setting.zone, type: 'zone' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: data.contractNo,
            status: 'success'
        });
        return result;
    } catch (error) {
        await zoneService('delete', data.zone);
        await logAction({ 
            action: 'create',
            track: { zone: data.zone, type: 'zone' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: data.contractNo,
            status: 'fail'
        });
        throw error;
    }
}))

router.delete('/:contractNo/:zone', [wafSettingAuthorizer], dbTransactionHandler(asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo, zone } = req.params;
    try {
        const result = await zoneService('delete', zone);
        const setting: any = await deleteZoneSetting({ contractNo, zone });
        await logAction({ 
            action: 'delete',
            track: { id: setting.id, zone: setting.zone, type: 'zone' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'success'
        });
        return result;
    } catch (error) {
        await logAction({ 
            action: 'delete',
            track: { zone: zone, type: 'zone' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'fail'
        });
        throw error;
    }
})))

router.post('/dns_record', [wafSettingAuthorizer], dbTransactionHandler(asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    try {
        let result = await dnsRecordService('create', data);
        if (!result) {
            throw new Error('DNS record operation failed');
        }
        result.zone = data.zone;
        result.contractNo = data.contractNo;
        const setting: any = await createDnsRecordSetting(result);
        await logAction({ 
            action: 'create',
            track: { id: setting.id, zone: setting.zone, name: setting.name, type: 'dns_record' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: data.contractNo,
            status: 'success'
        });
        return result;
    } catch (error) {
        await dnsRecordService('delete', data);
        await logAction({ 
            action: 'create',
            track: { zone: data.zone, name: data.name, type: 'dns_record' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: data.contractNo,
            status: 'fail'
        });
        throw error;
    }
})))

router.post('/dns_record/:name', [wafSettingAuthorizer], dbTransactionHandler(asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    try {
        let result = await dnsRecordService('update', data);
        const setting: any = await updateDnsRecordSetting(data);
        await logAction({ 
            action: 'update',
            track: { id: setting.id, zone: setting.zone, name: setting.name, type: 'dns_record' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: setting.contractNo,
            status: 'success'
        });
        return result;
    } catch (error) {
        await logAction({ 
            action: 'update',
            track: { zone: data.zone, name: data.name, type: 'dns_record' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: data.contractNo,
            status: 'fail'
        });
        throw error;
    }
})))

router.delete('/dns_record/:contractNo/:zone/:name', [wafSettingAuthorizer], dbTransactionHandler(asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo, zone, name } = req.params;
    try {
        const data = { contractNo, zone, name, originalName: name };
        const result = await dnsRecordService('delete', data);
        const setting: any = await deleteDnsRecordSetting(data);
        await logAction({ 
            action: 'delete',
            track: { id: setting.id, zone: setting.zone, name: setting.name, type: 'dns_record' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: setting.contractNo,
            status: 'success'
        });
        return result;
    } catch (error) {
        await logAction({ 
            action: 'delete',
            track: { zone, name, type: 'dns_record' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'fail'
        });
        throw error;
    }
})))

router.get('/certificate/:contractNo', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    const data = await getActivatedZonesByContractNo(contractNo);
    const zones = data.map((item: any) => item.zone);
    const certificateList = await getCloudflareCertificateByZones(zones);
    return certificateList;
}))

router.post('/certificate/:contractNo', [wafSettingAuthorizer], [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    const data = req.body;
    try {
        const resp = await uploadCustomCertificate(data);
        await logAction({ 
            action: 'update',
            track: { zone: data.zone, name: data.name, type: 'certificate' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'success'
        });
        return resp;
    } catch (error) {
        await logAction({ 
            action: 'update',
            track: { zone: data.zone, name: data.name, type: 'certificate' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'fail'
        });
        throw error;
    }
}))

router.delete('/certificate/:contractNo/:zone/:certificateId', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo, zone, certificateId } = req.params;
    const hosts = req.query.hosts as string;
    try {
        const resp = await deleteCustomCertificate({ contractNo, zone, certificateId, hosts });
        await logAction({ 
            action: 'delete',
            track: { zone, value: { certificateId, hosts }, type: 'certificate' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'success'
        });
        return resp;
    } catch (error) {
        await logAction({ 
            action: 'delete',
            track: { zone, value: { certificateId, hosts }, type: 'certificate' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'fail'
        });
        throw error;
    }
}))

router.get('/waf_policy/:contractNo', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    const data = await getActivatedZonesByContractNo(contractNo);
    const zones = data.map((item: any) => item.zone);
    const wafPolicySettings = await getWafPolicySettings(zones);
    return wafPolicySettings;
}))

router.post('/waf_policy/:contractNo/:type', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo, type } = req.params;
    const data = req.body;
    try {
        if (type === 'blacklist') {
            const resp = await createBlackListIp(data);
            await updateDnsRecordWafSetting({ ...data, userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '' });
            return resp;
        } else if (type === 'whitelist') {
            const resp = await createWhiteListIp(data);
            await updateDnsRecordWafSetting({ ...data, userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '' });
            return resp;
        } else if (type === 'country') {
            const resp = await createGeolocationList(data);
            await updateDnsRecordWafSetting({ ...data, userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '' });
            return resp;
        }
    } catch (error) {
        await logAction({ 
            action: 'update',
            track: { zone: data.zone, name: data.name, data, type },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'fail'
        });
        throw error;
    }
}))

router.get('/geolocation', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = await getGeolocationList();
    const countries = data.map((item: any) => ({
        code: item.code,
        name: item.name,
        country: item.country,
    }));
    return countries;
}))


router.get('/ddos_sensitivity/:contractNo', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    const data = await getActivatedZonesByContractNo(contractNo);
    const zones = data.map((item: any) => item.zone);
    const ddosList = await getCloudflareDDoSSensitivity(zones);
    return ddosList;
}))

// DDoS Sensitivity: By Zone
router.post('/ddos_sensitivity/:contractNo', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    const { contractNo } = req.params;
    try {
        const resp = await updateDDoSSensitivity(data);
        const setting: any = await updateZoneWafSetting({ ...data, contractNo });
        await logAction({ 
            action: 'update',
            track: { zone: setting.zone, name: setting.name, value: setting.sensitivityLevel, type: 'DDoS_sensitivity' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'success'
        });
        return resp;
    } catch (error) {
        await logAction({ 
            action: 'update',
            track: { zone: data.zone, value: data.sensitivityLevel, type: 'DDoS_sensitivity' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'fail'
        });
        throw error;
    }
}))

router.get('/cdn_cache/:contractNo', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    const data = await getActivatedZonesByContractNo(contractNo);
    const zones = data.map((item: any) => item.zone);
    const cdnCacheList = await getCdnCacheByDomains(zones);
    return cdnCacheList;
}))

// CDN Cache: By Domain
router.post('/cdn_cache/:contractNo', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    const data = req.body;
    try {
        const result = await updateCachePurgeRuleset(data);
        const setting: any = await updateDnsCdnCacheSetting({ ...data, contractNo });
        await logAction({ 
            action: 'update',
            track: { zone: data.zone, name: data.name, value: data.cdnCache, type: 'cache_purge' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'success'
        });
        return result;
    } catch (error) {
        await logAction({ 
            action: 'update',
            track: { zone: data.zone, name: data.name, value: data.cdnCache, type: 'cache_purge' },
            userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
            contractNo: contractNo,
            status: 'fail'
        });
        throw error;
    }
}))



export default router;