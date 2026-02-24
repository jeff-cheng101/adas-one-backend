import bcrypt from 'bcryptjs';
import update from 'immutability-helper';
import Contracts from "../dao/contracts";
import ContractResellers from "../dao/contract_resellers";
import ContractUsers from "../dao/contract_users";
import Users from "../dao/users";
import ZoneTraffic from "../dao/zone_traffic";
import Logs from "../dao/logs";
import Plans from "../dao/plans";
import { getContractTrafficRequest, getContractTrafficRequestByDays } from "./cloudflare_service";
import { getActivatedZones, getActivatedZonesByContractNo } from './cloudflare_setting';
import { getResellers, getUserByUsersIdAndEmail } from './user_service';

export const getActivatedContracts = async () => {
    return await Contracts.findAll({ raw: true, where: { end_date: null } });
}

export const getActivatedContract = async (contractNo: string) => {
    const contract = await Contracts.findOne({ raw: true, where: { contractNo } });
    return contract;
}

export const getContractsInfo = async () => {
    const today = new Date();
    let resellerContracts: any = {};
    const resellers = await getResellers();
    const contracts = await getActivatedContracts();
    const contractResellers = await ContractResellers.findAll({ raw: true });
    const contractUsers = await ContractUsers.findAll({ raw: true });
    const users = await Users.findAll({ raw: true, where: { role: 'user' } });
    const contractZones = await getActivatedZones();
    const zoneTraffic = await ZoneTraffic.findAll({ raw: true });

    // 計算當前月份的開始和結束時間
    const actualCurrentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
    const actualCurrentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    const currentMonthTotalDays = actualCurrentMonthEnd.getDate();
    // 調整後的查詢範圍（因為 Cloudflare API date_gt 和 date_lt 不包含邊界日期）
    // startDate 設為當前月1號的前一天，這樣 date_gt 會從當前月1號開始查詢
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 0, 0, 0, 0, 0);
    // endDate 設為下個月1號，這樣 date_lt 會查詢到當前月最後一天
    const currentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1, 23, 59, 59, 999);
    // 使用本地時間格式化日期（避免時區轉換問題）
    const formatLocalDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    console.log(`實際當前月範圍: ${formatLocalDate(actualCurrentMonthStart)} ~ ${formatLocalDate(actualCurrentMonthEnd)}`);
    console.log(`API查詢範圍 (調整後): ${formatLocalDate(currentMonthStart)} ~ ${formatLocalDate(currentMonthEnd)}`);
    console.log(`當前月總天數: ${currentMonthTotalDays} 天 (${actualCurrentMonthStart.getFullYear()}年${actualCurrentMonthStart.getMonth() + 1}月)`); 
    
    for (let reseller of resellers as any[]) {
        let contractList: any[] = [];
        const reseller_contracts = contractResellers.filter((item: any) => item.userId === reseller.userId);
        for (let contractReseller of reseller_contracts as any[]) {
            const contractNo = contractReseller.contractNo;
            const contract = contracts.find((item: any) => item.contractNo === contractNo);
            const zones = contractZones.filter((zone: any) => zone.contractNo === contractNo);
            const zoneNames = zones.map((zone: any) => zone.zone);
            
            const currentMonthRequest = await getContractTrafficRequest(zoneNames, formatLocalDate(currentMonthStart), formatLocalDate(currentMonthEnd));
            // 結合當月統計和歷史統計
            const combinedTrafficData: any = {};
            // 處理每個 zone
            let totalRequestByContract = 0;
            let totalTrafficByContract = 0;
            zoneNames.forEach((zoneName: string) => {
                let requestTotalByZone = 0;
                let trafficTotalByZone = 0;
                combinedTrafficData[zoneName] = {};
                // 1. 加入歷史統計 (從 zoneTraffic)
                const historicalData = zoneTraffic.filter((traffic: any) => traffic.zone === zoneName);
                historicalData.forEach((traffic: any) => {
                    const startDate = new Date(traffic.startDate);
                    const monthKey = `${startDate.getFullYear()}/${String(startDate.getMonth() + 1).padStart(2, '0')}/01`;
                    
                    combinedTrafficData[zoneName][monthKey] = {
                        requests: traffic.requests || 0,
                        bytes: traffic.bytes || 0
                    };
                    totalRequestByContract += traffic.requests || 0;
                    totalTrafficByContract += traffic.bytes || 0;
                    requestTotalByZone += traffic.requests || 0;
                    trafficTotalByZone += traffic.bytes || 0;
                });
                // 2. 加入當月統計 (從 currentMonthRequest)
                if (currentMonthRequest[zoneName]) {
                    const currentDate = new Date();
                    const currentMonthKey = `${currentDate.getFullYear()}/${String(currentDate.getMonth() + 1).padStart(2, '0')}/01`;
                    
                    combinedTrafficData[zoneName][currentMonthKey] = {
                        requests: currentMonthRequest[zoneName].requests || 0,
                        bytes: currentMonthRequest[zoneName].bytes || 0,
                    };
                    totalRequestByContract += currentMonthRequest[zoneName].requests || 0;
                    totalTrafficByContract += currentMonthRequest[zoneName].bytes || 0;
                    requestTotalByZone += currentMonthRequest[zoneName].requests || 0;
                    trafficTotalByZone += currentMonthRequest[zoneName].bytes || 0;
                }
                combinedTrafficData[zoneName].totalRequest = requestTotalByZone;
                combinedTrafficData[zoneName].totalTraffic = trafficTotalByZone;
            });
            const userIds = contractUsers.filter((item: any) => item.contractNo === contractNo).map((item: any) => item.userId);
            const newUsers = users.filter((item: any) => userIds.includes(item.userId));
            contractList.push({
                ...contract,
                users: newUsers,
                zones: zones,
                trafficData: combinedTrafficData,
                totalRequestByContract: totalRequestByContract,
                totalTrafficByContract: totalTrafficByContract,
            })
        }
        resellerContracts[reseller.userId] = contractList;
    }
    return resellerContracts;
}

