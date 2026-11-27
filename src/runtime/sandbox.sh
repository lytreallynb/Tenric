#!/bin/sh
# Builds the filesystem view of a Tenric sandbox and runs a command in it.
#
# Started by src/runtime/sandbox.ts inside fresh user, mount and PID namespaces
# (and a network namespace with no interfaces when network is off), as root of
# that user namespace. It never runs on the host's own namespaces.
#
#   sandbox.sh [--ro PATH]... [--rw PATH]... --cwd DIR -- COMMAND [ARG]...
#
# The new root is an empty tmpfs. Into it go: the system directories read-only,
# each --ro path read-only and each --rw path writable, at their own absolute
# paths, a private /tmp, /dev/shm and /proc, and a handful of device nodes.
# Nothing else from the host is visible. The command then runs in a nested
# user namespace as an unprivileged user with no_new_privs, which locks every
# mount above: it cannot remount a read-only path writable or unmount one to
# see what lies beneath.
set -eu

RO=""
RW=""
CWD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ro) RO="$RO
$2"; shift 2 ;;
    --rw) RW="$RW
$2"; shift 2 ;;
    --cwd) CWD=$2; shift 2 ;;
    --) shift; break ;;
    *) echo "sandbox.sh: unknown argument $1" >&2; exit 125 ;;
  esac
done
[ -n "$CWD" ] && [ $# -gt 0 ] || { echo "sandbox.sh: usage: [--ro P]... [--rw P]... --cwd DIR -- COMMAND..." >&2; exit 125; }

R=$(mktemp -d /tmp/tenric-sandbox-root.XXXXXX)
mount -t tmpfs -o mode=0755 tenric-root "$R"
mkdir -p "$R/tmp" && mount -t tmpfs -o mode=1777 tenric-tmp "$R/tmp"

place() { # place SRC MODE: bind SRC at the same path in the new root
  src=$1
  [ -e "$src" ] || return 0
  if [ -d "$src" ]; then mkdir -p "$R$src"; else mkdir -p "$R$(dirname "$src")"; [ -e "$R$src" ] || : > "$R$src"; fi
  mount --rbind "$src" "$R$src"
  if [ "$2" = ro ]; then mount -o remount,bind,ro "$R$src"; fi
}

for d in /usr /bin /sbin /lib /lib32 /lib64 /libx32 /etc; do
  if [ -L "$d" ]; then ln -s "$(readlink "$d")" "$R$d"; else place "$d" ro; fi
done
IFS_SAVED=$IFS
IFS='
'
for p in $RO; do [ -n "$p" ] && place "$p" ro; done
for p in $RW; do [ -n "$p" ] && place "$p" rw; done
IFS=$IFS_SAVED

mkdir -p "$R/dev" "$R/proc" "$R/dev/shm"
for n in null zero full random urandom tty; do
  [ -e "/dev/$n" ] || continue
  : > "$R/dev/$n"
  mount --bind "/dev/$n" "$R/dev/$n"
done
mount -t tmpfs -o mode=1777 tenric-shm "$R/dev/shm"
mount -t proc proc "$R/proc"

cd "$R"
mkdir .old-root
pivot_root . .old-root
umount -l /.old-root
rmdir /.old-root

export HOME=/tmp/home TMPDIR=/tmp XDG_CACHE_HOME=/tmp/home/.cache UV_CACHE_DIR=/tmp/home/.cache/uv
mkdir -p "$HOME" "$XDG_CACHE_HOME"
cd "$CWD"
exec unshare --user --mount --map-user=1000 --map-group=1000 -- setpriv --no-new-privs -- "$@"
