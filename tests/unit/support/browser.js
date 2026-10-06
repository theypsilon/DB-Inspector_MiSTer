import { STATUS_CODES } from 'node:http';

// A browser for the app model under Node: an address bar with history (back and forward fire
// popstate, and so does a new # typed in the address bar; pages loaded are recorded), timers on a
// clock the test moves, and fetch answered from routes. Routes map a URL to
// { status, body, contentType } (or are a function from URL to that), or to a promise of it, which
// holds the response back until the test settles it; a body that is not a string or bytes is sent
// as JSON. Unknown URLs fail as a blocked request would. Requests ({ url, init }) are recorded in
// order.

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
  const pageLoads = [];
  const current = () => entries[index];

  function firePopState() {
    for (const listener of listeners.get('popstate') ?? []) {
      listener({ type: 'popstate' });
    }
  }

  function go(delta) {
    const next = index + delta;
    if (next < 0 || next >= entries.length) {
      return;
    }

    index = next;
    firePopState();
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
      // Loads a page, recorded in `pageLoads`: in a new history entry, unless it is the address
      // shown. The model stays, where a browser would start the page afresh.
      assign(url) {
        const next = new URL(String(url), current());
        pageLoads.push(next.href);
        if (next.href === current().href) {
          return;
        }

        entries.splice(index + 1, entries.length, next);
        index += 1;
      },
    },
    // The pages loaded with location.assign.
    pageLoads,
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
    // The address bar: another # of the same page opens in it, in a new history entry.
    navigate(url) {
      const next = new URL(String(url), current());
      if (next.origin + next.pathname + next.search !== current().origin + current().pathname + current().search) {
        throw new Error(`Only another # of the same page opens without loading it again: ${next.href}`);
      }

      entries.splice(index + 1, entries.length, next);
      index += 1;
      firePopState();
    },
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

function createFetch(routes, requests) {
  return async (input, init) => {
    requests.push({ url: String(input), init });
    // Responses arrive in a later task, as they do from the network.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const url = String(input);
    let route = typeof routes === 'function' ? routes(url) : routes[url];
    // A route that is a promise answers once the test settles it.
    if (typeof route?.then === 'function') {
      route = await route;
    }
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
  const requests = [];
  globalThis.window = window;
  globalThis.history = window.history;
  globalThis.fetch = createFetch(routes, requests);
  return {
    window,
    clock,
    routes,
    requests,
    restore() {
      globalThis.window = previous.window;
      globalThis.history = previous.history;
      globalThis.fetch = previous.fetch;
    },
  };
}
