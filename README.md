# ADAS-ONE-BACK

ADAS ONE 後端 API 服務器

## 功能特色

- 🔐 JWT 認證系統
- 🗄️ Redis Session 管理
- 🛡️ 安全中間件 (Helmet, CORS, Rate Limiting)
- 📊 健康檢查端點
- 🔄 自動重啟開發模式

## 快速開始

### 前置需求

- Node.js 18+
- Redis 服務器
- npm 或 yarn

### 安裝

```bash
# 安裝依賴
npm install
# 或
yarn install
```

### 開發模式
開發服務器將在 [http://localhost:3000](http://localhost:3000) 啟動

```bash
# 啟動開發服務器
npm run dev
# 或
yarn dev
```

### 生產模式

```bash
# 建置專案
npm run build
# 或
yarn build

# 啟動生產服務器
npm dev
# 或
yarn dev
```

### 線上模式
測試服務器將在 [https://adas-one.twister5.cf](https://adas-one.twister5.cf) 啟動(3001 PORT)

```bash
# 前端位置
/opt/app/adas-one
yarn build
# 啟動開發服務器 pm2
HOST=0.0.0.0 HOSTNAME=0.0.0.0 PORT=3001 pm2 start dist/index.js --name adas-backend --cwd /opt/app/adas-one/ --update-env
```

## API 端點

### 認證相關

- `POST /api/auth/login` - 用戶登入
- `GET /api/auth/verify` - 驗證登入狀態
- `DELETE /api/auth/logout` - 用戶登出

### 系統相關

- `GET /health` - 健康檢查
- `GET /` - API 資訊

## 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `PORT` | 服務器端口 | 3001 |
| `NODE_ENV` | 環境模式 | development |
| `REDIS_HOST` | Redis 主機 | localhost |
| `REDIS_PORT` | Redis 端口 | 6379 |
| `JWT_SECRET` | JWT 密鑰 | adasonezmjwtsecret@f5 |
| `SESSION_TIMEOUT` | Session 超時時間(秒) | 1800 |

## 專案結構

```
server/
├── config/
│   └── config.yaml               # 配置
├── dao/
│   └── database                  # Redis/Database 配置
│   └── ...
├── middleware/
│   └── errorHandler.ts           # 錯誤處理
│   └── request_handler_util.ts   # 中間處理
│   └── route_middleware_util.ts  # 驗證處理
│   └── ...
├── routes/
│   └── auth.ts                   # 認證路由
│   └── ...
├── services/
│   └── auth_service.ts           # 認證功能
│   └── cloudflare_service.ts     # cloudflare功能
│   └── ...
└── index.ts                      # 主入口文件
│   └── ...
```

## 開發工具

- **TypeScript** - 類型安全
- **ESLint** - 程式碼品質
- **Jest** - 單元測試
- **Morgan** - HTTP 日誌
- **Helmet** - 安全標頭 