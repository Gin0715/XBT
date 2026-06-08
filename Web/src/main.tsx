import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initBMap } from './utils/bmap'

// 初始化百度地图 SDK（SDK 未加载时静默降级）
initBMap()

createRoot(document.getElementById('root')!).render(
  <App />
)
