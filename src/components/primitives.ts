import { tv } from 'tailwind-variants'

// ==================== 按钮 ====================
// 对应官方 ui-primitives Button 的两档几何：
// md（h36 / 圆角 18px 胶囊 / 14px 字号）与 sm（h28 / 圆角 14px 胶囊 / 12px 字号）。
// 颜色沿用官方 dsw alias token（bg-btn-fill / interactive-bg-* 等）。
export const button = tv({
  base: 'inline-flex cursor-pointer items-center justify-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
  variants: {
    size: {
      sm: 'h-7 rounded-[14px] px-2.5 text-xs',
      md: 'h-9 rounded-[18px] px-3.5 text-sm leading-[22px]',
    },
    tone: {
      primary: 'bg-btn-fill text-btn-ink hover:bg-btn-fill-hover',
      ghost: 'text-ink hover:bg-btn-hover active:bg-btn-active',
      danger: 'text-danger hover:bg-btn-danger-hover',
    },
    block: {
      true: 'mt-1.5 w-full',
    },
  },
  defaultVariants: {
    size: 'md',
    tone: 'ghost',
  },
})

// 按钮内小型加载指示器：边框旋转动画，颜色跟随当前文字。
// 用 animate-load-spin（直接 animation + keyframes）而非 animate-spin，
// 避免 Tailwind var() 间接层在 WebView2 下不旋转。
export const spinner = tv({
  base: 'inline-block h-3 w-3 shrink-0 animate-load-spin rounded-full border-2 border-current border-t-transparent',
})

// ==================== 侧边栏 ====================
// 点击侧边栏外内容时关闭侧边栏的透明遮罩（位于内容之上、侧边栏之下）
export const overlay = tv({
  base: 'fixed inset-0 z-[25]',
})

// 右侧调试侧边栏抽屉
export const drawer = tv({
  base: 'fixed inset-y-0 right-0 z-30 flex w-[300px] flex-col overflow-y-auto border-l border-line bg-panel shadow-2xl transition-transform duration-200 ease-out',
  variants: {
    open: {
      true: 'translate-x-0',
      false: 'translate-x-full',
    },
  },
})

// 分组标题（h3）
export const sectionTitle = tv({
  base: 'mb-2 flex items-center justify-between gap-1.5 text-xs uppercase tracking-[0.06em] text-muted',
})

// 连接状态胶囊
export const statusPill = tv({
  base: 'inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold',
  variants: {
    tone: {
      running: 'bg-[rgba(34,197,94,0.15)] text-ok',
      stopped: 'bg-[rgba(242,90,90,0.15)] text-danger',
    },
  },
})

// 信息列表（dl）的 dt/dd
export const dataTerm = tv({
  base: 'mt-1.5 text-muted',
})
export const dataDesc = tv({
  base: 'mt-0.5 break-all',
})

// 代码/URL 展示块
export const codeBlock = tv({
  base: 'flex-1 truncate rounded-md border border-line bg-panel2 px-2 py-1.5 text-xs',
})

// 表单输入 / 下拉选择
export const input = tv({
  base: 'flex-1 rounded-md border border-line bg-panel2 px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent/60',
})
export const select = tv({
  base: 'flex-1 rounded-md border border-line bg-panel2 px-2 py-1 text-[13px] text-ink outline-none',
})

// 日志面板（pre）
export const logPanel = tv({
  base: 'm-0 max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-log-bg px-2 py-2 text-[11px] leading-[1.45] text-log-ink',
})

// 侧边栏内底部居中的轻提示
export const notice = tv({
  base: 'fixed bottom-[18px] left-1/2 z-10 -translate-x-1/2 rounded-lg border border-line bg-panel2 px-3.5 py-2 text-[13px] shadow-[0_8px_24px_rgba(0,0,0,0.45)]',
})

// ==================== 浮动提示条 ====================
// 右下角浮动提示条（更新提示 / 下载完成提示）
export const toast = tv({
  base: 'fixed right-4 bottom-4 z-50 flex gap-3 rounded-lg border border-line bg-panel px-4 py-3 shadow-lg',
  variants: {
    size: {
      sm: 'max-w-[420px] items-center',
      md: 'max-w-[440px]',
    },
    align: {
      start: 'items-start',
    },
  },
  defaultVariants: {
    size: 'sm',
  },
})

// 右下角侧边栏展开按钮（lifted：上方有提示条时上移，避免重叠）
export const toggle = tv({
  base: 'fixed right-4 z-20 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-panel/80 text-ink shadow-lg backdrop-blur-md transition-colors hover:bg-panel-hover',
  variants: {
    lifted: {
      true: 'bottom-[84px]',
      false: 'bottom-4',
    },
  },
  defaultVariants: {
    lifted: false,
  },
})