export const getContractsInfoByReseller = async (userId: string, email: string) => {
    const reseller: any = await getUserByUsersIdAndEmail(userId, email);
    const reseller_contracts: any = await ContractResellers.findAll({ raw: true, where: { userId: reseller.userId } });
    const contracts = await getActivatedContracts();
    const contractZones = await getActivatedZones();
    const zoneTraffic = await ZoneTraffic.findAll({ raw: true });
    const contractUsers = await ContractUsers.findAll({ raw: true });
    const users = await Users.findAll({ raw: true, where: { role: 'user' } });

    const today = new Date();
    // 計算當前月份的開始和結束時間
    const actualCurrentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
    const actualCurrentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    const currentMonthTotalDays = actualCurrentMonthEnd.getDate();
    // 調整後的查詢範圍（因為 Cloudflare API date_gt 和 date_lt 不包含邊界日期）
    // startDate 設為當前月1號的前一天，這樣 date_gt 會從當前月1號開始查詢
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 0, 0, 0, 0, 0);
    // endDate 設為下個月1號，這樣 date_lt 會查詢到當前月最後一天
    const currentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1, 23, 59, 59, 999);
    // 使用本地時間格式化日期（避免時區轉換問題）
    const formatLocalDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    console.log(`實際當前月範圍: ${formatLocalDate(actualCurrentMonthStart)} ~ ${formatLocalDate(actualCurrentMonthEnd)}`);
    console.log(`API查詢範圍 (調整後): ${formatLocalDate(currentMonthStart)} ~ ${formatLocalDate(currentMonthEnd)}`);
    console.log(`當前月總天數: ${currentMonthTotalDays} 天 (${actualCurrentMonthStart.getFullYear()}年${actualCurrentMonthStart.getMonth() + 1}月)`); 
    
    let contractList: any[] = [];
    for (let resellerContract of reseller_contracts as any[]) {
        let contractNo = resellerContract.contractNo;
        const contract = contracts.find((item: any) => item.contractNo === contractNo);
        const zones = contractZones.filter((zone: any) => zone.contractNo === contractNo);
        const zoneNames = zones.map((zone: any) => zone.zone);
        const currentMonthRequest = await getContractTrafficRequest(zoneNames, formatLocalDate(currentMonthStart), formatLocalDate(currentMonthEnd));
        // 結合當月統計和歷史統計
        const combinedTrafficData: any = {};
        // 處理每個 zone
        let totalRequestByContract = 0;
        let totalTrafficByContract = 0;
        zoneNames.forEach((zoneName: string) => {
            let requestTotalByZone = 0;
            let trafficTotalByZone = 0;
            combinedTrafficData[zoneName] = {};
            // 1. 加入歷史統計 (從 zoneTraffic)
            const historicalData = zoneTraffic.filter((traffic: any) => traffic.zone === zoneName);
            historicalData.forEach((traffic: any) => {
                const startDate = new Date(traffic.startDate);
                const monthKey = `${startDate.getFullYear()}/${String(startDate.getMonth() + 1).padStart(2, '0')}/01`;
                
                combinedTrafficData[zoneName][monthKey] = {
                    requests: traffic.requests || 0,
                    bytes: traffic.bytes || 0
                };
                totalRequestByContract += traffic.requests || 0;
                totalTrafficByContract += traffic.bytes || 0;
                requestTotalByZone += traffic.requests || 0;
                trafficTotalByZone += traffic.bytes || 0;
            });
            // 2. 加入當月統計 (從 currentMonthRequest)
            if (currentMonthRequest[zoneName]) {
                const currentDate = new Date();
                const currentMonthKey = `${currentDate.getFullYear()}/${String(currentDate.getMonth() + 1).padStart(2, '0')}/01`;
                
                combinedTrafficData[zoneName][currentMonthKey] = {
                    requests: currentMonthRequest[zoneName].requests || 0,
                    bytes: currentMonthRequest[zoneName].bytes || 0,
                };
                totalRequestByContract += currentMonthRequest[zoneName].requests || 0;
                totalTrafficByContract += currentMonthRequest[zoneName].bytes || 0;
                requestTotalByZone += currentMonthRequest[zoneName].requests || 0;
                trafficTotalByZone += currentMonthRequest[zoneName].bytes || 0;
            }
            combinedTrafficData[zoneName].totalRequest = requestTotalByZone;
            combinedTrafficData[zoneName].totalTraffic = trafficTotalByZone;
        });
        const userIds = contractUsers.filter((item: any) => item.contractNo === contractNo).map((item: any) => item.userId);
        const newUsers = users.filter((item: any) => userIds.includes(item.userId));
        contractList.push({
            ...contract,
            users: newUsers,
            zones: zones,
            trafficData: combinedTrafficData,
            totalRequestByContract: totalRequestByContract,
            totalTrafficByContract: totalTrafficByContract,
        })
    }
    return contractList;
}

