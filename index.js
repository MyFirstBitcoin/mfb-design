// @myfirstbitcoin/design - programmatic access to MFB brand tokens.
export { default as tailwindPreset } from './tailwind.js';
export const colors = {
  "purple": {
    "200": "#5E378E",
    "300": "#422C70",
    "400": "#2B1C58"
  },
  "orange": {
    "200": "#FBB040",
    "300": "#F7941F",
    "400": "#EF7B00"
  },
  "black": "#000000",
  "white": "#FFFFFF",
  "gray": {
    "100": "#F3F3FA",
    "200": "#EAEAF4",
    "300": "#D8D8E7",
    "400": "#C0C0D0",
    "500": "#ADADBE",
    "600": "#88889C",
    "700": "#6C6C7D",
    "800": "#4F4F5D",
    "900": "#25252B"
  }
};
export const fontFamily = {
  "heading": [
    "IBM Plex Sans",
    "Arial",
    "sans-serif"
  ],
  "body": [
    "IBM Plex Sans",
    "Arial",
    "sans-serif"
  ],
  "mono": [
    "IBM Plex Mono",
    "monospace"
  ],
  "sans": [
    "IBM Plex Sans",
    "Arial",
    "sans-serif"
  ]
};
export const fontSize = {
  "h1": "70px",
  "h2": "58px",
  "h3": "48px",
  "h4": "40px",
  "h5": "36px",
  "h6": "32px",
  "body": "18px",
  "label": "22px",
  "quote": "40px"
};
export const fontWeight = {
  "regular": 400,
  "medium": 500,
  "semibold": 600
};
export const gradientBrand = "linear-gradient(135deg, #2B1C58 0%, #5E378E 100%)";
export const colorRoles = {
  "heading-on-light": "#000000",
  "body-on-light": "#000000",
  "muted-on-light": "#6C6C7D",
  "link-on-light": "#422C70",
  "link-underline-on-light": "#F7941F",
  "border-on-light": "#EAEAF4",
  "highlighter-on-light": "#F7941F",
  "logo-on-light": "#422C70",
  "heading-on-dark": "#FFFFFF",
  "body-on-dark": "#FFFFFF",
  "muted-on-dark": "#C0C0D0",
  "link-on-dark": "#F7941F",
  "highlighter-on-dark": "#F7941F",
  "logo-on-dark": "#FFFFFF",
  "heading-on-orange": "#000000",
  "body-on-orange": "#000000",
  "link-on-orange": "#000000",
  "highlighter-on-orange": "#FFFFFF",
  "logo-on-orange": "#000000"
};
export const shapeTones = {
  "purple-300": "#5E378E",
  "orange-300": "#FBB040",
  "gray-700": "#88889C"
};
export const fontSizeFluid = {
  "h1": "clamp(44px, 6vw, 70px)",
  "h2": "clamp(36px, 5vw, 58px)",
  "h3": "clamp(30px, 4vw, 48px)",
  "h4": "clamp(26px, 3.2vw, 40px)",
  "h5": "clamp(22px, 2.6vw, 36px)",
  "h6": "clamp(20px, 2.2vw, 32px)",
  "quote": "clamp(22px, 2.8vw, 40px)",
  "label": "clamp(16px, 1.6vw, 22px)"
};
export const lineHeight = {
  "h1": 1,
  "h2": 1,
  "h3": 1,
  "h4": 1,
  "h5": 1.1,
  "h6": 1.1,
  "body": 1.2,
  "label": 1.2,
  "quote": 1
};
export const letterSpacing = {
  "h1": "0em",
  "h2": "0em",
  "h3": "0em",
  "h4": "0em",
  "h5": "0em",
  "h6": "0em",
  "body": "0em",
  "label": "0em",
  "quote": "0em"
};
export const logo = {
  "min-width": "120px",
  "min-width-print": "25mm",
  "aspect": 1.904,
  "min-height": "63px",
  "clearspace": 0.5,
  "edge-margin": 0.5
};
export const spacing = {
  "1": "4px",
  "2": "8px",
  "3": "12px",
  "4": "16px",
  "6": "24px",
  "8": "32px",
  "12": "48px",
  "16": "64px",
  "24": "96px",
  "32": "128px"
};
export const space = {
  "heading-to-body": "40px",
  "quote-to-label": "48px",
  "gutter": "clamp(20px, 4vw, 64px)",
  "section": "clamp(64px, 9vw, 128px)",
  "section-tight": "clamp(48px, 6vw, 96px)",
  "header-gap": "clamp(32px, 4vw, 56px)",
  "block-end": "clamp(32px, 4vw, 48px)"
};
export const radius = {
  "sm": "4px",
  "md": "8px",
  "lg": "12px",
  "pill": "999px"
};
export const shadow = {
  "media": "0px 20px 60px -20px color-mix(in srgb, #2B1C58 25%, transparent)",
  "media-control": "0px 12px 32px -8px color-mix(in srgb, #000000 40%, transparent)",
  "overlay": "0px 40px 80px -20px color-mix(in srgb, #000000 50%, transparent)"
};
export const easing = {
  "out": "cubic-bezier(0.16, 1, 0.3, 1)",
  "in-out": "cubic-bezier(0.65, 0, 0.35, 1)"
};
export const duration = {
  "fast": "180ms",
  "med": "320ms",
  "slide": "520ms",
  "reveal": "700ms"
};
export const container = {
  "page": "1280px",
  "wide": "1440px",
  "measure": "720px"
};
export const breakpoint = {
  "phone": "600px",
  "stack": "720px",
  "nav": "900px"
};
export const zIndex = {
  "header": 100,
  "dropdown": 200,
  "overlay": 1000
};
export const mediaRatio = {
  "video": "16 / 9",
  "photo": "4 / 3",
  "portrait": "4 / 5",
  "square": "1 / 1"
};
export const ui = {
  "touch-target": "44px",
  "link-underline-offset": "3px"
};
