<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import * as z from 'zod'
import { APP_TITLE } from '@/utils/app-title'
import { readSavedLoginCredentials, saveLoginCredentials } from '@/utils/login-credentials'
import { FormControl, FormField, FormItem, FormMessage } from '@/ui/shadcn/ui/form'

defineOptions({
  name: 'LoginForm',
})

const props = defineProps<{
  account?: string
}>()

const emits = defineEmits<{
  onLogin: [account?: string]
  onResetPassword: [account?: string]
}>()

const appAccountStore = useAppAccountStore()
const SHOW_DEMO_ACCOUNT_ENTRY = false

const title = APP_TITLE
const loading = ref(false)
const captchaRequired = ref(false)
const challengeToken = ref('')
const challengeQuestion = ref('')

function resolveLoginInitialValues() {
  const saved = readSavedLoginCredentials()
  if (import.meta.env.DEV) {
    return {
      account: saved.account || String(import.meta.env.VITE_DEV_LOGIN_ACCOUNT ?? '').trim() || 'superadmin',
      password: String(import.meta.env.VITE_DEV_LOGIN_PASSWORD ?? '') || '123456',
      remember: saved.remember,
      challengeAnswer: '',
    }
  }
  return {
    account: props.account ?? saved.account,
    password: '',
    remember: saved.remember,
    challengeAnswer: '',
  }
}

function restoreSavedCredentials() {
  const saved = readSavedLoginCredentials()
  // 只恢复账号与记住状态，不触碰密码输入框（密码交给浏览器密码管理器）。
  const account = props.account ?? saved.account
  if (account) {
    form.setFieldValue('account', account)
  }
  form.setFieldValue('remember', saved.remember)
}

interface LoginErrorPayload {
  code?: string
  data?: Record<string, unknown>
}

function updateCaptchaState(data?: Record<string, unknown>) {
  captchaRequired.value = true
  challengeToken.value = String(data?.challengeToken ?? '')
  challengeQuestion.value = String(data?.challengeQuestion ?? '')
  form.setFieldValue('challengeAnswer', '')
}

async function refreshCaptchaChallenge() {
  const values = form.values
  if (!values.account?.trim() || !values.password?.trim()) {
    faToast.warning('请先输入账号和密码')
    return
  }
  loading.value = true
  try {
    await appAccountStore.login({
      account: values.account,
      password: values.password,
      remember: values.remember === true,
      challengeToken: challengeToken.value || undefined,
      challengeAnswer: '__refresh__',
    })
  }
  catch (error) {
    const payload = error as LoginErrorPayload
    if (payload.code === 'AUTH_CAPTCHA_REQUIRED') {
      updateCaptchaState(payload.data)
    }
  }
  finally {
    loading.value = false
  }
}

const form = useForm({
  validationSchema: toTypedSchema(z.object({
    account: z.string().min(1, '请输入用户名'),
    password: z.string().min(1, '请输入密码'),
    remember: z.boolean(),
    challengeAnswer: z.string().optional(),
  })),
  initialValues: resolveLoginInitialValues(),
})

onMounted(() => {
  restoreSavedCredentials()
})

onActivated(() => {
  restoreSavedCredentials()
})

const onSubmit = form.handleSubmit(async (values) => {
  if (captchaRequired.value && !values.challengeAnswer?.trim()) {
    form.setFieldError('challengeAnswer', '请输入验证码结果')
    return
  }
  loading.value = true
  try {
    await appAccountStore.login({
      ...values,
      remember: values.remember === true,
      challengeToken: challengeToken.value || undefined,
      challengeAnswer: values.challengeAnswer?.trim() || undefined,
    })
    saveLoginCredentials({
      account: values.account,
      remember: values.remember === true,
    })
    captchaRequired.value = false
    challengeToken.value = ''
    challengeQuestion.value = ''
    form.setFieldValue('challengeAnswer', '')
    emits('onLogin', values.account)
  }
  catch (error) {
    const payload = error as LoginErrorPayload
    if (payload.code === 'AUTH_CAPTCHA_REQUIRED') {
      updateCaptchaState(payload.data)
    }
  }
  finally {
    loading.value = false
  }
})

