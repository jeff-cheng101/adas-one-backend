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
import { getAllTicketNos, createTicket, getTicketsByUser, sendTicketMailToOps, getTicketsById } from '../services/ticket_service';


const router = express.Router();
// router.use([expressSession()]);

router.get('/ticket_nos', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    return await getAllTicketNos();
}))

router.post('/create', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const emailRes = await sendTicketMailToOps(req.body);
    console.log(emailRes)
    return await createTicket(req.body);
}))

router.get('/user_tickets/:email', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    return await getTicketsByUser(req.params.email);
}))

router.get('/ticket_detail/:id', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    return await getTicketsById(req.params.id);
}))
export default router;