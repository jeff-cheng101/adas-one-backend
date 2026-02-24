import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
// import createError from 'http-errors';
import chalk from 'chalk';
import session from 'express-session';
import { Redis } from '../dao/database/connection';
import { /*asyncExtrenalHandler,*/ asyncHandler } from './request_handler_util';
import { getRedis, setRedisExpiration } from '../dao/database/redis';
import { refreshAuthToken } from '../services/auth_service';
import config from '../config/config';

// 擴展 Request 類型
declare global {
    namespace Express {
        interface Request {
            token?: string;
            loginUser?: any;
        }
    }
}

export const authenticator = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    let authCookie = null;
    let token = null;

    if (req.cookies['authToken']) {
        try {
            const decodedCookie = decodeURIComponent(req.cookies['authToken']);
            authCookie = JSON.parse(decodedCookie);
            token = authCookie.token;
        } catch (error) {
            console.error('Error parsing authToken:', error);
        }
    }
    if (token && token.startsWith('Bearer ')) {
        token = token.slice(7, token.length);
    }

    const exclude = ['/auth/captcha', '/auth/login', '/auth/status', '/auth/forgot-password', '/auth/reset-password', '/system_setting/email_contact'];

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    res.setHeader('X-Download-Options', 'noopen');
    res.setHeader('X-XSS-Protection', '1');
    res.setHeader('Content-Security-Policy', 'default-src *');
    res.setHeader('Public-Key-Pins', 'pin-sha256="base64=="; max-age=2592000; includeSubDomains');
    res.setHeader('X-Powered-By', 'none');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');

    if (exclude.includes(req.path)) {
        next();
    }
    else {
        if (!token) throw new Error('Unauthorized');
        const { secr } = config;
        jwt.verify(token, secr);

        const auth = await getRedis(token);
        if (!auth) throw new Error('閒置未操作逾時 30 分鐘，請您重新登入，謝謝。');

        // 智能刷新session - 根据JWT剩余时间决定是否重新生成token
        const authToken = req.cookies?.authToken;
        if (authToken) {
            const SESSION_TIMEOUT = parseInt(config.sessionTimeout || '1800');
            try {
                // 检查JWT的剩余有效时间
                const decoded = jwt.verify(token, config.secr) as any;
                const currentTime = Math.floor(Date.now() / 1000);
                const expirationTime = decoded.exp;
                const remainingTime = expirationTime - currentTime;
                console.log(`JWT remaining time: ${remainingTime}s`);
                
                // 如果剩余时间少于总时间的一半，则刷新token
                if (remainingTime < SESSION_TIMEOUT / 2) {
                    console.log('Refreshing JWT token...');
                    // 生成新的token
                    const newToken = await refreshAuthToken(token);
                    // 更新cookie
                    res.cookie('authToken', JSON.stringify(newToken), {
                        httpOnly: true,
                        secure: config.mode === 'production',
                        sameSite: 'lax',
                        path: '/',
                        maxAge: SESSION_TIMEOUT * 1000
                    });
                    // 更新Redis中的过期时间
                    await setRedisExpiration(token, SESSION_TIMEOUT);
                    // 更新req中的token以供后续使用
                    req.token = newToken.token;
                } 
            } catch (jwtError) {
                console.error('JWT verification failed during session refresh:', jwtError);
                // JWT无效，不做处理，让后续验证逻辑处理
            }
        }

        await new Promise<void>((resolve) => {
            resolve();
            // 如果token已经在刷新逻辑中更新了，就不要覆盖
            if (!req.token) {
                req.token = token;
            }
            req.loginUser = auth;
            next();
        });
    }
}, 401, '', true);

// export const customerAuthorizer = asyncHandler(async (req, res, next) => {
//     const { secr } = config;
//     const auth = jwt.verify(req.token, secr);
//     const { user, contract } = auth;

//     if (!user || !contract) throw new Error('Unauthorized');
//     next();
// }, 403, '', true);

export const maintainerAuthorizer = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { secr } = config;
    const auth = jwt.verify((req as any).token, secr);
    const { user } = auth as any;

    if (user.role !== 'management' && user.role !== 'reseller') throw new Error('Unauthorized');
    next();
}, 403, '', true);

export const wafSettingAuthorizer = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { secr } = config;
        const auth = jwt.verify((req as any).token, secr);
        const { contract, maintainer, user } = auth as any;
        if (maintainer || user?.role === 'management' || user?.role === 'reseller') throw new Error('Unauthorized');
        const { body, params } = req;
        const contractNo = body.contractNo || params.contractNo;
        // if (contract.contractNo !== contractNo) throw new Error('Unauthorized');
        next();
    }
    catch (e) {
        console.error(chalk.red(`Error: ${(e as any).message}`));
        res.status(403).json({ message: (e as any).message });
    }
}, 403, '', true);

export const expressSession = () => {
    const { secr } = config;

    const params = {
        secret: secr,
        resave: false,
        saveUninitialized: true,
        cookie: { maxAge: 10 * 60 * 1000, httpOnly: true } // 10 min
    };

    return session(params);
}