function testAccount(account: string) {
  form.setFieldValue('account', account)
  form.setFieldValue('password', '123456')
  onSubmit()
}
</script>

<template>
  <div class="p-12 flex-col-stretch-center min-h-500px w-full">
    <div class="mb-6 space-y-2">
      <h3 class="text-4xl font-bold">
        欢迎使用 👋🏻
      </h3>
      <p class="text-sm text-muted-foreground lg:text-base">
        {{ title }}
      </p>
    </div>
    <div>
      <form @submit="onSubmit">
        <FormField v-slot="{ componentField, errors }" name="account">
          <FormItem class="pb-6 relative space-y-0">
            <FormControl>
              <FaInput type="text" placeholder="用户名" autocomplete="username" class="w-full" :class="{ 'border-destructive': errors.length }" v-bind="componentField">
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
        <FormField v-slot="{ componentField, errors }" name="password">
          <FormItem class="pb-6 relative space-y-0">
            <FormControl>
              <FaInput type="password" placeholder="密码" autocomplete="current-password" class="w-full" :class="{ 'border-destructive': errors.length }" v-bind="componentField">
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
        <FormField v-if="captchaRequired" v-slot="{ componentField, errors }" name="challengeAnswer">
          <FormItem class="pb-6 relative space-y-0">
            <p class="mb-2 flex items-center gap-2 text-sm text-foreground">
              <FaIcon name="i-lucide:shield-check" class="size-4 text-primary" />
              <span class="font-medium">验证问题：</span>
              <span>{{ challengeQuestion || '请输入验证码' }}</span>
            </p>
            <FormControl>
              <FaInput
                type="text"
                placeholder="请输入计算结果"
                class="w-full"
                :class="{ 'border-destructive': errors.length }"
                v-bind="componentField"
              >
                <template #end>
                  <FaButton variant="link" class="h-auto p-0 text-xs" type="button" @click="refreshCaptchaChallenge">
                    换一题
                  </FaButton>
                </template>
              </FaInput>
            </FormControl>
            <Transition enter-active-class="transition-opacity" enter-from-class="opacity-0" leave-active-class="transition-opacity" leave-to-class="opacity-0">
              <FormMessage class="text-xs bottom-1 absolute" />
            </Transition>
          </FormItem>
        </FormField>
        <div class="mb-4 flex-center-between">
          <div class="flex-center-start">
            <FormField
              v-slot="{ value, handleChange }"
              name="remember"
              type="checkbox"
              :value="true"
              :unchecked-value="false"
            >
              <FormItem>
                <FormControl>
                  <FaCheckbox
                    :model-value="value === true"
                    title="密码由浏览器密码管理器保存，不会写入本地存储"
                    @update:model-value="handleChange"
                  >
                    记住账号
                  </FaCheckbox>
                </FormControl>
              </FormItem>
            </FormField>
          </div>
          <FaButton variant="link" class="p-0 h-auto" type="button" @click="emits('onResetPassword', form.values.account)">
            忘记密码?
          </FaButton>
        </div>
        <FaButton :loading="loading" size="lg" class="w-full" type="submit">
          登录
        </FaButton>
      </form>
      <div v-if="SHOW_DEMO_ACCOUNT_ENTRY" class="mt-4 text-center -mb-4">
        <FaDivider>演示账号一键登录</FaDivider>
        <div class="space-x-2">
          <FaButton variant="default" size="sm" plain @click="testAccount('superadmin')">
            superadmin
          </FaButton>
          <FaButton variant="outline" size="sm" plain @click="testAccount('test')">
            test
          </FaButton>
        </div>
      </div>
    </div>
  </div>
</template>
