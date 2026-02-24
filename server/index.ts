import os from 'os';
import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import logger from 'morgan';
import moment from 'moment';
import chalk from 'chalk';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { createReadStream } from 'fs';
import config from './config/config'
import { CronJob } from 'cron'
import { scanDashboardAndSendEmailReports } from './services/report_service';
import { processMonthlyTraffic } from './services/contract_service';
import { checkCloudflareLogPush } from './services/cloudflare_service';
import { internal } from './routes/internal';
import indexRouter from './routes/index';

import authRoutes from './routes/auth';
import { errorHandler } from './middleware/errorHandler';

if (!config.serverName) {
  config.serverName = os.hostname();
}

require('console-stamp')(console, {
  pattern: 'yyyy-mm-dd HH:MM:ss.l',
  metadata: function () {
      return ('[' + process.memoryUsage().rss + ']');
  },
  colors: {
      stamp: 'yellow',
      label: 'white',
      metadata: 'green'
  }
});

const app = express();
const PORT = config && config.server && config.server.port || 3001;

logger.token('date', (req, res, tz) => {
  return chalk.yellow(`[${moment().format('YYYY-MM-DD HH:mm:ss:SSS')}]`);
});
logger.token('remote-addr', function (req, res) {
  var ffHeaderValue = req.headers['x-forwarded-for'];
  return (ffHeaderValue as string) || req.connection.remoteAddress;
});
logger.token('memory', function (req, res) {
  return chalk.green(`[${process.memoryUsage().rss}]`);
})

// 安全中間件
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "blob:",
        "data:",
        "*.vercel.app",
        "*.netlify.app",
        "https://unpkg.com",
        "https://cdn.jsdelivr.net"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "fonts.googleapis.com",
        "*.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "fonts.gstatic.com",
        "data:"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "*.cloudflare.com",
        "*.googleapis.com"
      ],
      connectSrc: [
        "'self'",
        "localhost:*",
        "http://localhost:*",
        "https://localhost:*",
        "*.cloudflare.com",
        "api.cloudflare.com",
        "ws:",
        "wss:"
      ],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false
}) as any);
app.use(logger(':date [LOG]    :memory :remote-addr ":method :url HTTP/:http-version" :status :res[content-length]'));
app.use(compression() as any);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// 提供靜態檔案
app.use('/public', express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(__dirname, '../public'))); // 直接從根路徑提供靜態檔案
app.use('/_next', express.static(path.join(__dirname, '../frontend-dist')));

// CORS 配置
app.use(cors({
  origin: [
    config && config.frontend && config.frontend.url || 'http://localhost:3000',
    'http://localhost:3001',
    'https://localhost:3001',
    /^https?:\/\/localhost:\d+$/,
    /^https?:\/\/\d+\.\d+\.\d+\.\d+:\d+$/
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

// 請求限制
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15分鐘
//   max: 100 // 限制每個IP 15分鐘內最多100個請求
// });
// app.use(limiter);

// API 路由
app.use('/api/internal', internal);
app.use('/api', indexRouter);

// 健康檢查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'ADAS-ONE-BACK',
    version: '1.0.0'
  });
});

// 前端路由處理 - 必須在其他路由之後
app.use('*', (req, res) => {
  // 如果是 API 路由，返回 404
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  
  const frontendDistPath = path.join(__dirname, '../frontend-dist/server/app');
  
  // 智能路由處理函數
  const tryServeFile = (filePath: string, fallbackPath?: string) => {
    res.sendFile(filePath, (err) => {
      if (err) {
        if (fallbackPath) {
          tryServeFile(fallbackPath);
        } else {
          console.error(`Error serving file: ${filePath}`, err);
          res.status(500).json({ 
            error: 'Frontend not available',
            message: 'Please ensure the frontend is built and deployed correctly'
          });
        }
      }
    });
  };
  
  // 生成可能的 HTML 文件路径
  const generatePossiblePaths = (requestPath: string) => {
    const paths = [];
    
    if (requestPath === '/') {
      paths.push(path.join(frontendDistPath, 'index.html'));
      return paths;
    }
    
    const pathParts = requestPath.split('/').filter(part => part);
    
    // 1. 嘗試完整路径的 HTML 檔案 (例如: /services/hiwaf/manage -> services/hiwaf/manage.html)
    const fullPath = pathParts.join('/') + '.html';
    paths.push(path.join(frontendDistPath, fullPath));
    
    // 2. 嘗試在父目錄中尋找對應的檔案 (例如: /services/hiwaf/manage -> services/hiwaf/manage.html)
    if (pathParts.length >= 2) {
      const parentDir = pathParts.slice(0, -1).join('/');
      const fileName = pathParts[pathParts.length - 1] + '.html';
      paths.push(path.join(frontendDistPath, parentDir, fileName));
    }
    
    // 3. 嘗試在對應目錄中尋找 page.html
    const dirPath = pathParts.join('/');
    paths.push(path.join(frontendDistPath, dirPath, 'page.html'));
    
    // 4. 逐級回退到父路由的 HTML 檔案
    const tempParts = [...pathParts];
    while (tempParts.length > 0) {
      const parentPath = tempParts.join('/') + '.html';
      paths.push(path.join(frontendDistPath, parentPath));
      tempParts.pop();
    }
    
    // 5. 最終回退到 index.html
    paths.push(path.join(frontendDistPath, 'index.html'));
    
    return paths;
  };
  
  // 遞歸嘗試每個可能的路径
  const possiblePaths = generatePossiblePaths(req.path);
  
  const tryNextPath = (index: number) => {
    if (index >= possiblePaths.length) {
      res.status(500).json({ 
        error: 'Frontend not available',
        message: 'No suitable HTML file found'
      });
      return;
    }
    
    const currentPath = possiblePaths[index];
    res.sendFile(currentPath, (err) => {
      if (err) {
        // 如果當前文件不存在，嘗試下一個
        tryNextPath(index + 1);
      }
    });
  };
  
  tryNextPath(0);
  return;
});

