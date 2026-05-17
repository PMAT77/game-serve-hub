/**
 * AppHello UnoCSS shortcuts（由 uno.config.ts 引入，构建期扫描）
 */
export const appHelloShortcuts: Array<[string, string]> = [
  ['app-hello-root', 'relative h-full w-full flex-center overflow-hidden bg-#030303'],
  ['app-hello-hero-bg', 'absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-rose-500/5 blur-3xl'],
  ['app-hello-shapes-layer', 'absolute inset-0 overflow-hidden pointer-events-none'],
  ['app-hello-content', 'relative z-10 px-6 py-8 md:px-10'],
  ['app-hello-content-compact', 'relative z-10 px-4 py-5'],
  ['app-hello-content-inner', 'max-w-3xl mx-auto text-center'],
  ['app-hello-badge', 'inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/3 border border-white/8 mb-6 md:mb-8'],
  ['app-hello-badge-compact', 'inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/3 border border-white/8 mb-4'],
  ['app-hello-title', 'text-4xl sm:text-5xl md:text-6xl font-bold mb-4 md:mb-6 tracking-tight'],
  ['app-hello-title-compact', 'text-3xl sm:text-4xl font-bold mb-3 md:mb-4 tracking-tight'],
  ['app-hello-title-primary', 'bg-clip-text text-transparent bg-gradient-to-b from-white to-white/80'],
  ['app-hello-title-accent', 'bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-white/90 to-rose-300'],
  ['app-hello-desc', 'text-sm sm:text-base md:text-lg text-white/40 leading-relaxed font-light tracking-wide max-w-xl mx-auto'],
  ['app-hello-desc-compact', 'text-sm sm:text-base text-white/40 leading-relaxed font-light tracking-wide max-w-lg mx-auto'],
  ['app-hello-vignette', 'absolute inset-0 bg-gradient-to-t from-#030303 via-transparent to-#030303/80 pointer-events-none'],
  ['app-hello-shape-root', 'absolute'],
  ['app-hello-shape-inner', 'relative'],
  ['app-hello-shape-surface', 'absolute inset-0 rounded-full backdrop-blur-2px border-2 border-white/15 shadow-[0_8px_32px_0_rgba(255,255,255,0.1)]'],
  ['app-hello-shape-glow', 'pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.2),transparent_70%)]'],
  ['app-hello-shape-pos-indigo', 'left--10% md:left--5% top-15% md:top-20%'],
  ['app-hello-shape-pos-rose', 'right--5% md:right-0% top-70% md:top-75%'],
  ['app-hello-shape-pos-violet', 'left-5% md:left-10% bottom-5% md:bottom-10%'],
  ['app-hello-shape-pos-amber', 'right-15% md:right-20% top-10% md:top-15%'],
  ['app-hello-shape-pos-cyan', 'left-20% md:left-25% top-5% md:top-10%'],
]
