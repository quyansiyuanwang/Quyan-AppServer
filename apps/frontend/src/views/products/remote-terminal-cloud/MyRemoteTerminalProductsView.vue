<template>
  <div class="page-wrap">
    <el-card class="page-card remote-terminal-product-card">
      <template #header>
        <MyRemoteTerminalProductsHeader />
      </template>

      <MyRemoteTerminalProductsTabs />
    </el-card>

    <MyRemoteTerminalDialogs />
  </div>
</template>

<script setup lang="ts">
import { provide } from 'vue'
import MyRemoteTerminalDialogs from './my-remote-terminal-products/components/MyRemoteTerminalDialogs.vue'
import MyRemoteTerminalProductsHeader from './my-remote-terminal-products/components/MyRemoteTerminalProductsHeader.vue'
import MyRemoteTerminalProductsTabs from './my-remote-terminal-products/components/MyRemoteTerminalProductsTabs.vue'
import { myRemoteTerminalProductsContextKey } from './my-remote-terminal-products/context'
import { useMyRemoteTerminalProducts } from './my-remote-terminal-products/useMyRemoteTerminalProducts'
import './my-remote-terminal-products/my-remote-terminal-products.scss'

const state = useMyRemoteTerminalProducts()

provide(myRemoteTerminalProductsContextKey, state)
</script>
