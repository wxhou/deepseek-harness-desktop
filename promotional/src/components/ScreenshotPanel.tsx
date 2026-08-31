import type { Copy } from '../i18n'

/**
 * 主视觉右列：产品大截图，撑满右侧并上下出血裁切（与参考站一致），
 * 轻微圆角 + 描边缓和浅色截图与深色背景的对比。
 */
export function ScreenshotPanel(props: { copy: Copy }) {
  return (
    <div className="relative hidden h-full items-center lg:flex">
      <div className="absolute left-[-24px] top-[calc(50%+34px)] h-[88%] w-[clamp(1000px,80vw,1500px)] -translate-y-1/2">
        <img
          alt={props.copy.appScreenshotAlt}
          width={1279}
          height={749}
          decoding="async"
          className="h-full w-full rounded-2xl object-cover object-top shadow-[0_34px_70px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
          src="/images/app-preview.png"
        />
      </div>
    </div>
  )
}