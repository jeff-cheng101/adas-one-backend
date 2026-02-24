import express from 'express';
import { Request, Response, NextFunction } from 'express';
const formidable = require('formidable');
import fs from 'fs';

import { expressSession, wafSettingAuthorizer } from '../middleware/route_middleware_util';
import { asyncHandler, dbTransactionHandler } from '../middleware/request_handler_util';

import { logAction } from '../services/log_service';

import { createWafSettingService, updateWafSettingService, deleteWafSettingService, getCertChainInfo } from '../services/f5_waf_service';
import { getF5ServicesByContractNo, createF5WafSetting, updateF5WafSetting, deleteF5WafSetting } from '../services/f5_waf_setting';

const router = express.Router();
router.use([expressSession()]);

router.get('/:contractNo', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    let settings = await getF5ServicesByContractNo(contractNo);
    for (let f5Service of settings) {
        const sslCert = await getCertChainInfo(f5Service.contractNo, f5Service.domainName, f5Service.virtualServerIp);
        f5Service.cert = sslCert?.cert || {};
    }
    return settings;
}))

router.post('/create/:contractNo', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    try {
        await createWafSettingService(data)
        await createF5WafSetting({ ...data, virtualServerIp: '202.39.33.192' })
    } catch (error) {
        throw error;
    }
}))

router.delete('/delete/:contractNo/:domainName', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo, domainName } = req.params;
    try {
        await deleteWafSettingService(contractNo, domainName)
        await deleteF5WafSetting({ contractNo, domainName })
    } catch (error) {
        throw error;
    }
}))

router.post('/update/:contractNo', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    try {
        await updateWafSettingService(data)
        await updateF5WafSetting(data)
    } catch (error) {
        throw error;
    }
}))

router.post('/upload_certification', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // if (req.headers['content-length'] == 0) {
    //     throw Error(`Bad request: Content-Length must be greater than 0`);
    // }
    
    try {
        const result = await new Promise((resolve, reject) => {
            const form = new formidable.IncomingForm();
            form.parse(req);

            form.on('file', function (name: any, file: any) {
                const { originalFilename: fileName, mimetype: type, size, filepath: tempFilePath } = file;
                const result = { fileName, type, size, tempFilePath };
                resolve(result);
            });

            form.on('error', function (err: any) {
                reject(err);
            });
        });
        
        res.json(result);
    } catch (error) {
        throw error;
    }
}));


router.post('/check_is_crt_file', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { path } = req.body;
    const content = fs.readFileSync(path).toString();
    return { check: content.startsWith('-----BEGIN CERTIFICATE-----') }
}));

router.post('/check_is_key_file', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { path } = req.body;
    const content = fs.readFileSync(path).toString();
    return { check: content.startsWith('-----BEGIN ') && content.indexOf(' PRIVATE KEY-----') > -1 }
}));



export default router;