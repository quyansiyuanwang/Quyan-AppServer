<template>
  <!-- Home -->
  <el-menu-item
    v-if="isRouteVisible('home')"
    index="home"
    @click="nav('home', $event)"
    @contextmenu.prevent="openRouteMenu('home', $event)"
  >
    <el-icon><HomeFilled /></el-icon>
    <template #title>{{ i18ns.t('nav.home') }}</template>
  </el-menu-item>

  <template v-if="showPinnedSection && hasPinnedSlot">
    <li v-if="hasHomeNavigation" class="menu-divider" />
    <!-- Pinned -->
    <slot name="pinned" />
    <li v-if="hasNavigationAfterPinned" class="menu-divider" />
  </template>

  <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
    <el-menu-item
      v-if="isRouteVisible('balanceHistory')"
      index="balanceHistory"
      @click="nav('balanceHistory', $event)"
      @contextmenu.prevent="openRouteMenu('balanceHistory', $event)"
    >
      <el-icon><Wallet /></el-icon>
      <template #title>{{ i18ns.t('relay.accountBalance') }}</template>
    </el-menu-item>
    <el-menu-item
      v-if="isRouteVisible('consumptionRecords')"
      index="consumptionRecords"
      @click="nav('consumptionRecords', $event)"
      @contextmenu.prevent="openRouteMenu('consumptionRecords', $event)"
    >
      <el-icon><TrendCharts /></el-icon>
      <template #title>{{ i18ns.t('nav.consumptionRecords') }}</template>
    </el-menu-item>
  </PermissionWrapper>
  <PermissionWrapper
    :any-require="[
      Permission.TICKET_SUBMIT,
      Permission.TICKET_SELF_READ,
      Permission.TICKET_SELF_UPDATE,
      Permission.TICKET_COMMENT,
    ]"
  >
    <el-menu-item
      v-if="isRouteVisible('myTickets')"
      index="myTickets"
      @click="nav('myTickets', $event)"
      @contextmenu.prevent="openRouteMenu('myTickets', $event)"
    >
      <el-icon><ChatDotRound /></el-icon>
      <template #title>{{ i18ns.t('nav.myTickets') }}</template>
    </el-menu-item>
  </PermissionWrapper>

  <!-- Settings -->
  <el-sub-menu
    v-if="
      hasAnyVisibleRoutes(
        'settingsProfile',
        'settingsSecurity',
        'notificationSettings',
        'settingsPreferences',
      )
    "
    index="settings"
  >
    <template #title>
      <el-icon><Setting /></el-icon>
      <span>{{ i18ns.t('nav.settings') }}</span>
    </template>
    <el-menu-item
      v-if="isRouteVisible('settingsProfile')"
      index="settingsProfile"
      @click="nav('settingsProfile', $event)"
      @contextmenu.prevent="openRouteMenu('settingsProfile', $event)"
    >
      <el-icon><User /></el-icon>
      <template #title>{{ i18ns.t('nav.settingsProfile') }}</template>
    </el-menu-item>
    <el-menu-item
      v-if="isRouteVisible('settingsSecurity')"
      index="settingsSecurity"
      @click="nav('settingsSecurity', $event)"
      @contextmenu.prevent="openRouteMenu('settingsSecurity', $event)"
    >
      <el-icon><Lock /></el-icon>
      <template #title>{{ i18ns.t('nav.settingsSecurity') }}</template>
    </el-menu-item>
    <el-menu-item
      v-if="isRouteVisible('notificationSettings')"
      index="notificationSettings"
      @click="nav('notificationSettings', $event)"
      @contextmenu.prevent="openRouteMenu('notificationSettings', $event)"
    >
      <el-icon><Bell /></el-icon>
      <template #title>{{ i18ns.t('nav.notificationSettings') }}</template>
    </el-menu-item>
    <el-menu-item
      v-if="isRouteVisible('settingsPreferences')"
      index="settingsPreferences"
      @click="nav('settingsPreferences', $event)"
      @contextmenu.prevent="openRouteMenu('settingsPreferences', $event)"
    >
      <el-icon><Tools /></el-icon>
      <template #title>{{ i18ns.t('nav.preferences') }}</template>
    </el-menu-item>
  </el-sub-menu>

  <el-sub-menu
    v-if="hasAnyVisibleRoutes('myMonthlyPasses', 'myRemoteTerminalProducts')"
    index="productSubscriptions"
  >
    <template #title>
      <el-icon><Box /></el-icon>
      <span>{{ i18ns.t('nav.productSubscriptions') }}</span>
    </template>
    <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
      <el-menu-item
        v-if="isRouteVisible('myMonthlyPasses')"
        index="myMonthlyPasses"
        @click="nav('myMonthlyPasses', $event)"
        @contextmenu.prevent="openRouteMenu('myMonthlyPasses', $event)"
      >
        <el-icon><CreditCard /></el-icon>
        <template #title>{{ i18ns.t('nav.myMonthlyPasses') }}</template>
      </el-menu-item>
    </PermissionWrapper>
    <el-menu-item
      v-if="isRouteVisible('myRemoteTerminalProducts')"
      index="myRemoteTerminalProducts"
      @click="nav('myRemoteTerminalProducts', $event)"
      @contextmenu.prevent="openRouteMenu('myRemoteTerminalProducts', $event)"
    >
      <el-icon><Monitor /></el-icon>
      <template #title>{{ i18ns.t('nav.myRemoteTerminalProducts') }}</template>
    </el-menu-item>
  </el-sub-menu>

  <!-- AI & Tools -->
  <PermissionWrapper :any-require="[Permission.RELAY_TOKEN_READ, Permission.SCRIPT_READ]">
    <el-sub-menu v-if="hasAnyVisibleRoutes('chat', 'scriptManager')" index="myTools">
      <template #title>
        <el-icon><Connection /></el-icon>
        <span>{{ i18ns.t('nav.myTools') }}</span>
      </template>
      <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
        <el-menu-item
          v-if="isRouteVisible('chat')"
          index="chat"
          @click="nav('chat', $event)"
          @contextmenu.prevent="openRouteMenu('chat', $event)"
        >
          <el-icon><ChatDotRound /></el-icon>
          <template #title>{{ i18ns.t('nav.chat') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper :require="[Permission.SCRIPT_READ]">
        <el-menu-item
          v-if="isRouteVisible('scriptManager')"
          index="scriptManager"
          @click="nav('scriptManager', $event)"
          @contextmenu.prevent="openRouteMenu('scriptManager', $event)"
        >
          <el-icon><Cpu /></el-icon>
          <template #title>{{ i18ns.t('nav.scriptManager') }}</template>
        </el-menu-item>
      </PermissionWrapper>
    </el-sub-menu>
  </PermissionWrapper>

  <li v-if="hasPrimaryNavigation && hasSecondaryNavigation" class="menu-divider" />

  <!-- Developer & Integrations -->
  <PermissionWrapper
    :any-require="[
      Permission.RELAY_TOKEN_READ,
      Permission.OAUTH_CLIENT_READ,
      Permission.AUTH_CENTER_CLIENT_READ,
    ]"
  >
    <el-sub-menu
      v-if="hasAnyVisibleRoutes('oauthClientManagement', 'authCenterClientManagement')"
      index="developerCenter"
    >
      <template #title>
        <el-icon><Key /></el-icon>
        <span>{{ i18ns.t('nav.developerCenter') }}</span>
      </template>
      <PermissionWrapper :require="[Permission.OAUTH_CLIENT_READ]">
        <el-menu-item
          v-if="isRouteVisible('oauthClientManagement')"
          index="oauthClientManagement"
          @click="nav('oauthClientManagement', $event)"
          @contextmenu.prevent="openRouteMenu('oauthClientManagement', $event)"
        >
          <el-icon><Link /></el-icon>
          <template #title>{{ i18ns.t('nav.oauthClientManagement') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper :require="[Permission.AUTH_CENTER_CLIENT_READ]">
        <el-menu-item
          v-if="isRouteVisible('authCenterClientManagement')"
          index="authCenterClientManagement"
          @click="nav('authCenterClientManagement', $event)"
          @contextmenu.prevent="openRouteMenu('authCenterClientManagement', $event)"
        >
          <el-icon><Key /></el-icon>
          <template #title>{{ i18ns.t('nav.authCenterClientManagement') }}</template>
        </el-menu-item>
      </PermissionWrapper>
    </el-sub-menu>
  </PermissionWrapper>

  <!-- App Review -->
  <PermissionWrapper
    :any-require="[
      Permission.OAUTH_CLIENT_REVIEW_READ,
      Permission.AUTH_CENTER_CLIENT_REVIEW_READ,
      Permission.TICKET_REVIEW_READ,
    ]"
  >
    <el-sub-menu
      v-if="
        hasAnyVisibleRoutes(
          'oauthClientReviewManagement',
          'authCenterClientReviewManagement',
          'ticketReviewManagement',
        )
      "
      index="openPlatform"
    >
      <template #title>
        <el-icon><Link /></el-icon>
        <span>{{ i18ns.t('nav.openPlatform') }}</span>
      </template>
      <PermissionWrapper :require="[Permission.OAUTH_CLIENT_REVIEW_READ]">
        <el-menu-item
          v-if="isRouteVisible('oauthClientReviewManagement')"
          index="oauthClientReviewManagement"
          @click="nav('oauthClientReviewManagement', $event)"
          @contextmenu.prevent="openRouteMenu('oauthClientReviewManagement', $event)"
        >
          <el-icon><Document /></el-icon>
          <template #title>{{ i18ns.t('nav.oauthClientReviewManagement') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper :require="[Permission.AUTH_CENTER_CLIENT_REVIEW_READ]">
        <el-menu-item
          v-if="isRouteVisible('authCenterClientReviewManagement')"
          index="authCenterClientReviewManagement"
          @click="nav('authCenterClientReviewManagement', $event)"
          @contextmenu.prevent="openRouteMenu('authCenterClientReviewManagement', $event)"
        >
          <el-icon><Document /></el-icon>
          <template #title>{{ i18ns.t('nav.authCenterClientReviewManagement') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper :require="[Permission.TICKET_REVIEW_READ]">
        <el-menu-item
          v-if="isRouteVisible('ticketReviewManagement')"
          index="ticketReviewManagement"
          @click="nav('ticketReviewManagement', $event)"
          @contextmenu.prevent="openRouteMenu('ticketReviewManagement', $event)"
        >
          <el-icon><ChatDotRound /></el-icon>
          <template #title>{{ i18ns.t('nav.ticketReviewManagement') }}</template>
        </el-menu-item>
      </PermissionWrapper>
    </el-sub-menu>
  </PermissionWrapper>

  <!-- Billing & Subscriptions -->
  <PermissionWrapper
    :any-require="[
      Permission.BALANCE_READ,
      Permission.REDEMPTION_CODE_READ,
      Permission.MONTHLY_PASS_TEMPLATE_READ,
      Permission.MONTHLY_PASS_ASSIGNMENT_READ,
      Permission.MONTHLY_PASS_USAGE_READ,
    ]"
  >
    <el-sub-menu
      v-if="hasAnyVisibleRoutes('balanceManagement', 'monthlyPassManagement', 'redemptionCodes')"
      index="financial"
    >
      <template #title>
        <el-icon><Wallet /></el-icon>
        <span>{{ i18ns.t('nav.financial') }}</span>
      </template>
      <PermissionWrapper :require="[Permission.BALANCE_READ]">
        <el-menu-item
          v-if="isRouteVisible('balanceManagement')"
          index="balanceManagement"
          @click="nav('balanceManagement', $event)"
          @contextmenu.prevent="openRouteMenu('balanceManagement', $event)"
        >
          <el-icon><CreditCard /></el-icon>
          <template #title>{{ i18ns.t('nav.balanceManagement') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper
        :any-require="[
          Permission.MONTHLY_PASS_TEMPLATE_READ,
          Permission.MONTHLY_PASS_ASSIGNMENT_READ,
          Permission.MONTHLY_PASS_USAGE_READ,
        ]"
      >
        <el-menu-item
          v-if="isRouteVisible('monthlyPassManagement')"
          index="monthlyPassManagement"
          @click="nav('monthlyPassManagement', $event)"
          @contextmenu.prevent="openRouteMenu('monthlyPassManagement', $event)"
        >
          <el-icon><CreditCard /></el-icon>
          <template #title>{{ i18ns.t('nav.monthlyPassManagement') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper :require="[Permission.REDEMPTION_CODE_READ]">
        <el-menu-item
          v-if="isRouteVisible('redemptionCodes')"
          index="redemptionCodes"
          @click="nav('redemptionCodes', $event)"
          @contextmenu.prevent="openRouteMenu('redemptionCodes', $event)"
        >
          <el-icon><Postcard /></el-icon>
          <template #title>{{ i18ns.t('nav.redemptionCodes') }}</template>
        </el-menu-item>
      </PermissionWrapper>
    </el-sub-menu>
  </PermissionWrapper>

  <!-- Products -->
  <PermissionWrapper :any-require="productsMenuPermissions">
    <el-sub-menu
      v-if="
        hasAnyVisibleRoutes(
          'remoteTerminal',
          'remoteTerminalProductManagement',
          'relayTokenManagement',
          'apiDocumentation',
          'relayChannelProvider',
          'relayChannelReview',
          'relaySettings',
          'relayChannelHealth',
          'relayRequestDiagnostics',
          'relayChannelProbes',
          'upstreamStatus',
          'developerProducts',
          'ojAPIKeyManagement',
          'ojUsageStatistics',
          'ojPricingManagement',
          'jsonEndpointManagement',
          'articleManagement',
          'legalPolicyManagement',
          'analyticsOverview',
          'analyticsFunnel',
          'analyticsHeatmap',
        )
      "
      index="products"
    >
      <template #title>
        <el-icon><Cpu /></el-icon>
        <span>{{ i18ns.t('nav.products') }}</span>
      </template>
      <PermissionWrapper
        :any-require="[
          Permission.REMOTE_TERMINAL_DEVICE_READ,
          Permission.REMOTE_TERMINAL_PRODUCT_READ,
          Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
          Permission.REMOTE_TERMINAL_SESSION_READ,
          Permission.REMOTE_TERMINAL_SESSION_CREATE,
        ]"
      >
        <el-sub-menu
          v-if="hasAnyVisibleRoutes('remoteTerminal', 'remoteTerminalProductManagement')"
          index="remoteTerminalProducts"
        >
          <template #title>
            <el-icon><Monitor /></el-icon>
            <span>{{ i18ns.t('nav.remoteTerminal') }}</span>
          </template>
          <PermissionWrapper
            :any-require="[
              Permission.REMOTE_TERMINAL_DEVICE_READ,
              Permission.REMOTE_TERMINAL_SESSION_READ,
              Permission.REMOTE_TERMINAL_SESSION_CREATE,
            ]"
          >
            <el-menu-item
              v-if="isRouteVisible('remoteTerminal')"
              index="remoteTerminal"
              @click="nav('remoteTerminal', $event)"
              @contextmenu.prevent="openRouteMenu('remoteTerminal', $event)"
            >
              <el-icon><Monitor /></el-icon>
              <template #title>{{ i18ns.t('nav.remoteTerminal') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper
            :any-require="[
              Permission.REMOTE_TERMINAL_PRODUCT_READ,
              Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
              Permission.REMOTE_TERMINAL_DEVICE_MANAGE_READ,
            ]"
          >
            <el-menu-item
              v-if="isRouteVisible('remoteTerminalProductManagement')"
              index="remoteTerminalProductManagement"
              @click="nav('remoteTerminalProductManagement', $event)"
              @contextmenu.prevent="openRouteMenu('remoteTerminalProductManagement', $event)"
            >
              <el-icon><Setting /></el-icon>
              <template #title>{{ i18ns.t('nav.remoteTerminalProductManagement') }}</template>
            </el-menu-item>
          </PermissionWrapper>
        </el-sub-menu>
      </PermissionWrapper>
      <PermissionWrapper
        :any-require="[
          Permission.MODEL_PRICING_UPDATE,
          Permission.UPSTREAM_STATUS_READ,
          Permission.RELAY_TOKEN_READ,
          Permission.RELAY_CHANNEL_READ,
          Permission.RELAY_CHANNEL_SUBMIT,
          Permission.RELAY_CHANNEL_PROVIDER_READ,
          Permission.RELAY_CHANNEL_REVIEW,
          Permission.RELAY_CHANNEL_HEALTH_READ,
          Permission.RELAY_REQUEST_DIAGNOSTICS_READ,
        ]"
      >
        <el-sub-menu
          v-if="
            hasAnyVisibleRoutes(
              'relayTokenManagement',
              'apiDocumentation',
              'relayChannelProvider',
              'relayChannelReview',
              'relaySettings',
              'relayChannelHealth',
              'relayRequestDiagnostics',
              'relayChannelProbes',
              'upstreamStatus',
            )
          "
          index="relay"
        >
          <template #title>
            <el-icon><Connection /></el-icon>
            <span>{{ i18ns.t('nav.relay') }}</span>
          </template>
          <PermissionWrapper :require="[Permission.RELAY_TOKEN_READ]">
            <el-menu-item
              v-if="isRouteVisible('relayTokenManagement')"
              index="relayTokenManagement"
              @click="nav('relayTokenManagement', $event)"
              @contextmenu.prevent="openRouteMenu('relayTokenManagement', $event)"
            >
              <el-icon><Key /></el-icon>
              <template #title>{{ i18ns.t('nav.myTokens') }}</template>
            </el-menu-item>
            <el-menu-item
              v-if="isRouteVisible('apiDocumentation')"
              index="apiDocumentation"
              @click="nav('apiDocumentation', $event)"
              @contextmenu.prevent="openRouteMenu('apiDocumentation', $event)"
            >
              <el-icon><Document /></el-icon>
              <template #title>{{ i18ns.t('nav.apiDocumentation') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper
            :any-require="[Permission.RELAY_CHANNEL_SUBMIT, Permission.RELAY_CHANNEL_PROVIDER_READ]"
          >
            <el-menu-item
              v-if="isRouteVisible('relayChannelProvider')"
              index="relayChannelProvider"
              @click="nav('relayChannelProvider', $event)"
              @contextmenu.prevent="openRouteMenu('relayChannelProvider', $event)"
            >
              <el-icon><Wallet /></el-icon>
              <template #title>{{ i18ns.t('nav.relayChannelProvider') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.RELAY_CHANNEL_REVIEW]">
            <el-menu-item
              v-if="isRouteVisible('relayChannelReview')"
              index="relayChannelReview"
              @click="nav('relayChannelReview', $event)"
              @contextmenu.prevent="openRouteMenu('relayChannelReview', $event)"
            >
              <el-icon><Document /></el-icon>
              <template #title>{{ i18ns.t('nav.relayChannelReview') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.MODEL_PRICING_UPDATE]">
            <el-menu-item
              v-if="isRouteVisible('relaySettings')"
              index="relaySettings"
              @click="nav('relaySettings', $event)"
              @contextmenu.prevent="openRouteMenu('relaySettings', $event)"
            >
              <el-icon><Tools /></el-icon>
              <template #title>{{ i18ns.t('nav.relaySettings') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.RELAY_CHANNEL_HEALTH_READ]">
            <el-menu-item
              v-if="isRouteVisible('relayChannelHealth')"
              index="relayChannelHealth"
              @click="nav('relayChannelHealth', $event)"
              @contextmenu.prevent="openRouteMenu('relayChannelHealth', $event)"
            >
              <el-icon><Monitor /></el-icon>
              <template #title>{{ i18ns.t('nav.relayChannelHealth') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.RELAY_REQUEST_DIAGNOSTICS_READ]">
            <el-menu-item
              v-if="isRouteVisible('relayRequestDiagnostics')"
              index="relayRequestDiagnostics"
              @click="nav('relayRequestDiagnostics', $event)"
              @contextmenu.prevent="openRouteMenu('relayRequestDiagnostics', $event)"
            >
              <el-icon><Monitor /></el-icon>
              <template #title>{{ i18ns.t('nav.relayRequestDiagnostics') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.RELAY_CHANNEL_PROBE_READ]">
            <el-menu-item
              v-if="isRouteVisible('relayChannelProbes')"
              index="relayChannelProbes"
              @click="nav('relayChannelProbes', $event)"
              @contextmenu.prevent="openRouteMenu('relayChannelProbes', $event)"
            >
              <el-icon><Monitor /></el-icon>
              <template #title>{{ i18ns.t('nav.relayChannelProbes') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.UPSTREAM_STATUS_READ]">
            <el-menu-item
              v-if="isRouteVisible('upstreamStatus')"
              index="upstreamStatus"
              @click="nav('upstreamStatus', $event)"
              @contextmenu.prevent="openRouteMenu('upstreamStatus', $event)"
            >
              <el-icon><Connection /></el-icon>
              <template #title>{{ i18ns.t('nav.upstreamStatus') }}</template>
            </el-menu-item>
          </PermissionWrapper>
        </el-sub-menu>
      </PermissionWrapper>
      <PermissionWrapper :any-require="developerProductPlatformPermissions">
        <el-sub-menu
          v-if="hasAnyVisibleRoutes('developerProducts')"
          index="developerProductCatalog"
        >
          <template #title>
            <el-icon><Connection /></el-icon>
            <span>{{ i18ns.t('nav.developerProducts') }}</span>
          </template>
          <el-menu-item
            v-if="isRouteVisible('developerProducts')"
            index="developerProducts"
            @click="nav('developerProducts', $event)"
            @contextmenu.prevent="openRouteMenu('developerProducts', $event)"
          >
            <el-icon><Connection /></el-icon>
            <template #title>{{ i18ns.t('nav.productCatalog') }}</template>
          </el-menu-item>
          <PermissionWrapper
            v-for="product in developerProducts"
            :key="product.code"
            :any-require="[
              ...product.permissions,
              Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE,
              Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE,
            ]"
          >
            <el-sub-menu
              v-if="
                hasAnyVisibleRoutes(
                  developerProductUserRoute(product.code),
                  developerProductManagementRoute(product.code),
                  developerProductConfigRoute(product.code),
                )
              "
              :index="`developer-product-${product.code}`"
            >
              <template #title>
                <el-icon><component :is="product.icon" /></el-icon>
                <span>{{ i18ns.t(product.labelKey as any) }}</span>
              </template>
              <PermissionWrapper :any-require="product.permissions">
                <el-menu-item
                  v-if="isRouteVisible(developerProductUserRoute(product.code))"
                  :index="developerProductUserRoute(product.code)"
                  @click="nav(developerProductUserRoute(product.code), $event)"
                  @contextmenu.prevent="
                    openRouteMenu(developerProductUserRoute(product.code), $event)
                  "
                >
                  <el-icon><User /></el-icon>
                  <template #title>{{ i18ns.t('nav.productUserPage') }}</template>
                </el-menu-item>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE]">
                <el-menu-item
                  v-if="isRouteVisible(developerProductManagementRoute(product.code))"
                  :index="developerProductManagementRoute(product.code)"
                  @click="nav(developerProductManagementRoute(product.code), $event)"
                  @contextmenu.prevent="
                    openRouteMenu(developerProductManagementRoute(product.code), $event)
                  "
                >
                  <el-icon><DataAnalysis /></el-icon>
                  <template #title>{{ i18ns.t('nav.productManagementPage') }}</template>
                </el-menu-item>
              </PermissionWrapper>
              <PermissionWrapper :require="[Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE]">
                <el-menu-item
                  v-if="isRouteVisible(developerProductConfigRoute(product.code))"
                  :index="developerProductConfigRoute(product.code)"
                  @click="nav(developerProductConfigRoute(product.code), $event)"
                  @contextmenu.prevent="
                    openRouteMenu(developerProductConfigRoute(product.code), $event)
                  "
                >
                  <el-icon><Tools /></el-icon>
                  <template #title>{{ i18ns.t('nav.productConfigPage') }}</template>
                </el-menu-item>
              </PermissionWrapper>
            </el-sub-menu>
          </PermissionWrapper>
        </el-sub-menu>
      </PermissionWrapper>
      <PermissionWrapper
        :any-require="[
          Permission.OJ_APIKEY_READ,
          Permission.OJ_USAGE_READ,
          Permission.OJ_PRICING_READ,
        ]"
      >
        <el-sub-menu
          v-if="
            hasAnyVisibleRoutes('ojAPIKeyManagement', 'ojUsageStatistics', 'ojPricingManagement')
          "
          index="ojSubmitter"
        >
          <template #title>
            <el-icon><Cpu /></el-icon>
            <span>{{ i18ns.t('nav.ojSubmitter') }}</span>
          </template>
          <PermissionWrapper :require="[Permission.OJ_APIKEY_READ]">
            <el-menu-item
              v-if="isRouteVisible('ojAPIKeyManagement')"
              index="ojAPIKeyManagement"
              @click="nav('ojAPIKeyManagement', $event)"
              @contextmenu.prevent="openRouteMenu('ojAPIKeyManagement', $event)"
            >
              <el-icon><Key /></el-icon>
              <template #title>{{ i18ns.t('nav.ojAPIKeyManagement') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.OJ_USAGE_READ]">
            <el-menu-item
              v-if="isRouteVisible('ojUsageStatistics')"
              index="ojUsageStatistics"
              @click="nav('ojUsageStatistics', $event)"
              @contextmenu.prevent="openRouteMenu('ojUsageStatistics', $event)"
            >
              <el-icon><Histogram /></el-icon>
              <template #title>{{ i18ns.t('nav.ojUsageStatistics') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.OJ_PRICING_READ]">
            <el-menu-item
              v-if="isRouteVisible('ojPricingManagement')"
              index="ojPricingManagement"
              @click="nav('ojPricingManagement', $event)"
              @contextmenu.prevent="openRouteMenu('ojPricingManagement', $event)"
            >
              <el-icon><TrendCharts /></el-icon>
              <template #title>{{ i18ns.t('nav.ojPricingManagement') }}</template>
            </el-menu-item>
          </PermissionWrapper>
        </el-sub-menu>
      </PermissionWrapper>
    </el-sub-menu>
  </PermissionWrapper>

  <!-- Content & Data -->
  <PermissionWrapper
    :any-require="[
      Permission.JSON_ENDPOINT_READ,
      Permission.ARTICLE_READ,
      Permission.LEGAL_POLICY_READ,
    ]"
  >
    <el-sub-menu
      v-if="
        hasAnyVisibleRoutes('jsonEndpointManagement', 'articleManagement', 'legalPolicyManagement')
      "
      index="dataServices"
    >
      <template #title>
        <el-icon><FolderOpened /></el-icon>
        <span>{{ i18ns.t('nav.dataServices') }}</span>
      </template>
      <PermissionWrapper :require="[Permission.JSON_ENDPOINT_READ]">
        <el-menu-item
          v-if="isRouteVisible('jsonEndpointManagement')"
          index="jsonEndpointManagement"
          @click="nav('jsonEndpointManagement', $event)"
          @contextmenu.prevent="openRouteMenu('jsonEndpointManagement', $event)"
        >
          <el-icon><Document /></el-icon>
          <template #title>{{ i18ns.t('nav.jsonEndpoints') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper :require="[Permission.ARTICLE_READ]">
        <el-menu-item
          v-if="isRouteVisible('articleManagement')"
          index="articleManagement"
          @click="nav('articleManagement', $event)"
          @contextmenu.prevent="openRouteMenu('articleManagement', $event)"
        >
          <el-icon><Notebook /></el-icon>
          <template #title>{{ i18ns.t('nav.articleManagement') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper :require="[Permission.LEGAL_POLICY_READ]">
        <el-menu-item
          v-if="isRouteVisible('legalPolicyManagement')"
          index="legalPolicyManagement"
          @click="nav('legalPolicyManagement', $event)"
          @contextmenu.prevent="openRouteMenu('legalPolicyManagement', $event)"
        >
          <el-icon><Document /></el-icon>
          <template #title>{{ i18ns.t('nav.legalPolicyManagement') }}</template>
        </el-menu-item>
      </PermissionWrapper>
    </el-sub-menu>
  </PermissionWrapper>

  <!-- Analytics -->
  <PermissionWrapper :require="[Permission.ANALYTICS_READ]">
    <el-sub-menu
      v-if="hasAnyVisibleRoutes('analyticsOverview', 'analyticsFunnel', 'analyticsHeatmap')"
      index="analytics"
    >
      <template #title>
        <el-icon><DataAnalysis /></el-icon>
        <span>{{ i18ns.t('nav.analytics') }}</span>
      </template>
      <el-menu-item
        v-if="isRouteVisible('analyticsOverview')"
        index="analyticsOverview"
        @click="nav('analyticsOverview', $event)"
        @contextmenu.prevent="openRouteMenu('analyticsOverview', $event)"
      >
        <el-icon><TrendCharts /></el-icon>
        <template #title>{{ i18ns.t('nav.analyticsOverview') }}</template>
      </el-menu-item>
      <el-menu-item
        v-if="isRouteVisible('analyticsFunnel')"
        index="analyticsFunnel"
        @click="nav('analyticsFunnel', $event)"
        @contextmenu.prevent="openRouteMenu('analyticsFunnel', $event)"
      >
        <el-icon><Histogram /></el-icon>
        <template #title>{{ i18ns.t('nav.analyticsFunnel') }}</template>
      </el-menu-item>
      <el-menu-item
        v-if="isRouteVisible('analyticsHeatmap')"
        index="analyticsHeatmap"
        @click="nav('analyticsHeatmap', $event)"
        @contextmenu.prevent="openRouteMenu('analyticsHeatmap', $event)"
      >
        <el-icon><DataAnalysis /></el-icon>
        <template #title>{{ i18ns.t('nav.analyticsHeatmap') }}</template>
      </el-menu-item>
    </el-sub-menu>
  </PermissionWrapper>

  <!-- Users & Access -->
  <PermissionWrapper
    :any-require="[
      Permission.USER_READ,
      Permission.PERMISSION_VIEW,
      Permission.GROUP_READ,
      Permission.RAM_USER_READ,
      Permission.RAM_ROLE_READ,
      Permission.RAM_BINDING_READ,
      Permission.RAM_SESSION_READ,
    ]"
  >
    <el-sub-menu
      v-if="hasAnyVisibleRoutes('userManagement', 'groupManagement', 'permission', 'ramManagement')"
      index="userManagement"
    >
      <template #title>
        <el-icon><UserFilled /></el-icon>
        <span>{{ i18ns.t('nav.userManagement') }}</span>
      </template>
      <PermissionWrapper :require="[Permission.USER_READ]">
        <el-menu-item
          v-if="isRouteVisible('userManagement')"
          index="users"
          @click="nav('userManagement', $event)"
          @contextmenu.prevent="openRouteMenu('userManagement', $event)"
        >
          <el-icon><User /></el-icon>
          <template #title>{{ i18ns.t('nav.users') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper :require="[Permission.GROUP_READ]">
        <el-menu-item
          v-if="isRouteVisible('groupManagement')"
          index="groupManagement"
          @click="nav('groupManagement', $event)"
          @contextmenu.prevent="openRouteMenu('groupManagement', $event)"
        >
          <el-icon><Collection /></el-icon>
          <template #title>{{ i18ns.t('nav.groups') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper :require="[Permission.PERMISSION_VIEW]">
        <el-menu-item
          v-if="isRouteVisible('permission')"
          index="permission"
          @click="nav('permission', $event)"
          @contextmenu.prevent="openRouteMenu('permission', $event)"
        >
          <el-icon><Operation /></el-icon>
          <template #title>{{ i18ns.t('nav.permissions') }}</template>
        </el-menu-item>
      </PermissionWrapper>
      <PermissionWrapper
        :any-require="[
          Permission.RAM_USER_READ,
          Permission.RAM_ROLE_READ,
          Permission.RAM_BINDING_READ,
          Permission.RAM_SESSION_READ,
        ]"
      >
        <el-menu-item
          v-if="isRouteVisible('ramManagement')"
          index="ramManagement"
          @click="nav('ramManagement', $event)"
          @contextmenu.prevent="openRouteMenu('ramManagement', $event)"
        >
          <el-icon><Key /></el-icon>
          <template #title>{{ i18ns.t('nav.ramManagement') }}</template>
        </el-menu-item>
      </PermissionWrapper>
    </el-sub-menu>
  </PermissionWrapper>

  <li v-if="hasNavigationBeforeSystem && hasSystemNavigation" class="menu-divider" />

  <!-- System -->
  <PermissionWrapper
    :any-require="[
      Permission.SYSTEM_STATS_READ,
      Permission.SYSTEM_CONSUMPTION_STATS_READ,
      Permission.SYSTEM_LOG_READ,
      Permission.API_LOG_READ,
      Permission.SYSTEM_SERVER_LOG_READ,
      Permission.SYSTEM_BUSINESS_LOG_READ,
      Permission.SYSTEM_ERROR_REPORT_READ,
      Permission.SYSTEM_DATA_LIFECYCLE_MANAGE,
      Permission.SYSTEM_DATA_MAINTENANCE_MANAGE,
      Permission.SYSTEM_CONFIG,
      Permission.IP_BLACKLIST_READ,
      Permission.USER_ONLINE_MONITOR_READ,
    ]"
  >
    <el-sub-menu
      v-if="
        hasAnyVisibleRoutes(
          'serverConfig',
          'ipMonitoring',
          'systemStats',
          'systemConsumptionStats',
          'systemLogs',
          'businessLogs',
          'errorCenter',
          'dataLifecycle',
          'dataMaintenance',
          'userOnlineMonitor',
        )
      "
      index="system"
    >
      <template #title>
        <el-icon><Monitor /></el-icon>
        <span>{{ i18ns.t('nav.system') }}</span>
      </template>
      <PermissionWrapper :any-require="[Permission.SYSTEM_CONFIG, Permission.IP_BLACKLIST_READ]">
        <el-sub-menu
          v-if="hasAnyVisibleRoutes('serverConfig', 'ipMonitoring')"
          index="systemConfigSecurity"
        >
          <template #title>
            <el-icon><Tools /></el-icon>
            <span>{{ i18ns.t('nav.systemConfigSecurity') }}</span>
          </template>
          <PermissionWrapper :require="[Permission.SYSTEM_CONFIG]">
            <el-menu-item
              v-if="isRouteVisible('serverConfig')"
              index="serverConfig"
              @click="nav('serverConfig', $event)"
              @contextmenu.prevent="openRouteMenu('serverConfig', $event)"
            >
              <el-icon><Tools /></el-icon>
              <template #title>{{ i18ns.t('nav.serverConfig') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.IP_BLACKLIST_READ]">
            <el-menu-item
              v-if="isRouteVisible('ipMonitoring')"
              index="ipMonitoring"
              @click="nav('ipMonitoring', $event)"
              @contextmenu.prevent="openRouteMenu('ipMonitoring', $event)"
            >
              <el-icon><DataAnalysis /></el-icon>
              <template #title>{{ i18ns.t('nav.ipMonitoring') }}</template>
            </el-menu-item>
          </PermissionWrapper>
        </el-sub-menu>
      </PermissionWrapper>
      <PermissionWrapper
        :any-require="[Permission.SYSTEM_STATS_READ, Permission.SYSTEM_CONSUMPTION_STATS_READ]"
      >
        <el-sub-menu
          v-if="hasAnyVisibleRoutes('systemStats', 'systemConsumptionStats')"
          index="systemMonitoring"
        >
          <template #title>
            <el-icon><TrendCharts /></el-icon>
            <span>{{ i18ns.t('nav.systemMonitoring') }}</span>
          </template>
          <PermissionWrapper :require="[Permission.SYSTEM_STATS_READ]">
            <el-menu-item
              v-if="isRouteVisible('systemStats')"
              index="systemStats"
              @click="nav('systemStats', $event)"
              @contextmenu.prevent="openRouteMenu('systemStats', $event)"
            >
              <el-icon><TrendCharts /></el-icon>
              <template #title>{{ i18ns.t('nav.systemStats') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.SYSTEM_CONSUMPTION_STATS_READ]">
            <el-menu-item
              v-if="isRouteVisible('systemConsumptionStats')"
              index="systemConsumptionStats"
              @click="nav('systemConsumptionStats', $event)"
              @contextmenu.prevent="openRouteMenu('systemConsumptionStats', $event)"
            >
              <el-icon><Histogram /></el-icon>
              <template #title>{{ i18ns.t('nav.systemConsumptionStats') }}</template>
            </el-menu-item>
          </PermissionWrapper>
        </el-sub-menu>
      </PermissionWrapper>
      <PermissionWrapper
        :any-require="[
          Permission.SYSTEM_LOG_READ,
          Permission.API_LOG_READ,
          Permission.SYSTEM_SERVER_LOG_READ,
          Permission.SYSTEM_BUSINESS_LOG_READ,
        ]"
      >
        <el-sub-menu
          v-if="
            hasAnyVisibleRoutes(
              'systemLogs',
              'businessLogs',
              'errorCenter',
              'dataLifecycle',
              'dataMaintenance',
              'userOnlineMonitor',
            )
          "
          index="systemAudit"
        >
          <template #title>
            <el-icon><Document /></el-icon>
            <span>{{ i18ns.t('nav.systemAudit') }}</span>
          </template>
          <PermissionWrapper
            :any-require="[
              Permission.SYSTEM_LOG_READ,
              Permission.API_LOG_READ,
              Permission.SYSTEM_SERVER_LOG_READ,
              Permission.SYSTEM_ERROR_REPORT_READ,
              Permission.SYSTEM_DATA_LIFECYCLE_MANAGE,
              Permission.SYSTEM_DATA_MAINTENANCE_MANAGE,
            ]"
          >
            <el-menu-item
              v-if="isRouteVisible('systemLogs')"
              index="systemLogs"
              @click="nav('systemLogs', $event)"
              @contextmenu.prevent="openRouteMenu('systemLogs', $event)"
            >
              <el-icon><Document /></el-icon>
              <template #title>{{ i18ns.t('nav.systemLogs') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.SYSTEM_BUSINESS_LOG_READ]">
            <el-menu-item
              v-if="isRouteVisible('businessLogs')"
              index="businessLogs"
              @click="nav('businessLogs', $event)"
              @contextmenu.prevent="openRouteMenu('businessLogs', $event)"
            >
              <el-icon><Notebook /></el-icon>
              <template #title>{{ i18ns.t('nav.businessLogs') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.SYSTEM_ERROR_REPORT_READ]">
            <el-menu-item
              v-if="isRouteVisible('errorCenter')"
              index="errorCenter"
              @click="nav('errorCenter', $event)"
              @contextmenu.prevent="openRouteMenu('errorCenter', $event)"
            >
              <el-icon><Document /></el-icon>
              <template #title>{{ i18ns.t('nav.errorCenter') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.SYSTEM_DATA_LIFECYCLE_MANAGE]">
            <el-menu-item
              v-if="isRouteVisible('dataLifecycle')"
              index="dataLifecycle"
              @click="nav('dataLifecycle', $event)"
              @contextmenu.prevent="openRouteMenu('dataLifecycle', $event)"
            >
              <el-icon><Document /></el-icon>
              <template #title>{{ i18ns.t('nav.dataLifecycle') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.SYSTEM_DATA_MAINTENANCE_MANAGE]">
            <el-menu-item
              v-if="isRouteVisible('dataMaintenance')"
              index="dataMaintenance"
              @click="nav('dataMaintenance', $event)"
              @contextmenu.prevent="openRouteMenu('dataMaintenance', $event)"
            >
              <el-icon><Document /></el-icon>
              <template #title>{{ i18ns.t('nav.dataMaintenance') }}</template>
            </el-menu-item>
          </PermissionWrapper>
          <PermissionWrapper :require="[Permission.USER_ONLINE_MONITOR_READ]">
            <el-menu-item
              v-if="isRouteVisible('userOnlineMonitor')"
              index="userOnlineMonitor"
              @click="nav('userOnlineMonitor', $event)"
              @contextmenu.prevent="openRouteMenu('userOnlineMonitor', $event)"
            >
              <el-icon><Monitor /></el-icon>
              <template #title>{{ i18ns.t('nav.userOnlineMonitor') }}</template>
            </el-menu-item>
          </PermissionWrapper>
        </el-sub-menu>
      </PermissionWrapper>
    </el-sub-menu>
  </PermissionWrapper>

  <li v-if="hasAnyRegularNavigation && hasTrailingNavigation" class="menu-divider" />

  <div v-if="showSpacer" class="menu-spacer" />

  <PermissionWrapper :require="[Permission.DEBUG_ACCESS]">
    <el-menu-item
      v-if="isRouteVisible('debug')"
      index="debug"
      @click="nav('debug', $event)"
      @contextmenu.prevent="openRouteMenu('debug', $event)"
      class="item-muted"
    >
      <el-icon><Operation /></el-icon>
      <template #title>{{ i18ns.t('nav.debug') }}</template>
    </el-menu-item>
  </PermissionWrapper>

  <el-menu-item
    v-if="showLogout"
    index="logout"
    @click="authorizationService.logout()"
    class="item-logout"
  >
    <el-icon><LogoutIcon :size="16" /></el-icon>
    <template #title>{{ i18ns.t('logout') }}</template>
  </el-menu-item>
