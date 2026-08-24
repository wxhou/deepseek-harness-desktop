/**
 * prebuild：把 `src-tauri/resources/preset-plugins.json` 中标记 `internal: true`
 * 的插件从上游仓库克隆、安装依赖并构建，产物拷入
 * `src-tauri/resources/preset-plugins/<id>/`（随 `bundle.resources` 随安装包分发）。
 *
 * 由 `pnpm build` 的 prebuild 生命周期自动触发（tauri 的 `beforeBuildCommand` 为
 * `pnpm build`，pnpm 先执行 `prebuild` 脚本）。应用启动时（service::plugin::internal）
 * 会核对内置插件是否已安装、安装路径是否仍指向该捆绑目录，未满足即强制重装。
 *
 * 约束：仅用 Node 内置模块（零新增依赖）；需要 git 与 pnpm 在 PATH 上；
 * 构建机器需可访问 GitHub 与 npm registry。本文件是「可擦除」TypeScript，
 * Node ≥22.6（--experimental-strip-types）或 ≥23.6（默认启用类型剥离）可直接执行。
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface PresetPlugin {
  id: string
  spec: string
  internal?: boolean
}

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PRESET_FILE = join(REPO_ROOT, 'src-tauri', 'resources', 'preset-plugins.json')
const BUNDLE_ROOT = join(REPO_ROOT, 'src-tauri', 'resources', 'preset-plugins')
const GIT_URL_RE = /^github:([^#/]+\/[^#/]+)(?:#.*)?$/

function die(message: string): never {
  console.error(`[prebuild] ${message}`)
  process.exit(1)
}

/** 同步执行命令，非零退出码即终止构建（内置插件缺失是发布缺陷，必须响亮失败）。 */
function run(program: string, args: readonly string[], cwd: string): void {
  console.log(`[prebuild] $ ${program} ${args.join(' ')}`)
  const result = spawnSync(program, [...args], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    die(`${program} 启动失败: ${result.error.message}`)
  }
  if (result.status !== 0) {
    die(`${program} ${args.join(' ')} 退出码 ${result.status}`)
  }
}

/** `github:owner/repo[#ref]` → 可克隆的 https URL（忽略 ref，拉默认分支最新）。 */
function githubUrl(spec: string): string {
  const match = GIT_URL_RE.exec(spec)
  if (match === null) {
    die(`internal 插件 spec 必须是 github:owner/repo 形式，当前为: ${spec}`)
  }
  const repo = match[1].replace(/\.git$/, '')
  return `https://github.com/${repo}.git`
}

/**
 * 拷贝构建产物：优先 `files` 白名单（只发运行必需：lib/、patch 文件、README），
 * 缺失白名单时拷贝整目录但排除 node_modules/.git 等开发噪声；
 * `package.json` 恒在（它是 `pnpm add file:<dir>` 的包名/入口来源）。
 */
function collectBundle(preset: PresetPlugin, clone: string): void {
  const dest = join(BUNDLE_ROOT, preset.id)
  mkdirSync(dest, { recursive: true })

  const manifest = JSON.parse(readFileSync(join(clone, 'package.json'), 'utf8')) as Record<string, unknown>
  const rawFiles = manifest.files
  const files = Array.isArray(rawFiles)
    ? rawFiles.filter((f): f is string => typeof f === 'string')
    : undefined
  const skip = new Set(['node_modules', '.git', '.gitignore', '.npmrc'])
  const entries = files !== undefined && files.length > 0
    ? files
    : readdirSync(clone).filter(name => !skip.has(name) && !name.endsWith('.tsbuildinfo'))

  for (const name of entries) {
    const src = join(clone, name)
    if (!existsSync(src)) {
      die(`${preset.id}: 白名单产物缺失 ${src}`)
    }
    cpSync(src, join(dest, name), { recursive: true })
  }
  // 拷贝后置，确保即使白名单里没有 package.json 它也一定存在
  cpSync(join(clone, 'package.json'), join(dest, 'package.json'))
}

/** 构建单个 internal 插件：克隆 → 装依赖 → 构建 → 拷贝产物。 */
function buildPlugin(preset: PresetPlugin): void {
  const dest = join(BUNDLE_ROOT, preset.id)
  rmSync(dest, { recursive: true, force: true })

  const temp = mkdtempSync(join(tmpdir(), `dsh-internal-${preset.id}-`))
  const clone = join(temp, preset.id)
  run('git', ['clone', '--depth', '1', '--quiet', githubUrl(preset.spec), clone], temp)

  const revision = spawnSync('git', ['-C', clone, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
  if (revision.status === 0) {
    console.log(`[prebuild] ${preset.id}: 来源修订 ${revision.stdout.trim()}`)
  }

  // 注意：pnpm ≥10 默认拦截依赖的构建脚本（esbuild/原生模块需在插件仓库
  // 的 pnpm-workspace.yaml 配 onlyBuiltDependencies 放行）；纯 JS/TS 插件不受影响。
  run('pnpm', ['install'], clone)
  const manifest = JSON.parse(readFileSync(join(clone, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  if (manifest.scripts?.build !== undefined) {
    run('pnpm', ['run', 'build'], clone)
  }

  collectBundle(preset, clone)
  rmSync(temp, { recursive: true, force: true })
  console.log(`[prebuild] ${preset.id}: 产物已就绪 → ${dest}`)
}

function main(): void {
  if (!existsSync(PRESET_FILE)) {
    die(`未找到预设清单 ${PRESET_FILE}`)
  }
  const presets = JSON.parse(readFileSync(PRESET_FILE, 'utf8')) as PresetPlugin[]
  const internal = presets.filter(preset => preset.internal === true)
  if (internal.length === 0) {
    console.log('[prebuild] 预设清单无 internal 插件，跳过')
    return
  }
  console.log(`[prebuild] 拉取 ${internal.length} 个 internal 插件: ${internal.map(p => p.id).join(', ')}`)
  for (const preset of internal) {
    buildPlugin(preset)
  }
  console.log(`[prebuild] 完成 → ${BUNDLE_ROOT}`)
}

main()