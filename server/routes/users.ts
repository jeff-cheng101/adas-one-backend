import express from 'express';
// import update from 'immutability-helper';
// import formidable from 'formidable';
// import fs from 'fs';
import moment from 'moment';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import config from '../config/config';

import { expressSession, maintainerAuthorizer } from '../middleware/route_middleware_util';
import { asyncHandler, dbTransactionHandler } from '../middleware/request_handler_util';
import { getUsers, getUsersInfo, createReseller, updateReseller, createUser, updateUser } from '../services/user_service';
import { logAction } from '../services/log_service';

const router = express.Router();
router.use([expressSession()]);

router.get('/', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    return await getUsers();
}))

router.get('/info', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    return await getUsersInfo();
}))

router.post('/reseller', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user: any = await createReseller(req.body);
    await logAction({ 
        action: 'create',
        track: { userId: user.userId, email: user.email, company: user.company, name: user.name, phone: user.phone, type: 'user' },
        userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
        contractNo: '',
        status: 'success'
    });
    return user;
}))

router.put('/reseller', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const user: any = await updateReseller(req.body);
    await logAction({ 
        action: 'update',
        track: { userId: user.userId, email: user.email, company: user.company, name: user.name, phone: user.phone, type: 'user' },
        userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
        contractNo: '',
        status: 'success'
    });
    return user;
}))

router.post('/user', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    const user: any = await createUser(data);
    await logAction({ 
        action: 'create',
        track: { userId: user.userId, email: user.email, company: user.company, name: user.name, phone: user.phone, type: 'user' },
        userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
        contractNo: data.contractNo,
        status: 'success'
    });
    return user;
}))

router.put('/user', [maintainerAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    const user: any = await updateUser(data);
    await logAction({ 
        action: 'update',
        track: { userId: user.userId, email: user.email, company: user.company, name: user.name, phone: user.phone, type: 'user' },
        userId: typeof req.cookies.authToken === 'string' ? JSON.parse(req.cookies.authToken)?.user?.userId : req.cookies.authToken?.user?.userId || '',
        contractNo: data.contractNo,
        status: 'success'
    });
    return user;
}))


export default router;