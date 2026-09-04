<script setup lang="ts">
import { routeToNodeInstance } from '@/navigation/game-routes'
const router = useRouter()

const LINKS = {
  docs: 'https://github.com/PMAT77/game-serve-hub#readme',
  github: 'https://github.com/PMAT77/game-serve-hub',
} as const

const products = ref([
  {
    name: '实例管理',
    tagline: '创建、安装、启停与日志，掌控 DST 专用服生命周期',
    url: LINKS.docs,
    features: [
      'SteamCMD 安装与更新游戏服务端',
      '实例创建、启动、停止与运行状态查看',
      '安装过程日志与资源占用快照',
      '多实例自动端口分配',
      'Docker Compose 对齐的生产部署路径',
    ],
  },
  {
    name: '监控台',
    tagline: '主机与容器资源一目了然，辅助日常运维决策',
    url: LINKS.docs,
    features: [
      'CPU、内存、磁盘等主机指标',
      'Docker 运行概况',
      '网卡实时流量',
      '与实例状态联动查看',
    ],
  },
  {
    name: '游戏控制台',
    tagline: '贴近游戏内的运维体验，少登录、少切终端',
    url: LINKS.docs,
    features: [
      '实例日志 SSE 实时流',
      '游戏内命令下发',
      '直连连接代码生成',
    ],
  },
  {
    name: 'DST 房间 / 世界',
    tagline: 'Cluster 与分片配置，可视化编辑房间与世界规则',
    url: LINKS.docs,
    features: [
      'Cluster 房间配置',
      'Master / Caves 分片管理',
      '地图与规则可视化编辑',
    ],
  },
])

const useCases = ref([
  { title: '个人开服', description: 'VPS 或家用 Linux 一条命令拉起面板与 DST 实例' },
  { title: '小圈子联机', description: '控制台看日志、下发命令，减少 SSH 维护' },
  { title: '社区服运营', description: '监控台掌握 CPU、内存、磁盘与 Docker 状态' },
  { title: '进阶运维', description: 'Mod、备份、计划任务等能力按版本路线图发布' },
])

