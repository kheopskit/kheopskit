import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Logo from "./assets/icons/kheopskit-square.svg";
// import logo from "./assets/icons/kheopskit-square.svg";
/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: <explanation> */}
        <svg width="24" height="24" viewBox="0 0 100 100">
          <rect width="100" height="100" fill="none" />
          <rect
            x="5"
            y="5"
            width="90"
            height="90"
            rx="10"
            ry="10"
            fill="#e6007a"
            stroke="#fff"
            strokeWidth="3"
          />
          <rect x="5" y="15" width="90" height="10" fill="#fff" />
          <circle cx="80" cy="50" r="5" fill="#fff" />
        </svg>
        Kheopskit
      </>
    ),
  },
  // see https://fumadocs.dev/docs/ui/navigation/links
  links: [
    {
      text: "Documentation",
      url: "/docs",
      //   active: "nested-url",
    },
  ],
};
