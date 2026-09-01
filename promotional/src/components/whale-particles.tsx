import type { Group } from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'

/**
 * 逐行移植参考站 HeroDigitileR3F（WhaleParticles 粒子背景）：
 * - SVG 栅格化到 60x60 网格，按明度阈值 0.2 采样粒子（含边缘系数与散开位）
 * - 入场汇聚：延迟 0.3s，2.5s 内 easeOutCubic 从随机球面位置聚合成形
 * - 光照渐变：点光源位于右上方并跟随鼠标（followX），照亮粒子产生奶白高光
 * - 鼠标交互：径向漩涡推散粒子（角向扰动），强度平滑进出
 * - 常驻动效：整体呼吸/摇摆、中心波纹、粒子闪烁（加性混合）
 */

// BASE_URL 前缀：兼容 GitHub Pages 项目页（/deepseek-harness-desktop/）等任意子路径部署
const WHALE_SVG = `${import.meta.env.BASE_URL}images/hero-whale.svg`

/** 采样参数（与参考站一致） */
const GRID = 60
const LUMINANCE_MIN = 0.2
const WORLD_STEP = 0.18
const PLATE_SIZE = 0.13 // 粒子等效尺寸（世界单位）——比参考站略大，补偿 Points 软边损失

interface PixelData {
  positions: Float32Array
  scatteredPositions: Float32Array
  opacities: Float32Array
  edges: Float32Array
  count: number
}

/** 参考站同源采样：SVG → 60x60 亮度网格 → 剔除孤立杂点，输出粒子集 */
function sampleWhale(img: HTMLImageElement): PixelData {
  const canvas = document.createElement('canvas')
  canvas.width = GRID
  canvas.height = GRID
  const ctx = canvas.getContext('2d')
  if (!ctx)
    return { positions: new Float32Array(0), scatteredPositions: new Float32Array(0), opacities: new Float32Array(0), edges: new Float32Array(0), count: 0 }
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, GRID, GRID)
  const scale = Math.min(GRID / img.width, GRID / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (GRID - w) / 2, (GRID - h) / 2, w, h)
  const pixels = ctx.getImageData(0, 0, GRID, GRID).data

  const lum = new Float32Array(GRID * GRID)
  for (let i = 0; i < GRID * GRID; i += 1) {
    const p = i * 4
    lum[i] = (0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]) / 255
  }

  // 5x5 邻域全空 → 孤立杂点，剔除
  function isIsolated(x: number, y: number): boolean {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0)
          continue
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID && lum[GRID * ny + nx] > LUMINANCE_MIN)
          return false
      }
    }
    return true
  }

  const positions: number[] = []
  const scattered: number[] = []
  const opacities: number[] = []
  const edges: number[] = []

  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const l = lum[GRID * y + x]
      if (l <= LUMINANCE_MIN || isIsolated(x, y))
        continue
      positions.push((x - GRID / 2) * WORLD_STEP, (GRID / 2 - y) * WORLD_STEP, 0)
      opacities.push(l)
      // 3x3 邻域缺口比例 → 边缘系数（内部 0、轮廓 1），边缘粒子抖动更大
      let missing = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0)
            continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || lum[GRID * ny + nx] <= LUMINANCE_MIN)
            missing += 1
        }
      }
      edges.push(missing / 8)
      // 散开起点：随机球面方向（半轴压缩），汇聚动画的出发点
      const angle = Math.random() * Math.PI * 2
      const polar = Math.acos(2 * Math.random() - 1)
      const radius = 3 * (0.4 + 0.6 * Math.random())
      scattered.push(
        Math.sin(polar) * Math.cos(angle) * radius,
        Math.sin(polar) * Math.sin(angle) * radius,
        Math.cos(polar) * radius * 0.5,
      )
    }
  }

  return {
    positions: new Float32Array(positions),
    scatteredPositions: new Float32Array(scattered),
    opacities: new Float32Array(opacities),
    edges: new Float32Array(edges),
    count: positions.length / 3,
  }
}

