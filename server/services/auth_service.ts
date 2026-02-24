import jwt from 'jsonwebtoken';
//import cls from 'cls-hooked';
import bcrypt from 'bcryptjs';
import update from 'immutability-helper';
// import { sha256 } from 'js-sha256';
// import { URL } from 'url';
import config from '../config/config';
import { createError } from '../middleware/errorHandler';
import { setRedis, getRedis, removeRedis } from '../dao/database/redis';
import ContractUsers from '../dao/contract_users';
import { getUserByEmail, getUserByUsersId, getUserContractByUserId } from './user_service';
import { getActivatedContract } from './contract_service';

const JWT_SECRET = config.JWT_SECRET || 'adasonezmjwtsecret@f5';
const SESSION_TIMEOUT = parseInt(config.sessionTimeout || '1800');
const injectContract = (contract: any) => {
  return {
      ...contract,
  }
}

// 刷新JWT token
export const refreshAuthToken = async (currentToken: string) => {
    try {
        // 解码当前token获取用户信息
        const decoded = jwt.verify(currentToken, JWT_SECRET) as any;
        const { user, contract } = decoded;
        
        // 创建新的JWT token
        const newToken = jwt.sign({ user, contract }, JWT_SECRET, { expiresIn: SESSION_TIMEOUT });
        
        // 删除旧的Redis数据
        await removeRedis(currentToken);
        
        // 存储新的Redis数据
        await setRedis(newToken, { user, contract }, SESSION_TIMEOUT);
        
        console.log(`Token refreshed: ${currentToken.substring(0, 20)}... -> ${newToken.substring(0, 20)}...`);
        
        return  {  user,  contract, token: newToken };
    } catch (error) {
        console.error('Token refresh error:', error);
        throw error;
    }
};

export const login = async ({ email, password }: { email: string, password: string }, ignore = false) => {
    if (!email) {
      throw createError('Email is required', 400);
    }

    const user = await getUserByEmail(email);
    if (!user || !bcrypt.compareSync(password, (user as any).password)) {
      throw createError('登入帳密有誤', 404);
    }
    
    // 移除密碼並準備用戶信息
    const userInfo = update(user as any, { $unset: ['password'] });
    const contractUser: any = await getUserContractByUserId(userInfo.userId);
    let contract: any = {};
    if (userInfo.role === 'user') {
      if (!contractUser) {
        throw createError("User's contract not found", 404);
      }
      contract = await getActivatedContract(contractUser.contractNo);
      if (!contract) {
        throw createError('Contract not found', 404);
      }
    }
    
    // 創建 JWT token
    const token = jwt.sign({ user: userInfo, contract }, JWT_SECRET, { expiresIn: SESSION_TIMEOUT });
    
    // 儲存到 Redis
    setRedis(token, { user: userInfo, contract }, SESSION_TIMEOUT);
    
    // 返回響應
    const resp = { 
      user: userInfo, 
      contract,
      token
    };

    return resp;
}

export const loginUserContract = async (token: any, loginUser: any, { contractNo }: { contractNo: string }) => {
  let contract: any = await getActivatedContract(contractNo);
  if (!contract) {
    throw createError('Contract not found', 404);
  }
  let contractUsers: any = await ContractUsers.findOne({ raw: true, where: { contractNo } });
  if (!contractUsers) {
    throw createError('The contract does not have user account', 404);
  }

  let user = await getUserByUsersId(contractUsers.userId);
  removeRedis(token);
  // contract = injectContract(contract.get({plain: true, raw: true}));

  const { user: maintainer } = loginUser;
  const newToken = jwt.sign({ user, contract, maintainer }, JWT_SECRET);

  setRedis(newToken, { user, contract, maintainer }, (SESSION_TIMEOUT));
  const resp = { user, contract, maintainer, token: newToken };

  return resp;
}

export const logoutUserContract = async (token: any, loginUser: any) => {
  removeRedis(token);
  let user = {};
  const { maintainer } = loginUser;
  if (!maintainer) {
    if (loginUser.user && (loginUser.user.role === 'management' || loginUser.user.role === 'reseller')) {
      user = loginUser.user;
    } else {
      throw createError('Unauthorized', 401);
    }
  } else {
    user = maintainer;
  }
  const newToken = jwt.sign({ user }, JWT_SECRET);
  setRedis(newToken, { user }, (SESSION_TIMEOUT));
  const resp = { user, token: newToken };
  return resp;
}