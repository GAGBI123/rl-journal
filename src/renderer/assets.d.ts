// Files the renderer imports through Vite.
declare module '*.svg' {
  const url: string;
  export default url;
}

declare module '@fontsource-variable/*';