</template>

<script lang="ts" setup>
import {
  HomeFilled,
  ChatDotRound,
  Setting,
  Operation,
  DataAnalysis,
  TrendCharts,
  Document,
  Notebook,
  User,
  UserFilled,
  Collection,
  Tools,
  Monitor,
  Key,
  CreditCard,
  Connection,
  Postcard,
  Wallet,
  Histogram,
  FolderOpened,
  Cpu,
  Bell,
  Link,
  Box,
  Lock,
} from '@element-plus/icons-vue'
import { i18ns } from '@/locales'
import { authorizationService } from '@/service/authorizationService'
import LogoutIcon from '@/components/icons/LogoutIcon.vue'
import PermissionWrapper from '@/components/common/PermissionWrapper.vue'
import { Permission } from '@/constant/permission'
import {
  DEVELOPER_PRODUCT_NAVIGATION,
  developerProductConfigRoute,
  developerProductManagementRoute,
  developerProductUserRoute,
} from '@/constant/developer-product-navigation'
import router from '@/router'
import type { RouteName } from '@/types/route-types.gen'
import { computed, useSlots } from 'vue'

const props = withDefaults(
  defineProps<{
    showSpacer?: boolean
    showLogout?: boolean
    showPinnedSection?: boolean
    onRouteNavigate?: (name: RouteName, event?: MouseEvent) => void
    onRouteContextMenu?: (name: RouteName, event: MouseEvent) => void
  }>(),
  {
    showSpacer: false,
    showLogout: false,
    showPinnedSection: false,
  },
)

