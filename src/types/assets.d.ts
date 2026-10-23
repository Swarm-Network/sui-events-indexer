/** Static project templates are imported as text (`with { type: 'text' }`) and bundled into the CLI. */
declare module '*.tpl' {
  const content: string;
  export default content;
}
