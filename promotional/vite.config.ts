import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 相对路径基址：zip 解压后以 file:// 打开也能正常加载资源
  base: './',
  server: {
    // 避开主应用前端开发端口（1420）与桌面内嵌服务端口（3080/3081）
    port: 4321,
  },
})