const VERTEX_SHADER = /* glsl */ `
  attribute float aOpacity;
  attribute float aIndex;
  attribute float aEdge;
  attribute vec3 aScattered;

  uniform float uTime;
  uniform float uSize;
  uniform float uWaveSpeed;
  uniform float uWaveAmount;
  uniform vec2 uMouse;
  uniform float uMouseRadius;
  uniform float uMouseStrength;
  uniform float uMouseDistort;
  uniform float uAssembly;
  uniform float uLoose;
  uniform float uScatter;
  uniform vec3 uLightPos;
  uniform float uLightRange;
  uniform float uShadeMin;
  uniform float uShadeMax;

  varying float vOpacity;
  varying vec3 vWorldPos;
  varying float vAssembly;
  varying float vLight;

  void main() {
    vOpacity = aOpacity;
    vAssembly = uAssembly;

    float assembly = smoothstep(0.0, 1.0, uAssembly);
    vec3 center = mix(aScattered, position, assembly);
    vec3 pos = center;
    vWorldPos = center;

    // 常驻松散抖动：边缘系数调制，头部一侧附加摆尾
    float loose = uLoose * mix(0.25, 1.0, aEdge) * assembly;
    if (loose > 0.001) {
      vec3 jitter = vec3(
        fract(sin(aIndex * 12.9898) * 43758.5453) - 0.5,
        fract(sin(aIndex * 78.2330) * 12543.1230) - 0.5,
        fract(sin(aIndex * 39.4250) * 26711.7700) - 0.5
      );
      pos += jitter * 0.05 * loose;
      pos.x += sin(uTime * 0.50 + aIndex * 0.53) * 0.06 * loose;
      pos.y += cos(uTime * 0.42 + aIndex * 0.71) * 0.06 * loose;
      pos.z += sin(uTime * 0.36 + aIndex * 0.91) * 0.08 * loose;

      float tail = smoothstep(0.5, 4.5, position.x) * uLoose * assembly;
      pos.y += sin(uTime * 1.1 - position.x * 0.7) * 0.1 * tail;
      pos.z += cos(uTime * 0.9 - position.x * 0.55) * 0.06 * tail;
    }

    if (uScatter > 0.001) {
      float disperse = uScatter * mix(0.5, 1.0, aEdge);
      pos += (aScattered - center) * disperse;
      pos.z += sin(uTime * 0.6 + aIndex * 0.3) * disperse * 0.6;
    }

    // 成形后：自身体中心向外的涟漪
    if (assembly > 0.95) {
      float effectStrength = (assembly - 0.95) * 20.0;
      float dist = length(center.xy);
      float waveFade = smoothstep(0.0, 3.0, dist);
      float wave = sin(dist * 3.0 - uTime * uWaveSpeed) * uWaveAmount * effectStrength * waveFade;
      pos.z += wave;
    }

    // 鼠标漩涡：径向推力 + 随机角向扰动
    if (assembly > 0.8) {
      float mouseEffect = (assembly - 0.8) * 5.0;
      vec2 toMouse = center.xy - uMouse;
      float mouseDist = length(toMouse);

      if (mouseDist < uMouseRadius && mouseDist > 0.001) {
        float t = 1.0 - mouseDist / uMouseRadius;
        float force = t * t * t * mouseEffect * uMouseStrength;
        vec2 radialDir = toMouse / mouseDist;
        float noiseAngle = sin(aIndex * 0.37 + uTime * 0.5) * uMouseDistort;
        float ca = cos(noiseAngle);
        float sa = sin(noiseAngle);
        vec2 pushDir = vec2(
          radialDir.x * ca - radialDir.y * sa,
          radialDir.x * sa + radialDir.y * ca
        );

        pos.xy += pushDir * force * 2.0;
        pos.z += sin(aIndex * 1.7 + uTime) * force * 0.8;
      }
    }

    // 汇聚早期：整体散乱漂浮
    if (assembly < 0.9) {
      float scatter = smoothstep(0.9, 0.0, assembly);
      pos.x += sin(uTime * 0.5 + aIndex * 0.1) * 0.2 * scatter;
      pos.y += cos(uTime * 0.4 + aIndex * 0.07) * 0.2 * scatter;
      pos.z += sin(uTime * 0.3 + aIndex * 0.13) * 0.15 * scatter;
    }

    // 点光照（右上、随鼠标横移）：平方衰减 → 亮度系数
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    float lightDist = distance(worldPos.xyz, uLightPos);
    float lit = clamp(1.0 - lightDist / uLightRange, 0.0, 1.0);
    vLight = mix(uShadeMin, uShadeMax, lit * lit);

    gl_PointSize = uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  varying float vOpacity;
  varying vec3 vWorldPos;
  varying float vAssembly;
  varying float vLight;

  uniform float uTime;
  uniform vec3 uColor;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float softDot = smoothstep(0.5, 0.1, d);

    float dist = length(vWorldPos.xy);
    float glow = smoothstep(8.0, 0.0, dist) * 0.3 * vAssembly;

    float baseAlpha = mix(0.6, 0.9, vAssembly);
    float alpha = vOpacity * (baseAlpha + glow) * softDot;
    float shimmer = sin(uTime * 1.5 + vWorldPos.x * 5.0 + vWorldPos.y * 3.0) * 0.1 + 0.9;
    alpha *= shimmer * min(vLight, 1.0);

    vec3 color = (uColor + glow * vec3(0.2, 0.3, 0.5)) * vLight;
    color = mix(
      color,
      color * vec3(1.07, 1.02, 0.94),
      clamp(vLight - 1.0, 0.0, 1.0)
    );
    gl_FragColor = vec4(color, alpha);
  }
`

