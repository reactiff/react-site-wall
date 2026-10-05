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
export interface Viewport { width: number; height: number; name?: string }
export const devices: Viewport[] = [
  { name: 'Phone', width: 390, height: 844 },
  { name: 'Tablet', width: 820, height: 1180 },
  { name: 'Laptop', width: 1366, height: 768 },
  { name: 'Desktop', width: 1920, height: 1080 },
];
export interface WallState {
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
  controls: { tag: string; text: string; name: string; type: string }[];
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
  configure(patch: Partial<Pick<WallState, 'layout' | 'viewport' | 'zoom' | 'pan' | 'columns' | 'leftOpen' | 'rightOpen'>>): void;
  inspect(id?: string): Promise<PageObservation>;
  click(selector: string): Promise<void>;
  type(selector: string, value: string): Promise<void>;
  scroll(x: number, y: number): Promise<void>;
  capture(id?: string): Promise<string[]>;
  styles: StylesheetAdapter;
}
declare global { interface Window { sitewall?: SiteWallAPI } }
