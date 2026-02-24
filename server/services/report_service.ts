import puppeteer from 'puppeteer'
import moment from 'moment';
import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'
import { PDFDocument } from "pdf-lib";
import { v4 as uuidv4 } from 'uuid'
import config from '../config/config'
import Reports from '../dao/reports'
import Logs from '../dao/logs'
import { setRedis, getRedis, removeRedis, redisExpireForFifthSecond } from '../dao/database/redis'
import { dailyReportRange, weeklyReportRange, monthlyReportRange } from '../middleware/date_range_generator'
import { getActivatedZones } from './cloudflare_setting'
import { getCloudflareDnsByZones } from './cloudflare_service'

declare const window: any
declare const document: any

interface ReportSchedule {
  id: string
  type: 'daily' | 'weekly' | 'monthly' | 'custom'
  contractNo: string
  dashboardIds: string[]
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text?: string
  customDate?: string
  customTime?: string
  lastSent?: Date
  status: 'active' | 'inactive'
}

interface KibanaConfig {
  protocol: string
  host: string
  space: string
  username?: string
  password?: string
}

const kibanaConfig: KibanaConfig = {
  protocol: config.kibanaProtocol || 'https',
  host: config.kibanaHost || '10.168.10.250:5601',
  space: config.kibanaSpace || 'adasone'
}


const dashboardConfigs = [
  {
    id: "12e3a168-554f-4d9d-9ff3-d0095a211135",
    name: "安全監控總覽",
    description: "主要安全事件監控和威脅檢測"
  },
  {
    id: "85aeb500-3425-4bbd-a80e-1f5dc7c39383", 
    name: "網路流量分析",
    description: "網路流量模式和異常檢測"
  },
  {
    id: "d48ac77a-d5eb-4783-a1d2-4dca5701ca34",
    name: "威脅情報分析", 
    description: "威脅情報和攻擊趨勢分析"
  }
]

export const getEmailReport = async (contractNo: string) => {
    const reports = await Reports.findAll({
        raw: true,
        where: {
            contractNo
        }
    });
    
    const newReports = reports.map((report: any) => {
        if (report.customDate) {
            const date = new Date(report.customDate);
            // 轉換為台北時間
            const taipeiDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
            const customDate = taipeiDate.toISOString().split('T')[0]; // YYYY-MM-DD
            const customTime = taipeiDate.toISOString().split('T')[1].replace('.000Z', ''); // HH:MM:SS
            
            return {
                id: report.id,
                scheduleType: report.type,
                name: report.name,
                subject: report.subject,
                recipients: report.to,
                cc: report.cc || '',
                bcc: report.bcc || '',
                content: report.text || '',
                customDate: customDate,
                customTime: customTime,
                reportStartDate: new Date(),
                reportEndDate: new Date(),
                lastSent: report.lastSent || '',
                status: report.status || 'active'
            };
        } else {
            return {
                id: report.id,
                scheduleType: report.type,
                name: report.name,
                subject: report.subject,
                recipients: report.to,
                cc: report.cc || '',
                bcc: report.bcc || '',
                content: report.text || '',
                customDate: '',
                customTime: '',
                reportStartDate: new Date(),
                reportEndDate: new Date(),
                lastSent: report.lastSent || '',
                status: report.status || 'active'
            }
        }
    });
    return newReports;
}

export const createEmailReport = async (data: any) => {
    const { scheduleType, name, subject, recipients, cc, bcc, content, customDate, customTime, contractNo, reportStartDate, reportEndDate } = data;
    
    let combinedCustomDate = null;
    // 處理自訂排程的日期時間結合
    if (scheduleType === 'custom' && customDate && customTime) {
        // 結合 customDate (YYYY-MM-DD) 和 customTime (HH:MM:SS)
        combinedCustomDate = `${customDate} ${customTime}`;
    } else if (scheduleType === 'immediate' && reportStartDate && reportEndDate) {
        combinedCustomDate = new Date();
    }
    
    return await Reports.create({
        type: scheduleType,
        name,
        contractNo,
        subject,
        to: recipients,
        cc,
        bcc,
        text: content,
        customDate: combinedCustomDate,
        status: 'active'
    });
}

export const updateEmailReport = async (data: any) => {
    const { id, scheduleType, name, subject, recipients, cc, bcc, content, customDate, customTime, contractNo, reportStartDate, reportEndDate } = data;
    const report: any = await Reports.findOne({ where: { id: id, contractNo }})
    if (report) {
        let combinedCustomDate = null;
        if (scheduleType === 'custom' && customDate && customTime) {
            combinedCustomDate = `${customDate} ${customTime}`;
        } else if (scheduleType === 'immediate' && reportStartDate && reportEndDate) {
            combinedCustomDate = new Date();
        }
        report.type = scheduleType;
        report.name = name;
        report.subject = subject;
        report.to = recipients;
        report.cc = cc;
        report.bcc = bcc;
        report.text = content;
        report.customDate = combinedCustomDate;
        report.status = 'active';
        await report.save();
        return report;
    } else {
        throw new Error('報表設定不存在');
    }
}

export const deleteEmailReport = async (id: number, contractNo: string) => {
    const result = await Reports.destroy({ where: { id, contractNo }});
    if (result === 0) {
        throw new Error('報表設定不存在或無權限刪除');
    }
    return result;
}

export async function findDailyReportDashboardRecipientsSettings() {
    return await Reports.findAll({
        where: {
            type: 'daily',
            status: 'active'
        }
    });
}

export async function findWeeklyReportDashboardRecipientsSettings() {
    return await Reports.findAll({
        where: {
            type: 'weekly',
            status: 'active'
        }
    });
}

export async function findMonthlyReportDashboardRecipientsSettings() {
    return await Reports.findAll({
        where: {
            type: 'monthly',
            status: 'active'
        }
    });
}

// export async function generateCustomReport(dashboardIds: string[], period: any) {
//     const { start, end } = period;
//     const reports = await generateMultipleDashboardReports(dashboardIds, moment(start).toDate(), moment(end).toDate());
//     const result = {
//         startTime: start,
//         endTime: end,
//         reports: reports,
//     }
//     return result;
// }

