import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { setRedis, getRedis, removeRedis } from '../dao/database/redis';
import { login, loginUserContract, logoutUserContract } from '../services/auth_service';
import { sendPasswordResetEmail, resetPassword } from '../services/password_reset_service';
import { createError } from '../middleware/errorHandler';
import { asyncHandler } from '../middleware/request_handler_util';
import config from '../config/config';

const router = Router();

const JWT_SECRET = config.secr || 'adasonezmjwtsecret@f5';
const SESSION_TIMEOUT = parseInt(config.sessionTimeout || '1800');

// 登入
router.post('/login', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    const resp = await login({ email, password });
    
    if (!resp) {
      throw createError('登入失敗', 500);
    }
    
    res.cookie('authToken', JSON.stringify(resp), {
      httpOnly: true,
      secure: config.mode === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TIMEOUT * 1000
    });

    return ({ 
      success: true, 
      user: resp.user, 
      contract: resp.contract,
      token: resp.token,
      message: '登入成功'
    });
  } catch (error) {
    throw error;
  }
}));

// 驗證登入狀態
router.get('/verify', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.authToken;
    if (!token) {
      return { 
        loginState: false, 
        message: 'JWT token must be provided' 
      };
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { user: any };
    
    const redisData = await getRedis(token);
    console.log(redisData);
    if (!redisData) {
      return { 
        loginState: false, 
        message: 'Invalid or expired token session' 
      };
    }

    return { 
      loginState: true, 
      user: decoded.user,
      account: decoded.user.email 
    };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return { 
        loginState: false, 
        message: 'Invalid token' 
      };
    }
    throw error;
  }
}));

// 登出
router.delete('/logout', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.authToken;

    if (token) {
      await removeRedis(token);
    }

    // 清除 cookie
    res.clearCookie('authToken', {
      httpOnly: true,
      secure: config.mode === 'production',
      sameSite: 'lax',
      path: '/'
    });

    return { 
      success: true, 
      message: 'Logged out successfully' 
    };
  } catch (error) {
    throw error;
  }
}));

router.get('/status', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (req.cookies.authToken) {
      return { ...JSON.parse(req.cookies.authToken), loginState: true };
  } else {
      return { error: 'Unauthorized', loginState: false };
  }
}));

router.get('/config', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (req.cookies.cloudWafAuth) {
      return req.cookies.cloudWafAuth;
  } else {
      return { error: 'Unauthorized' };
  }
}));

router.post('/switch_contract', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.token;
    const loginUser = req.loginUser;
    const { contractNo } = req.body;

    const resp = await loginUserContract(token, loginUser, { contractNo });
    res.cookie('authToken', JSON.stringify(resp), {
      httpOnly: true,
      secure: config.mode === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TIMEOUT * 1000
    });

    return ({ 
      success: true, 
      user: resp.user, 
      contract: resp.contract,
      maintainer: resp.maintainer,
      token: resp.token,
      message: '登入成功'
    });
  } catch (error) {
    throw error;
  }
}));

router.post('/switch_management', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.token;
    let loginUser = req.loginUser;

    const resp = await logoutUserContract(token, loginUser);
    res.cookie('authToken', JSON.stringify(resp), {
      httpOnly: true,
      secure: config.mode === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TIMEOUT * 1000
    });

    return ({ 
      success: true, 
      user: resp.user, 
      contract: {},
      maintainer: resp.user,
      token: resp.token,
      message: '登入成功'
    });
  } catch (error) {
    throw error;
  }
}));

// 忘記密碼 - 發送重設郵件
router.post('/forgot-password', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      throw createError('請提供電子郵件地址', 400);
    }
    
    // 簡單的email格式驗證
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw createError('請提供有效的電子郵件地址', 400);
    }
    
    const result = await sendPasswordResetEmail(email);
    return result;
    
  } catch (error) {
    throw error;
  }
}));

// 重設密碼
router.post('/reset-password', asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, email, newPassword, confirmPassword } = req.body;
    
    if (!token || !email || !newPassword || !confirmPassword) {
      throw createError('請提供所有必要的欄位', 400);
    }
    
    if (newPassword !== confirmPassword) {
      throw createError('兩次輸入的密碼不一致', 400);
    }
    
    const result = await resetPassword(token, email, newPassword);
    return result;
    
  } catch (error) {
    throw error;
  }
}));

export default router; 