// 錯誤處理
app.use(errorHandler);

// 🕒 初始化定時任務
function initCronJobs() {
  console.log('📅正在初始化定時任務...');
  const timeZone = 'Asia/Taipei';
  
  // 📊 每日報表自動發送任務
  const dailyReportCronTime = 
    config.dailyReportSetting && config.dailyReportSetting.cronTime ?
    config.dailyReportSetting.cronTime : '0 0 0 * * *'; // 預設每天凌晨00:00執行

  new CronJob(dailyReportCronTime, async () => {
      try {
        console.log(`[${new Date().toISOString()}] 開始執行每日日週月報表任務...`);
        console.log(`job dashboard report start`);
        await scanDashboardAndSendEmailReports();
        console.log(`job dashboard report finished`);
        console.log(`[${new Date().toISOString()}] 每日日週月報表任務執行完成`);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] 執行每日日週月報表任務時發生錯誤:`, error);
      }
  }, null, true, timeZone);
  console.log(`每日報表定時任務已啟動 (${dailyReportCronTime})`);
  
  // 可選：定期清理暫存檔案任務
  const cleanupCronTime = 
    config.cleanupCronTime ?
    config.cleanupCronTime : '0 0 3 * * *'; // 每天凌晨3點清理
  
  new CronJob(cleanupCronTime, async () => {
    try {
      console.log(`[${new Date().toISOString()}] 開始清理暫存檔案...`);
      console.log(`[${new Date().toISOString()}] 暫存檔案清理完成`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] 清理暫存檔案失敗:`, error);
    }
  }, null, true, timeZone);
  console.log(`清理任務定時任務已啟動 (${cleanupCronTime})`);
  
  // 總結上一個月的流量，每天執行但只在每月第一天才處理
  const monthlyTrafficCronTime = 
    config.monthlyTrafficCronTime ?
    config.monthlyTrafficCronTime : '0 0 5 * * *'; // 每天早上5點執行檢查


  new CronJob(monthlyTrafficCronTime, async () => {
    try {
      console.log(`[${new Date().toISOString()}] 開始執行月度流量總結檢查任務...`);
      console.log(`job monthly traffic summary check start`);
      await processMonthlyTraffic();
      console.log(`job monthly traffic summary check finished`);
      console.log(`[${new Date().toISOString()}] 月度流量總結檢查任務執行完成`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] 執行月度流量總結檢查任務時發生錯誤:`, error);
    }
  }, null, true, timeZone);
  console.log(`月度總結檢查定時任務已啟動 (${monthlyTrafficCronTime})`);

  // 定時檢查Cloudflare上的logpush開關是否打開
  const logPushCloudflareCronTime = 
    config.logPushCloudflareCronTime ?
    config.logPushCloudflareCronTime : '0 0 6 * * *'; // 每天早上6點執行檢查

  new CronJob(logPushCloudflareCronTime, async () => {
    try {
      console.log(`[${new Date().toISOString()}] 開始執行Cloudflare logpush檢查任務...`);
      console.log(`job cloudflare logpush check start`);
      await checkCloudflareLogPush();
      console.log(`job cloudflare logpush check finished`);
      console.log(`[${new Date().toISOString()}] Cloudflare logpush檢查任務執行完成`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Cloudflare logpush檢查任務時發生錯誤:`, error);
    }
  }, null, true, timeZone);
  console.log(`Cloudflare logpush檢查定時任務已啟動 (${logPushCloudflareCronTime})`);
}

// 啟動服務器
async function startServer() {
  try {

    app.listen(PORT, () => {
      console.log(`🚀 ADAS-ONE-BACK Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🌐 Frontend integrated and available at: http://localhost:${PORT}`);
      console.log(`🔗 API endpoints: http://localhost:${PORT}/api/`);
      
      // 🕒 初始化定時任務
      initCronJobs();
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer(); 