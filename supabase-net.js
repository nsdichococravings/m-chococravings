// NSDI ChocoCravings — network safety for Supabase calls.
//
// Browsers give a request no time limit. On a weak shop connection, or
// right after the phone switches between Wi-Fi and mobile data, a request
// can hang for minutes before the operating system gives up. While a login
// token refresh hangs like that, every other database call waits behind it,
// which is the "app stuck, then works again after a few minutes" problem.
//
// ccFetch gives each request a time limit so the app shows an error and
// can recover instead of hanging. A timed-out request is NOT sent again
// automatically: when the server is overloaded, resending slow requests
// only adds load (the abandoned request keeps running on the server).
// Pass it to createClient through ccClientOptions():
//   supabase.createClient(URL, KEY, ccClientOptions({ auth: {...} }))
(function () {
  var LIMIT_AUTH = 20000;      // login / token refresh
  var LIMIT_READ = 30000;      // database reads
  var LIMIT_WRITE = 30000;     // database writes
  var LIMIT_FUNCTIONS = 45000; // edge functions (push, email)
  var LIMIT_STORAGE = 120000;  // photo uploads

  function limitFor(url, method) {
    if (url.indexOf('/auth/v1/') !== -1) return LIMIT_AUTH;
    if (url.indexOf('/storage/v1/') !== -1) return LIMIT_STORAGE;
    if (url.indexOf('/functions/v1/') !== -1) return LIMIT_FUNCTIONS;
    return method === 'GET' || method === 'HEAD' ? LIMIT_READ : LIMIT_WRITE;
  }

  function ccFetch(input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    var callerSignal = init.signal;

    var controller = new AbortController();
    var timedOut = false;
    var onCallerAbort = function () { controller.abort(); };
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener('abort', onCallerAbort);
    }
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, limitFor(url, method));
    function cleanup() {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    }
    return fetch(input, Object.assign({}, init, { signal: controller.signal })).then(
      function (response) { cleanup(); return response; },
      function (error) {
        cleanup();
        // The caller cancelled on purpose: pass that through untouched.
        if (callerSignal && callerSignal.aborted) throw error;
        if (timedOut) {
          // Named AbortError so the Supabase library does not resend it.
          // A timed-out write may also have reached the server, and
          // repeating it could save an order twice.
          error = new Error('Connection is slow. Please check the internet and try again.');
          error.name = 'AbortError';
          error.ccTimeout = true;
        }
        throw error;
      }
    );
  }

  function ccClientOptions(options) {
    options = options || {};
    options.global = Object.assign({}, options.global, { fetch: ccFetch });
    return options;
  }

  window.ccFetch = ccFetch;
  window.ccClientOptions = ccClientOptions;
})();
