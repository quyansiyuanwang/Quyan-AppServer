import { describe, expect, it } from 'vitest'
import {
  collectVisibleNavigationRoutes,
  filterNavigationNodes,
  navigationMenuDefinition,
} from '@/config/navigation-catalog'
import { Permission } from '@/constant/permission'

const allRoutesAvailable = () => true

describe('navigation catalog', () => {
  it('uses the same permission filter for sidebar nodes and search route entries', () => {
    const anonymousSidebar = filterNavigationNodes(navigationMenuDefinition, [], allRoutesAvailable)
    const anonymousSearch = collectVisibleNavigationRoutes(
      navigationMenuDefinition,
      [],
      allRoutesAvailable,
    )

    expect(anonymousSidebar.some((node) => node.route === 'home')).toBe(true)
    expect(anonymousSearch.some(({ node }) => node.route === 'relayTokenManagement')).toBe(false)

    const permissions = [Permission.RELAY_TOKEN_READ]
    const sidebar = filterNavigationNodes(navigationMenuDefinition, permissions, allRoutesAvailable)
    const searchRoutes = collectVisibleNavigationRoutes(
      navigationMenuDefinition,
      permissions,
      allRoutesAvailable,
    )

    expect(sidebar.some((node) => node.route === 'relayTokenManagement')).toBe(true)
    expect(
      searchRoutes.find(({ node }) => node.route === 'relayTokenManagement')?.parentLabelKeys,
    ).toEqual(['nav.relay'])
  })

  it('does not expose a route when it is not registered by the current site profile', () => {
    const routes = collectVisibleNavigationRoutes(
      navigationMenuDefinition,
      [Permission.RELAY_TOKEN_READ],
      (route) => route !== 'relayTokenManagement',
    )

    expect(routes.some(({ node }) => node.route === 'relayTokenManagement')).toBe(false)
  })
})
