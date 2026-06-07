import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initAMap } from './utils/amap'

// 初始化高德地图 SDK（SDK 未加载时静默降级）
initAMap()

createRoot(document.getElementById('root')!).render(
  <App />
)
