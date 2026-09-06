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
  "posts:write": "Write in your name, and change your name, pictures and files",
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
  label span { opacity: 0.55; font-weight: 400; }
  small { display: block; margin-top: 0.35rem; opacity: 0.6; line-height: 1.4; }
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
  var SEEN_HERE = 'sloppy.idp.signed-in-here';

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

  function signedInHere() {
    try { return localStorage.getItem(SEEN_HERE) === 'yes'; } catch (e) { return false; }
  }

  function rememberThisDevice() {
    try { localStorage.setItem(SEEN_HERE, 'yes'); } catch (e) {}
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
    p.setAttribute('role', 'alert');
    return p;
  }

  function field(label, type, autocomplete, opts) {
    var options = opts || {};
    var wrap = el('label', label);
    var input = document.createElement('input');
    input.type = type;
    input.autocomplete = autocomplete;
    input.required = !options.optional;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.minlength) input.minLength = options.minlength;
    if (options.value) input.value = options.value;
    if (options.optional) wrap.appendChild(el('span', ' (optional)'));
    wrap.appendChild(input);
    if (options.hint) wrap.appendChild(el('small', options.hint));
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

  /** Both doors lead here: a grant, then the app's request, then the review. */
  function entered(session) {
    rememberThisDevice();
    token = session.access_token;
    return post('/consent', {
      platform_origin: platformOrigin,
      platform_name: params.get('platform_name') || undefined,
      callback_url: callbackUrl,
      scopes: scopes,
      state: state
    }, token).then(function (opened) { request = opened; review(); });
  }

  function elsewhere(text, go) {
    var link = el('button', text);
    link.type = 'button';
    link.className = 'quiet';
    link.addEventListener('click', go);
    return link;
  }

  function door(mode, problem, kept) {
    var making = mode === 'make';
    var typed = kept || {};
    var form = document.createElement('form');

    var name = field('Username', 'text', 'username', {
      placeholder: 'alice',
      value: typed.username,
      hint: making
        ? '3\u201332 characters: lowercase letters, numbers, dashes and underscores. This is the handle a peer resolves.'
        : undefined
    });
    var shown = making
      ? field('Display name', 'text', 'name', {
          placeholder: 'Alice',
          optional: true,
          value: typed.displayName,
          hint: 'What people see. You can change it later.'
        })
      : null;
    var secret = field('Password', 'password', making ? 'new-password' : 'current-password', {
      placeholder: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022',
      minlength: making ? 12 : undefined,
      value: typed.password,
      hint: making ? 'At least 12 characters.' : undefined
    });
    var again = making
      ? field('Confirm password', 'password', 'new-password', {
          placeholder: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'
        })
      : null;

    var go = el('button', making ? 'Create and connect' : 'Continue');
    go.type = 'submit';

    var nodes = [
      el('h1', making ? 'Create an identity' : 'Sign in to continue'),
      el('p', making
        ? appName + ' is waiting to connect. Make an identity here and it stays yours to take elsewhere.'
        : appName + ' is waiting to connect to your account.'),
      scopeList(scopes),
      name.wrap
    ];
    if (shown) nodes.push(shown.wrap);
    nodes.push(secret.wrap);
    if (again) nodes.push(again.wrap);
    if (problem) nodes.push(problemLine(problem));
    nodes.push(go);
    form.append.apply(form, nodes);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var sofar = { username: name.input.value };
      if (shown) sofar.displayName = shown.input.value;
      if (again && secret.input.value !== again.input.value) {
        sofar.password = secret.input.value;
        door(mode, 'Those passwords are different. Type the second one again.', sofar);
        return;
      }
      go.disabled = true;
      go.textContent = making ? 'Creating\u2026' : 'Signing in\u2026';
      who = name.input.value;
      password = secret.input.value;
      var body = { username: who, password: password };
      if (shown && shown.input.value.trim()) body.display_name = shown.input.value.trim();
      post(making ? '/register' : '/login', body)
        .then(entered)
        .catch(function (error) { door(mode, error.message, sofar); });
    });

    show([form, elsewhere(
      making ? 'I already have an identity' : 'Create an identity here',
      function () { door(making ? 'have' : 'make', undefined, { username: name.input.value }); }
    )]);

    var inputs = [name.input];
    if (shown) inputs.push(shown.input);
    inputs.push(secret.input);
    if (again) inputs.push(again.input);
    var waiting = inputs.filter(function (input) { return input.required && !input.value; })[0];
    (waiting || inputs[0]).focus();
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
      el('p', 'Signed in as ' + (request.display_name || who) + '. It will be able to:'),
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
  door(signedInHere() ? 'have' : 'make');
})();
</script>
</body>
</html>`;
}
