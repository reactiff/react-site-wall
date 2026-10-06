import { defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
const palette: Record<string, string> = { '#708': '#c586c0', '#219': '#569cd6', '#164': '#b5cea8', '#a11': '#ce9178', '#00c': '#9cdcfe', '#05a': '#dcdcaa', '#085': '#4ec9b0', '#a50': '#d7ba7d', '#940': '#d4d4d4', '#f00': '#f48771' };
export const darkHighlightStyle = HighlightStyle.define(defaultHighlightStyle.specs.map(spec => typeof spec.color === 'string' ? { ...spec, color: palette[spec.color] ?? '#d4d4d4' } : spec));
