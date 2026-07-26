import { z } from 'zod'

const accountSchema = z.string().trim().min(1).max(128)
const secretSchema = z.string().min(1).max(256)
const tokenSchema = z.string().trim().min(1).max(4096)

export const loginBodySchema = z.object({
  account: accountSchema,
  password: secretSchema,
  remember: z.boolean().optional(),
  challengeToken: z.string().trim().min(1).max(256).optional(),
  challengeAnswer: z.string().trim().min(1).max(256).optional(),
})
export type LoginBody = z.infer<typeof loginBodySchema>

export const logoutBodySchema = z.object({
  refreshToken: z.string().trim().max(4096).optional(),
})
export type LogoutBody = z.infer<typeof logoutBodySchema>

export const refreshTokenBodySchema = z.object({
  refreshToken: tokenSchema,
})
export type RefreshTokenBody = z.infer<typeof refreshTokenBodySchema>

export const passwordEditBodySchema = z.object({
  password: secretSchema,
  newPassword: secretSchema,
})
export type PasswordEditBody = z.infer<typeof passwordEditBodySchema>

export const passwordRecoverBodySchema = z.object({
  account: accountSchema,
  recoveryToken: tokenSchema,
  newPassword: secretSchema,
})
export type PasswordRecoverBody = z.infer<typeof passwordRecoverBodySchema>

const authSessionSchema = z.object({
  account: z.string(),
  token: z.string(),
  refreshToken: z.string(),
  avatar: z.string(),
  email: z.string(),
  accessExpiresInSec: z.number().int().positive(),
  refreshExpiresInSec: z.number().int().positive(),
})

export const loginResponseSchema = authSessionSchema.extend({
  remember: z.boolean(),
  mustChangePassword: z.boolean(),
})
export type LoginResponse = z.infer<typeof loginResponseSchema>

export const refreshTokenResponseSchema = authSessionSchema.extend({
  mustChangePassword: z.boolean(),
})
export type RefreshTokenResponse = z.infer<typeof refreshTokenResponseSchema>

export const permissionResponseSchema = z.object({
  permissions: z.array(z.string()),
  mustChangePassword: z.boolean(),
})
export type PermissionResponse = z.infer<typeof permissionResponseSchema>

export const passwordEditResponseSchema = z.object({
  isSuccess: z.literal(true),
  mustChangePassword: z.literal(false),
})
export type PasswordEditResponse = z.infer<typeof passwordEditResponseSchema>

export const passwordRecoveryStatusResponseSchema = z.object({
  enabled: z.boolean(),
  hint: z.string().nullable(),
})
export type PasswordRecoveryStatusResponse = z.infer<typeof passwordRecoveryStatusResponseSchema>

export const successResponseSchema = z.object({
  isSuccess: z.literal(true),
})
export type SuccessResponse = z.infer<typeof successResponseSchema>
