import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import DiagnosticsView from './views/DiagnosticsView.vue'

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
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Nueva sesión' } },
    {
      path: '/diagnostico',
      name: 'diagnostics',
      component: DiagnosticsView,
      meta: { title: 'Diagnóstico' }
    },
    {
      path: '/uso',
      name: 'usage',
      // Diferida: la vista Uso no hace falta para arrancar.
      component: () => import('./views/UsageView.vue'),
      meta: { title: 'Uso' }
    },
    {
      path: '/terminal',
      name: 'terminal',
      // Diferida: xterm.js solo se carga si se abre la terminal.
      component: () => import('./views/TerminalView.vue'),
      meta: { title: 'Terminal' }
    },
    {
      path: '/ajustes',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
      meta: { title: 'Ajustes' }
    },
    {
      path: '/proyecto/:id/instrucciones',
      name: 'claude-md',
      component: () => import('./views/ClaudeMdView.vue'),
      meta: { title: 'Instrucciones del proyecto' }
    },
    {
      path: '/proyecto/:id/ajustes',
      name: 'project-settings',
      component: () => import('./views/ProjectSettingsView.vue'),
      meta: { title: 'Ajustes del proyecto' }
    },
    {
      path: '/sesion/:id',
      name: 'session',
      // Diferida: el visor (lista virtualizada, diff, herramientas…) no hace falta para arrancar.
      component: () => import('./views/SessionView.vue'),
      meta: { title: 'Sesión' }
    },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})
