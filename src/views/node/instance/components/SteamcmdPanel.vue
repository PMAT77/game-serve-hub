<script setup lang="ts">
import type { TreeOption } from 'naive-ui'
import type { DirectoryItem, SteamcmdConfigPayload } from '@/api/modules/system'
import { h, onMounted, reactive, ref, watch } from 'vue'
import apiRequest from '@/api'
import apiSystem from '@/api/modules/system'

defineOptions({
  name: 'NodeInstanceSteamcmdPanel',
})

const emit = defineEmits<{
  stateChange: [payload: { installed: boolean, configured: boolean }]
}>()

interface DirectoryTreeOption extends TreeOption {
  entryType?: DirectoryItem['type']
  entryName?: string
}

const steamcmdSaving = ref(false)
const steamcmdInstalling = ref(false)
const steamcmdConfigured = ref(false)
const steamcmdInstalled = ref(false)
const detectedSteamcmdPath = ref('')
const installRootPickerVisible = ref(false)
const directoryTreeLoading = ref(false)
const directorySearchLoading = ref(false)
const directoryTreeData = ref<DirectoryTreeOption[]>([])
const selectedDirectoryKeys = ref<string[]>([])
const expandedDirectoryKeys = ref<string[]>([])
const directoryTreePattern = ref('')
let directorySearchRequestId = 0
let directorySearchTimer: ReturnType<typeof setTimeout> | undefined
const DIRECTORY_SEARCH_MIN_KEYWORD_LENGTH = 2

const steamcmdForm = reactive<SteamcmdConfigPayload>({
  steamcmdPath: '',
  installRoot: '',
})

function emitStateChange() {
  emit('stateChange', {
    installed: steamcmdInstalled.value,
    configured: steamcmdConfigured.value,
  })
}

async function fetchSteamcmdConfig() {
  const res = await apiSystem.getSteamcmdConfig()
  const configuredPath = res.data.steamcmdPath?.trim() || ''
  const detectedPath = res.data.detectedSteamcmdPath?.trim() || ''
  steamcmdInstalled.value = Boolean(res.data.isSteamcmdInstalled)
  detectedSteamcmdPath.value = detectedPath
  steamcmdForm.steamcmdPath = steamcmdInstalled.value && detectedPath
    ? detectedPath
    : configuredPath
  steamcmdForm.installRoot = res.data.installRoot
  steamcmdConfigured.value = Boolean(res.data.installRoot?.trim())
  emitStateChange()
}

function mapDirectoryToTreeOption(item: DirectoryItem): DirectoryTreeOption {
  const isDirectory = item.type === 'directory'
  return {
    label: item.name,
    key: item.path,
    isLeaf: !isDirectory,
    children: isDirectory ? undefined : [],
    entryType: item.type,
  }
}