// export async function generateDailyReport(dashboardIds: string[], reportDate: Date) {
//     const { startTime, endTime } = dailyReportRange(reportDate);
//     return {
//         startTime: startTime,
//         endTime: endTime,
//         pdf: await generateMultipleDashboardReports(dashboardIds, startTime, endTime),
//         dashboardIds: dashboardIds
//     };
// }

// export async function generateWeeklyReport(dashboardIds: string[], offset = 0, reportDate: Date) {
//     const { startTime, endTime } = weeklyReportRange(offset, reportDate);
//     return {
//         startTime: startTime,
//         endTime: endTime,
//         pdf: await generateMultipleDashboardReports(dashboardIds, startTime, endTime),
//         dashboardIds: dashboardIds
//     };
// }

// export async function generateMonthlyReport(dashboardIds: string[], offset = 0, reportDate: Date) {
//     const { startTime, endTime } = monthlyReportRange(offset, reportDate);
//     return {
//         startTime: startTime,
//         endTime: endTime,
//         pdf: await generateMultipleDashboardReports(dashboardIds, startTime, endTime),
//         dashboardIds: dashboardIds
//     };
// }

// 生成單一儀表板截圖
export async function generateSingleDashboardReport(dashboardId: string, startTime: Date, endTime: Date, subDomains: string[]): Promise<Buffer> {
    const uuid = uuidv4();
    await setRedis(uuid, JSON.stringify({
        user: {
            id: 0,
            userId: '',
            userName: '',
            email: '',
            mobile: '',
            phone: '',
        },
        temporary: true
    }));
    redisExpireForFifthSecond(uuid);

    const basePath = config.basePath || '';
    let puppeteerSetting: any = { 
        headless: true, 
        protocolTimeout: 120000, // 設置協議超時為 2 分鐘，避免 deleteCookies 超時
        defaultViewport: null, // 避免 viewport 相關問題
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            // 字體支援相關
            '--font-render-hinting=none',
            '--enable-font-antialiasing',
            '--disable-font-subpixel-positioning',
            '--force-color-profile=srgb',
            // 圖形支援
            '--use-gl=egl',
            '--enable-webgl',
            '--enable-webgl2',
            '--use-gl=swiftshader',
            '--disable-gpu-sandbox',
            // 安全性設定 - 更強力的SSL錯誤忽略
            '--ignore-certificate-errors',
            '--ignore-ssl-errors',
            '--ignore-certificate-errors-spki-list',
            '--disable-web-security',
            '--allow-running-insecure-content',
            '--ignore-ssl-errors-list',
            '--ignore-urlfetcher-cert-requests',
            '--disable-certificate-transparency',
            '--disable-cert-verifier-logs',
            '--allow-deprecated-sha1-signatures',
            '--disable-extensions-http-throttling',
            // 效能優化
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-features=VizDisplayCompositor,TranslateUI',
            '--disable-ipc-flooding-protection',
            // 其他必要設定
            '--disable-default-apps',
            '--disable-extensions',
            '--no-first-run',
            '--disable-background-networking',
            '--mute-audio',
            // 網絡相關優化，減少超時風險
            '--disable-background-media-low-priority-optimization',
	    '--disable-client-side-phishing-detection',
	    '--lang=zh-TW'
        ], 
        ignoreHTTPSErrors: true 
    };
    // if (config.chromiumBrowser) {
    //     puppeteerSetting.executablePath = config.chromiumBrowser;
    // }
    puppeteerSetting.executablePath = '/usr/bin/chromium-browser'

    let pdf: any;
    let browser: any;
    try {
        console.log('CONSOLE=> <dashboard_report_service>:<generateSingleDashboardReport>:Generate report');
        browser = await puppeteer.launch(puppeteerSetting);
    	console.log('Generate report');

        // 限制於五分鐘內產pdf，逾時吐Time Limit Exceeded!訊息
        const timeoutPromise = new Promise((resolve, reject) => {
            setTimeout(resolve, 300000, 'Time Limit Exceeded!!!');
        });
        const generatePdf = new Promise(async(resolve, reject) => {
            try {
                let newPdf = await doPage(browser, uuid, basePath, dashboardId, startTime, endTime, subDomains);
                resolve(newPdf);
            } catch (error) {
                console.error(`doPage 執行失敗:`, error);
                reject(error);
            }
        })

        pdf = await Promise.race([timeoutPromise, generatePdf]);
        if (pdf === 'Time Limit Exceeded!!!') throw new Error('Time Limit Exceeded!!!');

    } catch (error) {
        console.error(`生成儀表板截圖失敗: ${dashboardId}`, error)
        console.log(`CONSOLE=> <dashboard_report_service>:<generateSingleDashboardReport>:Generate report failed then try again, dashboardId: ${dashboardId}`);
        console.log(error);
        console.log('Try regenerate report again');

        // 限制於五分鐘內產pdf，逾時吐Time Limit Exceeded!訊息
        const timeoutPromise = new Promise((resolve, reject) => {
            setTimeout(resolve, 300000, 'Time Limit Exceeded!!!');
        });
        const generatePdf = new Promise(async(resolve, reject) => {
            try {
                let newPdf = await doPage(browser, uuid, basePath, dashboardId, startTime, endTime, subDomains);
                resolve(newPdf);
            } catch (error) {
                console.error(`doPage 執行失敗:`, error);
                reject(error);
            }
        })
        pdf = await Promise.race([timeoutPromise, generatePdf]);
    } finally {
      if (browser) {
        await browser.close()
      }
    }
    
    return pdf
}

// 生成多個儀表板報表
export async function generateMultipleDashboardReports(dashboardIds: string[], startTime: Date, endTime: Date, subDomains: string[]): Promise<{name: string, pdf: Buffer}[]> {
    const reports = [];
    
    for (let i = 0; i < dashboardIds.length; i++) {
        const dashboardId = dashboardIds[i];
        try {
            const pdf = await generateSingleDashboardReport(dashboardId, startTime, endTime, subDomains);
            
            // 找到對應的 dashboard 名稱
            const dashboardConfig = dashboardConfigs.find(config => config.id === dashboardId);
            const dashboardName = dashboardConfig ? dashboardConfig.name : `Dashboard_${i + 1}`;
            
            reports.push({
                name: dashboardName,
                pdf: pdf
            });
            
            console.log(`✅ 儀表板 ${dashboardName} 報表生成成功`);
            
        } catch (error) {
            console.error(`❌ 儀表板 ${dashboardId} 報表生成失敗:`, error);
            throw error;
        }
    }
    
    console.log(`🎉 完成 ${reports.length}/${dashboardIds.length} 個儀表板報表生成`);
    return reports;
}

