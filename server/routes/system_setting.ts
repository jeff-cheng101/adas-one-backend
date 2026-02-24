import express from 'express';
import moment from 'moment';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import config from '../config/config';

import { expressSession, maintainerAuthorizer, wafSettingAuthorizer } from '../middleware/route_middleware_util';
import { asyncHandler, dbTransactionHandler } from '../middleware/request_handler_util';
import { getEmailReport, createEmailReport, updateEmailReport, deleteEmailReport, sendImmediateEmailReports } from '../services/report_service';
import { sendContactMail } from '../services/system_setting_service';
import { logAction } from '../services/log_service';

const router = express.Router();
router.use([expressSession()]);

router.get('/email_report/:contractNo', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { contractNo } = req.params;
    return await getEmailReport(contractNo);
}))

router.post('/email_report', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    const emailReport: any = await createEmailReport(data);
    if (data.scheduleType === 'immediate') {
        await sendImmediateEmailReports({ ...data, id: emailReport.id });
    }
    return emailReport;
}))

router.put('/email_report', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    const emailReport: any = await updateEmailReport(data);
    return emailReport;
}))

router.delete('/email_report/:id', [wafSettingAuthorizer], asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { contractNo } = req.body;
    const result = await deleteEmailReport(parseInt(id), contractNo);
    return { success: true, message: '報表設定刪除成功' };
}))

router.post('/email_contact', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const data = req.body;
    const result = await sendContactMail(data);
    return data;
}))

export default router;