<script setup lang="ts">
import logo from '@/assets/images/logo.svg'
import placeholdPreview from '@/assets/images/placehold.png'

/** 待补充：文档站、镜像站、Pro 购买页等外链 */
const LINKS = {
  docs: '#',
  github: 'https://github.com/PMAT77/game-server-hub',
  gitee: '#',
  gitcode: '#',
  pro: '#',
} as const

const versionType = ref('community')

const products = ref([
  {
    name: '实例管理',
    tagline: '创建、安装、启停与日志，掌控 DST 专用服生命周期',
    logo,
    url: LINKS.docs,
    features: [
      '通过 SteamCMD 安装与更新游戏服务端',
      '实例创建、启动、停止与运行状态查看',
      '安装过程日志与资源占用快照',
      'Docker Compose 对齐的生产部署路径',
      'v1 聚焦饥荒联机版（Don\'t Starve Together）',
    ],
  },
  {
    name: '监控台',
    tagline: '主机与容器资源一目了然，辅助日常运维决策',
    logo,
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
    logo,
    url: LINKS.docs,
    images: [
      placeholdPreview,
    ],
  },
])

const useCases = ref([
  { title: '个人开服', description: '在家或 VPS 上一键部署，快速拉起饥荒私服' },
  { title: '小圈子联机', description: '稳定托管、日志与控制台，减轻日常维护成本' },
  { title: '社区服运营', description: '多实例与资源监控，便于掌握节点负载与状态' },
  { title: '进阶运维', description: '房间/世界、Mod、备份等能力按路线图持续补齐' },
])

function open(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div class="bg-background size-full absolute overflow-auto">
    <div class="mx-auto px-4 py-6 max-w-7xl md-px-8 md-py-10">
      <!-- Top Bar -->
      <div class="mb-6 flex items-center justify-between">
        <div class="flex gap-3 items-center">
          <FaIcon :name="logo" class="p-1 border rounded-lg size-10" />
          <span class="tracking-tight font-semibold">GameServerHub</span>
        </div>
        <FaTabs
          v-model="versionType"
          :list="[
            { label: 'Community', value: 'community' },
            { label: 'Pro', value: 'pro' },
          ]"
        />
      </div>

      <!-- Hero: Asymmetric split -->
      <div class="mb-6 gap-4 grid items-stretch md-grid-cols-[3fr_2fr]">
        <!-- Left: Title & CTA -->
        <div class="hero-enter p-6 border rounded-xl relative overflow-hidden md-p-8">
          <div class="text-xs text-muted-foreground tracking-widest font-medium mb-3 uppercase">
            Node.js · Vue 3 · Vite · Docker · SQLite
          </div>
          <h1 class="text-2xl leading-tight tracking-tight font-semibold mb-3 md-text-3xl">
            欢迎使用
            <div class="text-4xl tracking-tight font-semibold md-text-6xl">
              GameServerHub
            </div>
          </h1>
          <p class="text-sm text-muted-foreground leading-relaxed mb-6 max-w-prose md-text-base">
            开源 <span class="text-foreground font-medium">Steam 游戏专用服务器面板</span>：装得上、开得起来、管得住。v1 聚焦饥荒联机版一键开服，Community 版提供完整自托管能力。
          </p>
          <div class="flex flex-wrap gap-3">
            <FaButton size="lg" @click="open(LINKS.docs)">
              项目文档
            </FaButton>
            <FaDropdown
              :items="[
                [
                  { label: 'Github', icon: 'i-simple-icons:github', handle: () => open(LINKS.github) },
                  { label: 'Gitee', icon: 'i-simple-icons:gitee', handle: () => open(LINKS.gitee) },
                  { label: 'GitCode', icon: 'i-simple-icons:gitcode', handle: () => open(LINKS.gitcode) },
                ],
              ]"
            >
              <FaButton variant="outline" size="lg">
                代码仓库
                <FaIcon name="i-ep:arrow-down" class="ml-1" />
              </FaButton>
            </FaDropdown>
            <FaButton variant="outline" size="lg" @click="open(LINKS.pro)">
              Pro 商业版
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
                  安装脚本 + Docker Compose 生产路径
                </div>
              </div>
            </div>
          </div>
          <div class="stat-enter border rounded-xl bg-neutral-950/[.012] dark:bg-white/5" :style="{ animationDelay: '200ms' }">
            <div class="p-5 flex flex-col h-full justify-between">
              <div class="text-xs text-muted-foreground tracking-widest font-medium uppercase">
                开源许可
              </div>
              <div>
                <div class="text-3xl tracking-tight font-semibold mb-1 md-text-4xl">
                  MIT
                </div>
                <div class="text-sm text-muted-foreground flex flex-wrap gap-1 items-center">
                  <span>Community 版覆盖</span>
                  <span class="text-foreground font-semibold">装服、启停、监控、控制台</span>
                  <span>等自托管核心能力</span>
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

      <!-- Ecosystem -->
      <div>
        <div class="mb-4 flex gap-3 items-center">
          <div class="rounded-full bg-primary h-4 w-0.5" />
          <h2 class="text-xs text-muted-foreground tracking-widest font-semibold uppercase">
            核心能力
          </h2>
          <span class="text-xs text-muted-foreground hidden md-block">面板核心模块与路线图能力一览</span>
        </div>
        <div class="gap-4 grid md-grid-cols-3">
          <div
            v-for="(product, i) in products"
            :key="product.name"
            class="group card-enter border rounded-xl bg-neutral-950/[.012] dark:bg-white/5"
            :style="{ animationDelay: `${i * 80}ms` }"
          >
            <div class="flex flex-col h-full">
              <div class="p-6 border-b flex gap-4 items-start">
                <img :src="product.logo" :alt="product.name" class="shrink-0 h-10 w-10 object-contain">
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
                <div v-if="product.features" class="mb-5 flex-1">
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
                <div v-if="product.images" class="mb-5 border rounded-lg flex-1 overflow-hidden">
                  <img
                    :src="product.images[0]"
                    :alt="product.name"
                    class="opacity-50 h-full w-full transition-opacity duration-500 object-cover group-hover-opacity-100"
                  >
                </div>
                <FaButton
                  variant="link"
                  size="sm"
                  class="mt-auto active-scale-98"
                  @click="open(product.url)"
                >
                  探索 →
                </FaButton>
              </div>
            </div>
          </div>
        </div>
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