function open(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

const appAccountStore = useAppAccountStore()

function goLogin() {
  // 已登录时原跳 /login 会被守卫弹回主页，直接进入实例管理
  if (appAccountStore.isLogin) {
    router.push(routeToNodeInstance())
    return
  }
  router.push('/login')
}
</script>

<template>
  <div class="bg-background size-full absolute overflow-auto">
    <div class="mx-auto px-4 py-6 max-w-7xl md-px-8 md-py-10">
      <!-- Top Bar -->
      <div class="mb-6 flex items-center justify-between">
        <div class="flex gap-3 items-center">
          <AppLogoMark size-class="h-[30px] w-[40px]" class="p-1 border rounded-lg" />
          <span class="tracking-tight font-semibold">GameServerHub</span>
          <span class="text-xs text-muted-foreground px-2 py-0.5 border rounded-full">
            Community · MIT
          </span>
        </div>
      </div>

      <!-- Hero: Asymmetric split -->
      <div class="mb-6 gap-4 grid items-stretch md-grid-cols-[3fr_2fr]">
        <!-- Left: Title & CTA -->
        <div class="hero-enter p-6 border rounded-xl relative overflow-hidden md-p-8">
          <div class="text-xs text-muted-foreground tracking-widest font-medium mb-3 uppercase">
            Docker · SteamCMD · DST · MIT
          </div>
          <h1 class="text-2xl leading-tight tracking-tight font-semibold mb-3 md-text-3xl">
            Steam 专用服务器，可视化管理
            <div class="text-4xl tracking-tight font-semibold md-text-6xl">
              GameServerHub
            </div>
          </h1>
          <p class="text-sm text-muted-foreground leading-relaxed mb-6 max-w-prose md-text-base">
            开源 <span class="text-foreground font-medium">Steam 游戏专用服务器面板</span>，Community 版 MIT 完整自托管。v1 聚焦
            <span class="text-foreground font-medium">饥荒联机版（DST）</span>，Linux 一键脚本 + Docker Compose 生产部署；面板与游戏容器分离，升级面板时实例可继续运行。
          </p>
          <div class="flex flex-wrap gap-3">
            <FaButton size="lg" @click="goLogin">
              {{ appAccountStore.isLogin ? '进入实例管理' : '进入面板' }}
            </FaButton>
            <FaButton variant="outline" size="lg" @click="open(LINKS.docs)">
              项目文档
            </FaButton>
            <FaButton variant="outline" size="lg" @click="open(LINKS.github)">
              <FaIcon name="i-simple-icons:github" class="mr-1" />
              GitHub
            </FaButton>
          </div>
        </div>

        <!-- Right: Stats -->
        <div class="gap-4 grid grid-rows-2">
          <div class="stat-enter border rounded-xl bg-neutral-950/[.012] dark:bg-white/5" :style="{ animationDelay: '100ms' }">
            <div class="p-5 flex flex-col h-full justify-between">
              <div class="text-xs text-muted-foreground tracking-widest font-medium uppercase">
                一键部署
              </div>
              <div>
                <div class="text-3xl tracking-tight font-semibold mb-1 md-text-4xl">
                  Linux
                </div>
                <div class="text-sm text-muted-foreground">
                  安装脚本 + Docker Compose；宿主机无需 Node.js 或 SteamCMD
                </div>
              </div>
            </div>
          </div>
          <div class="stat-enter border rounded-xl bg-neutral-950/[.012] dark:bg-white/5" :style="{ animationDelay: '200ms' }">
            <div class="p-5 flex flex-col h-full justify-between">
              <div class="text-xs text-muted-foreground tracking-widest font-medium uppercase">
                升级不掉线
              </div>
              <div>
                <div class="text-3xl tracking-tight font-semibold mb-1 md-text-4xl">
                  分离架构
                </div>
                <div class="text-sm text-muted-foreground">
                  面板与 gsh 游戏容器独立运行，按文档升级时玩家通常不掉线
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Use Cases -->
      <div class="mb-6">
        <div class="mb-3 flex gap-2 items-center">
          <div class="rounded-full bg-primary h-4 w-0.5" />
          <h2 class="text-xs text-muted-foreground tracking-widest font-semibold uppercase">
            应用场景
          </h2>
        </div>
        <div class="gap-3 grid grid-cols-2 md-grid-cols-4">
          <div
            v-for="(useCase, i) in useCases"
            :key="useCase.title"
            class="card-enter border rounded-xl bg-neutral-950/[.012] dark:bg-white/5"
            :style="{ animationDelay: `${i * 60}ms` }"
          >
            <div class="p-5">
              <div class="text-sm font-semibold mb-2">
                {{ useCase.title }}
              </div>
              <div class="text-xs text-muted-foreground leading-relaxed">
                {{ useCase.description }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Core capabilities -->
      <div>
        <div class="mb-4 flex gap-3 items-center">
          <div class="rounded-full bg-primary h-4 w-0.5" />
          <h2 class="text-xs text-muted-foreground tracking-widest font-semibold uppercase">
            核心能力
          </h2>
          <span class="text-xs text-muted-foreground hidden md-block">v1 已支持模块一览</span>
        </div>
        <div class="gap-4 grid md-grid-cols-2">
          <div
            v-for="(product, i) in products"
            :key="product.name"
            class="group card-enter border rounded-xl bg-neutral-950/[.012] dark:bg-white/5"
            :style="{ animationDelay: `${i * 80}ms` }"
          >
            <div class="flex flex-col h-full">
              <div class="p-6 border-b flex gap-4 items-start">
                <AppLogoMark size-class="h-10 w-10" />
                <div>
                  <div class="text-sm tracking-tight font-semibold">
                    {{ product.name }}
                  </div>
                  <div class="text-xs text-muted-foreground leading-relaxed mt-1">
                    {{ product.tagline }}
                  </div>
                </div>
              </div>
              <div class="p-6 flex-col-start flex-1">
                <div class="mb-5 flex-1">
                  <ul class="space-y-1.5">
                    <li
                      v-for="feature in product.features"
                      :key="feature"
                      class="text-xs text-muted-foreground flex gap-2 items-start"
                    >
                      <span class="text-primary mt-0.5 shrink-0">·</span>
                      <span>{{ feature }}</span>
                    </li>
                  </ul>
                </div>
                <FaButton
                  variant="link"
                  size="sm"
                  class="mt-auto active-scale-98"
                  @click="open(product.url)"
                >
                  查看文档 →
                </FaButton>
              </div>
            </div>
          </div>
        </div>
        <p class="text-xs text-muted-foreground mt-4 text-center">
          Pro 扩展能力规划中，详见版本发布说明
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero-enter {
  animation: slide-up 1.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.stat-enter {
  animation: slide-up 1.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.card-enter {
  animation: fade-up 1.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.active-scale-98:active {
  transform: scale(0.98);
}
</style>
