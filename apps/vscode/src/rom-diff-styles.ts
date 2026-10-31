/** Theme-native styles, embedded by the host under a nonce-based CSP. */
export const romDiffStyles = `
:root { color-scheme: light dark; }
body { margin:0; color:var(--vscode-foreground); background:var(--vscode-editor-background); font-family:var(--vscode-font-family); font-size:var(--vscode-font-size,13px); }
* { box-sizing:border-box; }
button,input { font:inherit; color:inherit; }
button { cursor:pointer; }
button:focus-visible,input:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:2px; }
::selection { background:var(--vscode-editor-selectionBackground); }
h1 { font-size:20px; margin:0 0 12px; font-weight:600; }
h2 { font-size:16px; margin:0 0 6px; }
h3 { font-size:13px; margin:0 0 8px; font-weight:600; }
p { margin:6px 0; line-height:1.5; }
.diff-header { padding:20px 24px 16px; border-bottom:1px solid var(--vscode-panel-border); }
.sources { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
.source { min-width:0; }
.source strong { display:block; margin-top:4px; overflow-wrap:anywhere; }
.source small { display:block; margin-top:4px; overflow-wrap:anywhere; color:var(--vscode-descriptionForeground); }
.source-label { color:var(--vscode-descriptionForeground); }
.notice { padding:10px 12px; margin-top:12px; background:var(--vscode-textBlockQuote-background); border:1px solid var(--vscode-panel-border); }
.diff-layout { display:grid; grid-template-columns:280px minmax(0,1fr); height:calc(100vh - 220px); min-height:350px; }
.table-nav { padding:16px 12px; overflow:auto; border-right:1px solid var(--vscode-panel-border); }
.search { width:100%; margin:6px 0 12px; padding:7px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border,transparent); border-radius:2px; }
.filter { display:flex; gap:7px; align-items:center; }
.table-count { color:var(--vscode-descriptionForeground); margin:12px 0 8px; }
.table-list { display:flex; flex-direction:column; gap:2px; }
.table-choice { text-align:left; border:0; background:transparent; padding:10px 8px; border-radius:2px; width:100%; overflow-wrap:anywhere; }
.table-choice:hover { background:var(--vscode-list-hoverBackground); }
.table-choice[aria-pressed="true"] { background:var(--vscode-list-activeSelectionBackground); color:var(--vscode-list-activeSelectionForeground); }
.table-choice span { display:block; margin-top:5px; font-size:12px; }
.table-detail { padding:20px 24px; overflow:auto; min-width:0; }
.table-meta { color:var(--vscode-descriptionForeground); margin-bottom:16px; }
.grids { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; margin-top:18px; }
.grid-section { min-width:0; }
.grid-scroll { overflow:auto; max-height:55vh; border:1px solid var(--vscode-panel-border); }
table { border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; font-family:var(--vscode-editor-font-family,monospace); font-size:12px; }
caption { text-align:left; padding:8px; font-family:var(--vscode-font-family); }
th,td { padding:7px 10px; text-align:right; border-bottom:1px solid var(--vscode-panel-border); white-space:nowrap; }
th { background:var(--vscode-editorGroupHeader-tabsBackground); position:sticky; top:0; font-weight:500; }
td.changed { background:var(--vscode-diffEditor-insertedTextBackground); outline:1px solid var(--vscode-diffEditor-insertedLineBackground); outline-offset:-1px; font-weight:700; }
.delta { margin-top:20px; }
.paging { display:flex; align-items:center; gap:12px; margin:16px 0; }
.paging button { background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); border:0; border-radius:2px; padding:6px 10px; }
.paging button:hover { background:var(--vscode-button-secondaryHoverBackground); }
.paging button:disabled { opacity:.5; cursor:default; }
.empty { padding:28px 0; color:var(--vscode-descriptionForeground); }
@media(max-width:850px) { .diff-layout { grid-template-columns:220px minmax(0,1fr); } .grids { grid-template-columns:1fr; } .diff-header,.table-detail { padding:16px; } }
@media(max-width:580px) { .sources { grid-template-columns:1fr; gap:12px; } .diff-layout { grid-template-columns:1fr; height:auto; } .table-nav { border-right:0; border-bottom:1px solid var(--vscode-panel-border); max-height:270px; } }
`;
