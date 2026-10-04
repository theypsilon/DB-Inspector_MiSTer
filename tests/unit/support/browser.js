import { STATUS_CODES } from 'node:http';

// A browser for the app model under Node: an address bar with history (back and forward fire
// popstate), timers on a clock the test moves, and fetch answered from routes. Routes map a URL to
// { status, body, contentType } (or are a function from URL to that); a body that is not a string or
// bytes is sent as JSON. Unknown URLs fail as a blocked request would.

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function nextDue(until) {
    let due = null;
    for (const [id, timer] of timers) {
      if (timer.at <= until && (!due || timer.at < due.timer.at || (timer.at === due.timer.at && id < due.id))) {
        due = { id, timer };
      }
    }
    return due;
  }

  return {
    setTimeout(callback, delay = 0) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + Math.max(0, Number(delay) || 0), callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    // Runs the timers that are due now, and those they start for now. Returns how many ran.
    runDue() {
      let ran = 0;
      for (let due = nextDue(now); due; due = nextDue(now)) {
        timers.delete(due.id);
        due.timer.callback();
        ran += 1;
      }
      return ran;
    },
    advance(ms) {
      const until = now + ms;
      for (let due = nextDue(until); due; due = nextDue(until)) {
        timers.delete(due.id);
        now = due.timer.at;
        due.timer.callback();
      }
      now = until;
    },
  };
}

function createWindow(href, clock) {
  const entries = [new URL(href)];
  let index = 0;
  const listeners = new Map();
  const current = () => entries[index];

  function go(delta) {
    const next = index + delta;
    if (next < 0 || next >= entries.length) {
      return;
    }

    index = next;
    for (const listener of listeners.get('popstate') ?? []) {
      listener({ type: 'popstate' });
    }
  }

  return {
    location: {
      get href() {
        return current().href;
      },
      get search() {
        return current().search;
      },
      get hash() {
        return current().hash;
      },
      get pathname() {
        return current().pathname;
      },
      get origin() {
        return current().origin;
      },
    },
    history: {
      get length() {
        return entries.length;
      },
      pushState(state, title, url) {
        entries.splice(index + 1, entries.length, new URL(String(url), current()));
        index += 1;
      },
      replaceState(state, title, url) {
        if (url != null) {
          entries[index] = new URL(String(url), current());
        }
      },
      back() {
        go(-1);
      },
      forward() {
        go(1);
      },
    },
    setTimeout: (callback, delay) => clock.setTimeout(callback, delay),
    clearTimeout: (id) => clock.clearTimeout(id),
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
}

function createFetch(routes) {
  return async (input) => {
    // Responses arrive in a later task, as they do from the network.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const url = String(input);
    const route = typeof routes === 'function' ? routes(url) : routes[url];
    if (!route) {
      throw new TypeError('Failed to fetch');
    }

    const { status = 200, body = '', contentType = 'application/json' } = typeof route === 'function' ? route(url) : route;
    const payload = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
    return new Response(payload, { status, statusText: STATUS_CODES[status] ?? '', headers: { 'content-type': contentType } });
  };
}

// Installs the browser as the global `window`, `history` and `fetch`; `restore()` puts the previous
// ones back.
export function installBrowser(href, { routes = {} } = {}) {
  const clock = createClock();
  const window = createWindow(href, clock);
  const previous = { window: globalThis.window, history: globalThis.history, fetch: globalThis.fetch };
  globalThis.window = window;
  globalThis.history = window.history;
  globalThis.fetch = createFetch(routes);
  return {
    window,
    clock,
    routes,
    restore() {
      globalThis.window = previous.window;
      globalThis.history = previous.history;
      globalThis.fetch = previous.fetch;
    },
  };
}
