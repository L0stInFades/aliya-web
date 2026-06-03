import Framework7 from 'framework7/lite-bundle'
import Framework7Vue, { registerComponents } from 'framework7-vue/bundle'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import 'framework7/css/bundle'
import 'framework7-icons/css/framework7-icons.css'
import App from './App.vue'
import './styles/main.css'

const app = createApp(App)
const pinia = createPinia()

Framework7.use(Framework7Vue)

registerComponents(app)
app.use(pinia)
app.use(Framework7Vue, { theme: 'ios' })
app.mount('#app')
