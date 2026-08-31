/**
 * 背景层：CSS 极光渐变模拟参考站的 canvas 动效（大片蓝色光晕 + 缓慢漂移），
 * 顶部叠加渐隐遮罩，保证标题区文字对比度。
 */
export function Background() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      <div className="absolute inset-0 overflow-hidden bg-[#0a0f1c]">
        <div className="absolute inset-0 z-0 overflow-hidden [mask-image:linear-gradient(#000000fc_0%,#000000e8_8.98%,transparent_100%)]">
          {/* 底色铺陈：深海军蓝 → 宝蓝的大面积对角渐变 */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(118deg, #0b1230 0%, #14306e 34%, #1c3f8f 52%, #0d1a45 78%, #060913 100%)',
            }}
          />
          <div
            className="absolute inset-[-30%] blur-[70px]"
            style={{
              background: [
                'radial-gradient(48% 42% at 30% 32%, rgba(77, 107, 254, 0.65) 0%, transparent 72%)',
                'radial-gradient(42% 46% at 72% 62%, rgba(29, 78, 216, 0.5) 0%, transparent 72%)',
                'radial-gradient(36% 38% at 52% 90%, rgba(12, 74, 110, 0.55) 0%, transparent 72%)',
                'radial-gradient(26% 28% at 12% 82%, rgba(6, 182, 212, 0.28) 0%, transparent 72%)',
              ].join(', '),
              animation: 'aurora-drift 18s ease-in-out infinite',
            }}
          />
          <div
            className="absolute inset-[-25%] blur-[90px]"
            style={{
              background: [
                'radial-gradient(30% 32% at 62% 26%, rgba(147, 51, 234, 0.22) 0%, transparent 70%)',
                'radial-gradient(28% 28% at 18% 64%, rgba(59, 130, 246, 0.34) 0%, transparent 70%)',
              ].join(', '),
              animation: 'aurora-drift-reverse 24s ease-in-out infinite',
            }}
          />
          {/* 细噪点网格，压住渐变的塑料感 */}
          <div
            className="absolute inset-0 opacity-[0.14] mix-blend-overlay"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.55) 0.5px, transparent 0.5px)',
              backgroundSize: '22px 22px',
            }}
          />
          {/* 底部压暗，让按钮/链接更聚焦 */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(5,7,11,0.42) 0%, transparent 26%, transparent 62%, rgba(5,7,11,0.55) 100%)',
            }}
          />
        </div>
      </div>
    </div>
  )
}