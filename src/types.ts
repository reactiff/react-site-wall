export interface PageRoute {
  id: string;
  title: string;
  path: string;
  pattern?: string;
  params?: Record<string, string>;
  group?: string;
  included?: boolean;
  metadata?: Record<string, unknown>;
}
export interface RouteManifest { version: 1; routes: PageRoute[] }
export interface StylesManifest { version: 1; styles: string[] }
export interface Viewport { width: number; height: number; name?: string }
export const devices: Viewport[] = [
  { name: 'iPhone 14 Pro (Safari)', width: 393, height: 659 },
  { name: 'Tablet', width: 820, height: 1180 },
  { name: 'Laptop', width: 1366, height: 768 },
  { name: 'Desktop', width: 1920, height: 1080 },
];
export interface WallState {
  autoCenter: boolean;
  styleFilter: string;
  selectionMode: 'none' | 'element' | 'region';
  selection: ContextSelection | null;
  routes: PageRoute[];
  visible: string[];
  focused: string | null;
  currentRoute: string;
  layout: 'viewport' | 'overview';
  viewport: Viewport;
  zoom: number;
  pan: { x: number; y: number };
  columns: number;
  leftOpen: boolean;
  rightOpen: boolean;
  stylesWidth: number;
}
export interface WallEvent {
  sequence: number;
  type: string;
  time: number;
  detail: unknown;
}
/** The application owns serialization, hydration, and invalidation of its shared store. */
export interface SharedStateAdapter {
  read(): unknown;
  apply(state: unknown): void | Promise<void>;
  subscribe(notify: () => void): () => void;
}
export interface Stylesheet { id: string; content: string; revision: string }
export interface StylesheetAdapter {
  list(): Promise<string[]>;
  read(id: string): Promise<Stylesheet>;
  save(file: Stylesheet): Promise<Stylesheet>;
}
export interface PageObservation {
  panelId?: string;
  assignedRoute?: string;
  available?: boolean;
  route: string;
  title: string;
  text: string;
  controls: { tag: string; text: string; name: string; type: string; value?: string; checked?: boolean }[];
  historyState?: unknown;
  viewport: Viewport;
  scroll: { x: number; y: number; height: number };
}
export interface SiteWallAPI {
  getState(): WallState;
  events(since?: number): WallEvent[];
  subscribe(listener: (event: WallEvent) => void): () => void;
  show(id: string, visible: boolean): void;
  focus(id: string): Promise<void>;
  navigate(path: string): Promise<void>;
  configure(patch: Partial<Pick<WallState, 'layout' | 'viewport' | 'zoom' | 'pan' | 'columns' | 'leftOpen' | 'rightOpen' | 'autoCenter' | 'stylesWidth'>>): void;
  zoomAt(zoom: number, origin: { x: number; y: number }): void;
  filterStyles(query: string): void;
  inspectStyles(id?: string, selector?: string): Promise<import('./style-context.js').StyleContext>;
  setSelectionMode(mode: WallState['selectionMode']): void;
  selectElement(selector: string, id?: string): Promise<ContextSelection>;
  selectRegion(rectangle: SelectionRectangle, id?: string): Promise<ContextSelection>;
  clearSelection(): void;
  inspectSelection(): ContextSelection | null;
  promptContext(): Promise<PromptContext>;
  executePrompt(instruction: string): Promise<PromptResult>;
  stopPrompt(): Promise<void>;
  inspect(id?: string): Promise<PageObservation>;
  click(selector: string): Promise<void>;
  type(selector: string, value: string): Promise<void>;
  scroll(x: number, y: number): Promise<void>;
  capture(id?: string): Promise<string[]>;
  /** Stitched PNG data URL for a panel id or manifest route path. */
  captureFullPage(route?: string): Promise<string>;
  /** Stitched PNG for each currently visible panel; unchecked panels are excluded. */
  captureAllPages(): Promise<PageCapture[]>;
  saveAllPages(outputDir: string): Promise<SavedPageCapture[]>;
  styles: StylesheetAdapter;
}
declare global { interface Window { sitewall?: SiteWallAPI; sitewallReady?: Promise<unknown> | (() => unknown | Promise<unknown>) } }
export interface SelectionRectangle { x: number; y: number; width: number; height: number }
export interface ContextSelection {
  kind: 'element' | 'region'; panelId: string; route: string;
  rectangle: SelectionRectangle; viewport: Viewport;
  scroll: { x: number; y: number }; capturedAt: number;
  element?: { selector: string; tag: string; text: string; html: string; attributes: Record<string, string>; ancestors: string[] };
  surroundingElements: { selector: string; tag: string; text: string }[];
  applicationState: unknown;
}
export interface PromptContext {
  version: 1; wallUrl: string; capturedAt: number; wall: WallState;
  selection: ContextSelection | null; page: PageObservation;
  applicationState: unknown; history: WallEvent[];
  styles: import('./style-context.js').StyleContext;
}
export interface PromptResult { status: 'completed' | 'failed'; output: string; exitCode: number | null }
export interface PageCapture { id: string; route: string; image: string }
export interface SavedPageCapture { id: string; route: string; path: string }
export interface CapturePersistenceAdapter { saveCaptures(outputDir: string, captures: PageCapture[]): Promise<SavedPageCapture[]> }
export interface PromptAdapter extends Partial<CapturePersistenceAdapter> {
  execute(instruction: string, context: PromptContext, options?: { signal?: AbortSignal }): Promise<PromptResult>;
  cancel?(): Promise<void>;
  /** Connect an authenticated agent transport to this exact human session. */
  attach?(api: SiteWallAPI): () => void;
}
