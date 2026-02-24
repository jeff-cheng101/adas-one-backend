import bcrypt from 'bcryptjs';
import update from 'immutability-helper';
import Users from "../dao/users";
import ContractResellers from "../dao/contract_resellers";
import ContractUsers from "../dao/contract_users";

export const getUsers = async () => {
    return await Users.findAll({ raw: true });
}

export const getUserById = async (id: any) => {
    return await Users.findByPk(id);
}

export const getUserByUsersId = async (userId: string) => {
    return await Users.findOne({
        raw: true,
        where: { userId }
    });
}

export const getUserByEmail = async (email: string) => {
    return await Users.findOne({
        raw: true,
        where: { email }
    });
}

export const getUserByUsersIdAndEmail = async (userId: string, email: string) => {
    return await Users.findOne({
        raw: true,
        where: { userId, email }
    });
}

export const getResellers = async () => {
    return await Users.findAll({ raw: true, where: { role: 'reseller' } });
}

export const getUserContractByUserId = async (userId: string) => {
    return await ContractUsers.findOne({
        raw: true,
        where: { userId }
    });
}

export const getUsersInfo = async () => {
    const users = await Users.findAll({ raw: true });
    const resellers = users.filter((user: any) => user.role === 'reseller');
    const resellerContractList = await ContractResellers.findAll({
        raw: true,
        where: { userId: resellers.map((reseller: any) => reseller.userId) }
    });
    const resellerList = resellers.map((reseller: any) => {
        return {
            ...reseller,
            contracts: resellerContractList.filter((contract: any) => contract.userId === reseller.userId)
        }
    })
    
    const endUsers = users.filter((user: any) => user.role === 'user');
    const endUserContractList = await ContractUsers.findAll({
        raw: true,
        where: { userId: endUsers.map((user: any) => user.userId) }
    });
    const endUserList = endUsers.map((user: any) => {
        return {
            ...user,
            contracts: endUserContractList.filter((contract: any) => contract.userId === user.userId)
        }
    })
    
    return { reseller: resellerList, endUser: endUserList };
}

export const createReseller = async (data: any) => {
    let reseller: any = await Users.findOne({ where: { userId: data.userId } });
    if (reseller) {
        throw new Error(`Reseller ${data.userId} already exists`);
    } else {
        const plainPassword = data.password;
        const password = bcrypt.hashSync(plainPassword, 10);
        return await Users.create({
            userId: data.userId,
            email: data.email,
            password: password,
            company: data.company,
            name: data.name,
            phone: data.phone,
            role: 'reseller'
        });
    }
}

export const updateReseller = async (data: any) => {
    let reseller: any = await Users.findOne({ where: { userId: data.userId } });
    if (reseller) {
        reseller.company = data.company;
        reseller.name = data.name;
        reseller.phone = data.phone;
        return await reseller.save();
    } else {
        throw new Error(`Reseller ${data.userId} not found`);
    }
}

export const createUser = async (data: any) => {
    let user: any = await Users.findOne({ where: { userId: data.userId } });
    if (!user) {
        const plainPassword = data.password;
        const password = bcrypt.hashSync(plainPassword, 10);
        const user = await Users.create({
            userId: data.userId,
            email: data.email,
            password: password,
            company: data.company,
            name: data.name,
            phone: data.phone,
            role: 'user'
        });
        await ContractUsers.create({
            contractNo: data.contractNo,
            userId: data.userId,
            email: data.email
        });
        return user;
    } else {
        throw new Error(`User ${data.userId} already exists`);
    }
}

export const updateUser = async (data: any) => {
    let user: any = await Users.findOne({ where: { userId: data.userId } });
    if (user) {
        user.company = data.company;
        user.name = data.name;
        user.phone = data.phone;
        return await user.save();
    } else {
        throw new Error(`User ${data.userId} not found`);
    }
}

export const resetUserPassword = async (data: any) => {
    const user: any = await Users.findOne({ where: { email: data.email } });
    if (user) {
        user.password = data.hashedPassword;
        user.resetPasswordToken = null,
        user.resetPasswordExpires = null,
        user.lastPasswordReset = new Date()
        return await user.save();
    } else {
        throw new Error(`User ${data.email} not found`);
    }
}