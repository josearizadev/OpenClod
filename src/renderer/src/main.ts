import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles/base.css'

import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { useUiStore } from './stores/ui'

const pinia = createPinia()
// Crear el store antes de montar aplica `.dark` desde el primer pintado.
void useUiStore(pinia).loadSettings()

createApp(App).use(pinia).use(router).mount('#app')
