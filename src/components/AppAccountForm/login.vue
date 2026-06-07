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
  onRegister: [account?: string]
  onResetPassword: [account?: string]
}>()

const appAccountStore = useAppAccountStore()
const SHOW_REGISTER_ENTRY = false
const SHOW_DEMO_ACCOUNT_ENTRY = false

const title = APP_TITLE
const loading = ref(false)
const captchaRequired = ref(false)
const challengeToken = ref('')
const challengeQuestion = ref('')

// 登录方式，default 账号密码登录，qrcode 扫码登录
const type = ref<'default' | 'qrcode'>('default')

function resolveLoginInitialValues() {
  if (import.meta.env.DEV) {
    return {
      account: String(import.meta.env.VITE_DEV_LOGIN_ACCOUNT ?? '').trim() || 'superadmin',
      password: String(import.meta.env.VITE_DEV_LOGIN_PASSWORD ?? '') || '123456',
      remember: false,
      challengeAnswer: '',
    }
  }
  const saved = readSavedLoginCredentials()
  return {
    account: props.account ?? saved.account,
    password: saved.password,
    remember: saved.remember,
    challengeAnswer: '',
  }
}

function restoreSavedCredentials() {
  if (import.meta.env.DEV) {
    return
  }
  const saved = readSavedLoginCredentials()
  form.resetForm({
    values: {
      ...form.values,
      account: props.account ?? saved.account,
      password: saved.password,
      remember: saved.remember,
    },
  })
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
      password: values.password,
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
    <div class="mb-4">
      <FaTabs
        v-model="type" :list="[
          { label: '账号密码登录', value: 'default' },
          { label: '扫码登录', value: 'qrcode' },
        ]" class="inline-flex"
      />
    </div>
    <div v-show="type === 'default'">
      <form @submit="onSubmit">
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
        <FormField v-slot="{ componentField, errors }" name="password">
          <FormItem class="pb-6 relative space-y-0">
            <FormControl>
              <FaInput type="password" placeholder="密码" class="w-full" :class="{ 'border-destructive': errors.length }" v-bind="componentField">
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
            <FormControl>
              <FaInput
                type="text"
                :placeholder="challengeQuestion || '请输入验证码'"
                class="w-full"
                :class="{ 'border-destructive': errors.length }"
                v-bind="componentField"
              >
                <template #start>
                  <FaIcon name="i-lucide:shield-check" />
                </template>
                <template #end>
                  <FaButton variant="link" class="h-auto p-0 text-xs" type="button" @click="refreshCaptchaChallenge">
                    刷新
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
                    @update:model-value="handleChange"
                  >
                    记住账号和密码
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
        <div v-if="SHOW_REGISTER_ENTRY" class="text-sm mt-4 flex-center gap-2">
          <span class="text-secondary-foreground op-50">还没有帐号?</span>
          <FaButton variant="link" class="p-0 h-auto" type="button" @click="emits('onRegister', form.values.account)">
            注册新帐号
          </FaButton>
        </div>
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
    <div v-show="type === 'qrcode'">
      <div class="flex-col-center">
        <img src="https://s2.loli.net/2024/04/26/GsahtuIZ9XOg5jr.png" class="h-[250px] w-[250px]">
        <div class="text-sm text-secondary-foreground mt-2 op-50">
          请使用微信扫码登录
        </div>
      </div>
    </div>
  </div>
</template>
