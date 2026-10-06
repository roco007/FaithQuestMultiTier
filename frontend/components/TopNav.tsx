'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Map, Gamepad2, Wand2, Backpack, User } from 'lucide-react';

const LINKS = [
  { href: '/', label: 'Quest Map', icon: Map },
  { href: '/games', label: 'Hunts', icon: Gamepad2 },
  { href: '/creator', label: 'Creator', icon: Wand2 },
  { href: '/inventory', label: 'Inventory', icon: Backpack },
  { href: '/profile', label: 'Profile', icon: User },
];

/**
 * Routes that opt out of the nav ribbon entirely.
 *
 * `/hunts/live-map` is a display view, not a destination inside the app: it is
 * meant to be thrown on a second monitor and read at a glance, where a row of
 * links and a brand mark are just pixels stolen from the map. It also renders no
 * page header of its own, so the ribbon was the last piece of chrome left — see
 * the `.appShell:has(.liveMapPage)` rules in globals.css, which rely on the nav
 * being absent to give the map the full viewport height.
 *
 * Escape and the browser's back button are the way off this page; the floating
 * fullscreen button covers leaving fullscreen.
 */
const BARE_ROUTES = ['/hunts/live-map'];

/** Primary navigation, replacing the native bottom tab bar. */
export function TopNav() {
  const pathname = usePathname();
  if (BARE_ROUTES.some(route => pathname.startsWith(route))) return null;

  return (
    <nav className="topNav">
      <Link href="/" className="brand">
        <span className="brandMark" aria-hidden="true">
          ✝
        </span>
        <span>
          FaithQuest
          <br />
          <span className="brandSub">Web Edition</span>
        </span>
      </Link>

      <div className="navLinks">
        {LINKS.map(({ href, label, icon: Icon }) => {
          // Exact match for "/" so it doesn't stay lit on every nested route.
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`navLink${isActive ? ' navLinkActive' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}