<script setup lang="ts">
import type { DirectoryItem } from '@/api/modules/system'
import { NButton, NEmpty, NInput, NModal, NSpin } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import apiSystem from '@/api/modules/system'

defineOptions({
  name: 'DirectoryPathPicker',
})

const props = defineProps<{
  show: boolean
  title?: string
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  'select': [path: string]
}>()

const currentPath = ref('')
const pathInput = ref('')
const entries = ref<DirectoryItem[]>([])
const loading = ref(false)
const errorMessage = ref('')

const directories = computed(() => entries.value.filter(item => item.type === 'directory'))


function resolveParent(current: string): string {
  const normalized = current.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  if (index <= 0) {
    // Windows 盘符根或 Unix 根：保持在原位
    return /^[A-Za-z]:$/.test(normalized) ? `${normalized}\\` : (normalized.startsWith('/') ? '/' : normalized)
  }
  const parent = normalized.slice(0, index)
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : (parent || '/')
}

async function loadDirectory(targetPath?: string) {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await apiSystem.getDirectoryList(targetPath || undefined)
    entries.value = response.data ?? []
    currentPath.value = targetPath || (entries.value[0]?.path ? '' : '')
    if (!targetPath) {
      // 根视图：无单一当前路径，路径框留空
      currentPath.value = ''
    }
    pathInput.value = currentPath.value
  }
  catch {
    errorMessage.value = '目录读取失败，请检查路径权限'
  }
  finally {
    loading.value = false
  }
}

async function jumpTo(targetPath: string) {
  const trimmed = targetPath.trim()
  if (!trimmed) {
    await loadDirectory()
    return
  }
  await loadDirectory(trimmed)
}

function enter(item: DirectoryItem) {
  void jumpTo(item.path)
}

function goUp() {
  if (!currentPath.value) {
    return
  }
  void jumpTo(resolveParent(currentPath.value))
}

function confirmSelect() {
  const target = (pathInput.value || currentPath.value).trim()
  if (!target) {
    errorMessage.value = '请先浏览或输入目录路径'
    return
  }
  emit('select', target)
  emit('update:show', false)
}

watch(() => props.show, (visible) => {
  if (visible) {
    currentPath.value = ''
    pathInput.value = ''
    errorMessage.value = ''
    void loadDirectory()
  }
})
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="title ?? '选择目录'"
    style="width: min(640px, 92vw)"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div class="picker">
      <div class="picker-toolbar">
        <NInput
          v-model:value="pathInput"
          size="small"
          placeholder="输入绝对路径后回车，如 C:\Users\Administrator\Documents\Klei\DoNotStarveTogether"
          @keyup.enter="jumpTo(pathInput)"
        />
        <NButton size="small" @click="jumpTo(pathInput)">
          跳转
        </NButton>
        <NButton size="small" :disabled="!currentPath" @click="goUp">
          上一级
        </NButton>
      </div>

      <div v-if="currentPath" class="picker-breadcrumb">
        <span class="picker-crumb-label">当前：</span>
        <span class="picker-crumb-path">{{ currentPath }}</span>
      </div>

      <NSpin :show="loading">
        <div class="picker-list">
          <NEmpty v-if="!loading && directories.length === 0" description="没有子目录（可选择当前路径）" size="small" />
          <div
            v-for="item in directories"
            :key="item.path"
            class="picker-row"
            @click="enter(item)"
          >
            <span class="picker-row-icon">▸</span>
            <span class="picker-row-name">{{ item.name }}</span>
          </div>
        </div>
      </NSpin>

      <div v-if="errorMessage" class="picker-error">
        {{ errorMessage }}
      </div>
    </div>

    <template #footer>
      <div class="picker-footer">
        <NButton size="small" @click="emit('update:show', false)">
          取消
        </NButton>
        <NButton size="small" type="primary" @click="confirmSelect">
          选择此目录
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.picker-toolbar {
  display: flex;
  gap: 8px;
}

.picker-breadcrumb {
  font-size: 12px;
  color: #909090;
  word-break: break-all;
}

.picker-crumb-label {
  flex-shrink: 0;
}

.picker-list {
  display: flex;
  flex-direction: column;
  min-height: 160px;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--custom-border-color, #efeff5);
  border-radius: 6px;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.picker-row:hover {
  background: var(--custom-hover-color, #f5f5f8);
}

.picker-row-icon {
  color: #c2c2c7;
}

.picker-error {
  font-size: 12px;
  color: #d03050;
}

.picker-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
