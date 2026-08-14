<template>
  <div class="account-profile-page">
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * AccountProfileLayout
 *
 * A lightweight container for account/profile/settings/balance/ticket pages.
 * Replaces the `:global()` grid rules that used to live in HomeFrameLayout.vue
 * so pages can opt into a consistent, breathable layout without tight coupling.
 *
 * Usage:
 *   <AccountProfileLayout>
 *     <PageHeader ... />
 *     <section class="account-profile-page__section" ... />
 *     ...
 *   </AccountProfileLayout>
 */
</script>

<style scoped>
.account-profile-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
}

/* Page-level cards/sections flow as block boxes by default, occupying the full
   available width rather than being tiled into an auto-fit grid. Forms and
   tables need horizontal space. */
.account-profile-page :deep(.el-card),
.account-profile-page :deep(.page-card),
.account-profile-page :deep(.account-profile-page__section) {
  width: 100%;
  min-width: 0;
}

/* Utility: a row of summary cards that should flow responsively.
   Can be used anywhere inside the page, including nested wrappers. */
.account-profile-page :deep(.account-profile-page__flow) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  align-items: start;
  gap: 16px;
  width: 100%;
  min-width: 0;
}

/* Utility: a two-column workspace for notification/settings forms.
   Collapses to a single column on narrow viewports. */
.account-profile-page :deep(.account-profile-page__columns) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 16px;
  width: 100%;
  min-width: 0;
}

@media screen and (max-width: 900px) {
  .account-profile-page :deep(.account-profile-page__columns) {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media screen and (max-width: 768px) {
  .account-profile-page {
    gap: 12px;
  }

  .account-profile-page :deep(.account-profile-page__flow) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