const slots = useSlots()
const hasPinnedSlot = computed(() => Boolean(slots.pinned))
const developerProducts = DEVELOPER_PRODUCT_NAVIGATION
const developerProductPermissions = developerProducts.flatMap((product) => product.permissions)
const developerProductPlatformPermissions = [
  ...developerProductPermissions,
  Permission.DEVELOPER_PRODUCT_ENTITLEMENT_MANAGE,
  Permission.DEVELOPER_PRODUCT_CONFIG_MANAGE,
]
const productsMenuPermissions = [
  ...developerProductPlatformPermissions,
  Permission.OJ_APIKEY_READ,
  Permission.OJ_USAGE_READ,
  Permission.OJ_PRICING_READ,
  Permission.MODEL_PRICING_UPDATE,
  Permission.UPSTREAM_STATUS_READ,
  Permission.REMOTE_TERMINAL_DEVICE_READ,
  Permission.REMOTE_TERMINAL_PRODUCT_READ,
  Permission.REMOTE_TERMINAL_ASSIGNMENT_READ,
  Permission.REMOTE_TERMINAL_SESSION_READ,
  Permission.REMOTE_TERMINAL_SESSION_CREATE,
]

const isRouteVisible = (routeName: string): boolean => router.hasRoute(routeName)
const hasAnyVisibleRoutes = (...routeNames: string[]): boolean => routeNames.some(isRouteVisible)

