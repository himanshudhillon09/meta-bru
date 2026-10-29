export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'meta-bru:theme';

/**
 * Runs in <head> before the first paint so a saved dark theme never flashes
 * light. Light is the default for everyone who has not chosen.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

const listeners = new Set<() => void>();

export function currentTheme(): Theme {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

let switchTimer: ReturnType<typeof setTimeout> | undefined;

export function setTheme(theme: Theme): void {
    // Fade colours between themes instead of snapping (see globals.css).
    const root = document.documentElement;
    root.classList.add('theme-switching');
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => root.classList.remove('theme-switching'), 350);

    root.setAttribute('data-theme', theme);
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // Private mode or blocked storage: the theme still applies for this visit.
    }
    listeners.forEach((listener) => listener());
}

export function subscribeTheme(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
