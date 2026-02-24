import Sequelize from 'sequelize';
import CatoSettings from '../dao/cato_settings';
import { decodeSetting } from './f5_waf_service';
const Op = Sequelize.Op;

export const getCatoSettingsByContractNo = async (contractNo: string) => {
    const settings = await CatoSettings.findAll({
        where: {
            contractNo,terminatedDate: null,
        },
        raw: true
    });
    return settings;
}


export const createCatoSetting = async (data: any) => {
    const setting = await CatoSettings.findOne({
        where: {
            contractNo: data.contractNo,
            name: data.name,
            terminatedDate: null,
        },
    });
    if (!setting) {
        return await CatoSettings.create({
            contractNo: data.contractNo,
            name: data.name,
            connectionType: data.connectionType,
            siteType: data.siteType,
            description: data.description,
            nativeNetworkRange: data.nativeNetworkRange,
            vlan: data.vlan,
            country: data.country,
            countryCode: data.countryCode,
            city: data.city,
            terminatedDate: null,
        });
    }
    return setting;
}

export const deleteCatoSetting = async (contractNo: string, domainName: string) => {
    const setting: any = await CatoSettings.findOne({
        where: {
            contractNo, name: domainName,
            terminatedDate: null,
        },
    });
    if (setting) {
        setting.terminatedDate = new Date();
        await setting.save();
    }
    return setting;
}