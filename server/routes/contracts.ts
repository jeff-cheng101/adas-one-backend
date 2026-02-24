import express from 'express';
import moment from 'moment';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import config from '../config/config';

import { expressSession, maintainerAuthorizer } from '../middleware/route_middleware_util';
import { asyncHandler, dbTransactionHandler } from '../middleware/request_handler_util';
import { getContractsInfo, getContractsInfoByReseller, getLogs, createContract, getPlans, updatePlan } from '../services/contract_service';
import { logAction } from '../services/log_service';

const router = express.Router();
router.use([expressSession()]);

router.get('/info', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    return await getContractsInfo();
}))

router.get('/info/:userId/:email', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { userId, email } = req.params;
    return await getContractsInfoByReseller(userId, email);
}))

router.get('/logs', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    return await getLogs();
}))

router.post('/create', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    const contract: any = await createContract(data);
    await logAction({ 
        action: 'create',
        track: { id: contract.id, zone: data.contractNo, type: 'contract' },
        userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
        contractNo: data.contractNo,
        status: 'success'
    });
    return contract;
}))

router.get('/plans', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    return await getPlans();
}))

router.post('/update_plan', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    const resp = await updatePlan(data);
    // await logAction({ 
    //     action: 'create',
    //     track: { type: 'plan', name: data.name, plan_code: data.plan_code, module: data.module, count: data.count, price: data.price, description: data.description },
    //     userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
    //     contractNo: data.contractNo,
    //     status: 'success'
    // });
    return resp;
}))

export default router;