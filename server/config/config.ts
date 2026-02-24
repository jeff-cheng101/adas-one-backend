import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

// 取得專案根目錄
const projectRoot = process.cwd()
// 組合出 config.yml 的完整路徑
const configPath = path.join(projectRoot, 'server', 'config', 'config.yaml')

// 讀取並解析 YAML 檔案
const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>

export default config