// 等待函數
function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 生成 PDF 報表 - 使用 PNG 轉 PDF 方法
export async function doPage(browser: any, uuid: string, basePath: string, dashboardId: string, startTime: Date, endTime: Date, subDomains: string[]) {
    let page: any = null;
    
    try {
        page = await browser.newPage();
        
        // 設置頁面錯誤處理
        page.on('error', (error: any) => {
            console.error('頁面錯誤:', error);
        });
        
        page.on('pageerror', (error: any) => {
            console.error('頁面 JavaScript 錯誤:', error);
        });
        
        // 設置更強的安全選項
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.8,en-US;q=0.5,en;q=0.3',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        });
        
        // 忽略所有安全警告
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 攔截網絡請求，處理失敗的請求
        await page.setRequestInterception(true);
        page.on('request', (request: any) => {
            // 只允許必要的資源類型
            const resourceType = request.resourceType();
            if (['image', 'font', 'media'].includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });
        
        page.on('requestfailed', (request: any) => {
            const failure = request.failure();
            if (failure) {
                console.warn(`⚠️ 請求失敗: ${request.url()} - ${failure.errorText}`);
            }
        });

        await page.setCookie({
            domain: 'localhost',
            name: 'tk',
            value: uuid,
            expires: (Date.now() / 1000) + 10,
            path: '/',
        });
        await page.setCookie({
            domain: 'localhost',
            name: 'bde_spell',
            value: 'set_kibana_free',
            expires: (Date.now() / 1000) + 10,
            path: '/',
	    });


        await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' });
        await page.addStyleTag({
            content: `body { font-family: "Noto Sans CJK SC", "WenQuanYi Zen Hei", sans-serif !important; }`
        });
            
        // 使用固定的測試 URL
        const url = buildKibanaUrl(dashboardId, startTime, endTime, subDomains)
        console.log(`導航到: ${url}`);

        // // 設定頁面事件監聽
        // page.on('console', (message: any) => console.log(`${message.type().substr(0, 3).toUpperCase()} ${message.text()}`));
        // page.on('pageerror', ({ message }: any) => console.log(message));
        // page.on('response', (response: any) => console.log(`${response.status()} ${response.url()}`));
        // page.on('requestfailed', (request: any) => console.log(`${request.failure().errorText} ${request.url()}`));
        
        // 添加重試機制的頁面導航
        let navigationSuccess = false
        let lastError: any = null
        const maxRetries = 3
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🌐 嘗試導航 (第 ${attempt}/${maxRetries} 次): ${url}`)
                
                await page.goto(url, { 
                    waitUntil: 'networkidle0', 
                    timeout: 90000,
                    // 忽略 HTTPS 錯誤
                    ignorehttpsErrors: true
                })
                
                navigationSuccess = true
                console.log(`✅ 頁面導航成功 (第 ${attempt} 次嘗試)`)
                break
                
            } catch (error: any) {
                lastError = error
                console.error(`❌ 頁面導航失敗 (第 ${attempt}/${maxRetries} 次): ${error.message}`)
                
                if (attempt < maxRetries) {
                    console.log(`⏳ 等待 ${attempt * 2} 秒後重試...`)
                    await wait(attempt * 2000) // 遞增等待時間
                }
            }
        }
        
        if (!navigationSuccess) {
            throw new Error(`頁面導航失敗，已重試 ${maxRetries} 次。最後錯誤: ${lastError?.message || 'Unknown error'}`)
        }

        // 等待頁面載入
        console.log('⏰ 等待 5 秒讓頁面完全載入...');
        await wait(5000);

        // 第一步：隱藏 navbar 和 filter 元素
        console.log('step1: 隱藏 navbar 和 filter 元素...');
        await page.addStyleTag({
            content: `
                /* 隱藏頂部導航和過濾器 */
                [data-test-subj="headerGlobalNav"], [data-test-subj="top-nav"], .kbn-top-nav, .euiHeader,
                .globalHeaderBreadcrumb, .kbnTopNavMenu, [data-test-subj="globalFilterGroup"],
                [data-test-subj="queryInput"], [data-test-subj="globalFilterItem"], [data-test-subj*="filter"],
                .euiFilterButton, .globalFilterItem, .globalFilterGroup, .kbnQueryBar, .filterBar,
                [data-test-subj="breadcrumbs"], [data-test-subj="superDatePickerToggleQuickMenuButton"],
                [data-test-subj="superDatePickerToggleRefreshButton"], .euiCallOut--danger,
                [data-test-subj*="errorMessage"] {
                    display: none !important;
                }
                
                /* 調整主容器 */
                .kbnAppWrapper { padding-top: 20px !important; }
                .layout-fixed-header { top: 0 !important; }
                
                /* 🎯 字體清晰度優化 */
                * {
                    font-family: "Microsoft JhengHei", "PingFang SC", "Arial", "DejaVu Sans", "Liberation Sans", sans-serif !important;
                    -webkit-font-smoothing: antialiased !important;
                    -moz-osx-font-smoothing: grayscale !important;
                    text-rendering: optimizeLegibility !important;
                }
                
                /* 📊 表格和圖表文字清晰度加強 */
                .euiDataGrid, .euiDataGridRowCell, .euiText, .euiTitle {
                    -webkit-font-smoothing: antialiased !important;
                    -moz-osx-font-smoothing: grayscale !important;
                    text-rendering: optimizeLegibility !important;
                    font-weight: 500 !important;
                }
                
                /* 📈 圖表內文字清晰度優化 */
                .visAxis__labels, .visAxisLabel, .tick text, .domain text,
                svg text, .chart text, .visualization text, .axis text,
                [data-test-subj*="chart"] text, [data-test-subj*="vis"] text {
                    -webkit-font-smoothing: antialiased !important;
                    -moz-osx-font-smoothing: grayscale !important;
                    text-rendering: optimizeLegibility !important;
                    font-size: 12px !important;
                    font-weight: 600 !important;
                    fill: #333 !important;
                }

                /* 商務報表，隱藏地圖，拉寬右邊table */
                .css-rsgry1 {
                    display: none !important;
                }
                .css-bhvk2v {
                    grid-area: 32 / 1 / 49 / 49 !important;
                }
                /* 網路報表，隱藏地圖，拉寬右邊table */
                .css-1nbfgc9  {
                    display: none !important;
                }
                .css-18oeyfr {
                    grid-area: 34 / 1 / 41 / 26 !important;
                }
                .css-15mql3z {
                    grid-area: 34 / 26 / 51 / 49 !important;
                }
                    
                .lnsWorkspaceWarning__button {
                    display: none !important;
                }
            `
        });
        
        await wait(1000);
        
        // 物理移除元素以減少高度
        console.log('物理移除隱藏元素以減少高度...');
        await page.evaluate(() => {
            const selectorsToRemove = [
                '[data-test-subj="globalQueryBar"]',
                'hr'
            ];
            let removedCount = 0;
            selectorsToRemove.forEach(selector => {
                try {
                    const elements = document.querySelectorAll(selector);
                    console.log('selector:', selector);
                    console.log('elements:', elements);
                    elements.forEach((element: any) => {
                        if (element && element.parentNode) {
                            console.log('移除元素:', selector);
                            element.parentNode.removeChild(element);
                            removedCount++;
                        }
                    });
                } catch (e) {
                    console.log('❌ 移除失敗:', selector, (e as Error).message);
                }
            });
            const eee = document.querySelectorAll('.css-1a1o4nv');
            eee.forEach((element: any) => {
                element.style.gridArea = '32 / 1 / 49 / 49 !important';
            });
            
            console.log(`✅ 總共移除了 ${removedCount} 個元素`);
            
            // 強制重新計算布局高度
            document.body.style.height = 'auto';
            document.documentElement.style.height = 'auto';
            document.body.offsetHeight;
        });
        
        await wait(500);
        
        // 第三步：添加時間區段顯示
        console.log('step3：添加時間區段顯示...');
        
        // 使用函數參數中的實際時間範圍
        const formatDate = (date: Date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
        };
        
        // 確保傳入的是 Date 物件
        const startDate = startTime instanceof Date ? startTime : new Date(startTime);
        const endDate = endTime instanceof Date ? endTime : new Date(endTime);
        const timeRange = `${formatDate(startDate)} ~ ${formatDate(endDate)}`;
        
        console.log('檢測到的時間範圍:', timeRange);
        
        await page.addStyleTag({
            content: `
                /* 減少頂部留白並設定定位 */
                body { 
                    padding-top: 0 !important; 
                    margin-top: 0 !important; 
                    position: relative !important;
                }
                .kbnAppWrapper { padding-top: 25px !important; position: relative !important; }
                
                body::before {
                    content: "報表時間範圍：${timeRange}" !important;
                    position: absolute !important;
                    top: 10px !important;
                    right: 10px !important;
                    background: rgba(255, 255, 255, 0.98) !important;
                    border: 2px solid #2c3e50 !important;
                    border-radius: 8px !important;
                    padding: 10px 16px !important;
                    font-size: 13px !important;
                    font-weight: 700 !important;
                    color: #2c3e50 !important;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1) !important;
                    z-index: 10000 !important;
                    font-family: 'Microsoft YaHei', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif !important;
                    white-space: nowrap !important;
                    -webkit-font-smoothing: antialiased !important;
                    -moz-osx-font-smoothing: grayscale !important;
                    text-rendering: optimizeLegibility !important;
                    display: block !important;
                    width: auto !important;
                    height: auto !important;
                    font-feature-settings: "kern" 1 !important;
                }
                
                /* 全域文字清晰度改善 */
                * {
                    -webkit-font-smoothing: antialiased !important;
                    -moz-osx-font-smoothing: grayscale !important;
                    text-rendering: optimizeLegibility !important;
                }
                
                /* 特別針對表格和圖表文字 */
                .euiDataGrid, .euiDataGridRowCell, .euiText, .euiTitle {
                    -webkit-font-smoothing: antialiased !important;
                    -moz-osx-font-smoothing: grayscale !important;
                    text-rendering: optimizeLegibility !important;
                    font-feature-settings: "kern" 1 !important;
                }
                
                /* 特別提高折線圖內文字清晰度 */
                .visAxis__labels, .visAxisLabel, .tick text, .domain text,
                svg text, .chart text, .visualization text, .axis text,
                [data-test-subj*="chart"] text, [data-test-subj*="vis"] text {
                    -webkit-font-smoothing: antialiased !important;
                    -moz-osx-font-smoothing: grayscale !important;
                    text-rendering: optimizeLegibility !important;
                    font-feature-settings: "kern" 1 !important;
                    font-size: 11px !important;
                    font-weight: 500 !important;
                    fill: #333 !important;
                }
                
                /* 針對時間軸和數值軸的文字 */
                .euiFlexGroup .visAxis text,
                .euiPanel svg text,
                .visualization svg text {
                    -webkit-font-smoothing: antialiased !important;
                    -moz-osx-font-smoothing: grayscale !important;
                    text-rendering: optimizeLegibility !important;
                    font-weight: 600 !important;
                }
            `
        });
        await page.evaluate(() => {
            // 移除任何可能造成分頁或截斷的 CSS
            const style = document.createElement('style');
            style.textContent = `
                /* 確保所有內容連續顯示 */
                * {
                    page-break-before: avoid !important;
                    page-break-after: avoid !important;
                    page-break-inside: avoid !important;
                    break-before: avoid !important;
                    break-after: avoid !important;
                    break-inside: avoid !important;
                }
                
                /* 確保body和html能顯示完整內容 */
                body, html {
                    overflow: visible !important;
                    height: auto !important;
                    max-height: none !important;
                    min-height: auto !important;
                }
                
                /* 🎯 確保body保持相對定位以支援時間區間顯示 */
                body {
                    position: relative !important;
                }
                
                /* 確保所有容器都能完整顯示 */
                .euiPage, .euiPageBody, .kbnAppWrapper {
                    overflow: visible !important;
                    height: auto !important;
                    max-height: none !important;
                }
                
                /* 🎯 強化圖表容器不會被截斷 */
                .visualization, .euiPanel, .react-grid-item, 
                .dashboard, .kbnAppWrapper, .euiPage, .euiPageBody,
                [data-test-subj*="dashboard"], [data-test-subj*="panel"] {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                    overflow: visible !important;
                    -webkit-column-break-inside: avoid !important;
                    column-break-inside: avoid !important;
                }
                
                /* 🎯 確保整個儀表板作為單一連續內容 */
                .dashboard-container, .grid-stack, .react-grid-layout {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                    height: auto !important;
                    min-height: auto !important;
                }
            `;
            document.head.appendChild(style);
            
            console.log('✅ 已設定完整頁面顯示CSS');
        });

    
        // 強制提高 SVG 圖表渲染品質
        await page.evaluate(() => {
            const svgs = document.querySelectorAll('svg');
            svgs.forEach((svg: any) => {
                svg.style.shapeRendering = 'geometricPrecision';
                svg.style.textRendering = 'geometricPrecision';
                svg.setAttribute('shape-rendering', 'geometricPrecision');
                svg.setAttribute('text-rendering', 'geometricPrecision');
                
                // 改善 SVG 內文字的渲染
                const texts = svg.querySelectorAll('text');
                texts.forEach((text: any) => {
                    text.style.fontFamily = 'Microsoft YaHei, PingFang SC, Arial, sans-serif';
                    text.style.fontWeight = '600';
                    text.style.fontSize = '12px';
                    text.setAttribute('text-rendering', 'geometricPrecision');
                    text.setAttribute('shape-rendering', 'geometricPrecision');
                });
            });
            
            console.log('已優化', svgs.length, '個 SVG 圖表的渲染品質');
        });
        
        await wait(1000);
        
        const actualPageSize = await page.evaluate(() => {
            // 確保所有內容都可見
            document.body.style.overflow = 'visible';
            document.documentElement.style.overflow = 'visible';
            
            // 獲取實際內容大小
            const body = document.body;
            const html = document.documentElement;
            
            const height = Math.max(
                body.scrollHeight,
                body.offsetHeight,
                html.clientHeight,
                html.scrollHeight,
                html.offsetHeight
            );
            
            const width = Math.max(
                body.scrollWidth,
                body.offsetWidth,
                html.clientWidth,
                html.scrollWidth,
                html.offsetWidth
            );
            
            console.log('🎯 檢測到的頁面實際尺寸:', { width, height });
            return { width, height };
        });
        
        await page.setViewport({
            width: Math.max(1920, actualPageSize.width),
            height: 1080,                 // 固定一個正常螢幕高度就好
            deviceScaleFactor: 2
        });
        
        await wait(2000);
        
        // 先截圖保存為 PNG
        const screenshot = await page.screenshot({
            fullPage: true,
            type: 'png'
        });
        
        console.log('✅ PNG 截圖完成');
        
        // 將 PNG 轉換為 PDF
        const pdf = await convertPngToPdf(screenshot);
        
        console.log('✅ PDF 生成成功');
        return pdf;
    
    } catch (error: any) {
        console.error('🚫 doPage 執行過程中發生錯誤:', error);
        
        // 記錄詳細錯誤信息
        const errorInfo = {
            dashboardId,
            message: error.message,
            stack: error.stack,
            url: buildKibanaUrl(dashboardId, startTime, endTime, subDomains),
            timestamp: new Date().toISOString()
        };
        
        console.error('錯誤詳情:', JSON.stringify(errorInfo, null, 2));
        
        // 拋出錯誤讓上層處理
        throw new Error(`報表生成失敗 (${dashboardId}): ${error.message}`);
        
    } finally {
        // 確保頁面被關閉
        if (page && !page.isClosed()) {
            try {
                await page.close();
                console.log('✅ 頁面已安全關閉');
            } catch (closeError) {
                console.error('⚠️ 關閉頁面時發生錯誤:', closeError);
            }
        }
    }
}


// 建構 Kibana URL（包含 filter）
function buildKibanaUrl(
    dashboardId: string, 
    startTime: Date | string,
    endTime: Date | string,
    subDomains: string[]
  ): string {
    // 確保 startTime 和 endTime 是 Date 物件
    const startDate = startTime instanceof Date ? startTime : new Date(startTime);
    const endDate = endTime instanceof Date ? endTime : new Date(endTime);
    const baseUrl = `${kibanaConfig.protocol}://${kibanaConfig.host}`
    
    // 建構 filter
    let filtersSection = '!()'
    
    if (!subDomains || subDomains.length === 0) {
      // 如果沒有域名，使用一個永遠不會匹配的filter來顯示空結果
      const emptyFilter = `(meta:(alias:!n,disabled:!f,key:ClientRequestHost,negate:!f,type:phrase,params:(query:'__no_match_ever__')),query:(match_phrase:(ClientRequestHost:'__no_match_ever__')))`
      filtersSection = `!(${emptyFilter})`
    } else {
      // 建構包含所有域名的 terms filter
      const termsFilter = `(meta:(alias:!n,disabled:!f,key:ClientRequestHost,negate:!f,type:phrases,params:!(${subDomains.map(h => `'${h}'`).join(',')})),query:(terms:(ClientRequestHost:!(${subDomains.map(h => `'${h}'`).join(',')}))))`
      filtersSection = `!(${termsFilter})`
    }
    
    // 使用 ISO 字串格式，與你提供的範例一致
    const kibanaGlobalState = `(filters:${filtersSection},refreshInterval:(pause:!t,value:60000),time:(from:'${startDate.toISOString()}',to:'${endDate.toISOString()}'))`
    
    // 建構完整的dashboard URL
    const dashboardUrl = `${baseUrl}/s/${kibanaConfig.space}/app/dashboards#/view/${dashboardId}?_g=${kibanaGlobalState}`
    
    console.log('=== Kibana URL 構建詳情 ===');
    console.log('Base URL:', baseUrl);
    console.log('Dashboard ID:', dashboardId);
    console.log('時間範圍:', startDate.toISOString(), '到', endDate.toISOString());
    console.log('子域名:', subDomains);
    console.log('篩選器段落:', filtersSection);
    console.log('完整 URL:', dashboardUrl);
    console.log('=========================');
    
    // 添加embed參數
    const embedParams = new URLSearchParams()
    embedParams.append('embed', 'true')
    embedParams.append('show-top-menu', 'false')
    embedParams.append('hide-filter-bar', 'true')
    
    return `${dashboardUrl}&${embedParams.toString()}`
}

// PNG 轉 PDF 輔助函數
async function convertPngToPdf(pngBuffer: Buffer): Promise<Buffer> {
    let browser: any = null;
    try {
        const pdfDoc = await PDFDocument.create();
        const img = await pdfDoc.embedPng(pngBuffer);
        const { width, height } = img.size();   // 👈 用實際圖片尺寸，不要用 scale(1)
        const page1 = pdfDoc.addPage([width, height]);
        page1.drawImage(img, { x: 0, y: 0, width, height });

        const pdf = await pdfDoc.save();
                
        console.log('✅ PNG 轉 PDF 完成');
        return Buffer.from(pdf);
        // browser = await puppeteer.launch({
        //     headless: true,
        //     // executablePath: '/usr/bin/chromium-browser',
        //     args: ['--no-sandbox', '--disable-setuid-sandbox',]
        // });
        
        // const page = await browser.newPage();
        // // 🎯 設定高解析度viewport以提高字體清晰度
        // await page.setViewport({
        //     width: 1920,
        //     height: 1080,
        //     deviceScaleFactor: 3 
        // });
        // // 將 PNG 轉為 base64
        // const base64Image = pngBuffer.toString('base64');
        // const dataUri = `data:image/png;base64,${base64Image}`;
        // // 創建包含圖片的 HTML
        // // 創建包含圖片的 HTML，並優化字體清晰度
        // const html = `
        //     <html>
        //         <head>
        //             <style>
        //                 /* 🎯 字體清晰度優化 */
        //                 * {
        //                     -webkit-font-smoothing: antialiased !important;
        //                     -moz-osx-font-smoothing: grayscale !important;
        //                     text-rendering: optimizeLegibility !important;
        //                     font-feature-settings: "kern" 1 !important;
        //                 }
        //                 body {
        //                     margin: 0;
        //                     padding: 0;
        //                     -webkit-print-color-adjust: exact !important;
        //                     color-adjust: exact !important;
        //                 }
        //                 img {
        //                     width: 100%;
        //                     height: auto;
        //                     display: block;
        //                     image-rendering: -webkit-optimize-contrast !important;
        //                     image-rendering: crisp-edges !important;
        //                 }
        //             </style>
        //         </head>
        //         <body>
        //             <img src="${dataUri}" />
        //         </body>
        //     </html>
        // `;
        
        // await page.setContent(html);
        
        // // 獲取圖片尺寸
        // const imgDimensions = await page.evaluate(() => {
        //     const img = document.querySelector('img') as any;
        //     return {
        //         width: img.naturalWidth,
        //         height: img.naturalHeight
        //     };
        // });
        
        // console.log(`圖片尺寸: ${imgDimensions.width} x ${imgDimensions.height}`);
        
        // // 🎯 緊湊的 PDF 生成設定，減少留白
        // console.log(imgDimensions.width)
        // console.log(imgDimensions.height)
        // const pdf = await page.pdf({
        //     width: `${imgDimensions.width}px`,   // 🎯 使用實際圖片寬度
        //     height: `10000px`, // 🎯 使用實際圖片高度
        //     landscape: true,                    // 🎯 關鍵：使用橫向模式
        //     printBackground: true,             // 包含背景色彩和圖片
        //     margin: {                          // 🎯 零邊距，最大化內容空間
        //         top: 0,
        //         bottom: 0,
        //         left: 0,
        //         right: 0
        //     },
        //     scale: 1,                        // 🎯 縮放到80%確保內容完整顯示
        //     preferCSSPageSize: false,          // 忽略CSS頁面大小
        //     displayHeaderFooter: false,        // 不顯示頁首頁尾
        //     pageRanges: '1',                   // 🎯 只生成第一頁，強制單頁
        //     timeout: 60000                     // 設定PDF生成超時
        // });
        
        // console.log('✅ PNG 轉 PDF 完成');
        // return pdf;
        
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}


export async function scanDashboardAndSendEmailReports(): Promise<void> {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=週日, 1=週一, 2=週二...
  const dayOfMonth = today.getDate(); // 1-31
  
  console.log(`Time ${today.toISOString().split('T')[0]}, 星期${dayOfWeek === 0 ? '日' : dayOfWeek}, 當月第${dayOfMonth}天`);

  const allZones = await getActivatedZones();

  // 每日報表 - 每天都執行
  console.log('🔍 檢查每日報表...');
  const dailyReportDashboardRecipientsSettings: any = await findDailyReportDashboardRecipientsSettings();
  if (dailyReportDashboardRecipientsSettings.length > 0) {
    console.log(`找到 ${dailyReportDashboardRecipientsSettings.length} 個每日報表設定，開始處理...`);
    for (const setting of dailyReportDashboardRecipientsSettings) {
        try {
            console.log(`contractNo: ${setting.contractNo}`);
            const zones = allZones.filter((zone: any) => zone.contractNo === setting.contractNo);
            const zoneNames = zones.map((zone: any) => zone.zone);
            if (zoneNames.length > 0) {
                let subDomains: string[] = [];
                const dnsRecords = await getCloudflareDnsByZones(zoneNames)
                if (dnsRecords.length > 0) {
                    subDomains = dnsRecords.map((dnsRecord: any) => dnsRecord.name);
                    console.log(`subDomains: ${subDomains.join(', ')}`);
                } else {
                    console.log(`沒有找到 ${dailyReportDashboardRecipientsSettings[0].contractNo} 的 DNS 記錄`);
                }
                
                await sendEmailReports(setting as any, 'daily', subDomains);
                console.log(`Success 每日報表發送成功`);
                setting.lastSent = new Date();
                await setting.save();
            } else {
                console.log(`沒有找到 ${dailyReportDashboardRecipientsSettings[0].contractNo} 的 Zone 記錄`);
            }
        } catch (error) {
            console.error(`Error 每日報表發送失敗:`, error);
            // await Logs.create({
            //     userId: 'system',
            //     contractNo: setting.contractNo,
            //     action: 'dailyReport',
            //     track: JSON.stringify(error)
            // })
        }
    }
  } else {
    console.log('📋 沒有每日報表設定');
  }

  // 週報 - 只有週一才執行
  if (dayOfWeek === 1) { // 週一
    console.log('Time 週一，檢查週報設定...');
    const weeklyReportDashboardRecipientsSettings: any = await findWeeklyReportDashboardRecipientsSettings();
    if (weeklyReportDashboardRecipientsSettings.length > 0) {
        console.log(`找到 ${weeklyReportDashboardRecipientsSettings.length} 個週報設定，開始處理...`);
        for (const setting of weeklyReportDashboardRecipientsSettings) {
            try {
                console.log(`contractNo: ${weeklyReportDashboardRecipientsSettings[0].contractNo}`);
                const zones = allZones.filter((zone: any) => zone.contractNo === weeklyReportDashboardRecipientsSettings[0].contractNo);
                const zoneNames = zones.map((zone: any) => zone.zone);
            
                if (zoneNames.length > 0) {
                    let subDomains: string[] = [];
                    const dnsRecords = await getCloudflareDnsByZones(zoneNames)
                    if (dnsRecords.length > 0) {
                        subDomains = dnsRecords.map((dnsRecord: any) => dnsRecord.name);
                        console.log(`subDomains: ${subDomains.join(', ')}`);
                    } else {
                        console.log(`沒有找到 ${weeklyReportDashboardRecipientsSettings[0].contractNo} 的 DNS 記錄`);
                    }
                    
                    await sendEmailReports(setting as any, 'weekly', subDomains);
                    console.log(`Success 週報發送成功`);
                    setting.lastSent = new Date();
                }
            } catch (error) {
                console.error(`Error 週報發送失敗:`, error);
                // await Logs.create({
                //     userId: 'system',
                //     contractNo: setting.contractNo,
                //     action: 'weeklyReport',
                //     track: JSON.stringify(error)
                // })
            }
        }
    } else {
      console.log('沒有週報設定');
    }
  } else {
    console.log('Time 不是週一，跳過週報檢查');
  }

  // 月報 - 只有每月1號才執行
  if (dayOfMonth === 1) { // 每月1號
    console.log('Time 每月1號，檢查月報設定...');
    const monthlyReportDashboardRecipientsSettings: any = await findMonthlyReportDashboardRecipientsSettings();
    if (monthlyReportDashboardRecipientsSettings.length > 0) {
        console.log(`找到 ${monthlyReportDashboardRecipientsSettings.length} 個月報設定，開始處理...`);
        for (const setting of monthlyReportDashboardRecipientsSettings) {
            try {
                console.log(`contractNo: ${monthlyReportDashboardRecipientsSettings[0].contractNo}`);
                const zones = allZones.filter((zone: any) => zone.contractNo === monthlyReportDashboardRecipientsSettings[0].contractNo);
                const zoneNames = zones.map((zone: any) => zone.zone);
        
                if (zoneNames.length > 0) {
                    let subDomains: string[] = [];
                    const dnsRecords = await getCloudflareDnsByZones(zoneNames)
                    if (dnsRecords.length > 0) {
                        subDomains = dnsRecords.map((dnsRecord: any) => dnsRecord.name);
                        console.log(`subDomains: ${subDomains.join(', ')}`);
                    } else {
                        console.log(`沒有找到 ${monthlyReportDashboardRecipientsSettings[0].contractNo} 的 DNS 記錄`);
                    }
                    await sendEmailReports(setting as any, 'monthly', subDomains);
                    console.log(`Success 月報發送成功`);
                    setting.lastSent = new Date();
                    await setting.save()
                }
            } catch (error) {
                console.error(`Error 月報發送失敗:`, error);
                // await Logs.create({
                //     userId: 'system',
                //     contractNo: setting.contractNo,
                //     action: 'monthlyReport',
                //     track: JSON.stringify(error)
                // })
            }
        }
    } else {
      console.log('📋 沒有月報設定');
    }
  } else {
    console.log('Time 不是每月1號，跳過月報檢查');
  }

  console.log('Job Finished 報表檢查處理完成');
}

// 寄送郵件報表
export async function sendEmailReports(schedule: ReportSchedule, scheduleType: string, subDomains: string[]): Promise<void> {
    try {
        console.log(`sendEmailReports: ${scheduleType}`)
        console.log(`開始寄送郵件報表: ContractNo: ${schedule.contractNo}, Subject: ${schedule.subject}`)
        
        // 格式化時間為 yyyy-mm-dd hh:mm:ss 台灣時間
        const formatTaiwanTime = (date: Date) => {
            const taiwanDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
            const year = taiwanDate.getFullYear();
            const month = String(taiwanDate.getMonth() + 1).padStart(2, '0');
            const day = String(taiwanDate.getDate()).padStart(2, '0');
            const hours = String(taiwanDate.getHours()).padStart(2, '0');
            const minutes = String(taiwanDate.getMinutes()).padStart(2, '0');
            const seconds = String(taiwanDate.getSeconds()).padStart(2, '0');
            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        };
        
        const dashboardIds = dashboardConfigs.map((dashboard) => dashboard.id)
        const today = new Date();
        
        let startTime: Date, endTime: Date;
        
        if (scheduleType === 'daily') {
            // 前一天 00:00:00 到 23:59:59
            startTime = new Date(today);
            startTime.setDate(today.getDate() - 1);
            startTime.setHours(0, 0, 0, 0);
            
            endTime = new Date(today);
            endTime.setDate(today.getDate() - 1);
            endTime.setHours(23, 59, 59, 999);
            
        } else if (scheduleType === 'weekly') {
            // 上週一 00:00:00 到上週日 23:59:59
            // 週一(1)才寄送，寄送上週一到上週日的報表
            const dayOfWeek = today.getDay(); // 0=週日, 1=週一, 2=週二...
            const daysToLastMonday = dayOfWeek === 1 ? 7 : (dayOfWeek === 0 ? 8 : dayOfWeek + 6);
            
            startTime = new Date(today);
            startTime.setDate(today.getDate() - daysToLastMonday);
            startTime.setHours(0, 0, 0, 0);
            
            endTime = new Date(startTime);
            endTime.setDate(startTime.getDate() + 6);
            endTime.setHours(23, 59, 59, 999);
        
        } else if (scheduleType === 'monthly') {
            // 上個月 1號 00:00:00 到最後一天 23:59:59
            startTime = new Date(today.getFullYear(), today.getMonth() - 1, 1, 0, 0, 0, 0);
            endTime = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
            } else {
            // 預設使用前一天
            startTime = new Date(today);
            startTime.setDate(today.getDate() - 1);
            startTime.setHours(0, 0, 0, 0);
            
            endTime = new Date(today);
            endTime.setDate(today.getDate() - 1);
            endTime.setHours(23, 59, 59, 999);
        }
        
        console.log(`時間範圍: ${startTime.toISOString()} ~ ${endTime.toISOString()}`);
         
         // 生成多個 PDF 報表
        const reports = await generateMultipleDashboardReports(dashboardIds, startTime, endTime, subDomains)
        
        // 設定郵件傳輸器 - SMTP Relay 方式
        const transporter = nodemailer.createTransport({
            host: config.mailInfo.host || 'msa.hinet.net',     // SMTP 伺服器位址
            port: parseInt(config.mailInfo.port || '25'),        // SMTP 埠號 (25/587/465)
            secure: config.mailInfo.secure === 'false',           // true for 465, false for 587/25
            auth: config.mailInfo.user ? {
                user: config.mailInfo.user,                      // SMTP 使用者名稱
                pass: config.mailInfo.pass                       // SMTP 密碼
            } : undefined,                                         // 如果不需要認證則設為 undefined
            // 額外 Relay 設定
            tls: {
                rejectUnauthorized: config.mailInfo.rejectUnauthorized !== 'false' // 預設 true
            },
            connectionTimeout: 60000,                             // 連線逾時 (毫秒)
            greetingTimeout: 30000,                               // 問候逾時 (毫秒)
            socketTimeout: 60000                                  // Socket 逾時 (毫秒)
        })
        const dashboardTitles = dashboardConfigs.map((dashboard) => {
            return `<li><strong>${dashboard.name}:</strong> ${formatTaiwanTime(startTime)} ~ ${formatTaiwanTime(endTime)}</li>`
        })
        // 郵件內容
        const mailOptions = {
            from: config.mailInfo.from || 'system@twister5.com.tw',
            to: schedule.to,
            cc: schedule.cc,
            bcc: schedule.bcc,
            subject: schedule.subject,
            html: `
                <h2>${schedule.subject}</h2>
                <p>親愛的用戶，</p>
                <p>以下是您的 WAF 安全監控報表：</p>
                <ul>
                ${dashboardTitles.join('\n')}
                </ul>
                ${schedule.text ? `<p>${schedule.text}</p>` : ''}
                <p>請查看附件中的詳細報表。</p>
                <br>
                <p>此為系統自動發送的郵件，請勿回覆。</p>
                <p>ADAS ONE 系統</p>
            `,
            attachments: reports.map(report => ({
                filename: `${report.name}_${new Date().toISOString().split('T')[0]}.pdf`,
                content: report.pdf,
                contentType: 'application/pdf'
            }))
        }
        
        // 發送郵件
        const info = await transporter.sendMail(mailOptions)
        console.log(`郵件報表發送成功: ${info.messageId}`)
        
    } catch (error) {
        console.error(`寄送郵件報表失敗: ${schedule.subject}`, error)
        throw error
    }
}

export async function sendImmediateEmailReports(schedule: any): Promise<void> {
    try {
        console.log(`sendImmediateEmailReports: ${schedule.type}`)
        console.log(`開始寄送郵件報表: ContractNo: ${schedule.contractNo}, Subject: ${schedule.subject}`)
        const { subject, recipients, cc, bcc, content, reportStartDate, reportEndDate, domainSettings } = schedule;
        const dashboardIds = dashboardConfigs.map((dashboard) => dashboard.id)
        const today = new Date();

        // 設定郵件傳輸器 - SMTP Relay 方式（之後設定移至管理後台可修改）
        const transporter = nodemailer.createTransport({
            host: config.mailInfo.host || 'msa.hinet.net',
            port: parseInt(config.mailInfo.port || '25'),
            secure: config.mailInfo.secure === 'false',
            auth: config.mailInfo.user ? {
                user: config.mailInfo.user,
                pass: config.mailInfo.pass
            } : undefined,
            tls: {
                rejectUnauthorized: config.mailInfo.rejectUnauthorized !== 'false'
            },
            connectionTimeout: 60000,
            greetingTimeout: 30000,
            socketTimeout: 60000
        })
        // 格式化時間為 yyyy-mm-dd hh:mm:ss 台灣時間
        const formatTaiwanTime = (date: Date) => {
            const taiwanDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
            const year = taiwanDate.getFullYear();
            const month = String(taiwanDate.getMonth() + 1).padStart(2, '0');
            const day = String(taiwanDate.getDate()).padStart(2, '0');
            const hours = String(taiwanDate.getHours()).padStart(2, '0');
            const minutes = String(taiwanDate.getMinutes()).padStart(2, '0');
            const seconds = String(taiwanDate.getSeconds()).padStart(2, '0');
            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        };

        const reports = await generateMultipleDashboardReports(dashboardIds, reportStartDate, reportEndDate, domainSettings);
        const dashboardTitles = dashboardConfigs.map((dashboard) => {
            return `<li><strong>${dashboard.name}:</strong> ${formatTaiwanTime(reportStartDate)} ~ ${formatTaiwanTime(reportEndDate)}</li>`
        })
        const mailOptions = {
            from: 'system@twister5.com.tw',
            to: recipients,
            cc: cc,
            bcc: bcc,
            subject: subject,
            html: `
                <p>親愛的用戶，</p>
                <p>以下是您的報表：</p>
                <ul>
                ${dashboardTitles.join('\n')}
                </ul>
                ${content ? `<p>${content}</p>` : ''}
                <p>請查看附件中的詳細報表。</p>
                <br>
                <p>此為系統自動發送的郵件，請勿回覆。</p>
                <p>ADAS ONE 系統</p>
            `,
            attachments: reports.map(report => ({
                filename: `${report.name}_${new Date().toISOString().split('T')[0]}.pdf`,
                content: report.pdf,
                contentType: 'application/pdf'
            }))
        }
        const info = await transporter.sendMail(mailOptions)
        
        const reportSetting: any = await Reports.findOne({ where: { id: schedule.id, contractNo: schedule.contractNo }})
        if (reportSetting) {
            reportSetting.lastSent = new Date()
            reportSetting.status = 'inactive'
            await reportSetting.save()
        }
        console.log(`郵件報表發送成功: ${info.messageId}`)
    } catch (error) {
        console.error(`寄送郵件報表失敗: ${schedule.subject}`, error)
        throw error
    }
}