function compareDirectoryItems(a: DirectoryItem, b: DirectoryItem) {
  const aSteamcmd = a.name.toLowerCase() === 'steamcmd.exe'
  const bSteamcmd = b.name.toLowerCase() === 'steamcmd.exe'
  if (aSteamcmd !== bSteamcmd) {
    return aSteamcmd ? -1 : 1
  }
  if (a.type !== b.type) {
    return a.type === 'directory' ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}

async function requestDirectoryList(parentPath?: string): Promise<{ data: DirectoryItem[] }> {
  const apiWithDirectoryList = apiSystem as typeof apiSystem & {
    getDirectoryList?: (directoryPath?: string) => Promise<{ data: DirectoryItem[] }>
  }
  if (typeof apiWithDirectoryList.getDirectoryList === 'function') {
    return apiWithDirectoryList.getDirectoryList(parentPath)
  }
  return apiRequest.get('app/system/filesystem/directories', {
    params: parentPath ? { path: parentPath } : undefined,
  }) as Promise<{ data: DirectoryItem[] }>
}

async function requestDirectorySearch(keyword: string): Promise<{ data: DirectoryItem[] }> {
  const apiWithDirectorySearch = apiSystem as typeof apiSystem & {
    searchDirectoryList?: (searchKeyword: string) => Promise<{ data: DirectoryItem[] }>
  }
  if (typeof apiWithDirectorySearch.searchDirectoryList === 'function') {
    return apiWithDirectorySearch.searchDirectoryList(keyword)
  }
  return apiRequest.get('app/system/filesystem/search', {
    params: { keyword },
  }) as Promise<{ data: DirectoryItem[] }>
}

async function loadDirectoryTree(parentPath?: string): Promise<DirectoryTreeOption[]> {
  const res = await requestDirectoryList(parentPath)
  return res.data
    .slice()
    .sort(compareDirectoryItems)
    .map(mapDirectoryToTreeOption)
}

function mapSearchResultToTreeOption(item: DirectoryItem): DirectoryTreeOption {
  return {
    label: item.path,
    key: item.path,
    isLeaf: item.type === 'file',
    children: item.type === 'directory' ? undefined : [],
    entryType: item.type,
    entryName: item.name,
  }
}

function replaceTreeChildren(targetKey: string, nodes: DirectoryTreeOption[], treeData: DirectoryTreeOption[]): DirectoryTreeOption[] {
  return treeData.map((item) => {
    if (String(item.key) === targetKey) {
      return {
        ...item,
        isLeaf: nodes.length === 0,
        children: nodes,
      }
    }
    if (!item.children?.length) {
      return item
    }
    return {
      ...item,
      children: replaceTreeChildren(targetKey, nodes, item.children),
    }
  })
}

async function loadRootDirectoryTree() {
  directoryTreeLoading.value = true
  try {
    const roots = await loadDirectoryTree()
    directoryTreeData.value = roots
    expandedDirectoryKeys.value = roots.map(item => String(item.key))
    await Promise.all(
      roots.map(async (root) => {
        const rootPath = String(root.key ?? '')
        if (!rootPath) {
          return
        }
        const children = await loadDirectoryTree(rootPath)
        directoryTreeData.value = replaceTreeChildren(rootPath, children, directoryTreeData.value)
      }),
    )
  }
  finally {
    directoryTreeLoading.value = false
  }
}

async function runDirectorySearch(keyword: string) {
  const trimmedKeyword = keyword.trim()
  if (!trimmedKeyword) {
    return
  }
  const requestId = ++directorySearchRequestId
  directorySearchLoading.value = true
  try {
    const res = await requestDirectorySearch(trimmedKeyword)
    if (requestId !== directorySearchRequestId) {
      return
    }
    const searchMatchedFiles = res.data
      .slice()
      .sort(compareDirectoryItems)
      .map(mapSearchResultToTreeOption)
    directoryTreeData.value = searchMatchedFiles
    expandedDirectoryKeys.value = []
    if (!searchMatchedFiles.some(item => String(item.key) === selectedDirectoryKeys.value[0])) {
      selectedDirectoryKeys.value = []
    }
  }
  finally {
    if (requestId === directorySearchRequestId) {
      directorySearchLoading.value = false
    }
  }
}

function scheduleDirectorySearch(keyword: string) {
  if (directorySearchTimer) {
    clearTimeout(directorySearchTimer)
  }
  directorySearchTimer = setTimeout(() => {
    void runDirectorySearch(keyword)
  }, 320)
}

function triggerDirectorySearchByEnter() {
  const keyword = directoryTreePattern.value.trim()
  if (!installRootPickerVisible.value || keyword.length < DIRECTORY_SEARCH_MIN_KEYWORD_LENGTH) {
    return
  }
  if (directorySearchTimer) {
    clearTimeout(directorySearchTimer)
    directorySearchTimer = undefined
  }
  void runDirectorySearch(keyword)
}

async function openInstallRootPicker() {
  installRootPickerVisible.value = true
  directoryTreePattern.value = ''
  selectedDirectoryKeys.value = steamcmdForm.steamcmdPath.trim()
    ? [steamcmdForm.steamcmdPath.trim()]
    : []
  directorySearchRequestId += 1
  await loadRootDirectoryTree()
}

function closeInstallRootPicker() {
  if (directorySearchTimer) {
    clearTimeout(directorySearchTimer)
    directorySearchTimer = undefined
  }
  directorySearchRequestId += 1
  directorySearchLoading.value = false
  installRootPickerVisible.value = false
}

async function handleDirectoryTreeLoad(option: TreeOption) {
  if (directoryTreePattern.value.trim()) {
    return
  }
  const treeOption = option as DirectoryTreeOption
  if (treeOption.entryType === 'file') {
    return
  }
  const parentPath = String(option.key ?? '')
  if (!parentPath) {
    return
  }
  const children = await loadDirectoryTree(parentPath)
  directoryTreeData.value = replaceTreeChildren(parentPath, children, directoryTreeData.value)
}

function handleDirectorySelectionChange(keys: Array<string | number>) {
  const selectedPath = keys[0] ? String(keys[0]) : ''
  if (!selectedPath) {
    selectedDirectoryKeys.value = []
    return
  }
  const selectedNode = findTreeNodeByKey(directoryTreeData.value, selectedPath)
  if (!selectedNode) {
    selectedDirectoryKeys.value = []
    return
  }
  selectedDirectoryKeys.value = [selectedPath]
}

function handleDirectoryExpandedKeysChange(keys: Array<string | number>) {
  expandedDirectoryKeys.value = keys.map(key => String(key))
}

function renderDirectoryTreeLabel({ option }: { option: TreeOption }) {
  const node = option as DirectoryTreeOption
  const label = typeof node.label === 'string' ? node.label : String(node.key ?? '')
  const executableName = node.entryName?.toLowerCase() ?? label.toLowerCase()
  const isSteamcmdExecutable = node.entryType === 'file' && executableName === 'steamcmd.exe'
  return h(
    'span',
    {
      class: isSteamcmdExecutable ? 'steamcmd-executable-label' : '',
    },
    label,
  )
}

function findTreeNodeByKey(nodes: DirectoryTreeOption[], key: string): DirectoryTreeOption | null {
  for (const node of nodes) {
    if (String(node.key) === key) {
      return node
    }
    if (node.children?.length) {
      const found = findTreeNodeByKey(node.children as DirectoryTreeOption[], key)
      if (found) {
        return found
      }
    }
  }
  return null
}

function applySelectedInstallRoot() {
  const selectedPath = selectedDirectoryKeys.value[0]
  if (!selectedPath) {
    faToast.warning('请先在目录树中选择路径')
    return
  }
  const selectedNode = findTreeNodeByKey(directoryTreeData.value, selectedPath)
  const selectedType = selectedNode?.entryType
  const isWindowsPath = /^[a-z]:\\/i.test(selectedPath)

  if (selectedType === 'directory') {
    const separator = isWindowsPath ? '\\' : '/'
    const executableName = isWindowsPath ? 'steamcmd.exe' : 'steamcmd'
    const normalizedPath = selectedPath.endsWith(separator)
      ? selectedPath
      : `${selectedPath}${separator}`
    steamcmdForm.steamcmdPath = `${normalizedPath}${executableName}`
    faToast.info('已自动补全 SteamCMD 可执行文件名')
    closeInstallRootPicker()
    return
  }
  steamcmdForm.steamcmdPath = selectedPath
  closeInstallRootPicker()
}

watch(directoryTreePattern, (value) => {
  if (!installRootPickerVisible.value) {
    return
  }
  const keyword = value.trim()
  if (!keyword) {
    if (directorySearchTimer) {
      clearTimeout(directorySearchTimer)
      directorySearchTimer = undefined
    }
    directorySearchRequestId += 1
    directorySearchLoading.value = false
    void loadRootDirectoryTree()
    return
  }
  if (keyword.length < DIRECTORY_SEARCH_MIN_KEYWORD_LENGTH) {
    directorySearchRequestId += 1
    directorySearchLoading.value = false
    return
  }
  scheduleDirectorySearch(keyword)
})

async function saveSteamcmdConfig() {
  steamcmdSaving.value = true
  try {
    await apiSystem.saveSteamcmdConfig({
      steamcmdPath: steamcmdForm.steamcmdPath.trim(),
      installRoot: steamcmdForm.installRoot.trim(),
    })
    steamcmdConfigured.value = true
    faToast.success('SteamCMD 配置已保存')
    await fetchSteamcmdConfig()
  }
  finally {
    steamcmdSaving.value = false
  }
}

async function installSteamcmd() {
  steamcmdInstalling.value = true
  try {
    const res = await apiSystem.installSteamcmd()
    faToast.success(res.data.message || 'SteamCMD 安装完成')
    await fetchSteamcmdConfig()
  }
  finally {
    steamcmdInstalling.value = false
  }
}

onMounted(() => {
  void fetchSteamcmdConfig()
})
</script>

<template>
  <FaPageMain title="SteamCMD">
    <div class="p-4 border border-border/70 rounded-lg bg-muted/20 space-y-3">
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <p class="text-xs text-muted-foreground">
          支持两种策略：安装脚本预装 SteamCMD，或面板内按需安装（当前仅 Linux 自动安装）
        </p>
        <span
          class="text-xs px-2 py-0.5 rounded-full"
          :class="steamcmdInstalled
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-slate-500/10 text-slate-600 dark:text-slate-300'"
        >
          {{ steamcmdInstalled ? '已检测到 SteamCMD' : '未检测到 SteamCMD' }}
        </span>
      </div>
      <div class="gap-3 grid">
        <NInputGroup>
          <NInput
            v-model:value="steamcmdForm.steamcmdPath"
            placeholder="SteamCMD 可执行文件路径（如 D:\Programs\games\steamcmd\steamcmd.exe）"
          />
          <NButton strong secondary @click="openInstallRootPicker">
            浏览目录树
          </NButton>
        </NInputGroup>
      </div>
      <div class="flex flex-wrap gap-2">
        <NButton
          type="primary"
          secondary
          :loading="steamcmdSaving"
          @click="saveSteamcmdConfig"
        >
          保存 SteamCMD 配置
        </NButton>
        <NButton
          :loading="steamcmdInstalling"
          @click="installSteamcmd"
        >
          自动安装 SteamCMD（Linux）
        </NButton>
      </div>
    </div>

    <NModal
      v-model:show="installRootPickerVisible"
      preset="card"
      title="选择 SteamCMD 安装路径"
      :style="{ width: '720px' }"
      @close="closeInstallRootPicker"
    >
      <div class="space-y-3">
        <div class="text-xs text-muted-foreground">
          支持远端异步过滤；输入关键词后会在服务端递归搜索，可选择目录或文件。
        </div>
        <NInput
          v-model:value="directoryTreePattern"
          clearable
          placeholder="输入关键词过滤（至少 2 个字符，如 steamcmd）"
          @keydown.enter.prevent="triggerDirectorySearchByEnter"
        />
        <NSpin :show="directoryTreeLoading || directorySearchLoading">
          <div class="directory-tree-shell">
            <NTree
              block-line
              selectable
              :data="directoryTreeData"
              :selected-keys="selectedDirectoryKeys"
              :expanded-keys="expandedDirectoryKeys"
              :on-load="handleDirectoryTreeLoad"
              :render-label="renderDirectoryTreeLabel"
              @update:selected-keys="handleDirectorySelectionChange"
              @update:expanded-keys="handleDirectoryExpandedKeysChange"
            />
          </div>
        </NSpin>
        <div class="text-xs text-muted-foreground">
          已选择：{{ selectedDirectoryKeys[0] || '未选择路径' }}
        </div>
      </div>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="closeInstallRootPicker">
            取消
          </NButton>
          <NButton type="primary" @click="applySelectedInstallRoot">
            使用该路径
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </FaPageMain>
</template>

<style scoped>
.directory-tree-shell {
  height: 15rem;
  padding: 0.5rem;
  overflow: auto;
  border: 1px solid hsl(var(--border) / 55%);
  border-radius: 0.5rem;
}

:deep(.steamcmd-executable-label) {
  font-weight: 600;
  color: rgb(16 185 129);
}
</style>