export const processMonthlyTraffic = async () => {
    const today = new Date();
    const dayOfMonth = today.getDate(); // 1-31
    
    console.log(`🗓️ 檢查是否為新月份第一天: ${today.toISOString().split('T')[0]}, 當月第${dayOfMonth}天`);
    
    // 檢查是否是每月第一天，如果是的話就查詢上個整月份的流量資訊並儲存到資料庫中
    if (dayOfMonth === 1) {
        console.log('📊 今天是新月份第一天，開始執行當前月度總結任務...');
        // 計算上個月的開始和結束時間
        const actualLastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1, 0, 0, 0, 0);
        const actualLastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
        const lastMonthTotalDays = actualLastMonthEnd.getDate();
        // 調整後的查詢範圍（因為 Cloudflare API date_gt 和 date_lt 查詢會不包含gt跟lt設定的日期，所以需要各前一天跟後一天）
        // startDate 設為上個月1號的前一天，這樣 date_gt 會從上個月1號開始查詢
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 0, 0, 0, 0, 0);
        // endDate 設為當前月1號，這樣 date_lt 會查詢到上個月最後一天
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 1, 23, 59, 59, 999);
        // 使用本地時間格式化日期（避免時區轉換問題）
        const formatLocalDate = (date: Date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        
        console.log(`實際上個月範圍: ${formatLocalDate(actualLastMonthStart)} ~ ${formatLocalDate(actualLastMonthEnd)}`);
        console.log(`API查詢範圍 (調整後): ${formatLocalDate(lastMonthStart)} ~ ${formatLocalDate(lastMonthEnd)}`);
        console.log(`上個月總天數: ${lastMonthTotalDays} 天 (${actualLastMonthStart.getFullYear()}年${actualLastMonthEnd.getMonth() + 1}月)`); 
       
        const contracts = await getActivatedContracts();
        const contractZones = await getActivatedZones();
        let totalMonthRequests: any[] = [];
        for (let contract of contracts as any[]) {
            const contractNo = contract.contractNo;
            const zones = contractZones.filter((zone: any) => zone.contractNo === contractNo);
            const zoneNames = zones.map((zone: any) => zone.zone);
            const currentMonthRequests = await getContractTrafficRequestByDays(zoneNames, lastMonthTotalDays, formatLocalDate(lastMonthStart), formatLocalDate(lastMonthEnd));
            totalMonthRequests = totalMonthRequests.concat(currentMonthRequests);
        }
        for (let request of totalMonthRequests as any[]) {
            await ZoneTraffic.create({
                zone: request.zone,
                requests: request.requests,
                bytes: request.bytes,
                startDate: actualLastMonthStart,
                endDate:  actualLastMonthEnd,
            });
        }
    } else {
        console.log('🗓️ 今天不是新月份第一天，跳過月度流量總結任務...');
    }
}

export const getLogs = async () => {
    return await Logs.findAll({ raw: true });
}

export const createContract = async (data: any) => {
    const contract = await Contracts.findOne({ where: {
        contractNo: data.contractNo
    } });
    if (!contract) {
        const newContract = await Contracts.create({
            contractNo: data.contractNo,
            plan: data.plan,
            company: data.company,
            start_date: new Date(),
            serviceCount: data.serviceCount,
        });
        await ContractResellers.create({
            contractNo: data.contractNo,
            userId: data.resellerId,
            email: data.email,
        });
        return newContract;
    } else {
        throw new Error('Contract already exists');
    }
}

export const getPlans = async () => {
    return await Plans.findAll({ raw: true });
}

export const updatePlan = async (data: any) => {
    const { name, plan_code, module, count, price, description } = data;
    const plan: any = await Plans.findOne({ where: { plan_code: plan_code } });
    if (plan) {
        plan.name = name;
        plan.module = module;
        plan.count = count;
        plan.price = price;
        plan.description = description;
        return await plan.save();
    } else {
        throw new Error(`Plan ${data.plan_code} not found`);
    }
}