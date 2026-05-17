export type ShapeVariant = 'indigo' | 'rose' | 'violet' | 'amber' | 'cyan'

export interface AppHelloProps {
  badge?: string
  title?: string
  subtitle?: string
  description?: string
  /** 登录页居中布局等窄空间下使用较小字号 */
  compact?: boolean
}

export interface HeroShapeConfig {
  variant: ShapeVariant
  delay: number
  width: number
  height: number
  rotate: number
  positionClass: string
}

export const HERO_SHAPES: HeroShapeConfig[] = [
  { variant: 'indigo', delay: 0.3, width: 600, height: 140, rotate: 12, positionClass: 'app-hello-shape-pos-indigo' },
  { variant: 'rose', delay: 0.5, width: 500, height: 120, rotate: -15, positionClass: 'app-hello-shape-pos-rose' },
  { variant: 'violet', delay: 0.4, width: 300, height: 80, rotate: -8, positionClass: 'app-hello-shape-pos-violet' },
  { variant: 'amber', delay: 0.6, width: 200, height: 60, rotate: 20, positionClass: 'app-hello-shape-pos-amber' },
  { variant: 'cyan', delay: 0.7, width: 150, height: 40, rotate: -25, positionClass: 'app-hello-shape-pos-cyan' },
]

export const SHAPE_VARIANT_COLOR: Record<ShapeVariant, string> = {
  indigo: 'rgba(99, 102, 241, 0.15)',
  rose: 'rgba(244, 63, 94, 0.15)',
  violet: 'rgba(139, 92, 246, 0.15)',
  amber: 'rgba(245, 158, 11, 0.15)',
  cyan: 'rgba(6, 182, 212, 0.15)',
}
