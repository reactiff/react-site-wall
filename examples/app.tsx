import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SiteWall, installSiteWallBridge, createStylesheetClient, createPromptClient, type RouteManifest } from '../src/index.js';
import manifest from './page-routes.json';
import '../src/styles.css';

type Session = { user: string; cart: number };
let session: Session = { user: '', cart: 0 };
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach(fn => fn());
const sharedState = {
  read: () => session,
  apply: (value: unknown) => { session = value as Session; notify(); },
  subscribe: (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; },
};
installSiteWallBridge({ enabled: true, sharedState });
function navigate(path: string) { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }
function Application() {
  const [path, setPath] = useState(location.pathname);
  const [, redraw] = useState(0);
  const [name, setName] = useState('');
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener('popstate', update);
    const unsubscribe = sharedState.subscribe(() => redraw(value => value + 1));
    return () => { window.removeEventListener('popstate', update); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (path === '/redirect') navigate('/shop');
    const observer = new IntersectionObserver(entries => entries.forEach(entry => entry.target.classList.toggle('visible', entry.isIntersecting)));
    document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [path]);
  return <><nav><a href="/">Home</a><a href="/shop">Shop</a><a href="/story">Story</a><a href="/login">Login</a><a href="/account">Account</a></nav><main>
    <div className="stats">User: <b data-testid="user">{session.user || 'Guest'}</b> · Cart: <b data-testid="cart">{session.cart}</b></div>
    {path === '/' ? <div className="hero"><p>FIELD NOTES / 01</p><h1>A small collection.<br />A whole world.</h1><p>Explore a live application across its routes.</p><a href="/shop" data-testid="browse">Browse the collection →</a><p><a href="/shop" data-testid="add-and-browse" onClick={() => { session = { ...session, cart: session.cart + 1 }; notify(); }}>Add a sample and visit the shop</a></p></div> : null}
    {path === '/shop' ? <><h1>The collection</h1><p>Useful objects for everyday adventures.</p><button data-testid="add" onClick={() => { session = { ...session, cart: session.cart + 1 }; notify(); }}>Add to cart</button><button onClick={() => navigate('/checkout')}>Checkout</button></> : null}
    {path === '/story' ? <><div className="hero"><h1>Stories in motion</h1><p>The viewport stays real as you travel through this page.</p></div>{[1,2,3].map(i => <section key={i} className="chapter scroll-reveal"><h2>Chapter {i}</h2><p>Observe the rhythm, sticky navigation, and progressive sections.</p></section>)}</> : null}
    {path === '/login' ? <><h1>Welcome back</h1><label>Name<input name="username" value={name} onChange={e => setName(e.target.value)} /></label><button data-testid="login" onClick={() => { session = { ...session, user: name }; notify(); navigate('/account'); }}>Sign in</button></> : null}
    {path === '/account' ? <><h1>Your account</h1><p>Hello {session.user || 'Guest'}.</p><button data-testid="logout" onClick={() => { session = { ...session, user: '' }; notify(); navigate('/login'); }}>Sign out</button></> : null}
    {path === '/checkout' ? <><h1>Checkout</h1><button onClick={() => { session = { ...session, cart: 0 }; notify(); location.assign('/thanks'); }}>Complete purchase</button></> : null}
    {path === '/thanks' ? <><h1>Thank you</h1><p>Your next adventure is on its way.</p></> : null}
  </main></>;
}
const styles = createStylesheetClient({ token: (window as Window & { demoToken: string }).demoToken });
const prompts = createPromptClient({ token: (window as Window & { demoToken: string }).demoToken });
createRoot(document.getElementById('root')!).render(location.pathname === '/disabled' ? <SiteWall enabled={false} manifest={manifest as RouteManifest} /> : location.pathname === '/sitewall' ? <SiteWall enabled manifest={manifest as RouteManifest} styles={styles} prompts={prompts} /> : <Application />);
