<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import * as z from 'zod'
import apiApp from '@/api/modules/app'
import { FormControl, FormField, FormItem, FormMessage } from '@/ui/shadcn/ui/form'

defineOptions({
  name: 'ResetPasswordForm',
})

const props = defineProps<{
  account?: string
}>()

const emits = defineEmits<{
  onLogin: [account?: string]
}>()

const loading = ref(false)
const statusLoading = ref(true)
const recoveryEnabled = ref(false)
const recoveryHint = ref<string | null>(null)

const form = useForm({
  validationSchema: toTypedSchema(z.object({
    account: z.string().min(1, '请输入用户名'),
    recoveryToken: z.string().optional(),
    newPassword: z.string().min(1, '请输入新密码').min(8, '密码至少 8 位').max(64, '密码最多 64 位'),
    confirmPassword: z.string().min(1, '请再次输入新密码'),
  }).superRefine((values, ctx) => {
    if (values.newPassword !== values.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: '两次输入的密码不一致',
      })
    }
    if (recoveryEnabled.value && !values.recoveryToken?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['recoveryToken'],
        message: '请输入找回口令',
      })
    }
  })),
  initialValues: {
    account: props.account ?? '',
    recoveryToken: '',
    newPassword: '',
    confirmPassword: '',
  },
})

async function loadRecoveryStatus() {
  statusLoading.value = true
  try {
    const res = await apiApp.passwordRecoveryStatus()
    recoveryEnabled.value = res.data.enabled
    recoveryHint.value = res.data.hint
  }
  catch {
    recoveryEnabled.value = false
    recoveryHint.value = null
  }
  finally {
    statusLoading.value = false
  }
}

const onSubmit = form.handleSubmit(async (values) => {
  loading.value = true
  try {
    if (recoveryEnabled.value) {
      await apiApp.passwordRecover({
        account: values.account,
        recoveryToken: values.recoveryToken?.trim() ?? '',
        newPassword: values.newPassword,
      })
      faToast.success('密码已重置，请使用新密码登录')
      emits('onLogin', values.account)
      return
    }
    faToast.warning('当前未启用在线找回，请按下方说明在服务器上重置')
  }
  finally {
    loading.value = false
  }
})

onMounted(() => {
  void loadRecoveryStatus()
})
</script>

<template>
  <div class="p-12 flex-col-stretch-center min-h-500px w-full">
    <form @submit="onSubmit">
      <div class="mb-8 space-y-2">
        <h3 class="text-4xl font-bold">
          找回密码
        </h3>
        <p v-if="statusLoading" class="text-sm text-muted-foreground lg:text-base">
          正在读取找回方式…
        </p>
        <p v-else-if="recoveryEnabled" class="text-sm text-muted-foreground lg:text-base">
          {{ recoveryHint || '请输入服务器上配置的找回口令，并设置新密码。' }}
        </p>
        <p v-else class="text-sm text-muted-foreground lg:text-base">
          面板未启用在线找回。请在服务器上执行下方命令重置管理员密码。
        </p>
      </div>

      <FormField v-slot="{ componentField, errors }" name="account">
        <FormItem class="pb-6 relative space-y-0">
          <FormControl>
            <FaInput type="text" placeholder="用户名" class="w-full" :class="{ 'border-destructive': errors.length }" v-bind="componentField">
              <template #start>
                <FaIcon name="i-lucide:user" />
              </template>
            </FaInput>
          </FormControl>
          <Transition enter-active-class="transition-opacity" enter-from-class="opacity-0" leave-active-class="transition-opacity" leave-to-class="opacity-0">
            <FormMessage class="text-xs bottom-1 absolute" />
          </Transition>
        </FormItem>
      </FormField>

      <FormField v-if="recoveryEnabled" v-slot="{ componentField, errors }" name="recoveryToken">
        <FormItem class="pb-6 relative space-y-0">
          <FormControl>
            <FaInput type="password" placeholder="找回口令（panel.env 中的 GSH_PASSWORD_RECOVERY_TOKEN）" class="w-full" :class="{ 'border-destructive': errors.length }" v-bind="componentField">
              <template #start>
                <FaIcon name="i-lucide:key-round" />
              </template>
            </FaInput>
          </FormControl>
          <Transition enter-active-class="transition-opacity" enter-from-class="opacity-0" leave-active-class="transition-opacity" leave-to-class="opacity-0">
            <FormMessage class="text-xs bottom-1 absolute" />
          </Transition>
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField, errors }" name="newPassword">
        <FormItem class="pb-6 relative space-y-0">
          <FormControl>
            <FaInput type="password" placeholder="新密码（8-64 位，含大小写、数字、特殊字符）" class="w-full" :class="{ 'border-destructive': errors.length }" v-bind="componentField">
              <template #start>
                <FaIcon name="i-lucide:lock" />
              </template>
            </FaInput>
          </FormControl>
          <Transition enter-active-class="transition-opacity" enter-from-class="opacity-0" leave-active-class="transition-opacity" leave-to-class="opacity-0">
            <FormMessage class="text-xs bottom-1 absolute" />
          </Transition>
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField, errors }" name="confirmPassword">
        <FormItem class="pb-6 relative space-y-0">
          <FormControl>
            <FaInput type="password" placeholder="确认新密码" class="w-full" :class="{ 'border-destructive': errors.length }" v-bind="componentField">
              <template #start>
                <FaIcon name="i-lucide:lock-keyhole" />
              </template>
            </FaInput>
          </FormControl>
          <Transition enter-active-class="transition-opacity" enter-from-class="opacity-0" leave-active-class="transition-opacity" leave-to-class="opacity-0">
            <FormMessage class="text-xs bottom-1 absolute" />
          </Transition>
        </FormItem>
      </FormField>

      <FaButton :loading="loading" size="lg" class="w-full" type="submit">
        {{ recoveryEnabled ? '重置密码' : '查看说明' }}
      </FaButton>

      <div v-if="!statusLoading && !recoveryEnabled" class="text-xs text-muted-foreground mt-4 space-y-2">
        <p class="font-medium text-foreground">
          服务器命令行重置（推荐）
        </p>
        <pre class="text-xs bg-muted overflow-x-auto p-3 rounded-md whitespace-pre-wrap">cd /opt/game-server-hub
docker compose --env-file panel.env exec panel \
  pnpm exec tsx server/scripts/reset-admin-password.ts \
  --account=superadmin --password='YourNewPass#123'</pre>
        <p>
          或在 <code class="text-xs">panel.env</code> 中设置 <code class="text-xs">ADMIN_PASSWORD</code> 与
          <code class="text-xs">GSH_SYNC_ADMIN_PASSWORD_FROM_ENV=1</code> 后重启面板（用完后请改回 0）。
        </p>
        <p>
          启用在线找回：在 <code class="text-xs">panel.env</code> 添加至少 16 位的
          <code class="text-xs">GSH_PASSWORD_RECOVERY_TOKEN</code> 并重启面板。
        </p>
      </div>

      <div class="text-sm mt-4 flex-center gap-2">
        <FaButton variant="link" class="p-0 h-auto" type="button" @click="emits('onLogin', form.values.account)">
          返回登录
        </FaButton>
      </div>
    </form>
  </div>
</template>
