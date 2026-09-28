#!/usr/bin/env python3
"""Set the password for organizer.html.

Prompts for the password without showing it, then writes assets/organizer-lock.js
with a random salt and a PBKDF2-SHA256 hash. The password itself is never saved.
Commit and push assets/organizer-lock.js to change the live password.

The hash is public because the repository is public, so this only keeps casual
visitors out. Use a password that is not used anywhere else.

Usage:
  python tools/set_organizer_password.py
  python tools/set_organizer_password.py --show   # visible typing, for terminals where hidden input does not work
"""

import getpass
import hashlib
import json
import os
import secrets
import sys

ITERATIONS = 210000
MIN_LENGTH = 10
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'organizer-lock.js')


def lock_config(password, salt, iterations=ITERATIONS):
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return {'salt': salt.hex(), 'iterations': iterations, 'hash': digest.hex()}


def main():
    ask = input if '--show' in sys.argv[1:] else getpass.getpass
    password = ask('New organizer password: ')
    if len(password) < MIN_LENGTH:
        sys.exit('Use at least %d characters.' % MIN_LENGTH)
    if ask('Type it again: ') != password:
        sys.exit('The passwords do not match. Nothing was changed.')
    config = lock_config(password, secrets.token_bytes(16))
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* Organizer page lock. Written by tools/set_organizer_password.py.\n'
                '   Holds a salted PBKDF2-SHA256 hash, not the password. */\n')
        f.write('window.TSCC_ORGANIZER_LOCK = ' + json.dumps(config) + ';\n')
    print('Saved assets/organizer-lock.js. Commit and push it to change the live password.')


if __name__ == '__main__':
    main()
