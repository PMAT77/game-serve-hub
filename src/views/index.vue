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
    tagline: '从开服到日常管理，一个页面搞定',
    url: LINKS.docs,
    features: [
      '一键安装与更新游戏服务端',
      '创建、启动、停止实例，随时看运行状态',
      '安装进度与资源占用',
      '多开自动分配端口',
      '一条命令部署到自己的服务器',
    ],
  },
  {
    name: '监控台',
    tagline: '机器负载一目了然，不用登录服务器查',
    url: LINKS.docs,
    features: [
      'CPU、内存、磁盘占用',
      '游戏服务运行状态',
      '实时网络流量',
      '和实例状态一起看',
    ],
  },
  {
    name: '游戏控制台',
    tagline: '在面板里看日志、发指令，不用切终端',
    url: LINKS.docs,
    features: [
      '实时查看运行日志',
      '游戏内命令',
      '直连邀请码',
    ],
  },
  {
    name: 'DST 房间 / 世界',
    tagline: '可视化编辑房间与地上、洞穴世界',
    url: LINKS.docs,
    features: [
      '房间名称、密码与联网方式',
      '地上与洞穴两个世界',
      '地图与规则可视化调整',
    ],
  },
  {
    name: '备份与恢复',
    tagline: '存档随时能找回',
    url: LINKS.docs,
    features: [
      '存档一键备份与恢复',
      '更新、删除实例前自动备份',
      '面板数据备份',
    ],
  },
])

const useCases = ref([
  { title: '个人开服', description: '在自己电脑或云服务器上一键开服' },
  { title: '小圈子联机', description: '在面板里看日志、发指令，不用 SSH' },
  { title: '社区服运营', description: '一眼看清机器负载与游戏服务状态' },
  { title: '进阶运维', description: 'Mod、备份恢复已内置；计划任务、告警等能力按版本路线图发布' },
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
            开源 · 自托管 · 免费
          </div>
          <h1 class="text-2xl leading-tight tracking-tight font-semibold mb-3 md-text-3xl">
            Steam 专用服务器，可视化管理
            <div class="text-4xl tracking-tight font-semibold md-text-6xl">
              GameServerHub
            </div>
          </h1>
          <p class="text-sm text-muted-foreground leading-relaxed mb-6 max-w-prose md-text-base">
            开源、可自托管的 <span class="text-foreground font-medium">游戏服务器面板</span>。目前支持
            <span class="text-foreground font-medium">饥荒联机版（DST）</span>：一条命令装好，升级面板时玩家不掉线。
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
                  一条命令安装，不用预先配好运行环境
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
                  互不影响
                </div>
                <div class="text-sm text-muted-foreground">
                  升级面板时玩家不掉线
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
