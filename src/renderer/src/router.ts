import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import DiagnosticsView from './views/DiagnosticsView.vue'
import { t } from './i18n'

declare module 'vue-router' {
  interface RouteMeta {
    /** Título que muestra `MainHeader`. */
    title?: string
  }
}

// Historial con hash: la app se carga desde `file://` en producción.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: t('Nueva sesión') } },
    {
      path: '/diagnostico',
      name: 'diagnostics',
      component: DiagnosticsView,
      meta: { title: t('Diagnóstico') }
    },
    {
      path: '/uso',
      name: 'usage',
      // Diferida: la vista Uso no hace falta para arrancar.
      component: () => import('./views/UsageView.vue'),
      meta: { title: t('Uso') }
    },
    {
      path: '/terminal',
      name: 'terminal',
      // Diferida: xterm.js solo se carga si se abre la terminal.
      component: () => import('./views/TerminalView.vue'),
      meta: { title: t('Terminal') }
    },
    {
      path: '/ajustes',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
      meta: { title: t('Ajustes') }
    },
    {
      path: '/proyecto/:id/instrucciones',
      name: 'claude-md',
      component: () => import('./views/ClaudeMdView.vue'),
      meta: { title: t('Instrucciones del proyecto') }
    },
    {
      path: '/proyecto/:id/ajustes',
      name: 'project-settings',
      component: () => import('./views/ProjectSettingsView.vue'),
      meta: { title: t('Ajustes del proyecto') }
    },
    {
      path: '/sesion/:id',
      name: 'session',
      // Diferida: el visor (lista virtualizada, diff, herramientas…) no hace falta para arrancar.
      component: () => import('./views/SessionView.vue'),
      meta: { title: t('Sesión') }
    },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})