/** 参考站 WhaleParticles 的光照与鼠标参数 */
const LIGHT_DEFAULTS = { x: 4.5, y: 5.5, z: 3, range: 14, shadeMin: 0.42, shadeMax: 1.116, followX: 1.05 }
const MOUSE_DEFAULTS = { radius: 4.9, strength: 0.8, decay: 0.2, distort: 5 }
/** 参考站同款帧率上限（fps 30），GPU 占用友好 */
const FRAME_INTERVAL_MS = 1000 / 30

/**
 * 手动帧驱动（参考站 cS 同款）：frameloop never + rAF 限帧调用 advance。
 * 规避 r3f v9 自动循环偶发不启动的问题，同时把渲染频率压到 30fps。
 */
function FrameDriver() {
  const advanceFn = useThree(state => state.advance)

  useEffect(() => {
    let raf = 0
    let start: number | null = null
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (start === null)
        start = now
      if (now - last < FRAME_INTERVAL_MS)
        return
      last = now - ((now - last) % FRAME_INTERVAL_MS)
      advanceFn((now - start) / 1000)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [advanceFn])

  return null
}

/** 粒子云：动画时序、鼠标世界坐标换算与 uniform 更新（与参考站 useFrame 等价） */
function WhalePointCloud(props: { data: PixelData }) {
  const groupRef = useRef<Group>(null)
  const viewport = useThree(state => state.viewport)
  const stateSize = useThree(state => state.size)
  const pixelRatio = useThree(state => state.viewport.dpr)
  const canvasElRef = useRef<HTMLElement | null>(null)
  const mouseNdcRef = useRef({ x: 0, y: 0 })
  const mouseActiveRef = useRef(false)
  const mouseHasMovedRef = useRef(false)
  const smoothedMouseRef = useRef(new Vector2(0, 0))
  const elapsedRef = useRef(0)

  const geometry = useMemo(() => {
    const geo = new BufferGeometry()
    const { count } = props.data
    const indices = new Float32Array(count)
    for (let i = 0; i < count; i += 1) indices[i] = i
    geo.setAttribute('position', new BufferAttribute(props.data.positions, 3))
    geo.setAttribute('aOpacity', new BufferAttribute(props.data.opacities, 1))
    geo.setAttribute('aIndex', new BufferAttribute(indices, 1))
    geo.setAttribute('aEdge', new BufferAttribute(props.data.edges, 1))
    geo.setAttribute('aScattered', new BufferAttribute(props.data.scatteredPositions, 3))
    return geo
  }, [props.data])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSize: { value: 2 },
      uWaveSpeed: { value: 1.5 },
      uWaveAmount: { value: 0.06 },
      uMouse: { value: new Vector2(0, 0) },
      uMouseRadius: { value: 1.5 },
      uMouseStrength: { value: 0 },
      uMouseDistort: { value: 0.8 },
      uAssembly: { value: 0 },
      uLoose: { value: 1 },
      uScatter: { value: 0 },
      uLightPos: { value: new Vector3(LIGHT_DEFAULTS.x, LIGHT_DEFAULTS.y, LIGHT_DEFAULTS.z) },
      uLightRange: { value: LIGHT_DEFAULTS.range },
      uShadeMin: { value: LIGHT_DEFAULTS.shadeMin },
      uShadeMax: { value: LIGHT_DEFAULTS.shadeMax },
      uColor: { value: new Color(0.75, 0.8, 0.9) },
    }),
    [],
  )

  useEffect(() => {
    canvasElRef.current = document.querySelector('canvas')
  }, [])

  useEffect(() => {
    function handleMove(event: MouseEvent) {
      const canvas = canvasElRef.current
      if (!canvas)
        return
      const rect = canvas.getBoundingClientRect()
      mouseNdcRef.current = {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      }
      mouseActiveRef.current = true
      mouseHasMovedRef.current = true
    }
    function handleLeave() {
      mouseActiveRef.current = false
    }
    function handleVisibility() {
      if (document.hidden)
        mouseActiveRef.current = false
    }
    window.addEventListener('mousemove', handleMove, { passive: true })
    window.addEventListener('mouseleave', handleLeave)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseleave', handleLeave)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  useFrame((state, delta) => {
    elapsedRef.current += delta
    // 入场：0.3s 延迟 + 2.5s easeOutCubic 汇聚
    const assembleT = Math.max(0, Math.min(1, (elapsedRef.current - 0.3) / 2.5))
    const assembly = 1 - (1 - assembleT) ** 3
    const group = groupRef.current
    if (!group)
      return
    if (assembleT <= 0) {
      group.scale.setScalar(0)
      return
    }

    const u = uniforms
    u.uTime.value = state.clock.getElapsedTime()
    u.uAssembly.value = assembly
    u.uMouseRadius.value = MOUSE_DEFAULTS.radius
    u.uMouseDistort.value = MOUSE_DEFAULTS.distort
    u.uLightRange.value = LIGHT_DEFAULTS.range
    u.uShadeMin.value = LIGHT_DEFAULTS.shadeMin
    u.uShadeMax.value = LIGHT_DEFAULTS.shadeMax

    // 鼠标强度平滑进出（参考站同款指数趋近）
    const targetStrength = mouseActiveRef.current ? MOUSE_DEFAULTS.strength : 0
    u.uMouseStrength.value += (targetStrength - u.uMouseStrength.value) * (1 - 0.05 ** delta)

    // 归一化鼠标 → 世界坐标（指数平滑，decay 换算为帧率无关）
    const targetX = (mouseHasMovedRef.current ? mouseNdcRef.current.x : 0) * viewport.width * 0.5
    const targetY = (mouseHasMovedRef.current ? mouseNdcRef.current.y : 0) * viewport.height * 0.5
    const factor = 1 - (1 - MOUSE_DEFAULTS.decay) ** (delta * 60)
    smoothedMouseRef.current.x += (targetX - smoothedMouseRef.current.x) * (mouseHasMovedRef.current ? factor : 1)
    smoothedMouseRef.current.y += (targetY - smoothedMouseRef.current.y) * (mouseHasMovedRef.current ? factor : 1)

    // 点光源 X 跟随鼠标
    const lightX = LIGHT_DEFAULTS.x + smoothedMouseRef.current.x * LIGHT_DEFAULTS.followX
    u.uLightPos.value.set(lightX, LIGHT_DEFAULTS.y, LIGHT_DEFAULTS.z)

    // 鼠标世界位置 → 组局部坐标（组带轻微摇摆旋转）
    const inverse = group.matrixWorld.clone().invert()
    const local = new Vector3(smoothedMouseRef.current.x, smoothedMouseRef.current.y, 0).applyMatrix4(inverse)
    u.uMouse.value.set(local.x, local.y)

    // 颜色随汇聚淡入；粒子尺寸跟随窗口与 DPR。
    // 小画布（移动端）下粒子像素尺寸同比缩小、加性混合后存在感偏弱，
    // 按画布高度分档放大补偿（<420px 视为移动端档）
    const sizeBoost = stateSize.height < 420 ? 1.5 : 1
    u.uColor.value.setRGB(0.75 * assembly, 0.8 * assembly, 0.9 * assembly)
    u.uSize.value = PLATE_SIZE * (stateSize.height / viewport.height) * pixelRatio * sizeBoost

    // 组运动（参考站 spin=false 分支）
    const t = u.uTime.value
    group.rotation.z = 0.04 * Math.sin(0.25 * t)
    group.rotation.x = 0.05 * Math.sin(0.08 * t * 0.7)
    group.rotation.y = 0.1 * Math.sin(0.08 * t)
    group.position.y = 0.15 * Math.sin(0.4 * t)
    group.scale.setScalar(0.75 + 0.25 * assembly)
  })

  // 命令式创建材质：保证 useFrame 持有的 uniforms 与渲染中材质是同一引用
  // （JSX <shaderMaterial uniforms={...}> 会被拷贝，导致动画写入落空）
  const material = useMemo(
    () => new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
    [uniforms],
  )

  return (
    <group ref={groupRef}>
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  )
}

/** 容器：布局沿用参考站 WhaleParticles（全宽、screen 混合、620px 画布居左偏上）。
 * 移动端不再隐藏：画布按视口等比缩小（70vw），鲸鱼完整成形于文案后方 */
export function WhaleParticles() {
  const [data, setData] = useState<PixelData | null>(null)

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setData(sampleWhale(img))
    img.src = WHALE_SVG
  }, [])

  if (!data || data.count === 0)
    return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-start overflow-hidden mix-blend-screen"
    >
      <div className="ml-[2vw] h-[92vw] w-[92vw] max-h-[560px] max-w-[560px] -translate-y-[24vw] shrink-0 md:ml-[50px] md:h-[620px] md:w-[620px] md:max-h-none md:max-w-none md:-translate-y-[120px]">
        <Canvas
          camera={{ position: [0, 0, 18], fov: 50 }}
          gl={{ alpha: true, antialias: true }}
          dpr={[1, 1.5]}
          frameloop="never"
          style={{ background: 'transparent' }}
        >
          <FrameDriver />
          <WhalePointCloud data={data} />
        </Canvas>
      </div>
    </div>
  )
}
