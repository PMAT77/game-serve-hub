<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import * as z from 'zod'
import { FormControl, FormField, FormItem, FormMessage } from '@/ui/shadcn/ui/form'

defineOptions({
  name: 'EditPasswordForm',
})

const props = defineProps<{
  forceMode?: boolean
}>()

const emits = defineEmits<{
  onSuccess: []
}>()

const appAccountStore = useAppAccountStore()

const loading = ref(false)

const form = useForm({
  validationSchema: toTypedSchema(
    z.object({
      password: z.string().min(1, '请输入原密码'),
      newPassword: z.string().min(1, '请输入新密码').min(8, '密码长度为 8 到 64 位').max(64, '密码长度为 8 到 64 位').regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/, '需包含大小写字母、数字和特殊字符'),
      checkPassword: z.string().min(1, '请确认新密码'),
    }).refine(data => data.newPassword === data.checkPassword, {
      message: '两次输入的密码不一致',
      path: ['checkPassword'],
    }),
  ),
  initialValues: {
    password: '',
    newPassword: '',
    checkPassword: '',
  },
})
const onSubmit = form.handleSubmit((values) => {
  loading.value = true
  appAccountStore.editPassword(values).then(async () => {
    if (props.forceMode) {
      faToast.success('密码已更新，正在进入面板')
      emits('onSuccess')
      return
    }
    faToast.success('修改成功，请重新登录')
    appAccountStore.logout()
  }).finally(() => {
    loading.value = false
  })
})
</script>

<template>
  <div class="flex-col-stretch-center w-full">
    <div class="mb-6 space-y-2">
      <h3 class="text-4xl font-bold">
        {{ props.forceMode ? '设置新密码' : '修改密码' }}
      </h3>
      <p class="text-sm text-muted-foreground lg:text-base">
        {{ props.forceMode
          ? '请使用安装时提供的初始密码作为「原密码」，并设置新的登录密码（需包含大小写字母、数字和特殊字符）'
          : '请输入原密码、新密码和确认密码（新密码需包含大小写字母、数字和特殊字符）' }}
      </p>
    </div>
    <form @submit="onSubmit">
      <FormField v-slot="{ componentField, errors }" name="password">
        <FormItem class="pb-6 relative space-y-0">
          <FormControl>
            <FaInput type="password" placeholder="原密码" class="w-full" :class="{ 'border-destructive': errors.length }" v-bind="componentField">
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
      <FormField v-slot="{ componentField, errors }" name="newPassword">
        <FormItem class="pb-6 relative space-y-0">
          <FormControl>
            <FaInput type="password" placeholder="新密码" class="w-full" :class="{ 'border-destructive': errors.length }" v-bind="componentField">
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
      <FormField v-slot="{ componentField, errors }" name="checkPassword">
        <FormItem class="pb-6 relative space-y-0">
          <FormControl>
            <FaInput type="password" placeholder="确认密码" class="w-full" :class="{ 'border-destructive': errors.length }" v-bind="componentField">
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
      <FaButton :loading="loading" size="lg" class="mt-8 w-full" type="submit">
        保存
      </FaButton>
    </form>
  </div>
</template>
