/* TSCC HPDE Scheduler: password screen for organizer.html.
   Checks the password against the salted PBKDF2 hash in assets/organizer-lock.js,
   then loads assets/organizer.js. Nothing else on the page runs until then.
   An unlocked device is remembered until someone taps "Lock this device" or the
   password changes. This keeps casual visitors out. It is not real security:
   the hash is public, and publishing still needs GitHub write access. */
(function () {
  'use strict';

  var T = window.TSCC;
  var UNLOCK_KEY = 'tscc-hpde-organizer-unlock';
  var lock = window.TSCC_ORGANIZER_LOCK;
  function $(id) { return document.getElementById(id); }

  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function unhex(s) {
    var out = new Uint8Array(s.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  function derive(password) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(lock.salt), iterations: lock.iterations, hash: 'SHA-256' }, key, 256);
    }).then(hex);
  }

  function unlock() {
    document.body.classList.remove('locked');
    $('gate').hidden = true;
    var s = document.createElement('script');
    s.src = 'assets/organizer.js';
    document.body.appendChild(s);
  }

  function fail(msg) {
    $('gateError').textContent = msg;
    $('gateError').hidden = false;
  }

  $('lockDevice').addEventListener('click', function () {
    T.store.remove(UNLOCK_KEY);
    window.location.reload();
  });

  if (!lock || !lock.hash || !lock.salt) {
    $('gateForm').hidden = true;
    fail('No organizer password is set. Run tools/set_organizer_password.py and publish assets/organizer-lock.js.');
    return;
  }
  if (T.store.get(UNLOCK_KEY) === lock.hash) { unlock(); return; }
  if (!window.crypto || !crypto.subtle) {
    $('gateForm').hidden = true;
    fail('This browser cannot check the password here. Open the page from its https address.');
    return;
  }

  $('gateForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('gateSubmit');
    btn.disabled = true;
    $('gateError').hidden = true;
    derive($('gatePassword').value).then(function (h) {
      btn.disabled = false;
      if (h !== lock.hash) {
        fail('That password is not right.');
        $('gatePassword').select();
        return;
      }
      if ($('gateRemember').checked) T.store.set(UNLOCK_KEY, lock.hash);
      $('gatePassword').value = '';
      unlock();
    }, function () {
      btn.disabled = false;
      fail('The password check did not run. Reload the page and try again.');
    });
  });
  $('gatePassword').focus();
})();