const primaryNavigationRouteNames = [
  'home',
  'balanceHistory',
  'consumptionRecords',
  'myTickets',
  'settingsProfile',
  'settingsSecurity',
  'notificationSettings',
  'settingsPreferences',
  'myMonthlyPasses',
  'myRemoteTerminalProducts',
  'chat',
  'scriptManager',
]
const secondaryNavigationRouteNames = [
  'oauthClientManagement',
  'authCenterClientManagement',
  'oauthClientReviewManagement',
  'authCenterClientReviewManagement',
  'ticketReviewManagement',
  'balanceManagement',
  'monthlyPassManagement',
  'redemptionCodes',
  'remoteTerminal',
  'remoteTerminalProductManagement',
  'relayTokenManagement',
  'apiDocumentation',
  'relayChannelProvider',
  'relayChannelReview',
  'relaySettings',
  'relayChannelHealth',
  'relayRequestDiagnostics',
  'relayChannelProbes',
  'upstreamStatus',
  'developerProducts',
  'ojAPIKeyManagement',
  'ojUsageStatistics',
  'ojPricingManagement',
  'jsonEndpointManagement',
  'articleManagement',
  'legalPolicyManagement',
  'analyticsOverview',
  'analyticsFunnel',
  'analyticsHeatmap',
]
const userManagementRouteNames = [
  'userManagement',
  'groupManagement',
  'permission',
  'ramManagement',
]
const systemRouteNames = [
  'serverConfig',
  'ipMonitoring',
  'systemStats',
  'systemConsumptionStats',
  'systemLogs',
  'businessLogs',
  'errorCenter',
  'dataLifecycle',
  'dataMaintenance',
  'userOnlineMonitor',
]

