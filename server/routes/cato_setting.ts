import express from 'express';
import { Request, Response, NextFunction } from 'express';
const formidable = require('formidable');
import fs from 'fs';

import { expressSession, wafSettingAuthorizer } from '../middleware/route_middleware_util';
import { asyncHandler, dbTransactionHandler } from '../middleware/request_handler_util';

import { logAction } from '../services/log_service';

import { getCatoSitesService, createCatoSiteService, deleteCatoSite } from '../services/cato_service';
import { getCatoSettingsByContractNo, createCatoSetting, deleteCatoSetting } from '../services/cato_setting';

const router = express.Router();
router.use([expressSession()]);

router.get('/:contractNo', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    const networkSettings = await getCatoSitesService();
    let catoSettings: any[] = await getCatoSettingsByContractNo(contractNo);
    for (let catoSetting of catoSettings) {
        const site = networkSettings.find((site: any) => site.info.name === catoSetting.name);
        if (site) catoSetting.connectivityStatus = site.connectivityStatus;
    }
    return catoSettings;
}))

router.post('/create/:contractNo', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    try {
        await createCatoSiteService(data)
        await createCatoSetting(data);
    } catch (error) {
        throw error;
    }
}))

router.delete('/delete/:contractNo/:domainName', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo, domainName } = req.params;
    try {
        await deleteCatoSite(domainName)
        await deleteCatoSetting(contractNo, domainName);
    } catch (error) {
        throw error;
    }
}))


export default router;