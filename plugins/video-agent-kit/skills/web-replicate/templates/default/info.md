Using Node.js 20, Tailwind CSS v4, and Vite v7

Tailwind CSS has been set up with the shadcn theme (CSS variables in src/index.css)

Components (50+):
  accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb,
  button-group, button, calendar, card, carousel, chart, checkbox, collapsible,
  command, context-menu, dialog, drawer, dropdown-menu, empty, field, form,
  hover-card, input-group, input-otp, input, item, kbd, label, menubar,
  navigation-menu, pagination, popover, progress, radio-group, resizable,
  scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner,
  spinner, switch, table, tabs, textarea, toggle-group, toggle, tooltip

Usage:
  import { Button } from '@/components/ui/button'
  import { Card, CardHeader, CardTitle } from '@/components/ui/card'

Structure:
  src/pages/           Page / section components
  src/hooks/           Custom hooks
    useFreezeParams.ts   ?time=<sec> / ?t=<0..1> forensic params: `const { time, t } = useFreezeParams()`;
                         drive every animated value from `time` / `t` so screenshots can freeze a state;
                         `cssFreezeStyle()` pins a CSS animation to the frozen time
    ?hud=1               prints the page's clock (time / t / frame) bottom-right: the driver snapshot
                         React content rendered with; use it for live capture (components/ForensicHud.tsx)
    window.__v2c         { time, t, frame, frozenTime, frozenT } of the last published frame, for scripts
  src/lib/             Shared utilities
  src/components/ui/   Pre-installed shadcn/ui components
  src/App.css          Styles specific to the Webapp
  src/App.tsx          Root React component
  src/index.css        Global styles + Tailwind theme (:root/.dark vars, @theme)
  src/main.tsx         Entry point for rendering the Webapp
  index.html           Entry point for the Webapp
  vite.config.ts       Main build and dev server settings for Vite