const hasHomeNavigation = computed(() => isRouteVisible('home'))
const hasPrimaryNavigation = computed(() => hasAnyVisibleRoutes(...primaryNavigationRouteNames))
const hasSecondaryNavigation = computed(() => hasAnyVisibleRoutes(...secondaryNavigationRouteNames))
const hasUserManagementNavigation = computed(() => hasAnyVisibleRoutes(...userManagementRouteNames))
const hasSystemNavigation = computed(() => hasAnyVisibleRoutes(...systemRouteNames))
const hasNavigationAfterPinned = computed(
  () =>
    hasAnyVisibleRoutes(
      ...primaryNavigationRouteNames.filter((routeName) => routeName !== 'home'),
    ) ||
    hasSecondaryNavigation.value ||
    hasUserManagementNavigation.value ||
    hasSystemNavigation.value,
)
const hasNavigationBeforeSystem = computed(
  () =>
    hasPrimaryNavigation.value || hasSecondaryNavigation.value || hasUserManagementNavigation.value,
)
const hasAnyRegularNavigation = computed(
  () =>
    hasPrimaryNavigation.value ||
    hasSecondaryNavigation.value ||
    hasUserManagementNavigation.value ||
    hasSystemNavigation.value,
)
const hasTrailingNavigation = computed(() => props.showLogout || isRouteVisible('debug'))

const nav = (name: RouteName, event?: MouseEvent) => {
  props.onRouteNavigate?.(name, event)
  if (!props.onRouteNavigate) {
    router.push({ name } as any)
  }
}

const openRouteMenu = (name: RouteName, event: MouseEvent) => {
  props.onRouteContextMenu?.(name, event)
}
</script>

<style scoped>
.menu-divider {
  height: 1px;
  margin: 4px 12px;
  background-color: var(--el-border-color-lighter);
  list-style: none;
  flex-shrink: 0;
}

.menu-spacer {
  flex: 1;
  min-height: 12px;
}

.item-muted {
  opacity: 0.55;
  font-size: 12px;
}

.item-muted:hover {
  opacity: 0.8;
}

.item-logout {
  color: var(--el-color-danger) !important;
}

.item-logout :deep(.el-icon) {
  color: var(--el-color-danger) !important;
}

.item-logout:hover {
  background-color: var(--el-color-danger-light-9) !important;
}

.item-docs {
  color: var(--el-color-primary) !important;
}

.item-docs :deep(.el-icon) {
  color: var(--el-color-primary) !important;
}

.item-docs:hover {
  background-color: var(--el-color-primary-light-9) !important;
}
</style>
