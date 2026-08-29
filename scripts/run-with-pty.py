#!/usr/bin/env python3
import os
import pty
import signal
import subprocess
import sys


def main() -> int:
    if len(sys.argv) < 3:
      print("usage: run-with-pty.py LOG_PATH COMMAND [ARG ...]", file=sys.stderr)
      return 2

    log_path = sys.argv[1]
    command = sys.argv[2:]

    master_fd, slave_fd = pty.openpty()
    child = subprocess.Popen(
      command,
      stdin=slave_fd,
      stdout=slave_fd,
      stderr=slave_fd,
      close_fds=True,
      text=False,
    )
    os.close(slave_fd)

    def forward(signal_number, _frame) -> None:
      if child.poll() is None:
        child.send_signal(signal_number)

    signal.signal(signal.SIGTERM, forward)
    signal.signal(signal.SIGINT, forward)

    with open(log_path, "ab", buffering=0) as log_file:
      try:
        while True:
          try:
            chunk = os.read(master_fd, 4096)
          except OSError:
            chunk = b""

          if chunk:
            log_file.write(chunk)

          if not chunk and child.poll() is not None:
            break
      finally:
        os.close(master_fd)

    return child.wait()


if __name__ == "__main__":
    raise SystemExit(main())
