/**
 * The page an app sends a person to when it wants to act as them.
 *
 * The instance manifest promises this URL, and the provider is the only thing
 * that can keep the promise: an instance with no Sloppy app in front of it
 * still has to be able to authorise a delegation, and in local-only mode there
 * is no other surface to point at.
 */

import { DEFAULT_SCOPES } from "@sloppy/idp";
import type { SyrScope } from "@sloppy/types";

/** A scope is a wire value; a person reads what it lets the app do. */
const SCOPE_WORDS: Record<SyrScope, string> = {
  "identity:read": "See who you are",
  "identity:verify": "Prove it is really you",
  "profile:read": "See your name and picture",
  "posts:read": "Read what you write",
  "posts:write": "Write in your name",
};

const STYLES = `
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 16px/1.55 system-ui, sans-serif; padding: 24px; }
  main { width: 100%; max-width: 22rem; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.35rem; }
  p { margin: 0 0 1.25rem; opacity: 0.7; }
  ul { margin: 0 0 1.5rem; padding-left: 1.1rem; }
  li { margin-bottom: 0.35rem; }
  label { display: block; font-size: 0.875rem; margin-bottom: 1rem; }
  input { display: block; width: 100%; box-sizing: border-box; margin-top: 0.35rem;
          padding: 0.7rem 0.85rem; border-radius: 0.6rem; font: inherit;
          border: 1px solid color-mix(in srgb, CanvasText 25%, transparent);
          background: Canvas; color: CanvasText; }
  button { width: 100%; padding: 0.75rem 1.5rem; border: 0; border-radius: 999px;
           font: inherit; font-weight: 600; cursor: pointer;
           background: CanvasText; color: Canvas; }
  button[disabled] { opacity: 0.55; cursor: default; }
  button.quiet { background: transparent; color: CanvasText; font-weight: 400;
                 margin-top: 0.5rem; text-decoration: underline; }
  .problem { margin: 0 0 1rem; opacity: 1; color: color-mix(in srgb, CanvasText 65%, red); }
`;

export function consentPage(apiBase: string): string {
  return `<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Connect an app</title>
<style>${STYLES}</style>
</head>
<body>
<main id="app"></main>
<script>
(function () {
  var API = ${JSON.stringify(apiBase)};
  var WORDS = ${JSON.stringify(SCOPE_WORDS)};
  var DEFAULTS = ${JSON.stringify(DEFAULT_SCOPES)};
  var MALFORMED = "That app's sign-in link is malformed. Ask its author to fix it.";

  var main = document.getElementById('app');
  var params = new URLSearchParams(location.search);
  var platformOrigin = params.get('platform_origin') || '';
  var callbackUrl = params.get('callback_url') || '';
  var state = params.get('state') || undefined;
  var scopes = (params.get('scopes') || DEFAULTS.join(','))
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var appName = params.get('platform_name') || hostOf(platformOrigin);
  var who = '';
  var token = '';
  var password = '';
  var request = null;

  function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  }

  function sameSite(a, b) {
    try {
      var one = new URL(a), two = new URL(b);
      return one.origin === two.origin && /^https?:$/.test(one.protocol);
    } catch (e) { return false; }
  }

  function el(tag, text) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  }

  function show(nodes) {
    main.replaceChildren.apply(main, nodes);
  }

  function problemLine(message) {
    var p = el('p', message);
    p.className = 'problem';
    return p;
  }

  function field(label, type, autocomplete) {
    var wrap = el('label', label);
    var input = document.createElement('input');
    input.type = type;
    input.autocomplete = autocomplete;
    input.required = true;
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  function post(path, body, bearer) {
    var headers = { 'content-type': 'application/json' };
    if (bearer) headers.authorization = 'Bearer ' + bearer;
    return fetch(API + path, {
      method: 'POST', headers: headers, body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (response.ok) return data;
        throw new Error(data.message || 'Something went wrong. Try again.');
      });
    });
  }

  function scopeList(granted) {
    var list = el('ul');
    granted.forEach(function (scope) {
      if (WORDS[scope]) list.appendChild(el('li', WORDS[scope]));
    });
    return list;
  }

  function signIn(problem) {
    var form = document.createElement('form');
    var name = field('Name', 'text', 'username');
    var secret = field('Password', 'password', 'current-password');
    var go = el('button', 'Continue');
    go.type = 'submit';

    var nodes = [
      el('h1', 'Sign in to continue'),
      el('p', appName + ' is waiting to connect to your account.'),
      scopeList(scopes),
      name.wrap,
      secret.wrap
    ];
    if (problem) nodes.push(problemLine(problem));
    nodes.push(go);
    form.append.apply(form, nodes);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      go.disabled = true;
      go.textContent = 'Signing in…';
      who = name.input.value;
      password = secret.input.value;
      post('/login', { username: who, password: password })
        .then(function (session) {
          token = session.access_token;
          return post('/consent', {
            platform_origin: platformOrigin,
            platform_name: params.get('platform_name') || undefined,
            callback_url: callbackUrl,
            scopes: scopes,
            state: state
          }, token);
        })
        .then(function (opened) { request = opened; review(); })
        .catch(function (error) { signIn(error.message); });
    });

    show([form]);
    name.input.focus();
  }

  function review(problem) {
    var connect = el('button', 'Connect');
    var notNow = el('button', 'Not now');
    notNow.className = 'quiet';

    function settle(button, path, body) {
      button.addEventListener('click', function () {
        connect.disabled = true;
        notNow.disabled = true;
        post('/consent/' + encodeURIComponent(request.challenge_id) + path, body, token)
          .then(function (outcome) { location.href = outcome.redirect_url; })
          .catch(function (error) { review(error.message); });
      });
    }
    settle(connect, '/approve', { password: password });
    settle(notNow, '/deny', {});

    var nodes = [
      el('h1', 'Connect ' + request.platform_name + '?'),
      el('p', 'Signed in as ' + who + '. It will be able to:'),
      scopeList(request.scopes)
    ];
    if (problem) nodes.push(problemLine(problem));
    nodes.push(connect, notNow);
    show(nodes);
  }

  if (!sameSite(platformOrigin, callbackUrl) ||
      scopes.some(function (scope) { return !WORDS[scope]; })) {
    show([el('h1', 'This link will not work'), el('p', MALFORMED)]);
    return;
  }
  signIn();
})();
</script>
</body>
</html>`;
}
