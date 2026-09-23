<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthSession } from './auth/use-auth-session'
import DashboardView from './views/DashboardView.vue'
import ErrorView from './views/ErrorView.vue'
import LoadingView from './views/LoadingView.vue'
import LoginView from './views/LoginView.vue'
import SetupRequiredView from './views/SetupRequiredView.vue'

const { state, isLoggingOut, bootstrap, login, logout } = useAuthSession()

onMounted(bootstrap)
</script>

<template>
  <LoadingView v-if="state.kind === 'loading'" />
  <SetupRequiredView
    v-else-if="state.kind === 'configuration-missing'"
    :missing="state.missing"
  />
  <LoginView v-else-if="state.kind === 'anonymous'" @login="login" />
  <DashboardView
    v-else-if="state.kind === 'authenticated'"
    :user="state.user"
    :is-logging-out="isLoggingOut"
    @logout="logout"
  />
  <ErrorView v-else @retry="bootstrap" />
</template>
