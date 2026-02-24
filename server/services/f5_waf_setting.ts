import Sequelize from 'sequelize';
import F5WafSettings from '../dao/f5_waf_settings';
import { decodeSetting } from './f5_waf_service';
const Op = Sequelize.Op;

export const getF5ServicesByContractNo = async (contractNo: string) => {
    const settings = await F5WafSettings.findAll({
        where: {
            contractNo,terminatedDate: null,
        },
        raw: true
    });
    if (settings.length > 0) {
        const newSettings = settings.map((setting: any) => decodeSetting(setting));
        return newSettings;
    } else {
        return [];
    }
}

export const getF5ServiceByContractNoAndDomainName = async (contractNo: string, domainName: string) => {
    const setting = await F5WafSettings.findOne({
        where: {
            contractNo,
            domainName,
            terminatedDate: null,
        },
    });
    return setting;
}

export const createF5WafSetting = async (data: any) => {
    const setting = await F5WafSettings.findOne({
        where: {
            contractNo: data.contractNo,
            domainName: data.domainName,
            terminatedDate: null,
        },
    });
    if (!setting) {
        return await F5WafSettings.create({
            contractNo: data.contractNo,
            domainName: data.domainName,
            nodeIp: data.nodeIp,
            ports: JSON.stringify(data.ports),
            sslPorts: JSON.stringify(data.sslPorts),
            virtualServerIp: data.virtualServerIp,
            terminatedDate: null,
        });      
    }
    return setting;
}

export const updateF5WafSetting = async (data: any) => {
    const setting: any = await F5WafSettings.findOne({
        where: {
            contractNo: data.contractNo,
            domainName: data.domainName,
            terminatedDate: null,
        },
    });
    if (setting) {
        setting.nodeIp = data.nodeIp;
        setting.ports = JSON.stringify(data.ports);
        setting.sslPorts = JSON.stringify(data.sslPorts);
        await setting.save();
    }
    return setting;
}

export const deleteF5WafSetting = async (data: any) => {
    const setting: any = await F5WafSettings.findOne({
        where: {
            contractNo: data.contractNo,
            domainName: data.domainName,
            terminatedDate: null,
        },
    });
    if (setting) {
        setting.terminatedDate = new Date();
        await setting.save();
    }
    return setting;
}