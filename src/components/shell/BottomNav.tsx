import type { ComponentType, MouseEvent, SVGProps } from 'react'
import { IconChart, IconList, IconSettings, IconToday } from '../icons'
import { ROUTE_TITLES, routeHref, scrollToTop, type Route } from './router'

interface Tab {
  route: Route
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

const TABS: readonly Tab[] = [
  { route: 'oggi', Icon: IconToday },
  { route: 'esercizi', Icon: IconList },
  { route: 'riepilogo', Icon: IconChart },
  { route: 'impostazioni', Icon: IconSettings },
]

/** Fixed bottom navigation: 4 equal tabs (icon + label), thumb-reachable. */
export function BottomNav({ route }: { route: Route }) {
  const onTabClick = (e: MouseEvent<HTMLAnchorElement>, target: Route) => {
    // Tapping the active tab scrolls back to the top instead of doing nothing.
    if (target === route) {
      e.preventDefault()
      scrollToTop(true)
    }
  }

  return (
    <nav className="sh-nav" aria-label="Sezioni dell'app">
      <ul className="sh-nav__list">
        {TABS.map(({ route: target, Icon }) => {
          const active = target === route
          return (
            <li key={target} className="sh-nav__item">
              <a
                href={routeHref(target)}
                className="sh-nav__tab"
                aria-current={active ? 'page' : undefined}
                onClick={(e) => onTabClick(e, target)}
              >
                <span className="sh-nav__icon">
                  <Icon />
                </span>
                <span className="sh-nav__label">{ROUTE_TITLES[target]}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
