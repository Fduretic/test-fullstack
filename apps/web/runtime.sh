#!/bin/sh
set -eu
prefix="${APP_BASE_PATH:-/}"
case "$prefix" in
  /) base=/; route='' ;;
  /*) route="${prefix%/}"; base="$route/" ;;
  *) echo 'APP_BASE_PATH must start with /' >&2; exit 1 ;;
esac
if ! printf '%s' "$base" | grep -Eq '^/([A-Za-z0-9_-]+/)*$'; then
  echo 'APP_BASE_PATH may contain only URL path segments with letters, numbers, underscores and hyphens.' >&2
  exit 1
fi
sed "s|<base href=\"/\">|<base href=\"$base\">|" /opt/index.template.html > /usr/share/nginx/html/index.html
if [ -n "$route" ]; then
  printf 'rewrite ^%s(?:/(.*))?$ /$1 break;\n' "$route" > /etc/nginx/album-prefix.conf
else
  : > /etc/nginx/album-prefix.conf
fi
