import chalk from 'chalk';
import { Request, Response, NextFunction } from 'express';
import cls from 'cls-hooked';
import { MariaDB } from '../dao/database/connection';
import { txSeries } from './series_util';

export class WithMessageError extends Error {
    constructor(message: string) {
        super(message); // (1)
        this.name = "WithMessageError"; // (2)
    }    
}

function errorMessageFallback(e: any) {
    const responseMessage = e.response && e.response.data && e.response.data.message ? e.response.data.message : '';
    const alternativeMessage = e.alternativeMessage;
    let message = '';
    
    if (responseMessage) {
        message = responseMessage;
    } else if (e.message) {
        message = e.message;
    } else {
        message = e.stack || 'Unknown error occurred';
        // 避免打印包含循環引用的錯誤對象
        console.log(chalk.red('Error occurred, but cannot serialize error object due to circular references'));
        if (e.errors && e.errors.length > 0) {
            message = e.errors.map((error: any) => error.message).join('\n');
        }
    }
    
    console.log(chalk.red(`Error: ${message}`));
    
    if (alternativeMessage) {
        return alternativeMessage;
    } else {
        return message;
    }
}

export const asyncHandler = (fn: any, defaultErrorStatusCode?: number, defaultErrorResponseData?: any, ignoreResp?: boolean) => async (req: any, res: any, next: any) => {
    try {
        const resp = await fn(req, res, next);
        if (!ignoreResp && !res.headersSent) {
            if (resp) {
                res.json(resp);
            } else {
                res.json();
            }
        }
    } catch (e) {
        if (!res.headersSent) {
            const message = errorMessageFallback(e);
            res.status(defaultErrorStatusCode || 400).json(defaultErrorResponseData ||
                { message } ||
                { message: `Something went wrong.` });
        } else {
            console.error('Response already sent, cannot send error:', e);
        }
    }
}

let txSeriesCount = 0;

export const dbTransactionHandler = (fn: any) => async (req: Request, res: Response, next: NextFunction) => {
    return await new Promise((resolve, reject) => {
        txSeriesCount++;
        console.log(`txSeriesCount: ${txSeriesCount}`);
        if (txSeriesCount >= 5) {
            txSeriesCount--;
            reject(new WithMessageError(`交易過多請稍後再試！`));
            console.log(chalk.red('交易過多請稍後再試！'));
            // 系統忙碌中
        } else {
            let isReject = false;
            let isDoing = false;
            let timeoutObject = setTimeout(() => {
                try {} catch(e) {
                    console.log(chalk.red(`${(e as any).message} (${120000}ms.)`));
                    isReject = true;
                    reject(e);
                }
            }, 115000);
            
            txSeries.push(async () => {
                const namespace = cls.getNamespace('mariadb-transaction');
                if (!namespace) {
                    throw new Error('Namespace not found');
                }
                await new Promise((resolve2: any) => {
                    namespace.run(async () => {
                        try {
                            const t = await MariaDB.transaction();
                            namespace.set('transaction', t);
                            namespace.set('loginUser', req.loginUser);
                            console.log(chalk.blue('Transaction started'));
                            isDoing = true;
                            
                            try {
                                const resp = await fn(req, res, next);
                                await t.commit();
                                if (!isReject) {
                                    clearTimeout(timeoutObject);
                                    setTimeout(() => resolve(resp), 100);
                                }
                                setTimeout(() => resolve2(), 100);
                                console.log(chalk.green('Transaction committed'));
                                txSeriesCount--;
                            } catch (e: any) {
                                await t.rollback();
                                if (!isReject) {
                                    clearTimeout(timeoutObject);
                                    setTimeout(() => reject(e), 100);
                                }
                                setTimeout(() => resolve2(), 100);
                                console.log(chalk.red('Transaction rollbacked'));
                                txSeriesCount--;
                            }
                        } catch (e) {
                            txSeriesCount--;
                            if (!isReject) {
                                clearTimeout(timeoutObject);
                                setTimeout(() => reject(e), 100);
                            }
                            setTimeout(() => resolve2(), 100);
                            console.log(chalk.red('Transaction broken'));
                        }
                    });
                });
            });
        }
    });
}

export async function ignore404(err: any, fn: any) { 
    if (err.response) {
        if (err.response.data.code == 404) {
            if (fn) {
                return await fn();
            } else { 
                return defaultResponse;
            }
        } else { 
            throw err.response.data;
        }
    } else {
        throw err;
    }
}

export const defaultResponse = {
    status: 200,
    data: ''
};