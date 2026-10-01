"""Actual terminal process against the integration test's real cmsg Door."""
import errno
import fcntl
import json
import os
import pty
import select
import struct
import subprocess
import sys
import termios
import time

binary, mode, *args = sys.argv[1:]
fd = int(args[args.index('--capability-fd') + 1])
commands = json.loads(subprocess.check_output([binary, 'api']))['commands']
status_index = next(i for i, action in enumerate(commands) if action['action'] == 'runtime.status')
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 160, 0, 0))
before = termios.tcgetattr(slave)
child = subprocess.Popen([binary, *args], stdin=slave, stdout=slave if mode == 'terminal-test' else subprocess.PIPE, stderr=subprocess.PIPE, pass_fds=(fd,))
if mode == 'terminal-output-test':
    output, errors = child.communicate(timeout=12)
    assert child.returncode == 69, child.returncode
    assert output == b''
    assert errors
    assert termios.tcgetattr(slave) == before
    os.close(master)
    os.close(slave)
    sys.exit(0)
os.close(fd)
captured = bytearray()

def until(marker):
    deadline = time.monotonic() + 12
    while marker not in captured:
        assert time.monotonic() < deadline, 'terminal deadline'
        assert child.poll() is None, 'terminal exited early'
        if select.select([master], [], [], 0.1)[0]:
            captured.extend(os.read(master, 65536))

try:
    until(b'invoked')
    os.write(master, b'\x1b[B' * status_index + b'\r')
    until(b'unavailable')
    os.write(master, b'\x15{bad}\r')
    until(b'invalid_request')
    os.write(master, b'\x1b')
    child.wait(timeout=12)
    assert child.returncode == 64, child.returncode
    assert child.stderr.read() == b''
    assert termios.tcgetattr(slave) == before, 'terminal mode not restored'
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
    os.close(slave)
